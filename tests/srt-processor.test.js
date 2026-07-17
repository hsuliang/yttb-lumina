import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReplacementRules, processSubtitles } from '../public/js/srt-processor.js';

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
