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

/**
 * 解析特定 API Key 可用的所有 Flash 模型，並按版本從新到舊排序
 * @param {string} apiKey - Gemini API Key
 * @param {boolean} throwOnError - 是否在網路錯誤時直接拋出異常（用於儲存驗證）
 * @returns {Promise<string[]>} 排序後的模型名稱陣列
 */
async function resolveFlashModelsList(apiKey, throwOnError = false) {
    if (!apiKey) {
        return [FALLBACK_MODEL];
    }
    
    if (modelCache.has(apiKey)) {
        return modelCache.get(apiKey);
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

        // 1. 過濾：只保留包含 'flash' 且支援 'generateContent' 的正式模型，排除預覽版 (preview, lite)
        const flashModels = data.models.filter(m => {
            const name = m.name || '';
            const nameLower = name.toLowerCase();
            const hasGenerateContent = m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent');
            return hasGenerateContent && 
                   nameLower.includes('flash') && 
                   !nameLower.includes('preview') && 
                   !nameLower.includes('lite');
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
        modelCache.set(apiKey, list);
        return list;
    } catch (e) {
        console.warn("[系統警告] 動態模型解析失敗，已啟用動態常綠降級方案:", FALLBACK_MODEL, e);
        if (throwOnError) throw e;
        return [FALLBACK_MODEL];
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
async function callGeminiAPI(apiKey, prompt, forceJson = false) {
    if (!window.GoogleGenerativeAI) {
        throw new Error("Google AI SDK 尚未載入。");
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
        throw new Error("找不到有效的 API Key，請先設定。");
    }

    let lastError = null;

    // 第一層：輪詢金鑰池
    for (let i = 0; i < keyPool.length; i++) {
        const currentKey = keyPool[i];
        const models = await resolveFlashModelsList(currentKey);
        let lastModelError = null;

        // 第二層：依版本號從新到舊嘗試模型
        for (const modelName of models) {
            try {
                // UI 即時更新：顯示目前使用的模型型號
                const modelBadge = document.getElementById('modal-model-badge');
                const modelNameEl = document.getElementById('modal-model-name');
                if (modelBadge && modelNameEl) {
                    modelBadge.classList.remove('hidden');
                    modelNameEl.textContent = modelName;
                }

                console.log(`Trying API Key (...${currentKey.slice(-4)}) with Model: ${modelName}`);

                const genAI = new window.GoogleGenerativeAI(currentKey);

                const generationConfig = {
                    responseMimeType: forceJson ? "application/json" : "text/plain",
                };
                
                const systemInstruction = {
                    role: "system",
                    parts: [{ text: "請注意：你必須且只能使用「繁體中文（台灣）」進行回覆，絕對不可以使用簡體中文。"}]
                };

                const model = genAI.getGenerativeModel({
                    model: modelName,
                    generationConfig: generationConfig,
                    systemInstruction: systemInstruction,
                });

                const result = await model.generateContent(prompt);
                const response = result.response;

                if (response.promptFeedback && response.promptFeedback.blockReason) {
                     throw new Error(`請求因安全設定而被阻擋，原因：${response.promptFeedback.blockReason}`);
                }
                
                if (!response.candidates || response.candidates[0].finishReason === 'SAFETY') {
                     throw new Error("內容因違反安全政策而被 Google AI 阻擋。請檢查您的原始字幕內容是否包含敏感詞彙。");
                }

                const responseText = response.text();

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

                // 判定是否為金鑰錯誤 (金鑰無效或額度上限)
                const isKeyError = errorMsg.includes("API key not valid") || 
                                   errorMsg.includes("not valid") || 
                                   errorMsg.includes("invalid") || 
                                   errorMsg.includes("400") || 
                                   errorMsg.includes("403") || 
                                   errorMsg.includes("429") || 
                                   errorMsg.includes("Quota exceeded") || 
                                   errorMsg.includes("exhausted") || 
                                   errorMsg.includes("rate limit");

                if (isKeyError) {
                    console.warn("Detected API key error, switching to next key...");
                    break; // 直接跳出內層模型循環，換下一個金鑰
                }
            }
        }

        lastError = lastModelError;
    }

    const finalErrorMsg = lastError ? lastError.message : "未知錯誤";
    throw new Error(translateError(finalErrorMsg));
}

function translateError(message) {
    if (!message) return "【系統錯誤】未知錯誤";
    
    // 503 / High Demand / Overloaded
    if (message.includes("503") || message.includes("high demand") || message.includes("overloaded") || message.includes("Service Unavailable")) {
        return "【AI 伺服器繁忙 (overloaded)】Gemini API 目前負載過高或正處於全球尖峰時段。這通常是暫時的，請稍候一兩分鐘後重試。";
    }
    
    // 429 / Rate Limit / Quota Exceeded
    if (message.includes("429") || message.includes("Quota exceeded") || message.includes("exhausted") || message.includes("rate limit")) {
        return "【用量已達上限】您的 Gemini API 金鑰已超過每分鐘呼叫次數限制（Rate Limit）或免費額度已用盡。請稍候一分鐘再試，或更換其他金鑰。";
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