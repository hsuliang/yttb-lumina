import { state } from './state.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { callCloudflareTextAPI } from './cf-api.js';

/**
 * gemini-api.js
 * 封裝所有與 Google Gemini API 互動的邏輯。
 * 使用官方 @google/generative-ai SDK。
 */

/**
 * 【使用官方 SDK 版本】
 * 呼叫 Gemini API 並獲取回應。
 * SDK 會自動處理重試與指數退避。
 *
 * @param {string} apiKey - 您的 Gemini API Key。
 * @param {string} prompt - 要發送給模型的提示詞。
 * @param {boolean} forceJson - 是否強制使用 JSON 輸出模式。
 * @returns {Promise<string>} AI 生成的文本內容。
 * @throws {Error} 如果 API 請求最終失敗，則拋出錯誤。
 */
const modelCache = new Map();
const FALLBACK_MODEL = 'gemini-flash-latest';



export function isPollutedGeminiAudioOutput(text) {
  if (!text || typeof text !== 'string') return false;

  const pollutionPatterns = [
    /Let's check/i,
    /Let's search/i,
    /\bCould\b/i,
    /What about/i,
    /\bWait\b/i,
    /Search for/i,
    /I need to/i,
    /Based on/i,
    /The answer is/i
  ];

  const hasPollutionPhrase = pollutionPatterns.some(re => re.test(text));

  const bulletLines = text
    .split(/\r?\n/)
    .filter(line =>
      /^\s*[*-]\s+/.test(line) &&
      /Let's|Could|What about|Wait|search|check|audio/i.test(line)
    );

  const repeatedLineCount = (() => {
    const lines = text
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length >= 8);

    const counts = new Map();
    for (const line of lines) {
      counts.set(line, (counts.get(line) || 0) + 1);
    }
    return Math.max(0, ...counts.values());
  })();

  return hasPollutionPhrase || bulletLines.length >= 3 || repeatedLineCount >= 5;
}

const AUDIO_MAX_OUTPUT_TOKENS = 12000;

const AUDIO_TRANSCRIPTION_MODEL_ALLOWLIST = [
  {
    name: 'gemini-2.5-flash',
    includeEvenIfResolverOmits: false,
  },
  {
    name: 'gemini-2.5-flash-lite',
    includeEvenIfResolverOmits: true,
  },
];

function getAudioTranscriptionAllowlistText() {
  return AUDIO_TRANSCRIPTION_MODEL_ALLOWLIST
    .map(model => model.name)
    .join(', ');
}

function getAudioTranscriptionModelNames() {
  return AUDIO_TRANSCRIPTION_MODEL_ALLOWLIST.map(model => model.name);
}

const audioModelCooldowns = new Map();
const DEFAULT_AUDIO_RATE_LIMIT_COOLDOWN_MS = 60 * 1000;
const DEFAULT_AUDIO_TEMPORARY_ERROR_COOLDOWN_MS = 30 * 1000;

const AUDIO_MODEL_MIN_REQUEST_INTERVAL_MS = {
    'gemini-2.5-flash': 13 * 1000,
    'gemini-2.5-flash-lite': 7 * 1000,
};
const DEFAULT_AUDIO_MIN_REQUEST_INTERVAL_MS = 13 * 1000;

const audioRateLimitNextAvailableAt = new Map();

function getAudioRateLimitKey(apiKey, modelName) {
    return `${apiKey.slice(-8)}::${modelName}`;
}

function getAudioRateLimitNextAvailableAt(apiKey, modelName) {
    const rateLimitKey = getAudioRateLimitKey(apiKey, modelName);
    return audioRateLimitNextAvailableAt.get(rateLimitKey) || 0;
}

function getAudioModelMinRequestIntervalMs(modelName) {
    return AUDIO_MODEL_MIN_REQUEST_INTERVAL_MS[modelName] || DEFAULT_AUDIO_MIN_REQUEST_INTERVAL_MS;
}

function abortableDelay(ms, abortSignal) {
    if (!ms || ms <= 0) return Promise.resolve();

    return new Promise((resolve, reject) => {
        if (abortSignal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }

        const timeoutId = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);

        const onAbort = () => {
            clearTimeout(timeoutId);
            cleanup();
            reject(new DOMException('Aborted', 'AbortError'));
        };

        const cleanup = () => {
            if (abortSignal) {
                abortSignal.removeEventListener('abort', onAbort);
            }
        };

        if (abortSignal) {
            abortSignal.addEventListener('abort', onAbort, { once: true });
        }
    });
}

