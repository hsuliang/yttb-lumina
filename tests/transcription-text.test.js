import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    buildWhisperDictionary,
    isProbablyChinese,
    normalizeTranscriptionPayload,
} from '../public/js/transcription-text.js';

test('Whisper dictionary keeps terminology and deterministic replacements as separate entries', () => {
    const dictionary = buildWhisperDictionary(
        [
            { type: 'positive', term: '四維國小' },
            { type: 'negative', term: '四個國小' },
            { type: 'positive', term: '先備知識' },
        ],
        [
            { original: '四個國小', replacement: '四維國小' },
            { original: '先輩知識', replacement: '先備知識' },
        ]
    );
    assert.deepEqual(dictionary.split('\n'), [
        '四維國小',
        '先備知識',
        '四個國小=四維國小',
        '先輩知識=先備知識',
    ]);
    assert.doesNotMatch(dictionary, /繁體中文字幕。四維國小/);
});

test('Chinese Whisper output is normalized to Taiwan Traditional Chinese', () => {
    const payload = {
        text: '这是课文的概念图。',
        srt: '1\n00:00:00,000 --> 00:00:02,000\n这是课文的概念图。',
        vtt: 'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n这是课文的概念图。',
    };
    const normalized = normalizeTranscriptionPayload(payload, 'zh');
    assert.equal(normalized.text, '這是課文的概念圖。');
    assert.match(normalized.srt, /這是課文的概念圖。/);
    assert.match(normalized.vtt, /這是課文的概念圖。/);
});

test('automatic detection converts Chinese but leaves Japanese and English unchanged', () => {
    assert.equal(isProbablyChinese('我们开始整理课文。'), true);
    assert.equal(isProbablyChinese('これは日本国です。'), false);

    const chinese = normalizeTranscriptionPayload({ text: '我们开始整理课文。' }, 'auto');
    const japanese = normalizeTranscriptionPayload({ text: 'これは日本国です。' }, 'auto');
    const english = normalizeTranscriptionPayload({ text: 'This is a transcript.' }, 'auto');
    assert.equal(chinese.text, '我們開始整理課文。');
    assert.equal(japanese.text, 'これは日本国です。');
    assert.equal(english.text, 'This is a transcript.');
});

test('Traditional Chinese is the default while automatic detection remains available', () => {
    const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const tab0 = fs.readFileSync(new URL('../public/js/tab0-transcribe.js', import.meta.url), 'utf8');
    assert.match(html, /<option value="zh">中文（繁體，推薦）<\/option>/);
    assert.match(html, /<option value="auto">自動偵測（多語音檔）<\/option>/);
    assert.match(tab0, /savedLanguage[^\n]+\|\| 'zh'/);
});
