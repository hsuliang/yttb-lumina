import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileFunction, constants } from 'node:vm';
import { fileURLToPath } from 'node:url';
import * as timeline from '../public/js/transcription-timeline.js';
import { parseWhisperDictionary } from '../public/js/whisper-processing.js';
import { processWhisperChunk } from '../public/js/whisper-client.js';
import * as quality from '../public/js/transcription-quality.js';

// Exercise the actual transcription loop without loading the DOM application.
const file = new URL('../public/js/tab0-transcribe.js', import.meta.url);
const source = readFileSync(file, 'utf8');
const functionSource = source.slice(source.indexOf('async function transcribeWithWhisper('),
    source.indexOf('// ########## TAB 0 INITIALIZATION'));

async function runTranscription(fetchResponse, { chunkCount = 8, health = { clientProcessing: 'client-v1' } } = {}) {
    const chunks = Array.from({ length: chunkCount }, (_, index) => ({
        data: new Float32Array(1), sampleRate: 16000,
        offsetSeconds: index * 20, durationSeconds: 20,
    }));
    const audio = { duration: chunkCount * 20, length: 1, sampleRate: 16000, getChannelData: () => new Float32Array(1) };
    const requests = [];
    const progress = [];
    const dependencies = {
        ...timeline, ...quality, parseWhisperDictionary, processWhisperChunk,
        localStorage: { getItem: key => key.endsWith('-url') ? 'https://worker.example' : null },
        sessionStorage: { getItem: () => null },
        state: { aiTerminologyRules: [], batchReplaceRules: [] },
        AudioContext: class { async decodeAudioData() { return audio; } async close() {} },
        OfflineAudioContext: class {
            createBufferSource() { return { connect() {}, start() {} }; }
            async startRendering() { return audio; }
        },
        splitPcmByLowEnergy: () => chunks,
        float32ToWavBlob: () => new Blob(['audio']),
        applyBatchReplaceToSrt: value => value,
        applyReplacementRules: text => ({ text }),
        setTimeout: callback => { callback(); },
        fetch: async (_url, options) => {
            if (_url.endsWith('/api/health')) return Response.json(health);
            const index = Number(options.headers['X-Chunk-Index']);
            requests.push(index);
            return fetchResponse(index, requests.length);
        },
    };
    const transcribe = compileFunction(`return ${functionSource}`, [], {
        filename: fileURLToPath(file), contextExtensions: [dependencies],
        importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
    })();
    const result = await transcribe({ name: 'long.m4a', arrayBuffer: async () => new ArrayBuffer(1) },
        'en', '', event => progress.push(event));
    return { result, requests, progress };
}

const success = () => Response.json({ processing: 'client-v1', result: { text: 'Saved speech.', segments: [{ start: 0, end: 3, text: 'Saved speech.' }] } });

for (const failure of ['network', '503']) {
    test(`stops after three consecutive failed chunks (${failure}) and preserves partial subtitles`, async () => {
        const { result, requests, progress } = await runTranscription(index => {
            if (index === 0) return success();
            if (failure === 'network') throw new TypeError('Failed to fetch');
            return new Response('Worker exceeded resource limits', { status: 503 });
        });
        assert.equal(requests.length, 10); // One success, three chunks with three attempts each.
        assert.equal(Math.max(...requests), 3);
        assert.match(result.srt, /Saved/);
        assert.match(result.srt, /speech/);
        assert.equal(result.incomplete, true);
        assert.equal(result.failedRanges.at(-1).end, 160);
        assert.match(result.warning, /連續.*停止/);
        assert.ok(!progress.some(event => event.message === '全部辨識完成！'));
    });
}

test('a successful chunk resets consecutive failures and isolated gaps remain incomplete', async () => {
    const { result, requests, progress } = await runTranscription(index => {
        if ([1, 2, 4, 5].includes(index)) throw new TypeError('Failed to fetch');
        return success();
    });
    assert.equal(Math.max(...requests), 7);
    assert.equal(result.failedRanges.length, 4);
    assert.equal(result.incomplete, true);
    assert.ok(!progress.some(event => event.message === '全部辨識完成！'));
});

test('daily AI quota stops immediately and keeps previous subtitles', async () => {
    const { result, requests } = await runTranscription(index => index === 0 ? success()
        : Response.json({ code: 'AI_DAILY_LIMIT', error: 'Daily limit' }, { status: 429 }));
    assert.equal(requests.length, 2);
    assert.equal(result.usageLimit.code, 'AI_DAILY_LIMIT');
    assert.match(result.srt, /Saved/);
    assert.match(result.srt, /speech/);
});

test('successful transcription processes every chunk and reports completion', async () => {
    const { result, requests, progress } = await runTranscription(success);
    assert.equal(requests.length, 8);
    assert.equal(result.incomplete, false);
    assert.ok(progress.some(event => event.message === '全部辨識完成！'));
});

test('user cancellation is not retried or swallowed as a failed chunk', async () => {
    let calls = 0;
    await assert.rejects(runTranscription(() => {
        calls++;
        throw new DOMException('Cancelled', 'AbortError');
    }), { name: 'AbortError' });
    assert.equal(calls, 1);
});


test('old Worker is rejected before uploading any audio', async () => {
    let uploads = 0;
    await assert.rejects(runTranscription(() => { uploads++; return success(); }, {
        health: { version: '1.3.1' },
    }), /1\.3\.1.*低 CPU/);
    assert.equal(uploads, 0);
});

test('72-minute sequence processes all 216 chunks without a time-based cutoff', async () => {
    const { result, requests } = await runTranscription(success, { chunkCount: 216 });
    assert.equal(requests.length, 216);
    assert.equal(requests.at(-1), 215);
    assert.equal(result.incomplete, false);
    assert.match(result.srt, /01:11:40,000/);
});
