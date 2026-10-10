import { state } from './state.js';
import { buildTranscriptionTerminologyInstruction, TEXT_GENERATION_SYSTEM_INSTRUCTION } from './prompt-policy.js';
import { callCloudflareTextAPI } from './cf-api.js';
import {
    GEMINI_FALLBACK_MODELS,
    buildApprovedFlashModelList,
    classifyGeminiError,
    filterModelsForKey,
    getGeminiModelRateLimits,
    isGeminiModelDailyQuotaReached,
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
const modelNextRequestAt = new Map();
const GEMINI_CONTENT_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MAX_TRANSIENT_RETRIES = 1;
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
    const stored = readStoredKeyEntries();
    let { entries } = stored;
    if (entries.length === 0 && preferredKey) {
        entries = [{ key: preferredKey, count: 0 }];
        const isSession = stored.isSession || (
            !localStorage.getItem('geminiApiKeys') &&
            !localStorage.getItem('geminiApiKey') &&
            sessionStorage.getItem('geminiApiKey') === preferredKey
        );
        writeStoredKeyEntries(entries, isSession);
    }
    let availableEntries = entries.filter(entry => isGeminiKeyAvailable(entry, now));

    availableEntries.sort((a, b) => {
        const routeDifference = Number(a.routingCount ?? a.count ?? 0) - Number(b.routingCount ?? b.count ?? 0);
        if (routeDifference !== 0) return routeDifference;
        return Number(a.lastRoutedAt || 0) - Number(b.lastRoutedAt || 0);
    });

    const selected = availableEntries[0];
    if (!selected) return [];

    // Reserve the next route synchronously so concurrent calls do not all pick
    // the same least-used key before the first HTTP request is recorded.
    updateStoredKeyEntry(selected.key, entry => {
        entry.routingCount = Number(entry.routingCount ?? entry.count ?? 0) + 1;
        entry.lastRoutedAt = now;
    });
    selected.routingCount = Number(selected.routingCount ?? selected.count ?? 0) + 1;
    selected.lastRoutedAt = now;

    return [selected.key, ...availableEntries.slice(1).map(entry => entry.key)];
}

function getPacificDayKey(timestamp = Date.now()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date(timestamp));
}

function recordKeyAttempt(apiKey, modelName, requestId) {
    const now = Date.now();
    updateStoredKeyEntry(apiKey, entry => {
        const usage = entry.usageByModel?.[modelName];
        const sample = usage?.tokenUsage?.find(item => item.id === requestId);
        if (sample) {
            sample.at = now;
            sample.reserved = false;
        }
        if (usage) {
            usage.requestTimestamps = (usage.requestTimestamps || [])
                .filter(timestamp => timestamp > now - 60 * 1000);
            usage.requestTimestamps.push(now);
        }
        entry.lastAttemptAt = now;
    });
}

