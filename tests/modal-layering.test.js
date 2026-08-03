import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function modalZIndex(id) {
    const match = html.match(new RegExp(`id="${id}"[^>]*class="[^"]*z-\\[(\\d+)\\]`));
    assert.ok(match, `找不到 ${id} 的 z-index`);
    return Number(match[1]);
}

test('universal error modal appears above global settings', () => {
    assert.ok(modalZIndex('modal') > modalZIndex('global-settings-modal'));
});

test('displayed release version is R11', () => {
    assert.match(html, /丙午．大暑．20260803<span[^>]*>R11<\/span>/);
    assert.doesNotMatch(html, /丙午．大暑．20260801<span[^>]*>R10<\/span>/);
    assert.doesNotMatch(html, /丙午．端午．20260619<span[^>]*>R6<\/span>/);
});

test('portal introduction uses wider balanced wrapping', () => {
    assert.match(html, /max-w-3xl text-pretty[^>]*>\s*歡迎使用全方位 AI 數位內容創作助手/);
});
