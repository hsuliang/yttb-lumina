import test from 'node:test';
import assert from 'node:assert/strict';
import {
    callGeminiAPI,
    callGeminiAudioAPI,
    parseGeminiSseEvent,
} from '../public/js/gemini-api.js';

const responseChunk = {
    candidates: [{
        content: { role: 'model', parts: [{ text: '第一段' }] },
    }],
};

test('Gemini SSE parser accepts standard LF and CRLF framing', () => {
    assert.deepEqual(
        parseGeminiSseEvent(`data: ${JSON.stringify(responseChunk)}`),
        responseChunk,
    );
    assert.deepEqual(
        parseGeminiSseEvent(`event: message\r\ndata: ${JSON.stringify(responseChunk)}\r\n`),
        responseChunk,
    );
});

test('Gemini SSE parser accepts a final raw JSON response without SSE framing', () => {
    assert.deepEqual(parseGeminiSseEvent(JSON.stringify(responseChunk)), responseChunk);
    assert.equal(parseGeminiSseEvent('data: [DONE]'), null);
});

test('Gemini SSE parser reports malformed payloads as stream parse errors', () => {
    assert.throws(
        () => parseGeminiSseEvent('data: {"candidates":'),
        error => error.code === 'stream_parse' && /Failed to parse stream/.test(error.message),
    );
});

class MemoryStorage {
    #values = new Map();

    getItem(key) {
        return this.#values.get(key) ?? null;
    }

    setItem(key, value) {
        this.#values.set(key, String(value));
    }

    removeItem(key) {
        this.#values.delete(key);
    }
}

test('all Gemini generation modes use the shared REST transport', async () => {
    const originalFetch = globalThis.fetch;
    const originalLocalStorage = globalThis.localStorage;
    const originalSessionStorage = globalThis.sessionStorage;
    const originalDocument = globalThis.document;
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    const keys = ['stream-key', 'json-key', 'audio-key'];
    localStorage.setItem('geminiApiKeys', JSON.stringify(keys.map(key => ({ key, count: 0 }))));
    const requests = [];

    globalThis.localStorage = localStorage;
    globalThis.sessionStorage = sessionStorage;
    globalThis.document = { getElementById: () => null };
    globalThis.fetch = async (url, options = {}) => {
        requests.push({ url: String(url), options });

        if (String(url).includes('/models?')) {
            return new Response(JSON.stringify({
                models: [{
                    name: 'models/gemini-3.7-flash',
                    supportedGenerationMethods: ['generateContent'],
                }],
            }), { status: 200, headers: { 'content-type': 'application/json' } });
        }

        const isStream = String(url).includes(':streamGenerateContent?alt=sse');
        const body = JSON.parse(options.body);
        const key = options.headers['x-goog-api-key'];
        assert.equal(body.systemInstruction.role, 'system');
        assert.ok(body.systemInstruction.parts[0].text);
        assert.ok(key);

        if (isStream) {
            const text = key === 'audio-key' ? '字幕內容' : '串流內容';
            return new Response(
                `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n` +
                `data: ${JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] })}\n`,
                { status: 200, headers: { 'content-type': 'text/event-stream' } },
            );
        }

        return new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    try {
        const textCallbacks = [];
        const streamResult = await callGeminiAPI(
            'stream-key',
            '請產生串流內容',
            false,
            (chunkText, fullText) => textCallbacks.push({ chunkText, fullText }),
        );
        assert.equal(streamResult, '串流內容');
        assert.deepEqual(textCallbacks, [
            { chunkText: '', fullText: 'Gemini (gemini-3.7-flash) 思考中...' },
            { chunkText: '串流內容', fullText: '串流內容' },
        ]);

        const jsonResult = await callGeminiAPI('json-key', '請產生 JSON', true, () => {
            throw new Error('forceJson must not use the stream callback');
        });
        assert.equal(jsonResult, '{"ok":true}');

        const audioCallbacks = [];
        const audioResult = await callGeminiAudioAPI(
            'audio-key',
            'AQID',
            'audio/wav',
            '請轉寫音訊',
            (chunkText, fullText) => audioCallbacks.push({ chunkText, fullText }),
        );
        assert.equal(audioResult, '字幕內容');
        assert.deepEqual(audioCallbacks, [
            { chunkText: '字幕內容', fullText: '字幕內容' },
        ]);

        const generationRequests = requests.filter(request => request.options.method === 'POST');
        assert.equal(generationRequests.length, 3);
        assert.equal(generationRequests.filter(request => request.url.includes(':streamGenerateContent?alt=sse')).length, 2);
        assert.equal(generationRequests.filter(request => request.url.endsWith(':generateContent')).length, 1);
        const audioBody = JSON.parse(generationRequests.find(request => request.options.headers['x-goog-api-key'] === 'audio-key').options.body);
        assert.deepEqual(audioBody.contents[0].parts[1].inlineData, { data: 'AQID', mimeType: 'audio/wav' });
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.localStorage = originalLocalStorage;
        globalThis.sessionStorage = originalSessionStorage;
        globalThis.document = originalDocument;
    }
});
