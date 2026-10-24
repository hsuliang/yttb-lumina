import test from 'node:test';
import assert from 'node:assert/strict';
import {
    callGeminiAPI,
    callGeminiAudioAPI,
    parseGeminiSseEvent,
} from '../public/js/gemini-api.js';
import { getGeminiApiKey, saveGeminiApiKey } from '../public/js/gemini-key-storage.js';

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
    const originalDateNow = Date.now;
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    const apiKey = 'single-key';
    localStorage.setItem('geminiApiKey', apiKey);
    let fakeNow = Date.now();
    Date.now = () => (fakeNow += 30000);
    const requests = [];

    globalThis.localStorage = localStorage;
    globalThis.sessionStorage = sessionStorage;
    globalThis.document = { getElementById: () => null };
    globalThis.fetch = async (url, options = {}) => {
        requests.push({ url: String(url), options });

        if (String(url).includes('/models?')) {
            return new Response(JSON.stringify({
                models: [{
                    name: 'models/gemini-3.8-flash',
                    supportedGenerationMethods: ['generateContent'],
                }],
            }), { status: 200, headers: { 'content-type': 'application/json' } });
        }

        const isStream = String(url).includes(':streamGenerateContent?alt=sse');
        const body = JSON.parse(options.body);
        const key = options.headers['x-goog-api-key'];
        assert.equal(body.systemInstruction.role, 'system');
        assert.ok(body.systemInstruction.parts[0].text);
        assert.equal(key, apiKey);

        if (isStream) {
            const text = body.contents[0].parts.some(part => part.inlineData) ? '字幕內容' : '串流內容';
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
            apiKey,
            '請產生串流內容',
            false,
            (chunkText, fullText) => textCallbacks.push({ chunkText, fullText }),
        );
        assert.equal(streamResult, '串流內容');
        assert.deepEqual(textCallbacks, [
            { chunkText: '', fullText: 'Gemini (gemini-3.8-flash) 思考中...' },
            { chunkText: '串流內容', fullText: '串流內容' },
        ]);

        const jsonResult = await callGeminiAPI(apiKey, '請產生 JSON', true, () => {
            throw new Error('forceJson must not use the stream callback');
        });
        assert.equal(jsonResult, '{"ok":true}');

        const audioCallbacks = [];
        const audioResult = await callGeminiAudioAPI(
            apiKey,
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
        assert.ok(generationRequests.every(request => request.options.headers['x-goog-api-key'] === apiKey));
        const audioBody = JSON.parse(generationRequests.find(request => JSON.parse(request.options.body).contents[0].parts.some(part => part.inlineData)).options.body);
        assert.deepEqual(audioBody.contents[0].parts[1].inlineData, { data: 'AQID', mimeType: 'audio/wav' });
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.localStorage = originalLocalStorage;
        globalThis.sessionStorage = originalSessionStorage;
        globalThis.document = originalDocument;
        Date.now = originalDateNow;
    }
});

