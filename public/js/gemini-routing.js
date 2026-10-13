export const GEMINI_FALLBACK_MODELS = Object.freeze([
    'gemini-3.8-flash',
    'gemini-2.5-flash',
]);
export const GEMINI_DEFAULT_QUOTA_COOLDOWN_MS = 60 * 1000;
export const GEMINI_MODEL_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const GEMINI_TRANSIENT_RETRY_DELAY_MS = 1000;

export const GEMINI_TEXT_MODEL_ALLOWLIST = Object.freeze([
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash',
]);

const VERSIONED_FLASH_MODEL_PATTERN = /^(gemini-\d+(?:\.\d+)?-flash(?:-lite)?)(?:-(\d{3}))?$/i;
const EXCLUDED_MODEL_PATTERN = /(tts|image|imagen|vision|live|audio|embedding|robotics|computer[-_]?use|veo|lyria|preview|experimental|exp)/i;

export function getGeminiModelRateLimits(modelName) {
    const isLite = /-flash-lite(?:-|$)/i.test(modelName || '');
    return isLite
        ? { rpm: 12, tpm: 200_000, rpd: 400 }
        : { rpm: 4, tpm: 200_000, rpd: 16 };
}

export function isGeminiModelDailyQuotaReached(entry, modelName, now = Date.now()) {
    const usage = entry?.usageByModel?.[modelName];
    if (!usage || usage.day !== getPacificDayKey(now)) return false;
    return Number(usage.requests || 0) >= getGeminiModelRateLimits(modelName).rpd;
}

function getModelName(model) {
    const rawName = typeof model === 'string' ? model : model?.name;
    return (rawName || '').split('/').pop();
}

function parseModelVersion(modelName) {
    const match = modelName.match(VERSIONED_FLASH_MODEL_PATTERN);
    if (!match) return { baseModelName: '', versionParts: [], revision: -1 };
    const version = match[1].match(/^gemini-(\d+(?:\.\d+)?)-flash(?:-lite)?$/i)?.[1] || '';
    return {
        baseModelName: match[1].toLowerCase(),
        versionParts: version.split('.').map(Number),
        revision: match[2] ? Number(match[2]) : Number.MAX_SAFE_INTEGER,
    };
}

export function buildApprovedFlashModelList(models = []) {
    const approved = models
        .filter(model => {
            const modelName = getModelName(model);
            const methods = typeof model === 'string' ? ['generateContent'] : (model?.supportedGenerationMethods || []);
            const baseModelName = parseModelVersion(modelName).baseModelName;
            return methods.includes('generateContent') &&
                GEMINI_TEXT_MODEL_ALLOWLIST.includes(baseModelName) &&
                !EXCLUDED_MODEL_PATTERN.test(modelName);
        })
        .map(getModelName)
        .filter(Boolean);

    const modelOrder = new Map(GEMINI_TEXT_MODEL_ALLOWLIST.map((model, index) => [model, index]));
    return [...new Set(approved)].sort((a, b) => {
        const aVersion = parseModelVersion(a);
        const bVersion = parseModelVersion(b);
        const orderDifference = (modelOrder.get(aVersion.baseModelName) ?? Infinity) -
            (modelOrder.get(bVersion.baseModelName) ?? Infinity);
        if (orderDifference !== 0) return orderDifference;
        const length = Math.max(aVersion.versionParts.length, bVersion.versionParts.length);
        for (let i = 0; i < length; i++) {
            const difference = (bVersion.versionParts[i] || 0) - (aVersion.versionParts[i] || 0);
            if (difference !== 0) return difference;
        }
        return bVersion.revision - aVersion.revision;
    });
}

function collectDetailStrings(value, result = []) {
    if (typeof value === 'string') {
        result.push(value);
    } else if (Array.isArray(value)) {
        value.forEach(item => collectDetailStrings(item, result));
    } else if (value && typeof value === 'object') {
        Object.entries(value).forEach(([key, item]) => {
            if (typeof item === 'string') {
                result.push(`${key}: ${item}`);
            } else {
                collectDetailStrings(item, result);
            }
        });
    }
    return result;
}

function getPacificDayKey(timestamp) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date(timestamp));
}

