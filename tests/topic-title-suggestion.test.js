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

test('blockbuster topic prompt creates nine paired choices with concise length limits', () => {
    const source = readProjectFile('public/js/tab1-srt.js');

    assert.match(source, /每套方案必須提供 1 組正選與 2 組備選，共 9 組完整的主標題＋副標題配對/);
    assert.match(source, /最多 10 字，10 字是上限而不是目標/);
    assert.match(source, /介於 10 至 20 字/);
    assert.match(source, /優先寫成 6 至 9 字的強力口語短句/);
    assert.match(source, /依據逐字稿萃取出的內容靈魂，我為您設計了 3 種不同切入點的爆款標題：/);
    assert.match(source, /方案 A：主打「認知衝擊」/);
    assert.match(source, /方案 B：主打「實用需求」/);
    assert.match(source, /方案 C：主打「情感共鳴」/);
    assert.equal((source.match(/\*\*正選\*\*/g) || []).length, 3);
    assert.equal((source.match(/\*\*備選一\*\*/g) || []).length, 3);
    assert.equal((source.match(/\*\*備選二\*\*/g) || []).length, 3);
    assert.equal((source.match(/\*\*主標題\*\*/g) || []).length, 9);
    assert.equal((source.match(/\*\*副標題\*\*/g) || []).length, 9);
    assert.match(source, /\*\*設計概念\*\*/);
});

test('blockbuster topic prompt extracts the content soul before writing titles', () => {
    const source = readProjectFile('public/js/tab1-srt.js');

    assert.match(source, /觀眾只有 3 秒鐘/);
    assert.match(source, /這一句才是內容靈魂/);
    assert.match(source, /數字、工具與事件只是強化靈魂的素材，不能反過來取代主題/);
    assert.match(source, /實用需求層/);
    assert.match(source, /認知衝擊層/);
    assert.match(source, /情感共鳴層/);
    assert.match(source, /【主標題 The Hook：核心衝突／痛點提問】/);
    assert.match(source, /【副標題 The Promise：懸念反差／終極解方】/);
});

test('blockbuster topic prompt uses dramatic rhetoric without fabricating facts', () => {
    const source = readProjectFile('public/js/tab1-srt.js');

    assert.match(source, /爆款修辭張力設定為 9／10，事實誇大仍是 0／10/);
    assert.match(source, /驚嘆號、問號、挑釁、比喻與戲劇化動詞/);
    assert.match(source, /不是章節名稱或資料摘要/);
    assert.match(source, /某某的故事、完整解析、心路歷程、實用指南/);
    assert.match(source, /可以放大真實事件的情緒、荒謬感、代價感與反差/);
    assert.match(source, /不得虛構事實、因果、動機、心理、成果或關係狀態/);
});

test('blockbuster topic prompt makes subtitles an open loop instead of an evidence list', () => {
    const source = readProjectFile('public/js/tab1-srt.js');

    assert.match(source, /副標題的任務不是提交事實證據/);
    assert.match(source, /製造「開放迴圈」/);
    assert.match(source, /懸念問句、結果留白、價值承諾或人性抉擇/);
    assert.match(source, /關鍵答案留在影片裡/);
    assert.match(source, /若讀完主副標就已知道全部事實、沒有任何問題想追問，必須重寫/);
    assert.doesNotMatch(source, /副標題負責提供事實證據/);
    assert.doesNotMatch(source, /不得重複主標題中的完整數字/);
    assert.doesNotMatch(source, /證據兌現測試/);
});

test('blockbuster topic prompt generates genuinely different candidates and ranks curiosity', () => {
    const source = readProjectFile('public/js/tab1-srt.js');

    assert.match(source, /違反常理的選擇＋後果懸念/);
    assert.match(source, /令人崩潰的痛點＋翻盤承諾/);
    assert.match(source, /真實金句／人生代價＋未解的人性問題/);
    assert.match(source, /每個方案先在內部構思 6 組/);
    assert.match(source, /好奇缺口 40％、核心衝突 30％、口語記憶點 20％、受眾相關性 10％/);
    assert.match(source, /最高者列為正選，另選兩組真正不同的備選/);
    assert.match(source, /不要把設計概念寫成資料摘要/);
});

test('blockbuster topic prompt is transcript agnostic and prevents unrelated fact stitching', () => {
    const source = readProjectFile('public/js/tab1-srt.js');
    const topicPrompt = source.match(/if \(type === 'topic-title'\) \{[\s\S]*?prompt = `([\s\S]*?)逐字稿如下：/)?.[1] || '';

    assert.ok(topicPrompt);
    assert.doesNotMatch(topicPrompt, /兩千萬|四十萬|貨車|賓士|偏鄉|脫水機|退休|妻子|老婆|孩子/);
    assert.match(topicPrompt, /所有人名、機構、數字、時間、事件、引言、工具與觀點只能來自本次逐字稿/);
    assert.match(topicPrompt, /不得把不同時間、人物或場景的事件拼成同一件事/);
    assert.match(topicPrompt, /不得因為兩件事先後出現就自行寫成因果/);
    assert.match(topicPrompt, /主副標可以自然共用必要的核心名詞/);
    assert.match(topicPrompt, /不要為了避開重複而換成奇怪近義詞/);
    assert.match(topicPrompt, /繁體中文自然/);
    assert.doesNotMatch(topicPrompt, /事實卡 A|證據兌現測試/);
});

test('invalid blockbuster topic lengths trigger one inline automatic repair', () => {
    const source = readProjectFile('public/js/tab1-srt.js');

    assert.match(source, /validateTopicTitleSuggestion\(result\)/);
    assert.match(source, /buildTopicTitleRepairPrompt\(prompt, result, validation\.violations\)/);
    assert.match(source, /result = await streamOutput\(repairPrompt\)/);
    assert.match(source, /正在調整主副標題的爆款張力與懸念/);
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

test('topic title suggestions are stored with the active source for Tab 7 selection', () => {
    const source = readProjectFile('public/js/tab1-srt.js');
    const state = readProjectFile('public/js/state.js');
    const thumbnail = readProjectFile('public/js/tab7-thumbnail.js');

    assert.match(source, /extractTopicTitleSuggestions\(result\)/);
    assert.match(source, /state\.topicTitleSuggestions = suggestions/);
    assert.match(source, /state\.topicTitleSuggestionsSourceId = suggestions\.length \? requestSourceId : ''/);
    assert.match(source, /lumina:topicTitleSuggestionsReady/);
    assert.match(state, /topicTitleSuggestionsSourceId: ''/);
    assert.match(thumbnail, /state\.topicTitleSuggestionsSourceId !== state\.currentSourceId/);
    assert.match(thumbnail, /titleInput\.value = suggestion\.mainTitle/);
    assert.match(thumbnail, /subtitleInput\.value = suggestion\.subtitle/);
});

test('Tab 7 keeps manual title fields available without Tab 1 suggestions', () => {
    const html = readProjectFile('index.html');
    const thumbnail = readProjectFile('public/js/tab7-thumbnail.js');

    assert.match(html, /id="thumbnail-title"/);
    assert.match(html, /id="thumbnail-subtitle"/);
    assert.match(thumbnail, /clearTopicTitleSelection/);
    assert.match(thumbnail, /topicTitleSelection\.classList\.add\('hidden'\)/);
    assert.match(thumbnail, /subtitle: subtitleInput\.value/);
});
