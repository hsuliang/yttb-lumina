import test from 'node:test';
import assert from 'node:assert/strict';
import {
    GEMINI_FALLBACK_MODEL,
    buildApprovedFlashModelList,
    classifyGeminiError,
    filterModelsForKey,
    getMillisecondsUntilNextPacificDay,
    isGeminiKeyAvailable,
    parseGeminiRetryDelayMs,
} from '../public/js/gemini-routing.js';

test('approved Flash text models are sorted newest first with latest alias last', () => {
    const models = [
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.1-flash-tts-preview', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.1-flash-image', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.1-flash-live-preview', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-4.0-flash', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/gemini-4.0-flash', supportedGenerationMethods: ['generateContent'] },
    ];

    assert.deepEqual(buildApprovedFlashModelList(models), [
        'gemini-3.6-flash',
        'gemini-3.5-flash',
        'gemini-2.5-flash',
        GEMINI_FALLBACK_MODEL,
    ]);
});

test('latest alias remains available when no approved stable model is returned', () => {
    assert.deepEqual(buildApprovedFlashModelList([]), [GEMINI_FALLBACK_MODEL]);
});

test('quota errors distinguish unavailable models from exhausted projects', () => {
    assert.deepEqual(
        classifyGeminiError({ status: 429, message: 'Quota exceeded, limit: 0, model: gemini-3.6-flash' }),
        {
            action: 'next_model',
            reason: 'model_quota_unavailable',
            cooldownMs: 24 * 60 * 60 * 1000,
        },
    );
    assert.equal(classifyGeminiError({
        status: 429,
        message: 'RESOURCE_EXHAUSTED',
        errorDetails: [{ quotaValue: '0', quotaDimensions: { model: 'gemini-3.6-flash' } }],
    }).action, 'next_model');

    const projectQuota = classifyGeminiError({
        status: 429,
        message: 'RESOURCE_EXHAUSTED. Please retry in 45.5s.',
    });
    assert.equal(projectQuota.action, 'next_key');
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
    assert.equal(classifyGeminiError({ status: 400, message: 'INVALID_ARGUMENT' }).action, 'stop');
    assert.equal(classifyGeminiError({ status: 503, message: 'UNAVAILABLE' }).action, 'next_model');
});

test('retry delay is parsed from structured error details', () => {
    assert.equal(parseGeminiRetryDelayMs({
        errorDetails: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12.25s' }],
    }), 12250);
});

test('key and model cooldowns exclude temporarily unavailable candidates', () => {
    const now = 1000;
    assert.equal(isGeminiKeyAvailable({ key: 'key-a', cooldownUntil: 999 }, now), true);
    assert.equal(isGeminiKeyAvailable({ key: 'key-a', cooldownUntil: 1001 }, now), false);
    assert.deepEqual(
        filterModelsForKey(
            ['gemini-3.6-flash', GEMINI_FALLBACK_MODEL],
            { modelCooldowns: { 'gemini-3.6-flash': 1001 } },
            now,
        ),
        [GEMINI_FALLBACK_MODEL],
    );
});

test('daily quota cooldown ends at the next Pacific calendar day', () => {
    const cooldown = getMillisecondsUntilNextPacificDay(Date.parse('2026-07-26T06:30:00Z'));
    assert.ok(cooldown > 29 * 60 * 1000);
    assert.ok(cooldown < 31 * 60 * 1000);
});
