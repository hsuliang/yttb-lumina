import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readProjectFile = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const userInterfaceSource = [
    'index.html',
    'public/js/app.js',
    'public/js/tab0-transcribe.js',
    'public/js/tab2-blog.js',
    'public/js/tab4-edm.js',
    'public/js/tab5-carousel.js',
    'public/js/tab6-infographic.js',
].map(readProjectFile).join('\n');

test('user-facing guidance uses page names instead of Tab numbers', () => {
    assert.doesNotMatch(userInterfaceSource, /請先[^\n'"]*(?:Tab\s*1|分頁\s*1)/i);
    assert.doesNotMatch(userInterfaceSource, /回到[^\n'"]*(?:Tab\s*1|分頁\s*1)/i);
    assert.doesNotMatch(userInterfaceSource, /傳入\s*Tab\s*1/i);
    assert.doesNotMatch(userInterfaceSource, /Tab\s*1「開始整理」/i);
    assert.match(userInterfaceSource, /字幕已傳入「逐字稿整理」頁面/);
    assert.match(userInterfaceSource, /請先在「逐字稿整理」頁面貼上字幕內容/);
});