test('a 429 stops the current request and blocks the next operation without switching keys or models', async () => {
    const originalFetch = globalThis.fetch;
    const originalLocalStorage = globalThis.localStorage;
    const originalSessionStorage = globalThis.sessionStorage;
    const originalDocument = globalThis.document;
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    const apiKey = 'single-quota-key';
    localStorage.setItem('aliang-ai-engine', 'gemini');
    localStorage.setItem('geminiApiKey', apiKey);
    const requests = [];

    globalThis.localStorage = localStorage;
    globalThis.sessionStorage = sessionStorage;
    globalThis.document = { getElementById: () => null };
    globalThis.fetch = async (url, options = {}) => {
        const request = { url: String(url), options };
        requests.push(request);

        if (request.url.includes('/models?')) {
            return new Response(JSON.stringify({
                models: [{
                    name: 'models/gemini-3.8-flash',
                    supportedGenerationMethods: ['generateContent'],
                }],
            }), { status: 200, headers: { 'content-type': 'application/json' } });
        }

        return new Response(JSON.stringify({
            error: { message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' },
        }), { status: 429, headers: { 'content-type': 'application/json' } });
    };

    try {
        await assert.rejects(
            callGeminiAPI(apiKey, '第一次請求', false),
            /Gemini 暫時限流/,
        );
        const firstGenerationRequests = requests.filter(request => request.options.method === 'POST');
        assert.equal(firstGenerationRequests.length, 1);
        assert.equal(firstGenerationRequests[0].options.headers['x-goog-api-key'], apiKey);

        const stateAfterRateLimit = JSON.parse(localStorage.getItem('geminiApiState'));
        assert.ok(stateAfterRateLimit.cooldownUntil > Date.now());

        await assert.rejects(callGeminiAPI(apiKey, '下一次請求', false), /配額等待中/);

        const allGenerationRequests = requests.filter(request => request.options.method === 'POST');
        assert.equal(allGenerationRequests.length, 1);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.localStorage = originalLocalStorage;
        globalThis.sessionStorage = originalSessionStorage;
        globalThis.document = originalDocument;
    }
});

test('legacy multiple keys keep only the first key on migration', () => {
    const originalLocalStorage = globalThis.localStorage;
    const originalSessionStorage = globalThis.sessionStorage;
    const localStorage = new MemoryStorage();
    globalThis.localStorage = localStorage;
    globalThis.sessionStorage = new MemoryStorage();
    localStorage.setItem('geminiApiKeys', JSON.stringify([{ key: 'first-key' }, { key: 'unused-key' }]));
    try {
        assert.equal(getGeminiApiKey(), 'first-key');
        assert.equal(localStorage.getItem('geminiApiKey'), 'first-key');
        assert.equal(localStorage.getItem('geminiApiKeys'), null);
    } finally {
        globalThis.localStorage = originalLocalStorage;
        globalThis.sessionStorage = originalSessionStorage;
    }
});

test('saving the same Gemini key preserves its quota cooldown', () => {
    const originalLocalStorage = globalThis.localStorage;
    const originalSessionStorage = globalThis.sessionStorage;
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    globalThis.localStorage = localStorage;
    globalThis.sessionStorage = sessionStorage;
    localStorage.setItem('geminiApiKey', 'same-key');
    localStorage.setItem('geminiApiState', JSON.stringify({ key: 'same-key', cooldownUntil: 123456 }));
    try {
        saveGeminiApiKey('same-key', true);
        assert.equal(sessionStorage.getItem('geminiApiKey'), 'same-key');
        assert.equal(JSON.parse(sessionStorage.getItem('geminiApiState')).cooldownUntil, 123456);
        assert.equal(localStorage.getItem('geminiApiState'), null);
    } finally {
        globalThis.localStorage = originalLocalStorage;
        globalThis.sessionStorage = originalSessionStorage;
    }
});

test('Cloudflare selection handles JSON work without calling Gemini', async () => {
    const original = {
        fetch: globalThis.fetch,
        localStorage: globalThis.localStorage,
        sessionStorage: globalThis.sessionStorage,
    };
    const storage = new MemoryStorage();
    storage.setItem('aliang-ai-engine', 'cloudflare');
    storage.setItem('aliang-tab0-worker-url', 'https://worker.example');
    globalThis.localStorage = storage;
    globalThis.sessionStorage = new MemoryStorage();
    const urls = [];
    globalThis.fetch = async url => {
        urls.push(String(url));
        return new Response('data: {"response":"{\\"ok\\":true}"}\n\n');
    };
    try {
        assert.equal(await callGeminiAPI('', '請輸出 JSON', true), '{"ok":true}');
        assert.deepEqual(urls, ['https://worker.example/api/generate-text']);
    } finally {
        globalThis.fetch = original.fetch;
        globalThis.localStorage = original.localStorage;
        globalThis.sessionStorage = original.sessionStorage;
    }
});

test('automatic Cloudflare fallback requires user consent after Gemini failure', async () => {
    const original = {
        fetch: globalThis.fetch,
        localStorage: globalThis.localStorage,
        sessionStorage: globalThis.sessionStorage,
        document: globalThis.document,
        window: globalThis.window,
    };
    const storage = new MemoryStorage();
    storage.setItem('geminiApiKey', 'consent-key');
    storage.setItem('aliang-tab0-worker-url', 'https://worker.example');
    globalThis.localStorage = storage;
    globalThis.sessionStorage = new MemoryStorage();
    globalThis.document = { getElementById: () => null };
    let confirmations = 0;
    globalThis.window = { confirm: () => { confirmations += 1; return false; } };
    const urls = [];
    globalThis.fetch = async url => {
        urls.push(String(url));
        return Response.json({ error: { message: 'API key not valid', status: 'PERMISSION_DENIED' } }, { status: 403 });
    };
    try {
        await assert.rejects(callGeminiAPI('consent-key', '測試'), /金鑰無法使用/);
        assert.equal(confirmations, 1);
        assert.ok(urls.every(url => !url.startsWith('https://worker.example')));
    } finally {
        globalThis.fetch = original.fetch;
        globalThis.localStorage = original.localStorage;
        globalThis.sessionStorage = original.sessionStorage;
        globalThis.document = original.document;
        globalThis.window = original.window;
    }
});

test('503 retries the same model once, then uses the next model with the same key', async () => {
    const original = {
        fetch: globalThis.fetch,
        localStorage: globalThis.localStorage,
        sessionStorage: globalThis.sessionStorage,
        document: globalThis.document,
        dateNow: Date.now,
    };
    const localStorage = new MemoryStorage();
    const attempts = [];
    localStorage.setItem('aliang-ai-engine', 'gemini');
    localStorage.setItem('geminiApiKey', 'fallback-key');
    let fakeNow = Date.now();
    Date.now = () => (fakeNow += 30000);
    globalThis.localStorage = localStorage;
    globalThis.sessionStorage = new MemoryStorage();
    globalThis.document = { getElementById: () => null };
    globalThis.fetch = async (url, options = {}) => {
        const requestUrl = String(url);
        assert.equal(options.headers['x-goog-api-key'], 'fallback-key');
        if (requestUrl.includes('/models?')) {
            return Response.json({ models: [
                { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] },
            ] });
        }
        const model = requestUrl.includes('gemini-3.6-flash') ? '3.6' : '3.8';
        attempts.push(model);
        if (model === '3.6') {
            return Response.json({ error: { message: 'UNAVAILABLE', status: 'UNAVAILABLE' } }, { status: 503 });
        }
        return Response.json({ candidates: [{ content: { parts: [{ text: '完成' }] }, finishReason: 'STOP' }] });
    };
    try {
        assert.equal(await callGeminiAPI('fallback-key', '測試 503'), '完成');
        assert.deepEqual(attempts, ['3.6', '3.6', '3.8']);
    } finally {
        globalThis.fetch = original.fetch;
        globalThis.localStorage = original.localStorage;
        globalThis.sessionStorage = original.sessionStorage;
        globalThis.document = original.document;
        Date.now = original.dateNow;
    }
});
