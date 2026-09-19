import test from 'node:test';
import assert from 'node:assert/strict';
import {
    assembleSocialPrompt,
    buildFacebookPostInstruction,
    FACEBOOK_POST_WRITING_RULES,
} from '../public/js/social-prompt.js';

const baseOptions = {
    objective: '分享核心觀點',
    length: '中等',
    tone: '像真人分享',
    hashtags: '',
    cta: '',
    sourceText: '學生拍下自己的解法上傳，全班比較不同做法。',
    variationModifier: '',
    shouldOverride: false,
};

test('Facebook prompt includes the supplied one-page writing rules', () => {
    const prompt = assembleSocialPrompt(baseOptions);

    assert.match(prompt, /只談一個主題/);
    assert.match(prompt, /前 1～3 行/);
    assert.match(prompt, /先寫具體情境再講觀點/);
    assert.match(prompt, /3～5 點/);
    assert.match(prompt, /CTA 只保留一個主要動作/);
    assert.match(prompt, /低品質互動誘餌/);
    assert.match(prompt, /生活文 0 個/);
    assert.match(prompt, /送出前檢查/);
    assert.equal(prompt.includes('行動呼籲與互動問題'), false);
});

test('Facebook CTA remains one action when a CTA and question preference coexist', () => {
    const prompt = assembleSocialPrompt({
        ...baseOptions,
        cta: '完整操作步驟放在第一則留言。',
        wizardSettings: { fbQuestion: true },
    });

    assert.match(prompt, /使用者已提供 CTA，因此不要另外加入互動問句/);
    assert.doesNotMatch(prompt, /再多加一句引導留言的問題/);
});

test('Facebook question preference can become the only CTA when no CTA is supplied', () => {
    const instruction = buildFacebookPostInstruction({ question: true, hasCta: false });

    assert.match(instruction, /作為唯一 CTA/);
    assert.match(instruction, /值得回答/);
});

test('platform-specific social options remain in the assembled prompt', () => {
    const prompt = assembleSocialPrompt({
        ...baseOptions,
        wizardSettings: { igEmoji: true, igHashtags: true, lineColloquial: true },
    });

    assert.match(prompt, /每個段落或條列項目前/);
    assert.match(prompt, /額外生成 5-10 個/);
    assert.match(prompt, /更像朋友聊天/);
    assert.equal(FACEBOOK_POST_WRITING_RULES.includes('不點連結時，貼文仍要值得閱讀'), true);
});
