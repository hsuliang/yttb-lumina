import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cf-worker/worker.js';
import {
    analyzeWavPcm,
    buildWhisperInput,
    decorateFirstChunkSrt,
    detectLeadingMusicRange,
    evaluateTranscriptionQuality,
    fixSpellingInText,
    mergeSrtBlocks,
    parseSrtCues,
    restoreChinesePunctuation,
    segmentsToSrt,
    srtToVtt,
    vttToSrt,
} from '../cf-worker/worker.js';

function makeWav(samples, sampleRate = 16000) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const write = (offset, text) => {
        for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };
    write(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    write(8, 'WAVE');
    write(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    samples.forEach((sample, index) => {
        const normalized = Math.max(-1, Math.min(1, sample));
        view.setInt16(44 + index * 2, Math.round(normalized * 32767), true);
    });
    return buffer;
}

function sineWave(seconds, sampleRate = 16000, amplitude = 0.25) {
    return Float32Array.from(
        { length: Math.round(seconds * sampleRate) },
        (_, index) => Math.sin(index / sampleRate * Math.PI * 2 * 440) * amplitude
    );
}

test('health endpoint identifies Worker version 1.2.8', async () => {
    const response = await worker.fetch(
        new Request('https://worker.example/api/health'),
        {},
        {}
    );
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.version, '1.2.8');
});

test('VTT parser keeps consecutive cues separate even without blank lines', () => {
    const vtt = [
        'WEBVTT',
        '',
        '00:00.000 --> 00:00.120',
        'L',
        '00:00.120 --> 00:00.240',
        'U',
        '00:00.240 --> 00:00.360',
        'M',
    ].join('\n');
    const cues = parseSrtCues(vttToSrt(vtt));
    assert.deepEqual(cues.map(cue => cue.text), ['L', 'U', 'M']);
    assert.ok(cues.every(cue => !cue.text.includes('-->')));
});

test('structured Whisper segments are preferred as valid timed cues', () => {
    const srt = segmentsToSrt([
        { start: 0.2, end: 1.4, text: '第一段' },
        { start: 1.5, end: 2.8, text: '第二段' },
    ]);
    const cues = parseSrtCues(srt);
    assert.deepEqual(cues.map(cue => [cue.startMs, cue.endMs, cue.text]), [
        [200, 1400, '第一段'],
        [1500, 2800, '第二段'],
    ]);
});

test('Chinese punctuation is conservative and only restores clear questions', () => {
    const input = [
        '1\n00:00:00,000 --> 00:00:04,500\n這是一段沒有標點而且長度足夠的字幕',
        '2\n00:00:04,500 --> 00:00:05,800\n這樣可以嗎',
        '3\n00:00:06,100 --> 00:00:07,800\n這是下一句',
    ].join('\n\n');
    const result = restoreChinesePunctuation(input);
    assert.equal(result.restored, 1);
    assert.match(result.srt, /沒有標點而且長度足夠的字幕$/m);
    assert.match(result.srt, /這樣可以嗎？/);
    assert.match(result.srt, /這是下一句$/m);
    assert.doesNotMatch(result.srt, /字幕[，。]/);
});

test('English repair only joins fragments that form a known dictionary word', () => {
    const dictionary = new Set(['facebook', 'video', 'editing', 'use', 'every', 'day']);
    assert.equal(fixSpellingInText('faceb ook', dictionary), 'facebook');
    assert.equal(fixSpellingInText('video editing', dictionary), 'video editing');
    assert.equal(fixSpellingInText('I use GPT every day', dictionary), 'I use GPT every day');
    assert.equal(fixSpellingInText('ChatGPT Codex', dictionary), 'ChatGPT Codex');
    assert.equal(fixSpellingInText('Q R Code 和 P P T', dictionary), 'QR Code 和 PPT');
    assert.equal(fixSpellingInText('A 4 文件', dictionary), 'A4 文件');
    assert.equal(fixSpellingInText('I am a B student', dictionary), 'I am a B student');
});

