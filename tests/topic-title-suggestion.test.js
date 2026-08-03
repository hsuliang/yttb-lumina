import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readProjectFile = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Tab 1 places the blockbuster topic suggestion between SRT export and summary', () => {
    const html = readProjectFile('index.html');

    assert.match(
        html,
        /id="export-srt-btn"[\s\S]*id="generate-topic-title-btn"[\s\S]*爆款主題建議[\s\S]*id="generate-summary-btn"/,
    );
});

test('blockbuster topic suggestion uses the same inline streaming view as summary', () => {
    const html = readProjectFile('index.html');
    const source = readProjectFile('public/js/tab1-srt.js');

    assert.match(html, /data-view="topic-title"[^>]*>爆款主題</);
    assert.match(html, /<div id="display-topic-title"[^>]*contenteditable="true"/);
    assert.match(source, /handleAiFeature\('topic-title'\)/);
    assert.match(source, /switchView\(type\)[\s\S]*getElementById\(`display-\$\{type\}`\)/);
    assert.doesNotMatch(source, /handleTopicTitleSuggestion|正在生成爆款主題建議/);
});

test('blockbuster topic prompt creates nine paired choices with strict length limits', () => {
    const source = readProjectFile('public/js/tab1-srt.js');

    assert.match(source, /每套方案必須提供 1 組正選與 2 組備選，共 9 組完整的主標題＋副標題配對/);
    assert.match(source, /每個主標題最多 10 字，可以短於 10 字/);
    assert.match(source, /每個副標題必須介於 15 至 20 字/);
    assert.match(source, /不可先寫一條很長的標題再從中間切成主副標題/);
    assert.match(source, /依據逐字稿萃取出的內容靈魂，我為您設計了 3 種不同切入點的爆款標題：/);
    assert.match(source, /實用需求層/);
    assert.match(source, /認知衝擊層/);
    assert.match(source, /情感共鳴層/);
    assert.match(source, /方案 A：主打「認知衝擊」/);
    assert.match(source, /方案 B：主打「實用需求」/);
    assert.match(source, /方案 C：主打「情感共鳴」/);
    assert.equal((source.match(/\*\*正選\*\*/g) || []).length, 3);
    assert.equal((source.match(/\*\*備選一\*\*/g) || []).length, 3);
    assert.equal((source.match(/\*\*備選二\*\*/g) || []).length, 3);
    assert.equal((source.match(/\*\*主標題\*\*/g) || []).length, 9);
    assert.equal((source.match(/\*\*副標題\*\*/g) || []).length, 9);
    assert.match(source, /\*\*設計概念\*\*/);
    assert.match(source, /不得虛構、誇大/);
});

test('invalid blockbuster topic lengths trigger one inline automatic repair', () => {
    const source = readProjectFile('public/js/tab1-srt.js');

    assert.match(source, /validateTopicTitleSuggestion\(result\)/);
    assert.match(source, /buildTopicTitleRepairPrompt\(prompt, result, validation\.violations\)/);
    assert.match(source, /result = await streamOutput\(repairPrompt\)/);
    assert.match(source, /正在調整主副標題的字數與配對/);
    assert.doesNotMatch(source, /slice\(0,\s*10\)|substring\(0,\s*10\)/);
});

test('blockbuster topic output renders bold text without showing markdown markers', () => {
    const source = readProjectFile('public/js/tab1-srt.js');

    assert.match(source, /function renderTopicTitle/);
    assert.match(source, /document\.createElement\('strong'\)/);
    assert.match(source, /strong\.textContent = text\.slice/);
    assert.match(source, /container\.replaceChildren\(fragment\)/);
    assert.match(source, /type === 'topic-title' \? output\.textContent : output\.value/);
});

test('Tab 1 AI status updates the blockbuster topic suggestion button', () => {
    const source = readProjectFile('public/js/app.js');

    assert.match(source, /getElementById\('generate-topic-title-btn'\)/);
});
