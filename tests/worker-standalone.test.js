import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../cf-worker/worker.js', import.meta.url), 'utf8');
const standalone = readFileSync(new URL('../cf-worker/worker-standalone.js', import.meta.url), 'utf8');

test('worker.js stays synchronized with the downloadable standalone bundle', () => {
    assert.equal(worker, standalone);
});

test('standalone Worker bundle can be pasted without source imports', () => {
    assert.doesNotMatch(standalone, /from ['"](?:node:|\.\.\/|\.\/)/);
    assert.doesNotMatch(standalone, /sourceMappingURL/);
    assert.match(standalone, /WORKER_VERSION = "1\.3\.2"/);
    assert.match(standalone, /clientProcessing: "client-v1"/);
    assert.match(standalone, /function audioBufferToBase64/);
});
