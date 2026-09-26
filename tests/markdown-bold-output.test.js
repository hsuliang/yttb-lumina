import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { convertMarkdownBoldToHtml, normalizeMarkdownBoldHtml } from '../public/js/markdown-renderer.js';

const readProjectFile = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('markdown bold markers are converted to strong tags without changing ordinary text', () => {
    assert.equal(convertMarkdownBoldToHtml('一般文字 **這是粗體**，結尾保留。'), '一般文字 <strong>這是粗體</strong>，結尾保留。');
    assert.equal(convertMarkdownBoldToHtml('未完成 **粗體標記'), '未完成 **粗體標記');
    assert.equal(normalizeMarkdownBoldHtml('<p>**HTML 文字粗體**</p>'), '<p><strong>HTML 文字粗體</strong></p>');
});

test('tabs 2 through 7 render generated bold text directly', () => {
    const html = readProjectFile('index.html');
    const tab2 = readProjectFile('public/js/tab2-blog.js');
    const tab3 = readProjectFile('public/js/tab3-social.js');
    const tab4 = readProjectFile('public/js/tab4-edm.js');
    const tab5 = readProjectFile('public/js/tab5-carousel.js');
    const tab6 = readProjectFile('public/js/tab6-infographic.js');
    const tab7 = readProjectFile('public/js/tab7-thumbnail.js');

    assert.match(tab2, /normalizeMarkdownBoldHtml/);
    assert.match(tab2, /renderMarkdownBold/);
    assert.match(tab3, /function renderSocialBold/);
    assert.match(tab3, /ownerDocument\.createElement\('strong'\)/);
    assert.match(tab4, /normalizeMarkdownBoldHtml/);
    assert.match(tab5, /renderMarkdownBold/);
    assert.match(tab6, /renderMarkdownBold/);
    assert.match(tab7, /renderMarkdownBold/);
    assert.match(html, /<div id="carousel-prompt-textarea"/);
    assert.match(html, /<div id="infographic-prompt-textarea"/);
    assert.doesNotMatch(html, /<textarea id="carousel-prompt-textarea"/);
    assert.doesNotMatch(html, /<textarea id="infographic-prompt-textarea"/);
});
