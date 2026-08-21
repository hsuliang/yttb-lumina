import test from 'node:test';
import assert from 'node:assert/strict';
import { translateError } from '../public/js/gemini-api.js';

test('stream parsing errors explain likely causes and recovery steps', () => {
    const message = translateError('Failed to parse stream');

    assert.match(message, /串流回應中斷/);
    assert.match(message, /網路/);
    assert.match(message, /重新生成/);
    assert.match(message, /API Key/);
});
