import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readProjectFile = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const html = readProjectFile('index.html');
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
