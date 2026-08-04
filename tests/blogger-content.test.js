import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildBloggerPost,
    createContentHash,
    normalizeBloggerLabels,
    sanitizeBloggerHtml
} from '../public/js/blogger-content.js';

test('Blogger labels split commas, trim whitespace, and remove duplicates', () => {
    assert.deepEqual(
        normalizeBloggerLabels([' AI, 教學 ', '教學，工具', '', 'AI']),
        ['AI', '教學', '工具']
    );
});

test('Blogger post removes the duplicate leading H1 while preserving article content', () => {
    const post = buildBloggerPost({
        title: '文章標題',
        htmlContent: '<h1>文章標題</h1><p>正文內容</p>',
        labels: ['測試']
    });

    assert.equal(post.title, '文章標題');
    assert.equal(post.content, '<p>正文內容</p>');
    assert.deepEqual(post.labels, ['測試']);
    assert.match(post.contentHash, /^[0-9a-f]{8}$/);
});

test('Blogger HTML fallback removes active content and event handlers', () => {
    const cleanHtml = sanitizeBloggerHtml(
        '<p onclick="alert(1)" style="color:red">安全內容</p><script>alert(1)</script>'
    );

    assert.equal(cleanHtml, '<p>安全內容</p>');
});

test('content hash changes when publish content changes', () => {
    const first = createContentHash({ title: '標題', content: '<p>A</p>', labels: ['A'] });
    const second = createContentHash({ title: '標題', content: '<p>B</p>', labels: ['A'] });
    assert.notEqual(first, second);
});

test('empty Blogger title or content is rejected before network calls', () => {
    assert.throws(() => buildBloggerPost({ title: '', htmlContent: '<p>內容</p>' }), /標題不能為空/);
    assert.throws(() => buildBloggerPost({ title: '標題', htmlContent: '' }), /內容不能為空/);
});