async function acquireAudioRateLimitSlot(apiKey, modelName, abortSignal, earliestAvailableAt = Date.now()) {
    const rateLimitKey = getAudioRateLimitKey(apiKey, modelName);
    const intervalMs = getAudioModelMinRequestIntervalMs(modelName);
    const now = Date.now();

    const nextAvailableAt = audioRateLimitNextAvailableAt.get(rateLimitKey) || 0;
    const scheduledAt = Math.max(now, nextAvailableAt, earliestAvailableAt);
    const waitMs = Math.max(0, scheduledAt - now);

    // 重要：先預約下一個可用時間，避免並行請求撞在一起
    audioRateLimitNextAvailableAt.set(rateLimitKey, scheduledAt + intervalMs);

    if (waitMs > 0) {
        console.log(`[Audio API] 等待 ${Math.ceil(waitMs / 1000)} 秒以符合 cooldown/RPM 限制：${modelName} with Key (...${apiKey.slice(-4)})`);
        await abortableDelay(waitMs, abortSignal);
    }
}

function getAudioCooldownKey(apiKey, modelName) {
  return `${apiKey.slice(-8)}::${modelName}`;
}

function getAudioModelCooldownRemainingMs(apiKey, modelName) {
  const cooldownKey = getAudioCooldownKey(apiKey, modelName);
  const cooldownUntil = audioModelCooldowns.get(cooldownKey) || 0;
  const remainingMs = cooldownUntil - Date.now();

  if (remainingMs <= 0) {
    audioModelCooldowns.delete(cooldownKey);
    return 0;
  }

  return remainingMs;
}

function markAudioModelCooldown(apiKey, modelName, retryDelayMs) {
  const cooldownKey = getAudioCooldownKey(apiKey, modelName);
  audioModelCooldowns.set(cooldownKey, Date.now() + retryDelayMs);
}

