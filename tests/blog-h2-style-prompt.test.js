import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../public/js/tab2-blog.js', import.meta.url), 'utf8');
const promptFunction = source.slice(source.indexOf('function assembleBlogPrompt('), source.indexOf('\n\nfunction renderKeywords('));

test('blog prompt includes the selected H2 style', () => {
    for (const [style, expected] of [
        ['default', '每個段落都需要一個簡潔有力的小標題'],
        ['question', '每個段落都需要一個帶有疑問句、引發好奇的小標題'],
        ['emoji', '每個段落都需要一個活潑有趣、可加入 Emoji 的小標題']
    ]) {
        const assemble = runInNewContext(`(${promptFunction})`, {
            localStorage: { getItem: () => JSON.stringify({ h2Style: style }) },
            SETTINGS_STORAGE_KEYS: { PROMPT_WIZARD: 'wizard' }
        });
        const prompt = assemble({ persona: '第一人稱', tone: '自然', wordCount: '1000', sourceText: '逐字稿' });
        assert.ok(prompt.includes(expected), `missing ${style} style`);
        assert.ok(prompt.includes('每個小標題用 <h2> 標籤包圍'));
    }
});
