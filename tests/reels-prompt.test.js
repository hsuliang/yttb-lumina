import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildReelsPrompt, extractReelsListingCopy, extractReelsPromptBlocks, normalizeReelsPromptOutput } from '../public/js/reels-prompt.js';

const readProjectFile = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Reels prompt keeps the existing image specifications and delegates the task header to output assembly', () => {
    const prompt = buildReelsPrompt({
        sourceContent: '<p>老師分享如何用 AI 減少備課時間，並展示課堂案例。</p>',
        roles: ['ㄚ亮笑長', '王老師'],
        includeLogo: true,
        style: 'modern-minimalist-flat',
        shotCount: '5',
    });

    assert.match(prompt, /請完成以下整組圖卡，但務必一次只生成一張/);
    assert.match(prompt, /不要自行輸出多張圖片總任務指令/);
    assert.doesNotMatch(prompt, /這次只生成這一張/);
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
    assert.match(prompt, /請直接從「\[第 1 張\]」開始輸出/);
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

test('Reels output uses the actual number of image blocks and adds one numbered rule to each block', () => {
    for (const count of [4, 5]) {
        const sourceBlocks = Array.from({ length: count }, (_, index) =>
            `[第 ${index + 1} 張]\n主標：標題 ${index + 1}\n動作：動作 ${index + 1}\n場景：場景 ${index + 1}\n這是一張單一且完整的圖片，這次只生成這一張；絕對不要使用分割畫面、拼貼、多格漫畫、contact sheet、grid、panel、comic strip 或多圖合併。`,
        );
        const output = normalizeReelsPromptOutput(`生成以下 5 張圖片，務必分開生成，一次只生一張，共 5張\n\n${sourceBlocks.join('\n\n')}\n\n【上架文案】\n上架文案內容`);
        const blocks = extractReelsPromptBlocks(output);

        assert.equal(output.startsWith(`# 多張圖片獨立生成任務\n\n本次任務共需生成 ${count} 張獨立圖片。`), true);
        assert.match(output, new RegExp(`依照第 1 張至第 ${count} 張的順序完成全部圖片`));
        assert.match(output, /若無法完成指定張數，必須如實回報已完成與失敗的張數/);
        assert.equal((output.match(/# 多張圖片獨立生成任務/g) || []).length, 1);
        assert.equal(blocks.length, count);
        assert.doesNotMatch(output, /生成以下 5 張圖片|這次只生成這一張|上架文案內容/);
        blocks.forEach((block, index) => {
            assert.match(block.content, new RegExp(`主標：標題 ${index + 1}[\\s\\S]*動作：動作 ${index + 1}[\\s\\S]*場景：場景 ${index + 1}`));
            assert.match(block.content, new RegExp(`本段提示詞僅適用於第 ${index + 1} 張圖片`));
            assert.equal((block.content.match(/單張完整圖片與獨立任務限制/g) || []).length, 1);
            assert.doesNotMatch(block.content, /# 多張圖片獨立生成任務/);
            if (index > 0) assert.doesNotMatch(block.content, new RegExp(`主標：標題 ${index}\\b`));
        });
    }
});

test('Reels output does not invent a shot count when image blocks are missing or misnumbered', () => {
    assert.throws(() => normalizeReelsPromptOutput('生成以下 5 張圖片'), /無法辨識 Reels 逐張提示詞/);
    assert.throws(() => normalizeReelsPromptOutput('[第 1 張]\n封面\n\n[第 3 張]\n內容'), /圖片編號不連續/);
});

test('Reels output replaces a model-written single-image rule instead of duplicating it', () => {
    const output = normalizeReelsPromptOutput('[第 1 張]\n封面\n\n單張完整圖片與獨立任務限制：\n本段提示詞僅適用於第 1 張圖片。');
    const block = extractReelsPromptBlocks(output)[0].content;
    assert.equal((block.match(/單張完整圖片與獨立任務限制/g) || []).length, 1);
    assert.equal((block.match(/本段提示詞僅適用於第 1 張圖片/g) || []).length, 1);
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