test('subtitle normalization removes zero-duration cues and respects hard punctuation', () => {
    const input = [
        '1\n00:00:00,000 --> 00:00:01,000\nHello.',
        '2\n00:00:01,000 --> 00:00:02,000\nNext sentence.',
        '3\n00:00:02,000 --> 00:00:02,000\n不可顯示',
    ].join('\n\n');
    const cues = parseSrtCues(mergeSrtBlocks(input));
    assert.deepEqual(cues.map(cue => cue.text), ['Hello.', 'Next sentence.']);
    assert.ok(cues.every(cue => cue.endMs > cue.startMs));
});

test('SRT to VTT conversion preserves subtitle lines that contain only numbers', () => {
    const vtt = srtToVtt('1\n00:00:00,000 --> 00:00:01,000\n123');
    assert.match(vtt, /00:00:00\.000 --> 00:00:01\.000/);
    assert.match(vtt, /\n123$/);
});

test('a single long cue is split to readable duration and length limits', () => {
    const text = '這是一段很長的字幕，應該優先依照標點切開，並且確保每一段的時間與文字長度都適合閱讀。';
    const input = `1\n00:00:00,000 --> 00:00:12,000\n${text}`;
    const cues = parseSrtCues(mergeSrtBlocks(input));
    assert.ok(cues.length >= 2);
    assert.ok(cues.every(cue => cue.endMs - cue.startMs <= 6000));
    assert.ok(cues.every(cue => Array.from(cue.text.replace(/\s/g, '')).length <= 28));
});

test('long Chinese cues split on word and semantic boundaries without invented punctuation', () => {
    const text = '好我看我的說話速度會先思考我要講的內容夠不夠一個小時講完 但更重要的是 其實像這邊有強調的 可是其實你如果仔細問你就會發現 有些小朋友';
    const cues = parseSrtCues(mergeSrtBlocks(`1\n00:00:00,000 --> 00:00:16,000\n${text}`));
    assert.ok(cues.length >= 3);
    assert.ok(cues.every(cue => Array.from(cue.text.replace(/\s/g, '')).length <= 28));
    assert.ok(cues.every(cue => !/[，。]$/u.test(cue.text)));
    assert.ok(cues.some(cue => cue.text.includes('但更重要的是')));
    assert.ok(cues.some(cue => cue.text.includes('但更重要的是 其實像這邊有強調的')));
    assert.ok(cues.some(cue => cue.text.includes('有些小朋友')));
    assert.doesNotMatch(cues.map(cue => cue.text).join('\n'), /思\n考|小\n朋友/u);
});

test('uneven text splits still keep every subtitle within the duration limit', () => {
    const input = '1\n00:00:00,000 --> 00:00:12,000\n短句，這裡接著一段比較長的內容';
    const cues = parseSrtCues(mergeSrtBlocks(input, 800, 6000, 20));
    assert.ok(cues.length >= 2);
    assert.ok(cues.every(cue => cue.endMs - cue.startMs <= 6000));
});

test('a short orphaned tail is rebalanced with its preceding sentence', () => {
    const input = [
        '1\n00:00:13,774 --> 00:00:18,719\n就是還能上線的老師們真的是太值得值得鼓勵了齁實在是很',
        '2\n00:00:18,719 --> 00:00:19,419\n強這樣',
    ].join('\n\n');
    const cues = parseSrtCues(mergeSrtBlocks(input));

    assert.equal(cues.length, 2);
    assert.equal(
        cues.map(cue => cue.text).join(''),
        '就是還能上線的老師們真的是太值得值得鼓勵了齁實在是很強這樣'
    );
    assert.ok(cues.every(cue => Array.from(cue.text.replace(/\s/g, '')).length >= 10));
    assert.ok(cues.every(cue => cue.endMs - cue.startMs <= 6000));
});

test('duration splitting keeps a domain name intact', () => {
    const input = '1\n00:00:00,000 --> 00:00:10,789\n您就輸入lumioclass.com';
    const cues = parseSrtCues(mergeSrtBlocks(input));

    assert.ok(cues.length >= 2);
    assert.ok(cues.every(cue => cue.endMs - cue.startMs <= 6000));
    assert.ok(cues.some(cue => cue.text === 'lumioclass.com'));
    assert.equal(cues.map(cue => cue.text).join(''), '您就輸入lumioclass.com');
});

