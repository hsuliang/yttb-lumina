import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildReelsPrompt, extractReelsListingCopy, extractReelsPromptBlocks, normalizeReelsPromptOutput } from '../public/js/reels-prompt.js';

const readProjectFile = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Reels prompt outputs only independent image prompts with a shot-count prefix', () => {
    const prompt = buildReelsPrompt({
        sourceContent: '<p>老師分享如何用 AI 減少備課時間，並展示課堂案例。</p>',
        roles: ['ㄚ亮笑長', '王老師'],
        includeLogo: true,
        style: 'modern-minimalist-flat',
        shotCount: '5',
    });

    assert.match(prompt, /請完成以下整組圖卡，但務必一次只生成一張/);
    assert.match(prompt, /生成以下 5 張圖片，務必分開生成，一次只生一張，共 5張/);
    assert.match(prompt, /Hook、核心問題、重要觀點、方法或案例、結論與 CTA/);
    assert.match(prompt, /固定規劃 5 張圖卡/);
    assert.match(prompt, /9:16 直式/);
    assert.match(prompt, /image1：ㄚ亮笑長/);
    assert.match(prompt, /image2：王老師/);
    assert.match(prompt, /image3 的原始 Logo/);
    assert.match(prompt, /【上架文案】/);
    assert.match(prompt, /約 100 字（90～110 字）/);
    assert.match(prompt, /主標建議 8～15 字/);
    assert.match(prompt, /最多 3 個重點短句/);
    assert.match(prompt, /不可使用「往左滑看更多」/);
    assert.match(prompt, /contact sheet、grid、panel/);
    assert.match(prompt, /只輸出逐張完整繪圖提示詞/);
    assert.doesNotMatch(prompt, /使用用途/);
    assert.doesNotMatch(prompt, /指定品牌色/);
    assert.doesNotMatch(prompt, /先輸出一張「分鏡規劃表」/);
    assert.doesNotMatch(prompt, /<p>/);
});

test('Reels prompt validates custom styles and automatic shot count guidance', () => {
    assert.throws(
        () => buildReelsPrompt({ sourceContent: '內容', style: 'custom' }),
        /請輸入自訂風格提示詞/,
    );
    const prompt = buildReelsPrompt({ sourceContent: '內容', style: 'custom', customStyle: '暖色手繪風' });
    assert.match(prompt, /暖色手繪風/);
    assert.match(prompt, /文章較短、主題集中/);
    assert.match(prompt, /生成以下 XXX 張圖片，務必分開生成，一次只生一張，共 XXX張/);
    assert.match(buildReelsPrompt({ sourceContent: '內容', shotCount: '4' }), /固定規劃 4 張圖卡/);
});

test('Reels output blocks can be copied one image at a time', () => {
    const output = '生成以下 2 張圖片\n\n[第 1 張]\n第 1 張：封面 / Hook\n封面\n\n[第 2 張]\n第 2 張：問題\n問題\n\n【上架文案】\n這是一段上架文案。';
    const blocks = extractReelsPromptBlocks(output);
    assert.equal(blocks.length, 2);
    assert.match(blocks[0].content, /封面/);
    assert.match(blocks[1].content, /問題/);
    assert.doesNotMatch(blocks[0].content, /上架文案/);
    assert.equal(extractReelsListingCopy(output), '這是一段上架文案。');
});

test('Reels output removes planning text and normalizes the leading shot-count instruction', () => {
    const output = normalizeReelsPromptOutput('分鏡規劃\n\n[第 1 張]\n封面提示詞\n\n[第 2 張]\n問題提示詞\n\n【上架文案】\n上架文案內容', '4');
    assert.equal(output.startsWith('生成以下 4 張圖片，務必分開生成，一次只生一張，共 4張'), true);
    assert.doesNotMatch(output, /分鏡規劃/);
    assert.doesNotMatch(output, /上架文案內容/);
    assert.match(output, /\[第 1 張\][\s\S]*\[第 2 張\]/);
});

test('Reels page is wired after the YouTube thumbnail page', () => {
    const html = readProjectFile('index.html');
    const app = readProjectFile('public/js/app.js');
    const state = readProjectFile('public/js/state.js');
    const tab = readProjectFile('public/js/tab8-reels.js');

    assert.match(html, /data-tab="tab7"[\s\S]*YT封面提示詞[\s\S]*data-tab="tab8"[\s\S]*Reels 分鏡提示詞/);
    assert.match(html, /id="tab8"/);
    assert.match(html, /id="reels-reference-carousel-btn"/);
    assert.match(html, /id="reels-shot-count"/);
    assert.doesNotMatch(html, /id="reels-purpose"|id="reels-brand-colors"/);
    assert.match(html, /id="reels-listing-card"/);
    assert.match(html, /id="copy-reels-listing-btn"/);
    assert.match(app, /import \{ initializeTab8 \} from '\.\/tab8-reels\.js'/);
    assert.match(app, /initializeTab8\(\)/);
    assert.match(state, /reelsVersions: \[\]/);
    assert.match(state, /currentReelsVersionIndex: 0/);
    assert.match(tab, /VariationHub\.open\('reels'/);
    assert.match(tab, /參考輪播圖的角色、Logo 與視覺風格設定/);
});