function extractRetryDelayMs(errorMessage, fallbackMs = DEFAULT_AUDIO_RATE_LIMIT_COOLDOWN_MS) {
  const retryDelayMatch = errorMessage.match(/retryDelay["']?\s*:\s*["']?([\d.]+)s/i);
  if (retryDelayMatch) {
    return Math.ceil(Number(retryDelayMatch[1]) * 1000);
  }

  const pleaseRetryMatch = errorMessage.match(/Please retry in\s+([\d.]+)s/i);
  if (pleaseRetryMatch) {
    return Math.ceil(Number(pleaseRetryMatch[1]) * 1000);
  }

  return fallbackMs;
}

/**
 * 解析特定 API Key 可用的所有 Flash 模型，並按版本從新到舊排序
 * @param {string} apiKey - Gemini API Key
 * @param {boolean} throwOnError - 是否在網路錯誤時直接拋出異常（用於儲存驗證）
 * @returns {Promise<string[]>} 排序後的模型名稱陣列
 */
export async function resolveFlashModelsList(apiKey, throwOnError = false) {
    if (!apiKey) {
        return [FALLBACK_MODEL];
    }

    if (modelCache.has(apiKey)) {
        const cached = modelCache.get(apiKey);
        if (Date.now() - cached.timestamp < 3600000) { // 1 hour TTL
            return cached.data;
        }
    }

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch models: ${response.status}`);
        }
        const data = await response.json();
        if (!data.models || !Array.isArray(data.models)) {
            throw new Error('Invalid response format');
        }

        // 1. 過濾：只保留包含 'flash' 且支援 'generateContent' 的正式模型，排除預覽版 (preview, lite) 及特定用途 (image, vision)
        const flashModels = data.models.filter(m => {
            const name = m.name || '';
            const nameLower = name.toLowerCase();
            const hasGenerateContent = m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent');
            return hasGenerateContent &&
                   nameLower.includes('flash') &&
                   !nameLower.includes('preview') &&
                   !nameLower.includes('lite') &&
                   !nameLower.includes('image') &&
                   !nameLower.includes('vision');
        });

        if (flashModels.length === 0) {
            return [FALLBACK_MODEL];
        }

        // 2. 解析版本號：提取 'gemini-X.Y-flash' 中的 X.Y 數字
        const parsedModels = flashModels.map(m => {
            const parts = m.name.split('/');
            const suffix = parts[parts.length - 1];
            const versionMatch = suffix.match(/gemini-(\d+\.?\d*)-flash/i);
            const versionNum = versionMatch ? parseFloat(versionMatch[1]) : 0;

            return { suffix, versionNum };
        });

        // 3. 版本號由高到低排序 (降冪)
        parsedModels.sort((a, b) => {
            if (b.versionNum !== a.versionNum) {
                return b.versionNum - a.versionNum;
            }
            return b.suffix.localeCompare(a.suffix, undefined, { numeric: true, sensitivity: 'base' });
        });

        const list = parsedModels.map(m => m.suffix).filter(m => m);

        // 確保極穩定的底線模型存在於清單中
        if (!list.includes(FALLBACK_MODEL)) {
            list.push(FALLBACK_MODEL);
        }

        console.log("Resolved Flash models order:", list);
        modelCache.set(apiKey, { data: list, timestamp: Date.now() });
        return list;
    } catch (e) {
        console.warn("[系統警告] 動態模型解析失敗，已啟用動態常綠降級方案:", FALLBACK_MODEL, e);
        if (throwOnError) throw e;
        return [FALLBACK_MODEL];
    }
}

let textKeyRotationIndex = 0;

function rotateTextKeyPool(keyPool) {
    if (!Array.isArray(keyPool) || keyPool.length <= 1) {
        return keyPool;
    }

    const startIndex = textKeyRotationIndex % keyPool.length;
    textKeyRotationIndex = (textKeyRotationIndex + 1) % keyPool.length;

    return [
        ...keyPool.slice(startIndex),
        ...keyPool.slice(0, startIndex)
    ];
}

const textModelCooldowns = new Map();
const DEFAULT_TEXT_RATE_LIMIT_COOLDOWN_MS = 60 * 1000;
const DEFAULT_TEXT_TEMPORARY_ERROR_COOLDOWN_MS = 30 * 1000;

function getTextCooldownKey(apiKey, modelName) {
    return `${apiKey.slice(-8)}::${modelName}`;
}

function getTextModelCooldownRemainingMs(apiKey, modelName) {
    const cooldownKey = getTextCooldownKey(apiKey, modelName);
    const cooldownUntil = textModelCooldowns.get(cooldownKey) || 0;
    const remainingMs = cooldownUntil - Date.now();

    if (remainingMs <= 0) {
        textModelCooldowns.delete(cooldownKey);
        return 0;
    }

    return remainingMs;
}

function markTextModelCooldown(apiKey, modelName, retryDelayMs) {
    const cooldownKey = getTextCooldownKey(apiKey, modelName);
    textModelCooldowns.set(cooldownKey, Date.now() + retryDelayMs);
}

/**
 * 呼叫 Gemini API 並獲取回應。
 * 自動進行金鑰池與多模型故障降級自癒重試。
 *
 * @param {string} apiKey - 偏好/目前輪替到的金鑰。
 * @param {string} prompt - 要發送給模型的提示詞。
 * @param {boolean} forceJson - 是否強制使用 JSON 輸出模式。
 * @returns {Promise<string>} AI 生成的文本內容。
 * @throws {Error} 如果所有嘗試均失敗。
 */
export async function callGeminiAPI(apiKey, prompt, forceJson = false, onStream = null, abortSignal = null, forceModel = null) {

    const aiEngine = localStorage.getItem('aliang-ai-engine') || 'auto';

    if (aiEngine === 'cloudflare' && !forceJson) {
        return await callCloudflareTextAPI(prompt, onStream, abortSignal, forceModel);
    }

    // 建立金鑰嘗試池
    let keyPool = [];
    try {
        const stored = localStorage.getItem('geminiApiKeys') || sessionStorage.getItem('geminiApiKeys');
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                keyPool = parsed.map(entry => entry.key);
            }
        }
    } catch (e) {
        console.warn("Failed to parse geminiApiKeys from storage", e);
    }

    // 確保傳入的偏好金鑰排在第一位，且已被加進池子中
    if (apiKey) {
        keyPool = keyPool.filter(k => k !== apiKey);
        keyPool.unshift(apiKey);
    }

    if (keyPool.length === 0) {
        if (aiEngine === 'auto' && !forceJson) {
            console.warn('無 Gemini Key，直接進入 Cloudflare 備援機制');
            return await callCloudflareTextAPI(prompt, onStream, abortSignal);
        }
        throw new Error("找不到有效的 API Key，請先設定。");
    }

    let lastError = null;

    // 第一層：輪詢金鑰池
    const textKeyPool = rotateTextKeyPool(keyPool);
    console.log(`[Text API] Round-robin key order:`, textKeyPool.map(key => `...${key.slice(-4)}`));

    for (const currentKey of textKeyPool) {
        const models = forceModel ? [forceModel] : await resolveFlashModelsList(currentKey);
        let lastModelError = null;

        // 第二層：依版本號從新到舊嘗試模型
        for (const modelName of models) {
            const cooldownRemainingMs = getTextModelCooldownRemainingMs(currentKey, modelName);
            if (cooldownRemainingMs > 0) {
                console.warn(`[Text API] 模型 ${modelName} with Key (...${currentKey.slice(-4)}) 冷卻中，剩餘 ${Math.ceil(cooldownRemainingMs / 1000)} 秒，跳過此組合...`);
                lastModelError = new Error(`Text API key/model cooldown: ${modelName} with Key (...${currentKey.slice(-4)})`);
                continue;
            }

            try {
                // UI 即時更新：顯示目前使用的模型型號
                const modelBadge = document.getElementById('modal-model-badge');
                const modelNameEl = document.getElementById('modal-model-name');
                if (modelBadge && modelNameEl) {
                    modelBadge.classList.remove('hidden');
                    modelNameEl.textContent = modelName;
                }

                console.log(`Trying API Key (...${currentKey.slice(-4)}) with Model: ${modelName}`);

                const genAI = new GoogleGenerativeAI(currentKey);

                const generationConfig = {
                    responseMimeType: forceJson ? "application/json" : "text/plain",
                };


                let terminologyInstruction = '';
                if (state.aiTerminologyRules && state.aiTerminologyRules.length > 0) {
                    const positiveTerms = state.aiTerminologyRules.filter(r => r.type === 'positive').map(r => r.term);
                    const negativeTerms = state.aiTerminologyRules.filter(r => r.type === 'negative').map(r => r.term);

                    if (positiveTerms.length > 0) {
                        terminologyInstruction += `\n請嚴格遵守以下專有名詞，必須輸出這些指定的正向詞彙：${positiveTerms.join(', ')}。`;
                    }
                    if (negativeTerms.length > 0) {
                        terminologyInstruction += `\n絕對禁用以下詞彙（或類似翻譯）：${negativeTerms.join(', ')}。`;
                    }
                }

                const systemInstruction = {
                    role: "system",
                    parts: [{ text: "請注意：你必須且只能使用「繁體中文（台灣）」進行回覆，絕對不可以使用簡體中文。" + terminologyInstruction }]
                };

                const model = genAI.getGenerativeModel({
                    model: modelName,
                    generationConfig: generationConfig,
                    systemInstruction: systemInstruction,
                });

                const requestOptions = abortSignal ? { signal: abortSignal } : undefined;
                let responseText = "";

                if (onStream && !forceJson) {
                    onStream('', `Gemini (${modelName}) 思考中...`);
                    const result = await model.generateContentStream(prompt, requestOptions);
                    for await (const chunk of result.stream) {
                        const chunkText = chunk.text();
                        responseText += chunkText;
                        onStream(chunkText, responseText);
                    }

                    // 為了相容後續的安全檢查，我們模擬 response 物件
                    const response = await result.response;
                    if (response.promptFeedback && response.promptFeedback.blockReason) {
                        throw new Error(`請求因安全設定而被阻擋，原因：${response.promptFeedback.blockReason}`);
                    }
                    if (!response.candidates || response.candidates[0].finishReason === 'SAFETY') {
                        throw new Error("內容因違反安全政策而被 Google AI 阻擋。請檢查您的原始字幕內容是否包含敏感詞彙。");
                    }
                } else {
                    const result = await model.generateContent(prompt, requestOptions);
                    const response = result.response;

                    if (response.promptFeedback && response.promptFeedback.blockReason) {
                        throw new Error(`請求因安全設定而被阻擋，原因：${response.promptFeedback.blockReason}`);
                    }

                    if (!response.candidates || response.candidates[0].finishReason === 'SAFETY') {
                        throw new Error("內容因違反安全政策而被 Google AI 阻擋。請檢查您的原始字幕內容是否包含敏感詞彙。");
                    }
                    responseText = response.text();
                }

                // 成功後更新金鑰池的計數器
                try {
                    let isSession = false;
                    let stored = localStorage.getItem('geminiApiKeys');
                    if (!stored) {
                        stored = sessionStorage.getItem('geminiApiKeys');
                        isSession = true;
                    }
                    if (stored) {
                        const parsed = JSON.parse(stored);
                        if (Array.isArray(parsed)) {
                            const entry = parsed.find(e => e.key === currentKey);
                            if (entry) {
                                entry.count = (entry.count || 0) + 1;
                                if (isSession) {
                                    sessionStorage.setItem('geminiApiKeys', JSON.stringify(parsed));
                                } else {
                                    localStorage.setItem('geminiApiKeys', JSON.stringify(parsed));
                                }
                                console.log(`[API Key Usage Updated] Key: ...${currentKey.slice(-4)}, Count: ${entry.count}`);
                            }
                        }
                    }
                } catch (ex) {
                    console.warn("Failed to update key count in storage", ex);
                }

                return responseText;

            } catch (error) {
                lastModelError = error;
                const errorMsg = error.message || '';
                console.warn(`Model ${modelName} with Key (...${currentKey.slice(-4)}) failed: ${errorMsg}`);

                // ★ 改善錯誤分類邏輯：
                const isModelUnavailable =
                    errorMsg.includes("limit: 0") ||
                    errorMsg.includes("limit=0") ||
                    errorMsg.includes("limit 0");

                const isQuotaOrRateLimit =
                    errorMsg.includes("429") ||
                    errorMsg.includes("Quota exceeded") ||
                    errorMsg.includes("rate limit") ||
                    errorMsg.includes("exhausted");

                const isRealKeyError = errorMsg.includes("API key not valid") ||
                                       errorMsg.includes("not valid") ||
                                       errorMsg.includes("invalid") ||
                                       (errorMsg.includes("403") && !errorMsg.includes("limit"));

                if (error.name === 'AbortError' || errorMsg.includes('abort') || errorMsg.includes('The user aborted a request')) {
                    console.warn("使用者主動取消請求，中止所有嘗試。");
                    throw error;
                }

                if (isRealKeyError) {
                    console.warn("[Text API] Detected API key error, switching to next key...");
                    break; // 直接跳出內層模型循環，換下一個金鑰
                }

                if (isQuotaOrRateLimit && !isModelUnavailable) {
                    const retryDelayMs = extractRetryDelayMs(errorMsg, DEFAULT_TEXT_RATE_LIMIT_COOLDOWN_MS);
                    markTextModelCooldown(currentKey, modelName, retryDelayMs);
                    console.warn(`[Text API] 配額或頻率限制 (429)，模型 ${modelName} with Key (...${currentKey.slice(-4)}) 冷卻 ${Math.ceil(retryDelayMs / 1000)} 秒，嘗試下一個 Text 模型或下一組 Key...`);
                    continue; // 嘗試同一把 key 的下一個模型
                }

                if (errorMsg.includes("503") || errorMsg.includes("high demand") || errorMsg.includes("Failed to parse stream") || errorMsg.includes("overloaded") || errorMsg.includes("Service Unavailable")) {
                    markTextModelCooldown(currentKey, modelName, DEFAULT_TEXT_TEMPORARY_ERROR_COOLDOWN_MS);
                    console.warn(`[Text API] 模型 ${modelName} 暫時不可用，冷卻 ${Math.ceil(DEFAULT_TEXT_TEMPORARY_ERROR_COOLDOWN_MS / 1000)} 秒，嘗試下一個模型...`);
                    continue;
                }

                console.log(`[Text API] 模型 ${modelName} 暫時不可用，嘗試下一個模型...`);
            }
        }

        lastError = lastModelError;
    }

    const finalErrorMsg = lastError ? lastError.message : "未知錯誤";

    if (aiEngine === 'auto' && !forceJson) {
        console.warn('Gemini 失敗，觸發 Cloudflare 備援機制...', finalErrorMsg);
        try {
            return await callCloudflareTextAPI(prompt, onStream, abortSignal);
        } catch (cfErr) {
            console.error('Cloudflare 備援亦失敗:', cfErr);
            throw new Error(translateError(finalErrorMsg) + `\n(備援失敗: ${cfErr.message})`);
        }
    }

    throw new Error(translateError(finalErrorMsg));
}

let audioKeyRotationIndex = 0;

function rotateAudioKeyPool(keyPool) {
    if (!Array.isArray(keyPool) || keyPool.length <= 1) {
        return keyPool;
    }

    const startIndex = audioKeyRotationIndex % keyPool.length;
    audioKeyRotationIndex = (audioKeyRotationIndex + 1) % keyPool.length;

    return [
        ...keyPool.slice(startIndex),
        ...keyPool.slice(0, startIndex)
    ];
}

/**
 * 呼叫 Gemini API 進行音訊轉寫（multimodal: text + audio）。
 * 複用金鑰池輪替與模型降級邏輯。
 *
 * @param {string} apiKey - 偏好的 API Key。
 * @param {string} audioBase64 - 音訊檔案的 base64 編碼字串。
 * @param {string} mimeType - 音訊 MIME 類型，如 "audio/mp3"。
 * @param {string} promptText - 轉寫指令 prompt。
 * @returns {Promise<string>} AI 生成的 SRT 文字。
 */
export async function callGeminiAudioAPI(apiKey, audioBase64, mimeType, promptText, onStream = null, abortSignal = null) {


    // 建立金鑰嘗試池（與 callGeminiAPI 相同邏輯）
    let keyPool = [];
    try {
        const stored = localStorage.getItem('geminiApiKeys') || sessionStorage.getItem('geminiApiKeys');
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                keyPool = parsed.map(entry => entry.key);
            }
        }
    } catch (e) {
        console.warn("Failed to parse geminiApiKeys from storage", e);
    }

    if (apiKey) {
        keyPool = keyPool.filter(k => k !== apiKey);
        keyPool.unshift(apiKey);
    }

    if (keyPool.length === 0) {
        throw new Error("找不到有效的 API Key，請先設定。");
    }

    let lastError = null;

    const audioKeyPool = rotateAudioKeyPool(keyPool);
    console.log(`[Audio API] Round-robin key order:`, audioKeyPool.map(key => `...${key.slice(-4)}`));

    // 1. 先依照 audioKeyPool 建立 candidate list
    const candidates = [];
    const now = Date.now();
    const audioModels = getAudioTranscriptionModelNames();

    for (let keyIndex = 0; keyIndex < audioKeyPool.length; keyIndex++) {
        const currentKey = audioKeyPool[keyIndex];



        for (let modelIndex = 0; modelIndex < audioModels.length; modelIndex++) {
            const modelName = audioModels[modelIndex];
            const cooldownRemainingMs = getAudioModelCooldownRemainingMs(currentKey, modelName);
            const cooldownReadyAt = cooldownRemainingMs > 0 ? now + cooldownRemainingMs : now;
            const rateReadyAt = Math.max(now, getAudioRateLimitNextAvailableAt(currentKey, modelName));
            const availableAt = Math.max(cooldownReadyAt, rateReadyAt);

            candidates.push({
                currentKey,
                modelName,
                keyIndex,
                modelIndex,
                cooldownRemainingMs,
                cooldownReadyAt,
                rateReadyAt,
                availableAt
            });
        }
    }

    if (candidates.length === 0) {
        throw new Error(
            `找不到可用的 Gemini 音訊轉錄模型。目前 Audio allowlist: ${getAudioTranscriptionAllowlistText()}`
        );
    }

    // 2. candidate list 依 availableAt 排序
    candidates.sort((a, b) => {
        if (a.availableAt !== b.availableAt) {
            return a.availableAt - b.availableAt; // 越早可用越前面
        }
        if (a.keyIndex !== b.keyIndex) {
            return a.keyIndex - b.keyIndex; // 維持 round-robin key 順序
        }
        return a.modelIndex - b.modelIndex; // 維持 model 原本優先順序
    });

    const failedKeys = new Set();

    // 3. 依序嘗試 candidate
    for (const candidate of candidates) {
        const { currentKey, modelName, availableAt } = candidate;

        if (failedKeys.has(currentKey)) {
            continue; // 跳過同為無效 key 的其他 candidate
        }

        const waitTimeMs = Math.max(0, availableAt - Date.now());
        if (waitTimeMs > 0) {
            console.log(`[Audio API] Selected fastest available candidate: ${modelName} with Key (...${currentKey.slice(-4)}), wait ${Math.ceil(waitTimeMs / 1000)} 秒`);
        } else {
            console.log(`[Audio API] Selected fastest available candidate: ${modelName} with Key (...${currentKey.slice(-4)}), wait 0 秒`);
        }

        try {
            const modelBadge = document.getElementById('modal-model-badge');
            const modelNameEl = document.getElementById('modal-model-name');
            if (modelBadge && modelNameEl) {
                modelBadge.classList.remove('hidden');
                modelNameEl.textContent = modelName;
            }

            // ★ Tab0 專屬模型 badge
            const tab0Badge = document.getElementById('tab0-model-badge');
            if (tab0Badge) {
                tab0Badge.classList.remove('hidden');
                tab0Badge.textContent = `模型：${modelName}`;
            }

            console.log(`[Audio API] Trying Key (...${currentKey.slice(-4)}) with Model: ${modelName}`);

            const genAI = new GoogleGenerativeAI(currentKey);

            const generationConfig = {
                responseMimeType: "text/plain",
                temperature: 0,
                maxOutputTokens: AUDIO_MAX_OUTPUT_TOKENS,
            };

            let terminologyInstruction = '';
            if (state.aiTerminologyRules && state.aiTerminologyRules.length > 0) {
                const positiveTerms = state.aiTerminologyRules.filter(r => r.type === 'positive').map(r => r.term);
                const negativeTerms = state.aiTerminologyRules.filter(r => r.type === 'negative').map(r => r.term);

                if (positiveTerms.length > 0) {
                    terminologyInstruction += `\n請嚴格遵守以下專有名詞，必須輸出這些指定的正向詞彙：${positiveTerms.join(', ')}。`;
                }
                if (negativeTerms.length > 0) {
                    terminologyInstruction += `\n絕對禁用以下詞彙（或類似翻譯）：${negativeTerms.join(', ')}。`;
                }
            }

            const strictInstruction = `你是一個嚴格的 SRT 字幕轉寫器。
你必須且只能使用繁體中文（台灣）。
你只能輸出使用者指定格式。
如果任務要求 SRT，你只能輸出合法 SRT。
不得輸出任何說明、推理、分析、自我檢查、搜尋、猜測、候選答案。
不得輸出 Markdown。
不得輸出 bullet points。
不得輸出 Let's check、Let's search、Could、What about、Wait 等文字。
不得重複同一句話。
如果聽不清楚，只能在字幕文字中寫 [聽不清楚]，不要自行推測。
請只根據音訊實際聽到的內容轉寫，不要用常識補答案。`;

            const systemInstruction = {
                role: "system",
                parts: [{ text: strictInstruction + terminologyInstruction }]
            };

            const model = genAI.getGenerativeModel({
                model: modelName,
                generationConfig: generationConfig,
                systemInstruction: systemInstruction,
            });

            const parts = [
                { text: promptText },
                {
                    inlineData: {
                        data: audioBase64,
                        mimeType: mimeType,
                    },
                },
            ];

            const requestOptions = abortSignal ? { signal: abortSignal } : undefined;
            let responseText = "";

            await acquireAudioRateLimitSlot(currentKey, modelName, abortSignal, availableAt);

            if (onStream) {
                const result = await model.generateContentStream({ contents: [{ role: "user", parts }] }, requestOptions);
                for await (const chunk of result.stream) {
                    const chunkText = chunk.text();
                    responseText += chunkText;
                    onStream(chunkText, responseText);
                }
                const response = await result.response;
                if (response.promptFeedback && response.promptFeedback.blockReason) {
                    throw new Error(`請求因安全設定而被阻擋，原因：${response.promptFeedback.blockReason}`);
                }
                if (!response.candidates || response.candidates[0].finishReason === 'SAFETY') {
                    throw new Error("內容因違反安全政策而被 Google AI 阻擋。");
                }
                if (response.candidates && response.candidates[0].finishReason === 'MAX_TOKENS') {
                    console.warn("[Audio API] 警告：生成的內容已達到最大 token 限制，可能會被截斷。");
                    if (isPollutedGeminiAudioOutput(responseText)) {
                        console.warn("[Audio API] MAX_TOKENS 且偵測到污染輸出，可能陷入重複迴圈。Trying next audio model...");
                        const pollutedError = new Error("POLLUTED_AUDIO_TRANSCRIPTION_OUTPUT");
                        pollutedError.name = "PollutedAudioOutputError";
                        throw pollutedError;
                    }
                }
            } else {
                const result = await model.generateContent({ contents: [{ role: "user", parts }] }, requestOptions);
                const response = result.response;

                if (response.promptFeedback && response.promptFeedback.blockReason) {
                    throw new Error(`請求因安全設定而被阻擋，原因：${response.promptFeedback.blockReason}`);
                }
                if (!response.candidates || response.candidates[0].finishReason === 'SAFETY') {
                    throw new Error("內容因違反安全政策而被 Google AI 阻擋。");
                }
                responseText = response.text();

                if (response.candidates && response.candidates[0].finishReason === 'MAX_TOKENS') {
                    console.warn("[Audio API] 警告：生成的內容已達到最大 token 限制，可能會被截斷。");
                    if (isPollutedGeminiAudioOutput(responseText)) {
                        console.warn("[Audio API] MAX_TOKENS 且偵測到污染輸出，可能陷入重複迴圈。Trying next audio model...");
                        const pollutedError = new Error("POLLUTED_AUDIO_TRANSCRIPTION_OUTPUT");
                        pollutedError.name = "PollutedAudioOutputError";
                        throw pollutedError;
                    }
                }
            }

            if (isPollutedGeminiAudioOutput(responseText)) {
                console.warn("[Audio API] Polluted transcription output detected. Trying next candidate...");
                const pollutedError = new Error("POLLUTED_AUDIO_TRANSCRIPTION_OUTPUT");
                pollutedError.name = "PollutedAudioOutputError";
                throw pollutedError;
            }

            // 更新金鑰使用計數
            try {
                let isSession = false;
                let stored = localStorage.getItem('geminiApiKeys');
                if (!stored) {
                    stored = sessionStorage.getItem('geminiApiKeys');
                    isSession = true;
                }
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (Array.isArray(parsed)) {
                        const entry = parsed.find(e => e.key === currentKey);
                        if (entry) {
                            entry.count = (entry.count || 0) + 1;
                            if (isSession) {
                                sessionStorage.setItem('geminiApiKeys', JSON.stringify(parsed));
                            } else {
                                localStorage.setItem('geminiApiKeys', JSON.stringify(parsed));
                            }
                        }
                    }
                }
            } catch (ex) {
                console.warn("Failed to update key count in storage", ex);
            }

            return responseText;

        } catch (error) {
            lastError = error;
            const errorMsg = error.message || '';
            const lowerErrorMsg = errorMsg.toLowerCase();
            console.warn(`[Audio API] Model ${modelName} with Key (...${currentKey.slice(-4)}) failed: ${errorMsg}`);

            // ★ 改善錯誤分類邏輯：
            const isModelUnavailable =
                errorMsg.includes("limit: 0") ||
                errorMsg.includes("limit=0") ||
                errorMsg.includes("limit 0") ||
                lowerErrorMsg.includes("404") ||
                lowerErrorMsg.includes("not found") ||
                lowerErrorMsg.includes("unsupported") ||
                (lowerErrorMsg.includes("400") && lowerErrorMsg.includes("model"));

            const isQuotaOrRateLimit =
                errorMsg.includes("429") ||
                errorMsg.includes("Quota exceeded") ||
                errorMsg.includes("rate limit") ||
                errorMsg.includes("exhausted");

            const isRealKeyError = errorMsg.includes("API key not valid") ||
                                   errorMsg.includes("not valid") ||
                                   errorMsg.includes("invalid") ||
                                   (errorMsg.includes("403") && !errorMsg.includes("limit"));

            if (error.name === 'AbortError' || errorMsg.includes('abort') || errorMsg.includes('The user aborted a request')) {
                console.warn("[Audio API] 使用者主動取消請求，中止所有嘗試。");
                throw error;
            }

            if (isRealKeyError) {
                console.warn("[Audio API] Key 無效，切換到下一個 candidate...");
                failedKeys.add(currentKey);
                continue; // 換下一個 candidate
            }

            if (isQuotaOrRateLimit && !isModelUnavailable) {
                const retryDelayMs = extractRetryDelayMs(errorMsg);
                markAudioModelCooldown(currentKey, modelName, retryDelayMs);
                console.warn(`[Audio API] 配額或頻率限制 (429)，模型 ${modelName} with Key (...${currentKey.slice(-4)}) 冷卻 ${Math.ceil(retryDelayMs / 1000)} 秒，嘗試下一個 candidate...`);
                continue;
            }

            if (
                errorMsg.includes("503") ||
                errorMsg.includes("high demand") ||
                errorMsg.includes("Failed to parse stream") ||
                errorMsg.includes("overloaded") ||
                errorMsg.includes("Service Unavailable")
            ) {
                markAudioModelCooldown(currentKey, modelName, DEFAULT_AUDIO_TEMPORARY_ERROR_COOLDOWN_MS);
                console.warn(`[Audio API] 模型 ${modelName} 暫時不可用，冷卻 ${Math.ceil(DEFAULT_AUDIO_TEMPORARY_ERROR_COOLDOWN_MS / 1000)} 秒，嘗試下一個 candidate...`);
                continue;
            }

            console.log(`[Audio API] 模型 ${modelName} 暫時不可用或請求失敗 (${errorMsg})，嘗試下一個 candidate...`);
        }
    }

    const finalErrorMsg = lastError ? lastError.message : "未知錯誤";
    throw new Error(translateError(finalErrorMsg));
}

export function translateError(message) {
    if (!message) return "【系統錯誤】未知錯誤";

    // Audio polluted output
    if (message.includes("POLLUTED_AUDIO_TRANSCRIPTION_OUTPUT")) {
        return "【語音辨識輸出異常】Gemini 回傳了非 SRT 的推理、重複或自我檢查內容，系統已阻止污染文字進入字幕。請稍後重試，或改用較短音訊片段。";
    }

    // 503 / High Demand / Overloaded
    if (message.includes("503") || message.includes("high demand") || message.includes("overloaded") || message.includes("Service Unavailable")) {
        return "【AI 伺服器繁忙 (overloaded)】Gemini API 目前負載過高或正處於全球尖峰時段。這通常是暫時的，請稍候一兩分鐘後重試。";
    }

    // 429 / Rate Limit / Quota Exceeded / cooldown
    if (message.includes("429") || message.includes("Quota exceeded") || message.includes("exhausted") || message.includes("rate limit") || message.includes("Too Many Requests") || message.includes("cooldown")) {
        return `Gemini API 配額或頻率限制已達上限

目前可用的 Gemini API Key 或模型暫時無法處理音訊。
可能原因：
1. 短時間請求過多，觸發 RPM 限制
2. API Key 或模型正在冷卻中
3. 今日免費額度或專案配額已達上限
4. Google 模型服務暫時繁忙

建議稍後再試，或改用較短音檔，或確認 API Key / Project 的可用狀態。`;
    }

    // 400 / 403 / Invalid API Key
    if (message.includes("API key not valid") || message.includes("not valid") || message.includes("invalid") || message.includes("400") || message.includes("403")) {
        return "【無效的金鑰】您輸入的 Gemini API Key 格式不正確或已被停用，請至 Google AI Studio 重新確認並貼上正確的金鑰。";
    }

    // Safety
    if (message.includes("SAFETY") || message.includes("blockReason")) {
        return "【內容安全阻擋】由於輸入內容可能包含敏感詞彙，已被 Google AI 的安全過濾機制阻擋。";
    }

    // Default
    return `【系統錯誤】${message}`;
}