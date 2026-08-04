import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readProjectFile = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const html = readProjectFile('index.html');
const readme = readProjectFile('public/readme.html');
const appSource = readProjectFile('public/js/app.js');
const settingsSource = readProjectFile('public/js/blogger-settings.js');
const sessionSource = readProjectFile('public/js/blogger-session.js');
const publisherSource = readProjectFile('public/js/blogger-publisher.js');

test('global settings exposes Blogger connection and default blog controls', () => {
    assert.match(html, /data-target="settings-tab-blogger"/);
    assert.match(html, /id="blogger-settings-connect-btn"/);
    assert.match(html, /id="blogger-settings-refresh-btn"/);
    assert.match(html, /id="blogger-settings-disconnect-btn"/);
    assert.match(html, /id="blogger-settings-blog-select"/);
});

test('Blogger session keeps token memory-only while sharing selected blog state', () => {
    assert.match(sessionSource, /let bloggerBlogs = \[\];/);
    assert.match(sessionSource, /getBloggerAccessToken\(\)/);
    assert.match(sessionSource, /BLOGGER_SETTINGS_KEYS\.BLOG_ID/);
    assert.doesNotMatch(sessionSource, /ACCESS_TOKEN|accessToken.*localStorage|localStorage.*accessToken/i);
});

test('publish flow opens the Blogger global settings tab instead of duplicating OAuth setup', () => {
    assert.match(appSource, /initializeBloggerSettings\(\)/);
    assert.match(appSource, /lumina:open-global-settings/);
    assert.match(settingsSource, /lumina:blogger-session-changed/);
    assert.match(publisherSource, /settings-tab-blogger/);
    assert.match(publisherSource, /setSelectedBloggerBlog\(/);
    assert.match(publisherSource, /lumina:blogger-session-changed/);
});

test('public readme keeps user guidance focused on available features', () => {
    const voiceCard = readme.match(/<h3[^>]*>語音轉文字辨識<\/h3>[\s\S]*?<\/div>\s*<\/div>/)?.[0] || '';
    assert.match(voiceCard, /語音辨識完成後[\s\S]*AI 校對建議/);
    assert.doesNotMatch(readme, /<h3[^>]*>設定步驟<\/h3>/);
    assert.doesNotMatch(readme, /在 Google Cloud 建立或選擇專案，啟用 Blogger API v3/);
});
