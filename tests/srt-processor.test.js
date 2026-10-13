import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReplacementRules, processSubtitles } from '../public/js/srt-processor.js';
import { applyProofreadingSuggestions, parseProofreadingSuggestions } from '../public/js/transcription-proofreading.js';

test('replacement rules preserve configured terminology', () => {
    const result = applyReplacementRules(
        'ㄚ亮笑長介紹亮點',
        [{ original: '亮', replacement: '量' }],
        ['ㄚ亮笑長']
    );
    assert.equal(result.text, 'ㄚ亮笑長介紹量點');
    assert.equal(result.replacementsMade, 1);
});

test('start-organize replacements apply to subtitle text without changing timestamps', () => {
    const input = '1\n00:00:01,000 --> 00:00:02,000\n錯字內容';
    const result = processSubtitles(input, {
        maxCharsPerLine: 50,
        keepPunctuation: true,
        fixTimestamps: true,
        timestampThreshold: 0,
        batchReplaceRules: [{ original: '錯字', replacement: '正字' }],
        protectedTerms: [],
        mergeShortLinesThreshold: 0,
        timelineShift: 0,
    });
    assert.match(result.processedSrt, /00:00:01,000 --> 00:00:02,000/);
    assert.match(result.processedSrt, /正字內容/);
});

test('current Tab 1 typo rules can override a previously approved correction', () => {
    const raw = '1\n00:00:00,000 --> 00:00:02,000\n借書已經逾期';
    const [suggestion] = parseProofreadingSuggestions({ suggestions: [{
        cueNumber: 1, original: '逾期', suggested: '過期', confidence: 'high',
    }] }, raw);
    const approved = applyProofreadingSuggestions(raw, [suggestion], [suggestion.id]).srt;
    const processed = processSubtitles(approved, {
        maxCharsPerLine: 50,
        keepPunctuation: true,
        fixTimestamps: false,
        timestampThreshold: 0,
        batchReplaceRules: [{ original: '過期', replacement: '逾期' }],
        protectedTerms: [],
        mergeShortLinesThreshold: 0,
        timelineShift: 0,
    }).processedSrt;
    assert.match(approved, /借書已經過期/);
    assert.match(processed, /借書已經逾期/);
    assert.match(processed, /00:00:00,000 --> 00:00:02,000/);
});