test('music markers stay separate from adjacent speech', () => {
    const input = [
        '1\n00:00:00,000 --> 00:00:03,000\n[Music]',
        '2\n00:00:03,000 --> 00:00:05,000\n大家好。',
    ].join('\n\n');
    assert.deepEqual(
        parseSrtCues(mergeSrtBlocks(input)).map(cue => cue.text),
        ['【音樂】', '大家好。']
    );
});

test('PCM analysis detects sustained leading audio but not digital silence', () => {
    const music = analyzeWavPcm(makeWav(sineWave(4)));
    const silence = analyzeWavPcm(makeWav(new Float32Array(4 * 16000)));
    assert.deepEqual(detectLeadingMusicRange(music, 4000), { startMs: 0, endMs: 4000 });
    assert.equal(detectLeadingMusicRange(silence, 4000), null);
});

test('the first chunk receives one AI label and a detected music cue', () => {
    const analysis = analyzeWavPcm(makeWav(sineWave(5)));
    const speech = '1\n00:00:03,000 --> 00:00:05,000\n大家好。';
    const decorated = parseSrtCues(decorateFirstChunkSrt(speech, analysis, true));
    assert.equal(decorated[0].text, '《 字幕君：ㄚ亮笑長的內容助手》 【音樂】');
    assert.equal(decorated[0].startMs, 0);
    assert.equal(decorated[0].endMs, 3000);
    assert.equal(decorated[1].text, '大家好。');

    const laterChunk = decorateFirstChunkSrt(speech, analysis, false);
    assert.doesNotMatch(laterChunk, /《 字幕君：ㄚ亮笑長的內容助手》/);
});

test('transcription endpoint retries a suspect result and decorates the selected first chunk', async () => {
    const calls = [];
    const responses = [
        {
            text: '請使用繁體中文字幕',
            vtt: 'WEBVTT\n\n00:00:03.000 --> 00:00:05.000\n請使用繁體中文字幕',
        },
        {
            text: '大家好。',
            vtt: 'WEBVTT\n\n00:00:03.000 --> 00:00:05.000\n大家好。',
            transcription_info: { language: 'zh' },
        },
    ];
    const env = {
        AI: {
            async run(_model, input) {
                calls.push(input);
                return responses[calls.length - 1];
            },
        },
    };
    const request = new Request('https://worker.example/api/transcribe', {
        method: 'POST',
        headers: {
            'Content-Type': 'audio/wav',
            'X-Language': 'zh',
            'X-First-Chunk': '1',
            'X-Media-Title': encodeURIComponent('測試節目'),
            'X-Previous-Context': encodeURIComponent('上一段的內容'),
        },
        body: makeWav(sineWave(5)),
    });

    const response = await worker.fetch(request, env, {});
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].condition_on_previous_text, true);
    assert.equal(calls[1].condition_on_previous_text, false);
    assert.match(calls[0].initial_prompt, /測試節目/);
    assert.match(calls[0].initial_prompt, /上一段的內容/);
    assert.match(calls[1].initial_prompt, /測試節目/);
    assert.doesNotMatch(calls[1].initial_prompt, /上一段的內容/);
    assert.equal(result.quality.retried, true);
    assert.equal(result.quality.suspect, false);
    assert.equal(result.detectedLanguage, 'zh');
    assert.match(result.srt, /《 字幕君：ㄚ亮笑長的內容助手》 【音樂】/);
    assert.match(result.srt, /大家好。/);
    assert.doesNotMatch(result.srt, /請使用繁體中文字幕/);
});

