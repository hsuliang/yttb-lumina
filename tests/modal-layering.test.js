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

test('displayed release version is R1', () => {
    assert.match(html, /丙午．白露．20260920<span[^>]*>R1<\/span>/);
    assert.doesNotMatch(html, /丙午．大暑．20260804<span[^>]*>R12<\/span>/);
    assert.doesNotMatch(html, /丙午．大暑．20260803<span[^>]*>R11<\/span>/);
    assert.doesNotMatch(html, /丙午．大暑．20260801<span[^>]*>R10<\/span>/);
    assert.doesNotMatch(html, /丙午．端午．20260619<span[^>]*>R6<\/span>/);
});

test('portal introduction uses wider balanced wrapping', () => {
    assert.match(html, /max-w-3xl text-pretty[^>]*>\s*歡迎使用全方位 AI 數位內容創作助手/);
});

test('welcome portal feature cards use four cards above five cards', () => {
    const fourRowStart = html.indexOf('portal-card-row-four');
    const fiveRowStart = html.indexOf('portal-card-row-five');
    const rowsEnd = html.indexOf('<!-- 下方主要動作按鈕區 -->', fiveRowStart);
    assert.ok(fourRowStart >= 0 && fiveRowStart > fourRowStart && rowsEnd > fiveRowStart);

    const fourRow = html.slice(fourRowStart, fiveRowStart);
    const fiveRow = html.slice(fiveRowStart, rowsEnd);
    assert.equal((fourRow.match(/class="portal-card /g) || []).length, 4);
    assert.equal((fiveRow.match(/class="portal-card /g) || []).length, 5);
});

test('sidebar main navigation uses compact but separated spacing', () => {
    const mainNavStart = html.indexOf('<!-- Main Nav Links -->');
    const footerNavStart = html.indexOf('<!-- Footer Nav -->', mainNavStart);
    assert.ok(mainNavStart >= 0 && footerNavStart > mainNavStart);

    const mainNav = html.slice(mainNavStart, footerNavStart);
    assert.match(mainNav, /overflow-y-auto gap-2/);
    assert.equal((mainNav.match(/class="tab-btn[^\"]*py-2/g) || []).length, 9);
    assert.doesNotMatch(mainNav, /class="tab-btn[^\"]*py-3/);
});
