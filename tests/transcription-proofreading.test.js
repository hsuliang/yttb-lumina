import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    applyProofreadingSuggestions,
    buildProofreadingPrompt,
    expandConsistencySuggestions,
    getSrtTimelineSignature,
    parseProofreadingSuggestions,
    splitSrtForProofreading,
    srtToPlainText,
    srtToVtt,
} from '../public/js/transcription-proofreading.js';

const sampleSrt = [
    '1\n00:00:00,000 --> 00:00:02,000\n大家好',
    '2\n00:00:02,000 --> 00:00:05,000\n書借了以後都沒有還預期',
    '3\n00:00:05,000 --> 00:00:08,000\n聯絡部也貼過了',
].join('\n\n');

test('proofreading prompt allows suggestions only and forbids timeline edits', () => {
    const prompt = buildProofreadingPrompt(sampleSrt, ['聯絡簿']);

    assert.match(prompt, /只能提出校對建議/);
    assert.match(prompt, /不得修改.*時間碼/);
    assert.match(prompt, /original/);
    assert.match(prompt, /suggested/);
    assert.match(prompt, /聯絡簿/);
});

test('AI suggestions are accepted only when they target one exact cue substring', () => {
    const suggestions = parseProofreadingSuggestions(JSON.stringify({
        suggestions: [
            {
                cueNumber: 2,
                original: '預期',
                suggested: '逾期',
                reason: '借書超過歸還期限',
                confidence: 'high',
            },
            {
                cueNumber: 3,
                original: '不存在的文字',
                suggested: '不應採用',
                reason: '原文不吻合',
                confidence: 'high',
            },
            {
                cueNumber: 1,
                original: '大家好',
                suggested: '歡迎大家收聽今天的節目',
                reason: '改寫句子',
                confidence: 'low',
            },
            {
                cueNumber: 2,
                original: '預期',
                suggested: '逾期',
                reason: '重疊批次回傳的相同候選',
                confidence: 'high',
            },
        ],
    }), sampleSrt);

    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].time, '00:00:02,000');
    assert.equal(suggestions[0].original, '預期');
    assert.equal(suggestions[0].suggested, '逾期');
    assert.match(suggestions[0].context, /聯絡部也貼過了/);
});

test('long subtitles are split into focused batches with boundary context overlap', () => {
    const longSrt = Array.from({ length: 360 }, (_, index) => {
        const number = index + 1;
        const seconds = String(index % 60).padStart(2, '0');
        const nextSeconds = String((index + 1) % 60).padStart(2, '0');
        return `${number}\n00:00:${seconds},000 --> 00:00:${nextSeconds},000\n`
            + `這是第${number}段需要仔細校對的繁體中文字幕內容，請保留原始時間軸。`;
    }).join('\n\n');
    const batches = splitSrtForProofreading(longSrt);

    assert.ok(batches.length >= 3 && batches.length <= 6);
    const cueNumbers = batch => [...batch.matchAll(/(?:^|\n\n)(\d+)\n\d{2}:\d{2}:\d{2},\d{3} -->/g)]
        .map(match => Number(match[1]));
    const covered = new Set(batches.flatMap(cueNumbers));
    assert.deepEqual([...covered].sort((a, b) => a - b), Array.from({ length: 360 }, (_, i) => i + 1));

    for (let index = 1; index < batches.length; index++) {
        const previous = cueNumbers(batches[index - 1]);
        const current = cueNumbers(batches[index]);
        assert.deepEqual(current.slice(0, 2), previous.slice(-2));
        assert.ok(current.some(number => !previous.includes(number)));
    }
});

test('only user-selected suggestions change text while sequence and timelines stay identical', () => {
    const suggestions = parseProofreadingSuggestions({
        suggestions: [
            {
                cueNumber: 2,
                original: '預期',
                suggested: '逾期',
                reason: '借書超過期限',
                confidence: 'high',
            },
            {
                cueNumber: 3,
                original: '聯絡部',
                suggested: '聯絡簿',
                reason: '學校使用的簿冊',
                confidence: 'high',
            },
        ],
    }, sampleSrt);
    const beforeTimeline = getSrtTimelineSignature(sampleSrt);
    const result = applyProofreadingSuggestions(sampleSrt, suggestions, [suggestions[0].id]);

    assert.equal(result.applied.length, 1);
    assert.match(result.srt, /沒有還逾期/);
    assert.match(result.srt, /聯絡部也貼過了/);
    assert.deepEqual(getSrtTimelineSignature(result.srt), beforeTimeline);
});

