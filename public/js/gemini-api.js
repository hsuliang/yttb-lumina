import { state } from './state.js';
import { buildTranscriptionTerminologyInstruction, TEXT_GENERATION_SYSTEM_INSTRUCTION } from './prompt-policy.js';
import { callCloudflareTextAPI } from './cf-api.js';
import {
    GEMINI_FALLBACK_MODEL,
    GEMINI_REQUEST_INTERVAL_MS,
    buildApprovedFlashModelList,
    classifyGeminiError,
    filterModelsForKey,
    isGeminiKeyAvailable,
} from './gemini-routing.js';

/**
 * gemini-api.js
 * 封裝所有與 Google Gemini API 互動的邏輯。
 * 使用官方 Gemini REST API，並由本模組統一處理串流解析。
 */

/**
 * 【使用官方 Gemini REST API】
 * 呼叫 Gemini API 並獲取回應。
 * 重試、節流與金鑰輪替由本模組統一處理。
 *
 * @param {string} apiKey - 您的 Gemini API Key。
 * @param {string} prompt - 要發送給模型的提示詞。
 * @param {boolean} forceJson - 是否強制使用 JSON 輸出模式。
 * @returns {Promise<string>} AI 生成的文本內容。
 * @throws {Error} 如果 API 請求最終失敗，則拋出錯誤。
 */
const modelCache = new Map();
const keyNextRequestAt = new Map();
const GEMINI_CONTENT_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_BLOCKED_FINISH_REASONS = new Set([
    'SAFETY',
    'BLOCKLIST',
    'PROHIBITED_CONTENT',
    'RECITATION',
    'LANGUAGE',
    'SPII',
]);

function createGeminiError(message, { status = 0, code = '', response = null, errorDetails = [] } = {}) {
    const error = new Error(message);
    if (status) error.status = status;
    if (code) error.code = code;
    if (response) error.geminiResponse = response;
    if (errorDetails && (Array.isArray(errorDetails) ? errorDetails.length > 0 : true)) {
        error.errorDetails = errorDetails;
    }
    return error;
}

function createGeminiStreamParseError(cause = null) {
    const error = createGeminiError('[Gemini API] Failed to parse stream', { code: 'stream_parse' });
    if (cause) error.cause = cause;
    return error;
}

function getGeminiResponseText(response) {
    return response?.candidates?.[0]?.content?.parts
        ?.map(part => typeof part?.text === 'string' ? part.text : '')
        .join('') || '';
}

function validateGeminiResponse(response, responseText = '') {
    const blockReason = response?.promptFeedback?.blockReason;
    if (blockReason) {
        throw createGeminiError(`請求因安全設定而被阻擋，原因：${blockReason}`, {
            code: 'content_safety',
            response,
        });
    }

    if (response?.promptFeedback) {
        throw createGeminiError('請求因 Gemini 安全設定而沒有可用內容。', {
            code: 'content_safety',
            response,
        });
    }

    const candidate = response?.candidates?.[0];
    if (!candidate) {
        throw createGeminiError('Gemini 回應沒有候選內容。', {
            code: 'empty_response',
            response,
        });
    }

    const finishReason = String(candidate.finishReason || '').toUpperCase();
    if (GEMINI_BLOCKED_FINISH_REASONS.has(finishReason)) {
        throw createGeminiError(`內容因 Gemini 安全政策而被阻擋，原因：${candidate.finishReason}`, {
            code: 'content_safety',
            response,
        });
    }

    return responseText || getGeminiResponseText(response);
}

function findSseDelimiter(buffer) {
    const delimiters = ['\r\n\r\n', '\n\n', '\r\r'];
    let index = -1;
    let length = 0;

    delimiters.forEach(delimiter => {
        const candidateIndex = buffer.indexOf(delimiter);
        if (candidateIndex !== -1 && (index === -1 || candidateIndex < index)) {
            index = candidateIndex;
            length = delimiter.length;
        }
    });

    return index === -1 ? null : { index, length };
}

