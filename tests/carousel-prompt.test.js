import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCarouselPromptBlocks, normalizeCarouselPromptOutput } from '../public/js/carousel-prompt.js';

test('carousel output gives each page its own complete prompt and continues through the actual count', () => {
    const sourceBlocks = Array.from({ length: 4 }, (_, index) => `[第 ${index + 1} 張]
請生成 1:1 正方形社群輪播圖。畫風為暖色插畫，角色為 image1（ㄚ亮笑長）。
畫面動作：動作 ${index + 1}。場景：場景 ${index + 1}。
圖上排版與文字標示：
主標題：「標題 ${index + 1}」
副標題：「副標 ${index + 1}」
這是一張單一且完整的圖片，絕對不要使用分割畫面、拼貼格、多圖組合或漫畫方格的形式 (single complete image, no split screen, no collage, no grid, no panels, no comic strip)。`);
    const output = normalizeCarouselPromptOutput(`生成以下 4 張圖片，務必分開生成，一次只生一張，共 4 張\n\n${sourceBlocks.join('\n\n')}`);
    const blocks = extractCarouselPromptBlocks(output);

    assert.match(output, /^# 多張圖片獨立生成任務\n\n本次任務共需生成 4 張獨立圖片。/);
    assert.match(output, /直到第 4 張完成；不要把完成單張視為整體任務結束，也不要等待使用者再次下達下一張指令/);
    assert.equal((output.match(/# 多張圖片獨立生成任務/g) || []).length, 1);
    assert.equal(blocks.length, 4);
    assert.doesNotMatch(output, /生成以下 4 張圖片|這次只生成這一張|拼貼格/);
    blocks.forEach((block, index) => {
        assert.match(block.content, new RegExp(`動作：動作 ${index + 1}[\\s\\S]*場景：場景 ${index + 1}[\\s\\S]*主標題：「標題 ${index + 1}」[\\s\\S]*副標題：「副標 ${index + 1}」`));
        assert.match(block.content, /角色為 image1（ㄚ亮笑長）/);
        assert.match(block.content, new RegExp(`本段提示詞僅適用於第 ${index + 1} 張圖片`));
        assert.equal((block.content.match(/單張完整圖片與獨立任務限制/g) || []).length, 1);
        assert.doesNotMatch(block.content, /# 多張圖片獨立生成任務/);
    });
});

test('carousel header follows actual sections and accepts Chinese page numbers', () => {
    const output = normalizeCarouselPromptOutput('[第 一 張圖片提示詞]\n封面\n\n[第 二 張]\n內容\n\n[第 三 張]\n結尾');
    assert.match(output, /本次任務共需生成 3 張獨立圖片/);
    assert.match(output, /本段提示詞僅適用於第 3 張圖片/);
    assert.equal(extractCarouselPromptBlocks(output).length, 3);
});

test('carousel output does not claim completion without numbered image sections', () => {
    assert.throws(() => normalizeCarouselPromptOutput('生成以下 4 張圖片'), /無法辨識輪播圖逐張提示詞/);
    assert.throws(() => normalizeCarouselPromptOutput('[第 1 張]\n封面\n\n[第 3 張]\n內容'), /圖片編號不連續/);
    assert.throws(() => normalizeCarouselPromptOutput('[第 1 張]\n一\n[第 2 張]\n二\n[第 3 張]\n三\n[第 4 張]\n四\n[第 5 張]\n五'), /超過預定的 4 張/);
});
