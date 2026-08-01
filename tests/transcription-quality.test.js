import test from 'node:test';
import assert from 'node:assert/strict';
import {
    collectReliableTranscriptionText,
    getWorkersAiUsageNotice,
    isWorkersAiDailyLimitError,
    markUncertainTranscription,
    shouldSplitSuspectTranscription,
    shouldRetryWhisperResponse,
} from '../public/js/transcription-quality.js';

const sampleSrt = [
    '1\n00:00:00,500 --> 00:00:02,000\n第一段候選內容',
    '2\n00:00:02,000 --> 00:00:04,500\n第二段候選內容',
].join('\n\n');

test('normal transcription payload remains byte-for-byte unchanged', () => {
    const payload = {
        text: '正常內容',
        srt: sampleSrt,
        quality: { suspect: false, severity: 'normal', reasons: [] },
    };

    assert.equal(markUncertainTranscription(payload), payload);
    assert.equal(markUncertainTranscription(payload).srt, sampleSrt);
});

test('severely corrupted transcription is replaced by one explicit marker', () => {
    const marked = markUncertainTranscription({
        text: 'це婉嫉老家 雷仔 �',
        srt: sampleSrt,
        quality: {
            suspect: true,
            severity: 'severe',
            reasons: ['invalid_characters', 'unexpected_scripts'],
        },
    });

    assert.equal(marked.text, '【辨識不清】');
    assert.equal(marked.srt, '1\n00:00:00,500 --> 00:00:04,500\n【辨識不清】');
    assert.doesNotMatch(marked.srt, /婉嫉|雷仔|�/);
    assert.equal(marked.quality.markedUncertain, true);
});

test('readable but uncertain transcription keeps its candidate with a review marker', () => {
    const marked = markUncertainTranscription({
        text: '可能辨識不完整的內容',
        srt: sampleSrt,
        quality: {
            suspect: true,
            severity: 'warning',
            reasons: ['low_speech_density'],
        },
    });

    assert.equal(marked.text, '【待確認】 可能辨識不完整的內容');
    assert.match(marked.srt, /【待確認】 第一段候選內容/);
    assert.match(marked.srt, /第二段候選內容/);
});

test('only reliable child results are eligible for following context', () => {
    const results = [
        { data: { text: '上一段正常內容', quality: { suspect: false } } },
        { data: { text: 'це婉嫉老家 雷仔', quality: { suspect: true } } },
        { data: { text: '下一段正常內容', quality: { suspect: false } } },
    ];

    assert.deepEqual(collectReliableTranscriptionText(results), [
        '上一段正常內容',
        '下一段正常內容',
    ]);
});

test('severe corruption is marked after the Worker retry instead of being fragmented', () => {
    assert.equal(shouldSplitSuspectTranscription(
        { suspect: true, severity: 'severe' },
        0,
        20
    ), false);
    assert.equal(shouldSplitSuspectTranscription(
        { suspect: true, severity: 'warning' },
        0,
        20
    ), true);
    assert.equal(shouldSplitSuspectTranscription(
        { suspect: false, severity: 'normal' },
        0,
        20
    ), false);
});

test('daily Workers AI allocation errors stop retries and provide a usage notice', () => {
    const legacyPayload = {
        error: '處理失敗：4006: you have used up your daily free allocation of 10,000 neurons',
        code: 'AI_REQUEST_FAILED',
        retryable: true,
    };

    assert.equal(isWorkersAiDailyLimitError(legacyPayload), true);
    assert.equal(isWorkersAiDailyLimitError({ code: 'AI_DAILY_LIMIT' }), true);
    assert.equal(shouldRetryWhisperResponse(500, legacyPayload), false);
    assert.equal(shouldRetryWhisperResponse(500, { code: 'AI_REQUEST_FAILED' }), true);

    const notice = getWorkersAiUsageNotice(legacyPayload);
    assert.match(notice.title, /今日.*額度|今日.*用量/);
    assert.match(notice.message, /10,000 neurons/);
    assert.match(notice.message, /已完成的字幕仍會保留/);
});