function recordKeySuccess(apiKey, modelName, response, requestId) {
    const promptTokens = Number(response?.usageMetadata?.promptTokenCount);
    updateStoredKeyEntry(apiKey, entry => {
        entry.count = (entry.count || 0) + 1;
        entry.consecutiveFailures = 0;
        entry.lastErrorReason = '';
        if (Number(entry.cooldownUntil || 0) <= Date.now()) {
            entry.cooldownUntil = 0;
        }
        const usage = entry.usageByModel?.[modelName];
        const tokenSample = usage?.tokenUsage?.find(sample => sample.id === requestId);
        if (tokenSample && Number.isFinite(promptTokens) && promptTokens >= 0) {
            tokenSample.tokens = promptTokens;
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
    if (abortSignal?.aborted) {
        const error = new Error('The user aborted a request');
        error.name = 'AbortError';
        return Promise.reject(error);
    }
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

function estimateGeminiInputTokens(contents, systemInstruction) {
    const parts = [];
    let binaryTokenEstimate = 0;
    const collect = value => {
        if (Array.isArray(value)) value.forEach(collect);
        else if (value && typeof value === 'object') {
            if (typeof value.text === 'string') parts.push(value.text);
            if (typeof value.data === 'string' && value.mimeType) {
                const decodedBytes = Math.floor(value.data.length * 0.75);
                binaryTokenEstimate += Math.ceil(decodedBytes / 256);
            }
            Object.entries(value).forEach(([key, nested]) => {
                if (key !== 'text' && key !== 'data') collect(nested);
            });
        }
    };
    collect(contents);
    collect(systemInstruction);

    const text = parts.join('\n');
    const cjkCharacters = (text.match(/[\u3400-\u9fff]/g) || []).length;
    const otherCharacters = text.length - cjkCharacters;
    return Math.max(1, cjkCharacters + Math.ceil(otherCharacters / 4) + binaryTokenEstimate);
}

function getTokenBudgetWaitMs(entry, modelName, estimatedTokens, now) {
    const limits = getGeminiModelRateLimits(modelName);
    if (estimatedTokens > limits.tpm) {
        return Number.POSITIVE_INFINITY;
    }

    const usage = entry?.usageByModel?.[modelName];
    const samples = (usage?.tokenUsage || [])
        .filter(sample => sample.at > now - 60 * 1000)
        .sort((a, b) => a.at - b.at);
    let totalTokens = samples.reduce((total, sample) => total + Number(sample.tokens || 0), 0);
    if (totalTokens + estimatedTokens <= limits.tpm) return 0;

    for (const sample of samples) {
        totalTokens -= Number(sample.tokens || 0);
        if (totalTokens + estimatedTokens <= limits.tpm) {
            return Math.max(0, sample.at + 60 * 1000 + 250 - now);
        }
    }
    return samples.length > 0 ? Math.max(0, samples[0].at + 60 * 1000 + 250 - now) : Number.POSITIVE_INFINITY;
}

function reserveModelRequestSlot(apiKey, modelName, estimatedTokens) {
    const limits = getGeminiModelRateLimits(modelName);
    const intervalMs = Math.ceil(60 * 1000 / limits.rpm) + 250;
    const routeId = `${apiKey}:${modelName}`;
    const now = Date.now();
    const storedEntry = getStoredKeyEntry(apiKey);
    if (isGeminiModelDailyQuotaReached(storedEntry, modelName, now)) return null;

    const storedModelNextRequestAt = storedEntry.modelNextRequestAt || {};
    const rateReadyAt = Math.max(
        now,
        Number(storedModelNextRequestAt[modelName] || 0),
        Number(modelNextRequestAt.get(routeId) || 0),
    );
    const tokenWaitMs = getTokenBudgetWaitMs(storedEntry, modelName, estimatedTokens, now);
    if (!Number.isFinite(tokenWaitMs)) {
        throw new Error(`這筆請求預估用量超過 ${modelName} 的安全 TPM 預算，請縮短內容或分批處理。`);
    }

    const readyAt = Math.max(rateReadyAt, now + tokenWaitMs);
    const nextRequestAt = readyAt + intervalMs;
    const requestId = `${now}-${Math.random().toString(36).slice(2)}`;
    const day = getPacificDayKey(readyAt);
    updateStoredKeyEntry(apiKey, entry => {
        const currentUsage = entry.usageByModel?.[modelName];
        const usage = currentUsage?.day === day
            ? currentUsage
            : {
                day,
                requests: 0,
                requestTimestamps: currentUsage?.requestTimestamps || [],
                tokenUsage: currentUsage?.tokenUsage || [],
            };
        usage.requests = Number(usage.requests || 0) + 1;
        usage.requestTimestamps = (usage.requestTimestamps || [])
            .filter(timestamp => timestamp > now - 60 * 1000);
        usage.tokenUsage = (usage.tokenUsage || [])
            .filter(sample => sample.at > now - 60 * 1000);
        usage.tokenUsage.push({ id: requestId, at: readyAt, tokens: estimatedTokens, reserved: true });
        entry.usageByModel = entry.usageByModel || {};
        entry.usageByModel[modelName] = usage;
        entry.modelNextRequestAt = entry.modelNextRequestAt || {};
        entry.modelNextRequestAt[modelName] = nextRequestAt;
    });
    modelNextRequestAt.set(routeId, nextRequestAt);
    return { requestId, day, delayMs: readyAt - now };
}

function releaseModelRequestReservation(apiKey, modelName, reservation) {
    if (!reservation) return;
    updateStoredKeyEntry(apiKey, entry => {
        const usage = entry.usageByModel?.[modelName];
        if (!usage || usage.day !== reservation.day) return;
        const index = usage.tokenUsage?.findIndex(sample => sample.id === reservation.requestId) ?? -1;
        if (index !== -1) {
            usage.tokenUsage.splice(index, 1);
            usage.requests = Math.max(0, Number(usage.requests || 0) - 1);
        }
    });
}

async function waitForModelRequestSlot(apiKey, modelName, estimatedTokens, abortSignal) {
    const reservation = reserveModelRequestSlot(apiKey, modelName, estimatedTokens);
    if (!reservation) return null;
    try {
        await abortableDelay(reservation.delayMs, abortSignal);
        return reservation;
    } catch (error) {
        releaseModelRequestReservation(apiKey, modelName, reservation);
        throw error;
    }
}

async function generateGeminiContentWithRetry(request) {
    const estimatedTokens = estimateGeminiInputTokens(request.contents, request.systemInstruction);
    let retries = 0;

    while (true) {
        const reservation = await waitForModelRequestSlot(
            request.apiKey,
            request.modelName,
            estimatedTokens,
            request.abortSignal,
        );
        if (!reservation) return { dailyQuotaReached: true };

        recordKeyAttempt(request.apiKey, request.modelName, reservation.requestId);
        try {
            const result = await generateGeminiContent(request);
            recordKeySuccess(request.apiKey, request.modelName, result.response, reservation.requestId);
            return { result };
        } catch (error) {
            const decision = classifyGeminiError(error);
            if (decision.action !== 'retry_once' || retries >= GEMINI_MAX_TRANSIENT_RETRIES) {
                error.geminiRequestId = reservation.requestId;
                throw error;
            }

            retries += 1;
            const jitterMs = Math.floor(Math.random() * 500);
            await abortableDelay(decision.cooldownMs + jitterMs, request.abortSignal);
        }
    }
}

/**
 * 解析特定 API Key 可用的所有 Flash 模型，並按版本從新到舊排序
 * @param {string} apiKey - Gemini API Key
 * @param {boolean} throwOnError - 是否在網路錯誤時直接拋出異常（用於儲存驗證）
 * @returns {Promise<string[]>} 排序後的模型名稱陣列
 */
export async function resolveFlashModelsList(apiKey, throwOnError = false) {
    if (!apiKey) {
        return [...GEMINI_FALLBACK_MODELS];
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
            throw createGeminiError(`Failed to fetch models: ${response.status}`, { status: response.status });
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
        if (throwOnError || e.status === 401 || e.status === 403 || e.status === 429 || e.status >= 500) {
            throw e;
        }
        console.warn("[系統警告] 動態模型解析失敗，改用固定穩定模型候補：", GEMINI_FALLBACK_MODELS, e);
        return [...GEMINI_FALLBACK_MODELS];
    }
}

async function generateWithKeyPool(apiKey, buildRequest, { onModel = null, logPrefix = '' } = {}) {
    const keyPool = buildKeyPool(apiKey);
    if (keyPool.length === 0) {
        throw createGeminiError('目前沒有可用的 Gemini API Key；金鑰可能尚未設定或正在配額冷卻中。', {
            code: 'no_available_key',
        });
    }

    let lastError = null;
    let stopRouting = false;

    for (const currentKey of keyPool) {
        let models;
        try {
            const resolvedModels = await resolveFlashModelsList(currentKey);
            const storedEntry = getStoredKeyEntry(currentKey);
            models = filterModelsForKey(resolvedModels, storedEntry);
            if (
                models.length === 0 &&
                resolvedModels.some(model => isGeminiModelDailyQuotaReached(storedEntry, model))
            ) {
                lastError = createGeminiError(
                    '目前此專案的 Gemini 模型已達本機設定的每日安全額度。',
                    { code: 'local_daily_quota' },
                );
            }
        } catch (error) {
            lastError = error;
            const decision = classifyGeminiError(error);
            if (decision.action === 'abort') throw error;
            if (decision.action === 'next_key') {
                markKeyCooldown(currentKey, decision);
                continue;
            }
            if (decision.action === 'quota_cooldown') {
                error.geminiQuotaReason = decision.reason;
                error.geminiQuotaScope = 'key';
                markKeyCooldown(currentKey, decision);
            }
            break;
        }

        if (models.length === 0) continue;
        let modelFallbackCount = 0;

        for (const modelName of models) {
            try {
                onModel?.(modelName);
                console.log(`${logPrefix}Trying API Key (...${currentKey.slice(-4)}) with Model: ${modelName}`);
                const request = await buildRequest(currentKey, modelName);
                const generated = await generateGeminiContentWithRetry({
                    ...request,
                    apiKey: currentKey,
                    modelName,
                });

                if (generated.dailyQuotaReached) {
                    lastError = createGeminiError(
                        `${modelName} 已達本機設定的每日安全額度，請改用其他可用模型或專案。`,
                        { code: 'local_daily_quota' },
                    );
                    continue;
                }

                console.log(`${logPrefix}[API Key Usage Updated] Key: ...${currentKey.slice(-4)}`);
                return { ...generated.result, modelName, apiKey: currentKey };
            } catch (error) {
                lastError = error;
                console.warn(`${logPrefix}Model ${modelName} with Key (...${currentKey.slice(-4)}) failed: ${error.message || error}`);
                const decision = classifyGeminiError(error);

                if (decision.action === 'abort' || decision.action === 'stop') throw error;

                if (decision.action === 'next_key') {
                    markKeyCooldown(currentKey, decision);
                    break;
                }

                if (decision.action === 'quota_cooldown') {
                    error.geminiQuotaReason = decision.reason;
                    error.geminiQuotaScope = decision.scope;
                    if (decision.scope === 'model') {
                        markModelCooldown(currentKey, modelName, decision);
                    } else {
                        markKeyCooldown(currentKey, decision);
                    }
                    // Do not fan the same user operation out across other keys/models after a 429.
                    stopRouting = true;
                    break;
                }

                if (decision.action === 'retry_once') {
                    markModelCooldown(currentKey, modelName, {
                        ...decision,
                        cooldownMs: Math.max(
                            Number(decision.cooldownMs || 0),
                            60 * 1000,
                        ),
                    });
                    stopRouting = true;
                    break;
                }

                if (decision.action === 'next_model') {
                    markModelCooldown(currentKey, modelName, decision);
                    modelFallbackCount += 1;
                    if (modelFallbackCount > 1) {
                        stopRouting = true;
                        break;
                    }
                    continue;
                }
            }
        }

        if (stopRouting) break;
    }

    if (!lastError) {
        lastError = createGeminiError(
            '目前沒有符合 allowlist 且可用的 Gemini 模型。',
            { code: 'no_available_model' },
        );
    }
    throw lastError;
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

    let result;
    try {
        result = await generateWithKeyPool(apiKey, async (_currentKey, modelName) => ({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: forceJson ? 'application/json' : 'text/plain',
            },
            systemInstruction: {
                role: 'system',
                parts: [{ text: TEXT_GENERATION_SYSTEM_INSTRUCTION }],
            },
            onStream: onStream && !forceJson ? onStream : null,
            streamStatus: onStream && !forceJson ? `Gemini (${modelName}) 思考中...` : null,
            abortSignal,
        }), {
            onModel: modelName => {
                const modelBadge = document.getElementById('modal-model-badge');
                const modelNameEl = document.getElementById('modal-model-name');
                if (modelBadge && modelNameEl) {
                    modelBadge.classList.remove('hidden');
                    modelNameEl.textContent = modelName;
                }
            },
        });
    } catch (error) {
        if (aiEngine === 'auto' && !forceJson) {
            console.warn('Gemini 失敗，觸發 Cloudflare 備援機制...', error.message);
            try {
                return await callCloudflareTextAPI(prompt, onStream, abortSignal);
            } catch (cfErr) {
                console.error('Cloudflare 備援亦失敗:', cfErr);
                throw new Error(translateError(error.message, error) + `\n(備援失敗: ${cfErr.message})`);
            }
        }
        throw new Error(translateError(error.message, error));
    }
    return result.text;
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
    const terminologyInstruction = buildTranscriptionTerminologyInstruction(state.aiTerminologyRules);
    const systemInstruction = {
        role: 'system',
        parts: [{ text: '你是一個專業的語音轉寫員。你必須且只能使用「繁體中文（台灣）」進行回覆，絕對不可以使用簡體中文。請嚴格遵守使用者要求的輸出格式。' + terminologyInstruction }],
    };
    const parts = [
        { text: promptText },
        { inlineData: { data: audioBase64, mimeType } },
    ];

    try {
        const result = await generateWithKeyPool(apiKey, async () => ({
            contents: [{ role: 'user', parts }],
            generationConfig: { responseMimeType: 'text/plain', maxOutputTokens: 65536 },
            systemInstruction,
            onStream,
            streamStatus: null,
            abortSignal,
        }), {
            logPrefix: '[Audio API] ',
            onModel: modelName => {
                const modelBadge = document.getElementById('modal-model-badge');
                const modelNameEl = document.getElementById('modal-model-name');
                if (modelBadge && modelNameEl) {
                    modelBadge.classList.remove('hidden');
                    modelNameEl.textContent = modelName;
                }
                const tab0Badge = document.getElementById('tab0-model-badge');
                if (tab0Badge) {
                    tab0Badge.classList.remove('hidden');
                    tab0Badge.textContent = `模型：${modelName}`;
                }
            },
        });

        if (result.response?.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
            console.warn('[Audio API] 警告：生成的內容已達到最大 token 限制，可能會被截斷。');
        }
        return result.text;
    } catch (error) {
        throw new Error(translateError(error.message, error));
    }
}

export function translateError(message, error = {}) {
    if (!message) return "【系統錯誤】未知錯誤";
    const normalizedMessage = String(message).toLowerCase();

    if (error.code === 'local_daily_quota') {
        return "【已達每日安全額度】已達本機設定的 Gemini 每日保守上限，系統會等到太平洋時間午夜後再使用該模型；若有其他仍可用的專案或模型，可先改用它們。這是本機預防上限，實際配額以 Google AI Studio 顯示為準。";
    }

    if (error.code === 'no_available_key') {
        return "【目前沒有可用的 Gemini 專案】請檢查 API Key 設定，或等待被冷卻的專案恢復。";
    }

    if (error.code === 'no_available_model') {
        return "【目前沒有可用的 Gemini 模型】請確認專案可用模型，或稍後再試。";
    }

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
        if (error.geminiQuotaReason === 'daily_quota_exhausted') {
            return "【Gemini 每日配額已用盡】這個專案／模型已達 Google 配額上限，系統已停止本次連續重試，並暫停使用受影響的路由直到太平洋時間午夜重置。其他獨立專案之後仍可繼續承擔新請求。";
        }
        return "【Gemini 暫時限流】這個專案或模型已達每分鐘配額，系統已停止本次連續重試，並依 Google 提供的等待時間冷卻受影響的路由。稍後可重新操作。";
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