test('stale suggestions never overwrite a cue edited after analysis', () => {
    const suggestions = parseProofreadingSuggestions({
        suggestions: [{
            cueNumber: 2,
            original: '預期',
            suggested: '逾期',
            reason: '借書超過期限',
            confidence: 'high',
        }],
    }, sampleSrt);
    const manuallyEdited = sampleSrt.replace('書借了以後都沒有還預期', '書借了以後都沒有還，尚待人工確認');
    const result = applyProofreadingSuggestions(manuallyEdited, suggestions, [suggestions[0].id]);

    assert.equal(result.applied.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.srt, manuallyEdited);
});

test('derived text and VTT reflect approved wording without changing timestamps', () => {
    const corrected = sampleSrt.replace('預期', '逾期');
    const vtt = srtToVtt(corrected);

    assert.match(srtToPlainText(corrected), /沒有還逾期/);
    assert.match(vtt, /00:00:02\.000 --> 00:00:05\.000/);
    assert.doesNotMatch(vtt, /00:00:02,000/);
});

test('repeated AI-detected terms are offered as unmodified-timeline consistency suggestions', () => {
    const repeatedSrt = [
        '1\n00:00:00,000 --> 00:00:02,000\n聯絡部要給家長簽名',
        '2\n00:00:02,000 --> 00:00:04,000\n老師也會檢查聯絡部',
        '3\n00:00:04,000 --> 00:00:06,000\n學校的行政部門',
    ].join('\n\n');
    const aiSuggestions = parseProofreadingSuggestions({
        suggestions: [{
            cueNumber: 1,
            original: '聯絡部',
            suggested: '聯絡簿',
            reason: '學校使用的簿冊',
            confidence: 'high',
        }],
    }, repeatedSrt);
    const suggestions = expandConsistencySuggestions(repeatedSrt, aiSuggestions);

    assert.equal(suggestions.length, 2);
    assert.equal(suggestions[1].cueNumber, 2);
    assert.equal(suggestions[1].source, 'consistency');
    assert.equal(suggestions[1].confidence, 'medium');

    const beforeTimeline = getSrtTimelineSignature(repeatedSrt);
    const result = applyProofreadingSuggestions(repeatedSrt, suggestions, [suggestions[1].id]);
    assert.match(result.srt, /檢查聯絡簿/);
    assert.match(result.srt, /聯絡部要給家長簽名/);
    assert.deepEqual(getSrtTimelineSignature(result.srt), beforeTimeline);
});

test('single-character and ambiguous mappings do not create consistency suggestions', () => {
    const repeatedSrt = [
        '1\n00:00:00,000 --> 00:00:02,000\n忘了帶齒',
        '2\n00:00:02,000 --> 00:00:04,000\n又忘了帶齒',
        '3\n00:00:04,000 --> 00:00:06,000\n聯絡部要簽名',
        '4\n00:00:06,000 --> 00:00:08,000\n聯絡部需要整理',
        '5\n00:00:08,000 --> 00:00:10,000\n再檢查聯絡部',
    ].join('\n\n');
    const aiSuggestions = parseProofreadingSuggestions({ suggestions: [
        { cueNumber: 1, original: '齒', suggested: '尺', reason: '文具', confidence: 'high' },
        { cueNumber: 3, original: '聯絡部', suggested: '聯絡簿', reason: '簿冊', confidence: 'high' },
        { cueNumber: 4, original: '聯絡部', suggested: '聯絡簿本', reason: '另一候選', confidence: 'medium' },
    ] }, repeatedSrt);
    const suggestions = expandConsistencySuggestions(repeatedSrt, aiSuggestions);

    assert.equal(suggestions.length, aiSuggestions.length);
});

test('proofreading UI defaults to manual selection and provides undo', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const uiSource = readFileSync(new URL('../public/js/tab0-transcribe.js', import.meta.url), 'utf8');

    assert.match(html, /id="tab0-proofread-btn"[^>]*disabled/);
    assert.match(html, /id="tab0-proofread-undo-btn"[^>]*hidden/);
    assert.match(uiSource, /input type="checkbox" data-proofreading-index="\$\{index\}"/);
    assert.doesNotMatch(uiSource, /data-proofreading-index="\$\{index\}"[^>]*\schecked(?:\s|>)/);
    assert.match(uiSource, /data-proofreading-index\]:checked/);
    assert.match(uiSource, /data-proofreading-action="select-all"/);
    assert.match(uiSource, /data-proofreading-action="clear"/);
    assert.match(uiSource, /id="proofreading-selected-count"/);
    assert.match(uiSource, /max-h-\[48vh\]/);
    assert.match(uiSource, /applyProofreadingSuggestions\(current\.srt, suggestions, selectedIds\)/);
    assert.match(uiSource, /已復原最近一次 AI 校對，時間軸保持不變/);
});
