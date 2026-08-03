import test from 'node:test';
import assert from 'node:assert/strict';
import {
    countTopicTitleCharacters,
    extractTopicTitleSuggestions,
    validateTopicTitleSuggestion,
} from '../public/js/topic-title-validator.js';

const validSuggestion = `**爆款主題命名建議（主副標題設定）**
依據逐字稿萃取出的內容靈魂，我為您設計了 3 種不同切入點的爆款標題：

**💡 方案 A：主打「認知衝擊」**
**正選**
**主標題**：退休豪賭兩千萬
**副標題**：七年無薪改裝貨車，只為把課送進偏鄉
**備選一**
**主標題**：這台車差點翻桌
**副標題**：未先商量便下訂，妻子得知後當場傻眼
**備選二**
**主標題**：一撞燒掉四十萬
**副標題**：倒車壓壞隔壁賓士，偏鄉行程先停擺
**設計概念**：認知衝擊設計概念。

**💡 方案 B：主打「實用需求」**
**正選**
**主標題**：三小時地獄翻盤
**副標題**：五噸貨車一展開，五分鐘就能直接上課
**備選一**
**主標題**：三百萬怎麼撐
**副標題**：靠提案募集資源，讓巡迴服務繼續上路
**備選二**
**主標題**：車宿也能洗熱水澡
**副標題**：脫水機加熱水袋，破解洗衣沐浴難題
**設計概念**：實用需求設計概念。

**💡 方案 C：主打「情感共鳴」**
**正選**
**主標題**：退休反而累到爆
**副標題**：每天睡不到五小時，每週還上三十五堂
**備選一**
**主標題**：沒熱誠就退場
**副標題**：七年無薪跑遍偏鄉，他勸同業別耗盡人生
**備選二**
**主標題**：孩子一笑全都值
**副標題**：忙到只能啃飯糰，學生還主動要求加課
**設計概念**：情感共鳴設計概念。`;

test('title character counting excludes outer wrappers but counts content punctuation', () => {
    assert.equal(countTopicTitleCharacters('【背債跑偏鄉】'), 5);
    assert.equal(countTopicTitleCharacters('「追夢！前進」'), 5);
});

test('topic title suggestions are extracted as complete main and subtitle pairs', () => {
    const suggestions = extractTopicTitleSuggestions(`
💡 方案 A：主打認知衝擊
**正選**
**主標題**：AI不是萬靈丹
**副標題**：三個真實案例揭開工具限制
**備選一**
**主標題**：別再迷信AI
**副標題**：逐字稿帶你看見最常忽略的盲點
💡 方案 B：主打實用需求
**正選**
**主標題**：備課快十倍
**副標題**：一套流程讓老師每週省下三小時
`);

    assert.deepEqual(suggestions, [
        { scheme: 'A', option: '正選', mainTitle: 'AI不是萬靈丹', subtitle: '三個真實案例揭開工具限制' },
        { scheme: 'A', option: '備選一', mainTitle: '別再迷信AI', subtitle: '逐字稿帶你看見最常忽略的盲點' },
        { scheme: 'B', option: '正選', mainTitle: '備課快十倍', subtitle: '一套流程讓老師每週省下三小時' },
    ]);
});

test('validator accepts exactly three paired choices in each of the three schemes', () => {
    const result = validateTopicTitleSuggestion(validSuggestion);

    assert.equal(result.valid, true);
    assert.equal(result.pairCount, 9);
    assert.deepEqual(result.violations, []);
});

test('validator rejects overlong main titles and subtitles outside 10 to 20 characters', () => {
    const invalidSuggestion = validSuggestion
        .replace('退休豪賭兩千萬', '背債兩千多萬退休後仍堅持跑遍偏鄉')
        .replace('七年無薪改裝貨車，只為把課送進偏鄉', '副標太短');
    const result = validateTopicTitleSuggestion(invalidSuggestion);

    assert.equal(result.valid, false);
    assert.match(result.violations.join('\n'), /主標題.*必須在 10 字以內/);
    assert.match(result.violations.join('\n'), /副標題.*必須介於 10 至 20 字/);
});

test('validator accepts a concise suspense subtitle', () => {
    const concisePromise = validSuggestion.replace(
        '七年無薪改裝貨車，只為把課送進偏鄉',
        '三年後，夢想還活著嗎？',
    );

    assert.equal(validateTopicTitleSuggestion(concisePromise).valid, true);
});

test('validator rejects missing choices and duplicate title pairs', () => {
    const missingChoice = validSuggestion.replace(
        /\*\*備選二\*\*\n\*\*主標題\*\*：孩子一笑全都值\n\*\*副標題\*\*：忙到只能啃飯糰，學生還主動要求加課\n/,
        '',
    );
    const duplicatedTitle = validSuggestion.replace('這台車差點翻桌', '退休豪賭兩千萬');

    assert.equal(validateTopicTitleSuggestion(missingChoice).valid, false);
    assert.match(validateTopicTitleSuggestion(missingChoice).violations.join('\n'), /備選二|9 組/);
    assert.equal(validateTopicTitleSuggestion(duplicatedTitle).valid, false);
    assert.match(validateTopicTitleSuggestion(duplicatedTitle).violations.join('\n'), /主標題.*重複/);
});

test('validator allows natural key-term overlap within a title pair', () => {
    const naturalOverlap = validSuggestion.replace(
        '倒車壓壞隔壁賓士，偏鄉行程先停擺',
        '倒車失誤撞上賓士，當場燒掉四十萬',
    );

    assert.equal(validateTopicTitleSuggestion(naturalOverlap).valid, true);
});
