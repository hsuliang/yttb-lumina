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
**主標題**：背債跑偏鄉
**副標題**：退休教師背債兩千多萬打造偏鄉教室
**備選一**
**主標題**：野戰教室上路
**副標題**：四百萬貨車如何變身偏鄉行動教室
**備選二**
**主標題**：追夢撞爛賓士
**副標題**：無薪退休跑偏鄉竟付出四十萬代價
**設計概念**：認知衝擊設計概念。

**💡 方案 B：主打「實用需求」**
**正選**
**主標題**：五分鐘開課
**副標題**：拆解行動教室快速部署完整實戰方法
**備選一**
**主標題**：偏鄉教學攻略
**副標題**：從設備驗車募款掌握巡迴教學關鍵
**備選二**
**主標題**：百校營運術
**副標題**：一年跑遍百校的設備募款效率指南
**設計概念**：實用需求設計概念。

**💡 方案 C：主打「情感共鳴」**
**正選**
**主標題**：熱誠不能退
**副標題**：退休教師用七年陪伴偏鄉孩子成長
**備選一**
**主標題**：笑容就值得
**副標題**：走過百所學校只為點亮偏鄉孩子視野
**備選二**
**主標題**：夢想走鐘也前進
**副標題**：再苦也堅持只為守住偏鄉教育初心
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

test('validator rejects overlong main titles and subtitles outside 15 to 20 characters', () => {
    const invalidSuggestion = validSuggestion
        .replace('背債跑偏鄉', '背債兩千多萬退休後仍堅持跑遍偏鄉')
        .replace('退休教師背債兩千多萬打造偏鄉教室', '副標太短');
    const result = validateTopicTitleSuggestion(invalidSuggestion);

    assert.equal(result.valid, false);
    assert.match(result.violations.join('\n'), /主標題.*必須在 10 字以內/);
    assert.match(result.violations.join('\n'), /副標題.*必須介於 15 至 20 字/);
});

test('validator rejects missing choices and duplicate title pairs', () => {
    const missingChoice = validSuggestion.replace(
        /\*\*備選二\*\*\n\*\*主標題\*\*：夢想走鐘也前進\n\*\*副標題\*\*：再苦也堅持只為守住偏鄉教育初心\n/,
        '',
    );
    const duplicatedTitle = validSuggestion.replace('野戰教室上路', '背債跑偏鄉');

    assert.equal(validateTopicTitleSuggestion(missingChoice).valid, false);
    assert.match(validateTopicTitleSuggestion(missingChoice).violations.join('\n'), /備選二|9 組/);
    assert.equal(validateTopicTitleSuggestion(duplicatedTitle).valid, false);
    assert.match(validateTopicTitleSuggestion(duplicatedTitle).violations.join('\n'), /主標題.*重複/);
});