export function getMillisecondsUntilNextPacificDay(now = Date.now()) {
    const currentDay = getPacificDayKey(now);
    let low = now;
    let high = now + 30 * 60 * 60 * 1000;

    while (high - low > 1000) {
        const middle = Math.floor((low + high) / 2);
        if (getPacificDayKey(middle) === currentDay) {
            low = middle;
        } else {
            high = middle;
        }
    }
    return high - now + 1000;
}

export function parseGeminiRetryDelayMs(error) {
    const detailStrings = collectDetailStrings(error?.errorDetails);
    const candidates = [error?.message || '', ...detailStrings];

    for (const text of candidates) {
        const secondsMatch = String(text).match(/(?:retryDelay["'\s:=]*|retry\s+in\s+)(\d+(?:\.\d+)?)s/i);
        if (secondsMatch) return Math.ceil(Number(secondsMatch[1]) * 1000);

        const minutesMatch = String(text).match(/(?:retryDelay["'\s:=]*|retry\s+in\s+)(\d+(?:\.\d+)?)m/i);
        if (minutesMatch) return Math.ceil(Number(minutesMatch[1]) * 60 * 1000);
    }
    return 0;
}

export function classifyGeminiError(error) {
    const message = error?.message || String(error || '');
    const errorText = [message, ...collectDetailStrings(error?.errorDetails)].join(' ');
    const normalized = errorText.toLowerCase();
    const status = Number(error?.status) || Number(normalized.match(/\[(\d{3})\s/)?.[1]) || 0;
    const retryDelayMs = parseGeminiRetryDelayMs(error);

    if (error?.name === 'AbortError' || normalized.includes('abort') || normalized.includes('cancelled')) {
        return { action: 'abort', reason: 'aborted' };
    }

    if (error?.code === 'content_safety' || normalized.includes('safety') || normalized.includes('blockreason') || normalized.includes('安全政策') || normalized.includes('安全設定')) {
        return { action: 'stop', reason: 'content_safety' };
    }

    if (status === 429 || normalized.includes('resource_exhausted') || normalized.includes('quota exceeded')) {
        const isDailyQuota = /(requests?.?per.?day|perday|daily|rpd)/i.test(errorText);
        const isModelQuota = /(per.?model|model\s*[:=]\s*gemini-|model\s+gemini-)/i.test(errorText);
        return {
            action: 'quota_cooldown',
            scope: isModelQuota ? 'model' : 'key',
            reason: isDailyQuota ? 'daily_quota_exhausted' : 'project_rate_limited',
            cooldownMs: isDailyQuota
                ? getMillisecondsUntilNextPacificDay()
                : retryDelayMs || GEMINI_DEFAULT_QUOTA_COOLDOWN_MS,
        };
    }

    if (error?.code === 'stream_parse' || normalized.includes('failed to parse stream')) {
        return { action: 'stop', reason: 'stream_parse_error' };
    }

    if (status === 404 ||
        normalized.includes('model not found') ||
        normalized.includes('not supported for generatecontent') ||
        normalized.includes('model is not supported')) {
        return {
            action: 'next_model',
            reason: 'model_unavailable',
            cooldownMs: GEMINI_MODEL_COOLDOWN_MS,
        };
    }

    if (status === 401 || status === 403 ||
        normalized.includes('api key not valid') ||
        normalized.includes('permission_denied') ||
        normalized.includes('unauthenticated')) {
        return {
            action: 'stop',
            reason: 'key_unavailable',
        };
    }

    if (status === 400 ||
        normalized.includes('invalid_argument') ||
        normalized.includes('failed_precondition') ||
        normalized.includes('context length') ||
        normalized.includes('too many tokens')) {
        return { action: 'stop', reason: 'invalid_request' };
    }

    if (status === 408 || status >= 500 ||
        normalized.includes('timeout') ||
        normalized.includes('network') ||
        normalized.includes('fetch failed') ||
        normalized.includes('failed to fetch') ||
        normalized.includes('overloaded') ||
        normalized.includes('unavailable')) {
        return {
            action: 'retry_once',
            reason: 'transient_service_error',
            cooldownMs: retryDelayMs || GEMINI_TRANSIENT_RETRY_DELAY_MS,
        };
    }

    return { action: 'stop', reason: 'unknown_non_retryable' };
}

export function filterModelsForKey(models, entry, now = Date.now()) {
    const modelCooldowns = entry?.modelCooldowns || {};
    return models.filter(model =>
        Number(modelCooldowns[model] || 0) <= now,
    );
}
