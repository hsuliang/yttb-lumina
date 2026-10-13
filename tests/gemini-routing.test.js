import test from 'node:test';
import assert from 'node:assert/strict';
import {
    GEMINI_FALLBACK_MODELS,
    GEMINI_TEXT_MODEL_ALLOWLIST,
    buildApprovedFlashModelList,
    classifyGeminiError,
    filterModelsForKey,
    getGeminiModelRateLimits,
    getMillisecondsUntilNextPacificDay,
    parseGeminiRetryDelayMs,
} from '../public/js/gemini-routing.js';

test('approved Flash text models use the fixed stable model allowlist in priority order', () => {
    const models = [
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.7-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.1-flash-tts-preview', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.1-flash-image', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.1-flash-live-preview', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.1-flash-lite', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-4.0-flash', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/gemini-4.0-flash', supportedGenerationMethods: ['generateContent'] },
    ];

    assert.deepEqual(buildApprovedFlashModelList(models), [
        'gemini-3.8-flash',
        'gemini-3.6-flash',
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
        'gemini-2.5-flash',
    ]);
    assert.deepEqual(GEMINI_TEXT_MODEL_ALLOWLIST, [
        'gemini-3.8-flash',
        'gemini-3.6-flash',
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite',
        'gemini-2.5-flash',
    ]);
});

test('model discovery never adds a moving latest alias when no allowed model is returned', () => {
    assert.deepEqual(buildApprovedFlashModelList([]), []);
    assert.deepEqual(GEMINI_FALLBACK_MODELS, ['gemini-3.8-flash', 'gemini-2.5-flash']);
});

test('quota errors scope cooldown to the affected model or project', () => {
    const modelQuota = classifyGeminiError({
        status: 429,
        message: 'Quota exceeded, limit: 0, model: gemini-3.6-flash',
    });
    assert.equal(modelQuota.action, 'quota_cooldown');
    assert.equal(modelQuota.scope, 'model');
    assert.equal(modelQuota.reason, 'project_rate_limited');
    assert.equal(modelQuota.cooldownMs, 60 * 1000);

    assert.equal(classifyGeminiError({
        status: 429,
        message: 'RESOURCE_EXHAUSTED',
        errorDetails: [{ quotaValue: '0', quotaDimensions: { model: 'gemini-3.6-flash' } }],
    }).scope, 'model');

    const projectQuota = classifyGeminiError({
        status: 429,
        message: 'RESOURCE_EXHAUSTED. Please retry in 45.5s.',
    });
    assert.equal(projectQuota.action, 'quota_cooldown');
    assert.equal(projectQuota.scope, 'key');
    assert.equal(projectQuota.reason, 'project_rate_limited');
    assert.equal(projectQuota.cooldownMs, 45500);

    assert.equal(classifyGeminiError({
        status: 429,
        message: 'Quota exceeded for metric: generate_content_free_tier_requests_per_minute',
    }).reason, 'project_rate_limited');
});

test('daily quota, safety, invalid requests, and transient failures take different routes', () => {
    assert.equal(
        classifyGeminiError({ status: 429, message: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }).reason,
        'daily_quota_exhausted',
    );
    assert.equal(classifyGeminiError({ message: 'finishReason: SAFETY' }).action, 'stop');
    assert.equal(classifyGeminiError({ code: 'content_safety', message: '請求因安全設定而被阻擋' }).action, 'stop');
    assert.equal(classifyGeminiError({ status: 400, message: 'INVALID_ARGUMENT' }).action, 'stop');
    assert.equal(classifyGeminiError({ status: 503, message: 'UNAVAILABLE' }).action, 'retry_once');
    assert.equal(classifyGeminiError({ message: 'Failed to fetch' }).action, 'retry_once');
});

test('stream parse failures stop instead of fanning out duplicate generations', () => {
    assert.deepEqual(classifyGeminiError({
        code: 'stream_parse',
        message: '[Gemini API] Failed to parse stream',
    }), {
        action: 'stop',
        reason: 'stream_parse_error',
    });
});

test('local model budgets keep headroom under screenshot quotas', () => {
    assert.deepEqual(getGeminiModelRateLimits('gemini-3.8-flash'), { rpm: 4, tpm: 200_000, rpd: 16 });
    assert.deepEqual(getGeminiModelRateLimits('gemini-3.5-flash-lite'), { rpm: 12, tpm: 200_000, rpd: 400 });
});

test('daily request cap is tracked independently for each model and Pacific day', () => {
    const now = Date.parse('2026-07-26T06:30:00Z');
    const day = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date(now));
    const entry = {
        usageByModel: {
            'gemini-3.8-flash': { day, requests: 16 },
            'gemini-3.5-flash-lite': { day, requests: 399 },
        },
    };

    assert.deepEqual(
        filterModelsForKey(['gemini-3.8-flash', 'gemini-3.5-flash-lite'], entry, now),
        ['gemini-3.8-flash', 'gemini-3.5-flash-lite'],
    );
});

test('retry delay is parsed from structured error details', () => {
    assert.equal(parseGeminiRetryDelayMs({
        errorDetails: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12.25s' }],
    }), 12250);
});

test('model cooldowns exclude temporarily unavailable candidates', () => {
    const now = 1000;
    assert.deepEqual(
        filterModelsForKey(
            ['gemini-3.6-flash', 'gemini-2.5-flash'],
            { modelCooldowns: { 'gemini-3.6-flash': 1001 } },
            now,
        ),
        ['gemini-2.5-flash'],
    );
});

test('invalid or blocked key stops routing', () => {
    assert.equal(classifyGeminiError({ status: 401, message: 'API key not valid' }).action, 'stop');
    assert.equal(classifyGeminiError({ status: 403, message: 'PERMISSION_DENIED' }).reason, 'key_unavailable');
});

test('daily quota cooldown ends at the next Pacific calendar day', () => {
    const cooldown = getMillisecondsUntilNextPacificDay(Date.parse('2026-07-26T06:30:00Z'));
    assert.ok(cooldown > 29 * 60 * 1000);
    assert.ok(cooldown < 31 * 60 * 1000);
});