test('transcription endpoint replaces a low-density Chinese result only with a better retry', async () => {
    const calls = [];
    const responses = [
        {
            text: '好對是好你先決這次衣怎麼寫製我們搜尼這麼衍獻一攝',
            segments: [
                { start: 0, end: 20, text: '好對是好你先決這次衣怎麼寫製我們搜尼這麼衍獻一攝' },
            ],
            transcription_info: { language: 'zh' },
        },
        {
            text: '這是一段重新辨識後內容完整而且文字密度正常的中文語音字幕可以安全取代第一次的低品質結果',
            segments: [
                { start: 0, end: 10, text: '這是一段重新辨識後內容完整而且文字密度正常的中文語音字幕' },
                { start: 10, end: 20, text: '可以安全取代第一次的低品質結果' },
            ],
            transcription_info: { language: 'zh' },
        },
    ];
    const env = {
        AI: {
            async run() {
                const result = responses[calls.length];
                calls.push(result);
                return result;
            },
        },
    };
    const request = new Request('https://worker.example/api/transcribe', {
        method: 'POST',
        headers: {
            'Content-Type': 'audio/wav',
            'X-Language': 'zh',
            'X-First-Chunk': '0',
            'X-Chunk-Index': '1',
        },
        body: makeWav(sineWave(20)),
    });

    const response = await worker.fetch(request, env, {});
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    assert.match(result.text, /內容完整而且文字密度正常/);
    assert.doesNotMatch(result.text, /搜尼|衍獻/);
    assert.equal(result.quality.retried, true);
    assert.equal(result.quality.suspect, false);
});

test('invalid model input is retried once with a minimal Whisper payload', async () => {
    const calls = [];
    const env = {
        AI: {
            async run(_model, input) {
                calls.push(input);
                if (calls.length === 1) throw new Error('8001: Invalid input');
                return {
                    text: '大家好。',
                    segments: [{ start: 0, end: 5, text: '大家好。' }],
                    transcription_info: { language: 'zh' },
                };
            },
        },
    };
    const request = new Request('https://worker.example/api/transcribe', {
        method: 'POST',
        headers: {
            'Content-Type': 'audio/wav',
            'X-Language': 'zh',
            'X-Custom-Dict': encodeURIComponent('Lumio\n四個國小=四維國小'),
        },
        body: makeWav(sineWave(5)),
    });

    const response = await worker.fetch(request, env, {});
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    assert.ok(calls[0].initial_prompt);
    assert.equal(calls[1].initial_prompt, undefined);
    assert.equal(calls[1].beam_size, undefined);
    assert.equal(result.quality.usedMinimalInput, true);
});

test('persistent invalid model input returns a structured recoverable error', async () => {
    const env = {
        AI: {
            async run() {
                throw new Error('8001: Invalid input');
            },
        },
    };
    const request = new Request('https://worker.example/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav', 'X-Language': 'zh' },
        body: makeWav(sineWave(5)),
    });

    const response = await worker.fetch(request, env, {});
    const result = await response.json();
    assert.equal(response.status, 422);
    assert.equal(result.code, 'AI_INVALID_INPUT');
    assert.equal(result.retryable, true);
});

test('configured replacement rules are enforced inside the Worker output', async () => {
    const calls = [];
    const env = {
        AI: {
            async run(_model, input) {
                calls.push(input);
                return {
                    text: '四個國小會連結先輩知識，ch unk 和 Power Point。',
                    vtt: [
                        'WEBVTT',
                        '',
                        '00:00.000 --> 00:02.000',
                        '四個國小會連結先輩知識，',
                        '00:02.000 --> 00:02.500',
                        'ch',
                        '00:02.500 --> 00:03.000',
                        'unk',
                        '00:03.000 --> 00:05.000',
                        '和 Power Point。',
                    ].join('\n'),
                    transcription_info: { language: 'zh' },
                };
            },
        },
    };
    const request = new Request('https://worker.example/api/transcribe', {
        method: 'POST',
        headers: {
            'Content-Type': 'audio/wav',
            'X-Language': 'zh',
            'X-First-Chunk': '0',
            'X-Custom-Dict': encodeURIComponent([
                '四個國小=四維國小',
                '先輩知識=先備知識',
                '四維國小',
                '先備知識',
                'chunk',
                'PowerPoint',
            ].join('\n')),
        },
        body: makeWav(sineWave(5)),
    });

    const response = await worker.fetch(request, env, {});
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.match(calls[0].initial_prompt, /四維國小/);
    assert.match(calls[0].initial_prompt, /先備知識/);
    assert.match(result.text, /四維國小會連結先備知識，chunk 和 PowerPoint/);
    assert.match(result.srt, /四維國小會連結先備知識，/);
    assert.match(result.srt, /chunk和 PowerPoint/);
    assert.doesNotMatch(result.srt, /四個國小|先輩知識/);
    assert.doesNotMatch(result.srt, /ch unk|Power Point/);
});

