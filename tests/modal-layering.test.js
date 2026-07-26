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

test('displayed release version is R7', () => {
    assert.match(html, /丙午．大暑．20260726<span[^>]*>R7<\/span>/);
    assert.doesNotMatch(html, /丙午．端午．20260619<span[^>]*>R6<\/span>/);
});