/**
 * Parse one Gemini SSE event. Gemini normally sends `data: {json}` events,
 * but accepting a raw JSON event keeps the transport compatible with proxies
 * that remove the SSE framing while preserving the same response payload.
 */
export function parseGeminiSseEvent(eventText) {
    const lines = String(eventText || '').split(/\r\n|\n|\r/);
    const dataLines = lines
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).replace(/^ /, ''));

    if (dataLines.length === 0) {
        const raw = lines.join('\n').trim();
        if (!raw || raw === '[DONE]' || lines.some(line => line.startsWith('event:'))) return null;
        try {
            return JSON.parse(raw);
        } catch (error) {
            throw createGeminiStreamParseError(error);
        }
    }

    const payload = dataLines.join('\n').trim();
    if (!payload || payload === '[DONE]') return null;

    try {
        return JSON.parse(payload);
    } catch (error) {
        throw createGeminiStreamParseError(error);
    }
}

function mergeGeminiStreamResponse(target, response) {
    if (response?.promptFeedback) target.promptFeedback = response.promptFeedback;
    if (Array.isArray(response?.candidates) && response.candidates.length > 0) {
        target.candidates = response.candidates;
    }
    if (response?.usageMetadata) target.usageMetadata = response.usageMetadata;
    return target;
}

async function readGeminiStream(response, onStream) {
    if (!response.body) throw createGeminiStreamParseError();

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const aggregateResponse = {};
    let buffer = '';
    let eventCount = 0;
    let responseText = '';

    const processEvent = eventText => {
        const parsed = parseGeminiSseEvent(eventText);
        if (!parsed) return;
        eventCount += 1;
        mergeGeminiStreamResponse(aggregateResponse, parsed);

        const chunkText = getGeminiResponseText(parsed);
        if (chunkText) {
            responseText += chunkText;
            onStream?.(chunkText, responseText);
        }
    };

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let delimiter = findSseDelimiter(buffer);
            while (delimiter) {
                const eventText = buffer.slice(0, delimiter.index);
                buffer = buffer.slice(delimiter.index + delimiter.length);
                processEvent(eventText);
                delimiter = findSseDelimiter(buffer);
            }
        }

        buffer += decoder.decode();
        if (buffer.trim()) processEvent(buffer);
    } catch (error) {
        if (error?.name === 'AbortError') throw error;
        if (error?.code === 'stream_parse') throw error;
        throw createGeminiStreamParseError(error);
    } finally {
        reader.releaseLock();
    }

    if (eventCount === 0) throw createGeminiStreamParseError();
    return { response: aggregateResponse, text: responseText };
}

async function readGeminiErrorResponse(response) {
    const rawBody = await response.text();
    let payload = null;
    try {
        payload = rawBody ? JSON.parse(rawBody) : null;
    } catch (_) {
        // Keep the raw response text in the error when the server did not return JSON.
    }

    const message = payload?.error?.message || rawBody || `${response.status} ${response.statusText}`.trim();
    return createGeminiError(`[Gemini API ${response.status}] ${message}`, {
        status: response.status,
        code: payload?.error?.status || '',
        errorDetails: payload?.error?.details || [],
        response: payload,
    });
}

