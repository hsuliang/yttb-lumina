import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');

test('Worker connection success displays the health endpoint version', () => {
    assert.match(source, /const healthData = await healthResp\.json\(\)/);
    assert.match(source, /const versionLabel = workerVersion \? `\$\{workerVersion\} ` : ''/);
    assert.match(source, /`✅ \$\{versionLabel\}連線成功，Token 驗證通過！`/);
});

test('Worker connection status remains readable when an older health response has no version', () => {
    assert.match(source, /typeof healthData\?\.version === 'string'/);
    assert.match(source, /workerVersion \? `\$\{workerVersion\} ` : ''/);
});