test('auto language remains automatic and Whisper quality controls are enabled', () => {
    const automatic = buildWhisperInput('audio', 'auto');
    assert.equal(automatic.language, undefined);
    assert.equal(automatic.vad_filter, true);
    assert.equal(automatic.task, 'transcribe');

    const chinese = buildWhisperInput('audio', 'zh', ['專有名詞']);
    assert.equal(chinese.language, 'zh');
    assert.match(chinese.initial_prompt, /專有名詞/);

    const contextual = buildWhisperInput('audio', 'zh', [], false, '前一段內容', '節目標題');
    assert.match(contextual.initial_prompt, /節目標題/);
    assert.match(contextual.initial_prompt, /前一段內容/);
    const retry = buildWhisperInput('audio', 'zh', [], true, '可能錯誤的前文', '節目標題');
    assert.match(retry.initial_prompt, /節目標題/);
    assert.doesNotMatch(retry.initial_prompt, /可能錯誤的前文/);
});

test('quality gate flags prompt leakage, unexpected scripts, and sparse active audio', () => {
    const activeAudio = analyzeWavPcm(makeWav(sineWave(20)));
    const corrupted = evaluateTranscriptionQuality({
        text: '請使用繁體中文字幕 привет мир привет',
        srt: '1\n00:00:00,000 --> 00:00:01,000\n請使用繁體中文字幕 привет мир привет',
        audioAnalysis: activeAudio,
        language: 'zh',
    });
    assert.equal(corrupted.suspect, true);
    assert.ok(corrupted.reasons.includes('prompt_leak'));
    assert.ok(corrupted.reasons.includes('unexpected_scripts'));

    const sparse = evaluateTranscriptionQuality({
        text: '呃',
        srt: '1\n00:00:00,000 --> 00:00:00,500\n呃',
        audioAnalysis: activeAudio,
        language: 'zh',
    });
    assert.equal(sparse.suspect, true);
    assert.ok(sparse.reasons.includes('sparse_transcript'));

    const stretchedSparse = evaluateTranscriptionQuality({
        text: '我一定要去',
        srt: '1\n00:00:00,000 --> 00:00:20,000\n我一定要去',
        audioAnalysis: analyzeWavPcm(makeWav(sineWave(20))),
        language: 'zh',
    });
    assert.equal(stretchedSparse.suspect, true);
    assert.ok(stretchedSparse.reasons.includes('sparse_transcript'));
    assert.ok(stretchedSparse.charactersPerSecond < 0.75);

    const lowDensityChinese = evaluateTranscriptionQuality({
        text: '好對是好你先決這次衣怎麼寫製我們搜尼這麼衍獻一攝',
        srt: [
            '1\n00:00:00,000 --> 00:00:05,800\n好對是好你先決',
            '2\n00:00:05,800 --> 00:00:08,300\n這次衣',
            '3\n00:00:08,300 --> 00:00:13,300\n怎麼寫製我們',
            '4\n00:00:13,300 --> 00:00:15,000\n搜尼',
            '5\n00:00:15,000 --> 00:00:20,000\n這麼衍獻一攝',
        ].join('\n\n'),
        audioAnalysis: activeAudio,
        language: 'zh',
    });
    assert.equal(lowDensityChinese.suspect, true);
    assert.ok(lowDensityChinese.reasons.includes('low_speech_density'));

    const validSlowChinese = evaluateTranscriptionQuality({
        text: '老師正在慢慢說明今天要練習的內容請大家先看畫面再跟著步驟操作',
        srt: [
            '1\n00:00:00,000 --> 00:00:06,000\n老師正在慢慢說明今天要練習的內容',
            '2\n00:00:06,000 --> 00:00:13,000\n請大家先看畫面',
            '3\n00:00:13,000 --> 00:00:20,000\n再跟著步驟操作',
        ].join('\n\n'),
        audioAnalysis: activeAudio,
        language: 'zh',
    });
    assert.equal(validSlowChinese.suspect, false);
    assert.ok(!validSlowChinese.reasons.includes('low_speech_density'));

    const introMusic = evaluateTranscriptionQuality({
        text: '大家好今天一起來練習',
        srt: [
            '1\n00:00:00,000 --> 00:00:10,000\n【音樂】',
            '2\n00:00:10,000 --> 00:00:20,000\n大家好今天一起來練習',
        ].join('\n\n'),
        audioAnalysis: activeAudio,
        language: 'zh',
        isFirstChunk: true,
    });
    assert.ok(!introMusic.reasons.includes('low_speech_density'));

    const missingMiddle = evaluateTranscriptionQuality({
        text: '前段內容，後段內容。',
        srt: [
            '1\n00:00:00,000 --> 00:00:02,000\n前段內容，',
            '2\n00:00:17,000 --> 00:00:20,000\n後段內容。',
        ].join('\n\n'),
        audioAnalysis: activeAudio,
        language: 'zh',
    });
    assert.equal(missingMiddle.suspect, true);
    assert.ok(missingMiddle.reasons.includes('active_audio_gap'));
    assert.ok(missingMiddle.longestActiveGapMs >= 14000);

    const repeated = evaluateTranscriptionQuality({
        text: '謝謝觀看謝謝觀看謝謝觀看謝謝觀看',
        srt: '1\n00:00:00,000 --> 00:00:04,000\n謝謝觀看謝謝觀看謝謝觀看謝謝觀看',
        language: 'zh',
    });
    assert.equal(repeated.suspect, true);
    assert.ok(repeated.reasons.includes('repetition'));

    const implausible = evaluateTranscriptionQuality({
        text: '嗯',
        srt: '1\n00:00:00,000 --> 00:00:06,000\n嗯',
        rawSrt: '1\n00:00:00,000 --> 00:00:12,000\n嗯',
        language: 'zh',
    });
    assert.equal(implausible.suspect, true);
    assert.ok(implausible.reasons.includes('implausible_cue'));

    const timestampLeak = evaluateTranscriptionQuality({
        text: 'P00:13.480 --> 00:13.560',
        srt: '1\n00:00:00,000 --> 00:00:01,000\nP00:13.480 --> 00:13.560',
        language: 'zh',
    });
    assert.equal(timestampLeak.suspect, true);
    assert.ok(timestampLeak.reasons.includes('timestamp_leak'));

    const unreadableTiming = evaluateTranscriptionQuality({
        text: '這是不可能在極短時間內說完的內容這也是不可能在極短時間內說完的內容',
        srt: [
            '1\n00:00:00,000 --> 00:00:00,050\n這是不可能在極短時間內說完的內容',
            '2\n00:00:00,050 --> 00:00:00,100\n這也是不可能在極短時間內說完的內容',
            '3\n00:00:00,100 --> 00:00:00,150\n仍然是不合理的字幕',
        ].join('\n\n'),
        language: 'zh',
    });
    assert.equal(unreadableTiming.suspect, true);
    assert.ok(unreadableTiming.reasons.includes('unreadable_timing'));

    const missingFirstChunk = evaluateTranscriptionQuality({
        text: '',
        srt: '',
        audioAnalysis: analyzeWavPcm(makeWav(sineWave(10))),
        language: 'zh',
        isFirstChunk: true,
    });
    assert.equal(missingFirstChunk.suspect, true);
    assert.ok(missingFirstChunk.reasons.includes('active_audio_gap'));
});
