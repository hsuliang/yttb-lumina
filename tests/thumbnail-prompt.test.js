import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildThumbnailPrompt } from '../public/js/thumbnail-prompt.js';

const readProjectFile = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('thumbnail prompt follows the guide and maps roles before the logo', () => {
    const prompt = buildThumbnailPrompt({
        sourceContent: '<p>用 AI 改善備課流程，節省老師每週三小時。</p>',
        roles: ['ㄚ亮笑長', '來賓老師'],
        includeLogo: true,
        title: '備課快十倍',
        shot: 'low-angle-wide',
        style: 'saturated-3d',
    });

    assert.match(prompt, /image1（ㄚ亮笑長）/);
    assert.match(prompt, /image2（來賓老師）/);
    assert.match(prompt, /image3 的 Logo 圖示/);
    assert.match(prompt, /請參考我上傳的角色圖片，並啟動嚴格臉部一致性模式/);
    assert.match(prompt, /主體與動作/);
    assert.match(prompt, /地點／背景/);
    assert.match(prompt, /廣角仰角鏡頭/);
    assert.match(prompt, /色彩極度飽和的現代 3D 綜藝動畫/);
    assert.match(prompt, /長寬比必須設定為 16:9/);
    assert.match(prompt, /""爆款密碼""/);
    assert.match(prompt, /封面標題必須使用使用者指定的繁體中文：「備課快十倍」/);
    assert.match(prompt, /調整人物的光線與陰影以完全符合環境氛圍/);
    assert.doesNotMatch(prompt, /<p>/);
});

test('thumbnail prompt forbids invented people and logos when none are configured', () => {
    const prompt = buildThumbnailPrompt({
        sourceContent: '介紹三種提升專注力的方法。',
    });

    assert.match(prompt, /不可出現主持人、來賓、路人或其他人物/);
    assert.match(prompt, /不可出現 Logo、浮水印或商標相關描述/);
    assert.match(prompt, /由 AI 從影片內容自動產生一個吸睛的繁體中文封面標題/);
    assert.match(prompt, /字數不設限/);
    assert.doesNotMatch(prompt, /最終繪圖提示詞開頭必須完整寫上/);
});

test('all camera shots and art styles from the guide affect the generated prompt', () => {
    const shotCases = {
        'eye-level-wide': /廣角平視鏡頭/,
        'high-angle': /廣角俯視鏡頭/,
        'symmetrical-panoramic': /對稱式全景鏡頭/,
    };
    const styleCases = {
        'bright-3d-animation': /3D 歡樂動畫風格/,
        'cyberpunk-neon': /賽博龐克霓虹科技風/,
        'warm-realistic-photo': /高畫質質感寫實攝影風格/,
    };

    for (const [shot, expected] of Object.entries(shotCases)) {
        assert.match(buildThumbnailPrompt({ sourceContent: '內容', shot }), expected);
    }
    for (const [style, expected] of Object.entries(styleCases)) {
        assert.match(buildThumbnailPrompt({ sourceContent: '內容', style }), expected);
    }
});

test('thumbnail prompt validates custom style and supports variation overrides', () => {
    assert.throws(
        () => buildThumbnailPrompt({ sourceContent: '內容', style: 'custom' }),
        /請輸入自訂風格提示詞/,
    );

    const prompt = buildThumbnailPrompt({
        sourceContent: '內容',
        style: 'cinematic-realistic',
        variationModifier: '改成極簡黑白剪影。',
        shouldOverride: true,
    });
    assert.match(prompt, /藝術風格：改成極簡黑白剪影。/);
    assert.doesNotMatch(prompt, /真實材質、戲劇性輪廓光/);
});

test('YT thumbnail is wired as tab7 immediately after infographic', () => {
    const html = readProjectFile('index.html');
    const app = readProjectFile('public/js/app.js');
    const state = readProjectFile('public/js/state.js');

    assert.match(html, /data-tab="tab6"[\s\S]*資訊圖表提示詞[\s\S]*data-tab="tab7"[\s\S]*YT封面提示詞/);
    assert.match(html, /id="tab7"/);
    assert.doesNotMatch(html, /id="thumbnail-title"[^>]*maxlength=/);
    assert.match(html, /標題字數不設限；留空時 AI 會依影片內容自動產生/);
    assert.match(html, /value="eye-level-wide"/);
    assert.match(html, /value="high-angle"/);
    assert.match(html, /value="symmetrical-panoramic"/);
    assert.match(html, /value="bright-3d-animation"/);
    assert.match(html, /value="cyberpunk-neon"/);
    assert.match(html, /value="warm-realistic-photo"/);
    assert.match(app, /import \{ initializeTab7 \} from '\.\/tab7-thumbnail\.js'/);
    assert.match(app, /initializeTab7\(\)/);
    assert.match(app, /state\.thumbnailVersions = \[\]/);
    assert.match(state, /thumbnailVersions: \[\]/);
    assert.match(state, /currentThumbnailVersionIndex: 0/);
});