async function requestGeminiContent({ apiKey, modelName, body, stream, abortSignal }) {
    const task = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    const url = `${GEMINI_CONTENT_API_BASE_URL}/${encodeURIComponent(modelName)}:${task}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
        signal: abortSignal || undefined,
    });

    if (!response.ok) throw await readGeminiErrorResponse(response);
    return response;
}

async function readGeminiJsonResponse(response) {
    const rawBody = await response.text();
    if (!rawBody.trim()) {
        throw createGeminiError('Gemini 回應為空。', { code: 'empty_response' });
    }

    try {
        return JSON.parse(rawBody);
    } catch (error) {
        throw createGeminiError('Gemini 回應 JSON 解析失敗。', { code: 'response_parse', response: rawBody });
    }
}

async function generateGeminiContent({
    apiKey,
    modelName,
    contents,
    generationConfig,
    systemInstruction,
    onStream = null,
    streamStatus = null,
    abortSignal = null,
}) {
    const stream = Boolean(onStream);
    if (stream && streamStatus) onStream('', streamStatus);

    const body = { contents, generationConfig, systemInstruction };
    const response = await requestGeminiContent({ apiKey, modelName, body, stream, abortSignal });

    if (stream) {
        const streamed = await readGeminiStream(response, onStream);
        return {
            text: validateGeminiResponse(streamed.response, streamed.text),
            response: streamed.response,
        };
    }

    const payload = await readGeminiJsonResponse(response);
    return {
        text: validateGeminiResponse(payload),
        response: payload,
    };
}

function readStoredKeyEntries() {
    let isSession = false;
    let stored = localStorage.getItem('geminiApiKeys');
    if (!stored) {
        stored = sessionStorage.getItem('geminiApiKeys');
        isSession = true;
    }

    if (!stored) return { entries: [], isSession };

    try {
        const parsed = JSON.parse(stored);
        const entries = Array.isArray(parsed)
            ? parsed.map(entry => typeof entry === 'string' ? { key: entry, count: 0 } : entry).filter(entry => entry?.key)
            : [];
        return { entries, isSession };
    } catch (error) {
        console.warn('Failed to parse geminiApiKeys from storage', error);
        return { entries: [], isSession };
    }
}

function writeStoredKeyEntries(entries, isSession) {
    const storage = isSession ? sessionStorage : localStorage;
    storage.setItem('geminiApiKeys', JSON.stringify(entries));
}

function updateStoredKeyEntry(apiKey, updater) {
    const { entries, isSession } = readStoredKeyEntries();
    const entry = entries.find(item => item.key === apiKey);
    if (!entry) return null;
    updater(entry);
    writeStoredKeyEntries(entries, isSession);
    return entry;
}

function getStoredKeyEntry(apiKey) {
    return readStoredKeyEntries().entries.find(entry => entry.key === apiKey) || { key: apiKey, count: 0 };
}

function buildKeyPool(preferredKey) {
    const now = Date.now();
    const { entries } = readStoredKeyEntries();
    let availableEntries = entries.filter(entry => isGeminiKeyAvailable(entry, now));

    if (availableEntries.length === 0 && preferredKey && entries.length === 0) {
        availableEntries = [{ key: preferredKey, count: 0 }];
    }

    availableEntries.sort((a, b) => (a.count || 0) - (b.count || 0));
    const keys = availableEntries.map(entry => entry.key);

    if (preferredKey && keys.includes(preferredKey)) {
        return [preferredKey, ...keys.filter(key => key !== preferredKey)];
    }
    return keys;
}

function getPacificDayKey(timestamp = Date.now()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date(timestamp));
}

function recordKeyAttempt(apiKey, modelName) {
    updateStoredKeyEntry(apiKey, entry => {
        const day = getPacificDayKey();
        entry.usageByModel = entry.usageByModel || {};
        const usage = entry.usageByModel[modelName];
        entry.usageByModel[modelName] = usage?.day === day
            ? { day, requests: (usage.requests || 0) + 1 }
            : { day, requests: 1 };
        entry.lastAttemptAt = Date.now();
    });
}

function recordKeySuccess(apiKey) {
    updateStoredKeyEntry(apiKey, entry => {
        entry.count = (entry.count || 0) + 1;
        entry.consecutiveFailures = 0;
        entry.lastErrorReason = '';
        if (Number(entry.cooldownUntil || 0) <= Date.now()) {
            entry.cooldownUntil = 0;
        }
    });
}

function markKeyCooldown(apiKey, decision) {
    updateStoredKeyEntry(apiKey, entry => {
        entry.consecutiveFailures = (entry.consecutiveFailures || 0) + 1;
        entry.lastErrorReason = decision.reason;
        entry.cooldownUntil = Math.max(
            Number(entry.cooldownUntil || 0),
            Date.now() + Number(decision.cooldownMs || 0),
        );
    });
}

function markModelCooldown(apiKey, modelName, decision) {
    updateStoredKeyEntry(apiKey, entry => {
        entry.modelCooldowns = entry.modelCooldowns || {};
        entry.modelCooldowns[modelName] = Math.max(
            Number(entry.modelCooldowns[modelName] || 0),
            Date.now() + Number(decision.cooldownMs || 0),
        );
        entry.lastErrorReason = decision.reason;
    });
}

function abortableDelay(delayMs, abortSignal) {
    if (delayMs <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const finish = () => {
            if (abortSignal) abortSignal.removeEventListener('abort', handleAbort);
            resolve();
        };
        const timeoutId = setTimeout(finish, delayMs);
        const handleAbort = () => {
            clearTimeout(timeoutId);
            const error = new Error('The user aborted a request');
            error.name = 'AbortError';
            reject(error);
        };
        if (!abortSignal) return;
        if (abortSignal.aborted) {
            handleAbort();
        } else {
            abortSignal.addEventListener('abort', handleAbort, { once: true });
        }
    });
}

async function waitForKeyRequestSlot(apiKey, abortSignal) {
    const now = Date.now();
    const storedEntry = getStoredKeyEntry(apiKey);
    const readyAt = Math.max(
        now,
        Number(storedEntry.nextRequestAt || 0),
        Number(keyNextRequestAt.get(apiKey) || 0),
    );
    const nextRequestAt = readyAt + GEMINI_REQUEST_INTERVAL_MS;

    keyNextRequestAt.set(apiKey, nextRequestAt);
    updateStoredKeyEntry(apiKey, entry => {
        entry.nextRequestAt = Math.max(Number(entry.nextRequestAt || 0), nextRequestAt);
    });

    await abortableDelay(readyAt - now, abortSignal);
}

/**
 * 解析特定 API Key 可用的所有 Flash 模型，並按版本從新到舊排序
 * @param {string} apiKey - Gemini API Key
 * @param {boolean} throwOnError - 是否在網路錯誤時直接拋出異常（用於儲存驗證）
 * @returns {Promise<string[]>} 排序後的模型名稱陣列
 */
export async function resolveFlashModelsList(apiKey, throwOnError = false) {
    if (!apiKey) {
        return [GEMINI_FALLBACK_MODEL];
    }
    
    if (!throwOnError && modelCache.has(apiKey)) {
        const cached = modelCache.get(apiKey);
        if (Date.now() - cached.timestamp < 3600000) { // 1 hour TTL
            return cached.data;
        }
    }

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${apiKey}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch models: ${response.status}`);
        }
        const data = await response.json();
        if (!data.models || !Array.isArray(data.models)) {
            throw new Error('Invalid response format');
        }

        const list = buildApprovedFlashModelList(data.models);

        console.log("Resolved Flash models order:", list);
        modelCache.set(apiKey, { data: list, timestamp: Date.now() });
        return list;
    } catch (e) {
        console.warn("[系統警告] 動態模型解析失敗，已啟用動態常綠降級方案:", GEMINI_FALLBACK_MODEL, e);
        if (throwOnError) throw e;
        return [GEMINI_FALLBACK_MODEL];
    }
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

    const keyPool = buildKeyPool(apiKey);

    if (keyPool.length === 0) {
        if (aiEngine === 'auto' && !forceJson) {
            console.warn('無健康的 Gemini Key，直接進入 Cloudflare 備援機制');
            return await callCloudflareTextAPI(prompt, onStream, abortSignal);
        }
        throw new Error("目前沒有可用的 API Key；金鑰可能尚未設定或正在配額冷卻中。");
    }

    let lastError = null;

    // 第一層：輪詢金鑰池
    for (let i = 0; i < keyPool.length; i++) {
        const currentKey = keyPool[i];
        const resolvedModels = await resolveFlashModelsList(currentKey);
        const models = filterModelsForKey(resolvedModels, getStoredKeyEntry(currentKey));
        let lastModelError = null;

        // 第二層：依版本號從新到舊嘗試模型
        for (const modelName of models) {
            try {
                await waitForKeyRequestSlot(currentKey, abortSignal);
                recordKeyAttempt(currentKey, modelName);

                // UI 即時更新：顯示目前使用的模型型號
                const modelBadge = document.getElementById('modal-model-badge');
                const modelNameEl = document.getElementById('modal-model-name');
                if (modelBadge && modelNameEl) {
                    modelBadge.classList.remove('hidden');
                    modelNameEl.textContent = modelName;
                }

                console.log(`Trying API Key (...${currentKey.slice(-4)}) with Model: ${modelName}`);

                const generationConfig = {
                    responseMimeType: forceJson ? "application/json" : "text/plain",
                };
                const systemInstruction = {
                    role: "system",
                    parts: [{ text: TEXT_GENERATION_SYSTEM_INSTRUCTION }]
                };

                const result = await generateGeminiContent({
                    apiKey: currentKey,
                    modelName,
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig,
                    systemInstruction,
                    onStream: onStream && !forceJson ? onStream : null,
                    streamStatus: onStream && !forceJson ? `Gemini (${modelName}) 思考中...` : null,
                    abortSignal,
                });

                recordKeySuccess(currentKey);
                console.log(`[API Key Usage Updated] Key: ...${currentKey.slice(-4)}`);

                return result.text;

            } catch (error) {
                lastModelError = error;
                const errorMsg = error.message || '';
                console.warn(`Model ${modelName} with Key (...${currentKey.slice(-4)}) failed: ${errorMsg}`);

                const decision = classifyGeminiError(error);
                if (decision.action === 'abort') {
                    console.warn("使用者主動取消請求，中止所有嘗試。");
                    throw error;
                }

                if (decision.action === 'stop') {
                    throw error;
                }

                if (decision.action === 'next_key') {
                    markKeyCooldown(currentKey, decision);
                    console.warn(`Key 已標記為 ${decision.reason}，切換下一組獨立 Project Key。`);
                    break;
                }

                markModelCooldown(currentKey, modelName, decision);
                console.log(`Model ${modelName} 已標記為 ${decision.reason}，嘗試同一 Key 的下一個模型...`);
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
    const keyPool = buildKeyPool(apiKey);

    if (keyPool.length === 0) {
        throw new Error("目前沒有可用的 API Key；金鑰可能尚未設定或正在配額冷卻中。");
    }

    let lastError = null;

    for (let i = 0; i < keyPool.length; i++) {
        const currentKey = keyPool[i];
        const allModels = await resolveFlashModelsList(currentKey);
        const models = filterModelsForKey(allModels, getStoredKeyEntry(currentKey));
        console.log('[Audio API] 音訊候選 Flash 模型:', models);

        let lastModelError = null;

        for (const modelName of models) {
            try {
                await waitForKeyRequestSlot(currentKey, abortSignal);
                recordKeyAttempt(currentKey, modelName);

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

                const generationConfig = {
                    responseMimeType: "text/plain",
                    maxOutputTokens: 65536,
                };
                const terminologyInstruction = buildTranscriptionTerminologyInstruction(state.aiTerminologyRules);
                const systemInstruction = {
                    role: "system",
                    parts: [{ text: "你是一個專業的語音轉寫員。你必須且只能使用「繁體中文（台灣）」進行回覆，絕對不可以使用簡體中文。請嚴格遵守使用者要求的輸出格式。" + terminologyInstruction }]
                };
                const parts = [
                    { text: promptText },
                    {
                        inlineData: {
                            data: audioBase64,
                            mimeType: mimeType,
                        },
                    },
                ];

                const result = await generateGeminiContent({
                    apiKey: currentKey,
                    modelName,
                    contents: [{ role: 'user', parts }],
                    generationConfig,
                    systemInstruction,
                    onStream,
                    // 保留原本音訊 API 不主動送出「思考中」狀態的回呼行為。
                    streamStatus: null,
                    abortSignal,
                });

                if (result.response?.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
                    console.warn("[Audio API] 警告：生成的內容已達到最大 token 限制，可能會被截斷。");
                }

                recordKeySuccess(currentKey);

                return result.text;

            } catch (error) {
                lastModelError = error;
                const errorMsg = error.message || '';
                console.warn(`[Audio API] Model ${modelName} with Key (...${currentKey.slice(-4)}) failed: ${errorMsg}`);

                const decision = classifyGeminiError(error);
                if (decision.action === 'abort') {
                    console.warn("[Audio API] 使用者主動取消請求，中止所有嘗試。");
                    throw error;
                }

                if (decision.action === 'stop') {
                    throw error;
                }

                if (decision.action === 'next_key') {
                    markKeyCooldown(currentKey, decision);
                    console.warn(`[Audio API] Key 已標記為 ${decision.reason}，切換下一組獨立 Project Key。`);
                    break;
                }

                markModelCooldown(currentKey, modelName, decision);
                console.log(`[Audio API] 模型 ${modelName} 已標記為 ${decision.reason}，嘗試下一個模型...`);
            }
        }

        lastError = lastModelError;
    }

    const finalErrorMsg = lastError ? lastError.message : "未知錯誤";
    throw new Error(translateError(finalErrorMsg));
}

export function translateError(message) {
    if (!message) return "【系統錯誤】未知錯誤";
    const normalizedMessage = String(message).toLowerCase();

    // 串流回應未完整傳回或格式異常
    if (normalizedMessage.includes("failed to parse stream")) {
        return "【AI 串流回應中斷】AI 已開始回傳內容，但網路或 Gemini 服務的串流回應未完整傳回，因此無法完成這次 AI 生成。\n\n可能原因：網路短暫不穩、Gemini 服務忙碌，或瀏覽器連線中途被中斷。\n\n處理方式：請先重新生成；若再次發生，確認網路連線後稍候再試。持續發生時，請改用其他 Gemini API Key，或切換至其他 AI 引擎。畫面上已出現的部分內容可能不完整，請勿直接使用。";
    }
    
    // 503 / High Demand / Overloaded
    if (normalizedMessage.includes("503") || normalizedMessage.includes("high demand") || normalizedMessage.includes("overloaded") || normalizedMessage.includes("service unavailable")) {
        return "【AI 伺服器繁忙 (overloaded)】Gemini API 目前負載過高或正處於全球尖峰時段。這通常是暫時的，請稍候一兩分鐘後重試。";
    }
    
    // 429 / Rate Limit / Quota Exceeded
    if (normalizedMessage.includes("429") || normalizedMessage.includes("quota exceeded") || normalizedMessage.includes("exhausted") || normalizedMessage.includes("rate limit")) {
        return "【用量已達上限】您的 Gemini API 金鑰已超過每分鐘呼叫次數限制（Rate Limit）或免費額度已用盡。請稍候一分鐘再試，或更換其他金鑰。";
    }
    
    // 400 / 403 / Invalid API Key
    if (normalizedMessage.includes("api key not valid") || normalizedMessage.includes("not valid") || normalizedMessage.includes("invalid") || normalizedMessage.includes("400") || normalizedMessage.includes("403")) {
        return "【無效的金鑰】您輸入的 Gemini API Key 格式不正確或已被停用，請至 Google AI Studio 重新確認並貼上正確的金鑰。";
    }
    
    // Safety
    if (normalizedMessage.includes("safety") || normalizedMessage.includes("blockreason") || normalizedMessage.includes("blocked") || normalizedMessage.includes("安全設定")) {
        return "【內容安全阻擋】由於輸入內容可能包含敏感詞彙，已被 Google AI 的安全過濾機制阻擋。";
    }
    
    // Default
    return `【系統錯誤】${message}`;
}
