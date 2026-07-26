import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readProjectFile = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const draftModules = [
    'public/js/tab2-blog.js',
    'public/js/tab3-social.js',
    'public/js/tab4-edm.js',
    'public/js/tab5-carousel.js',
    'public/js/tab6-infographic.js',
    'public/js/ui-components.js'
];

test('generated content tabs no longer save or restore browser drafts', () => {
    const source = draftModules.map(readProjectFile).join('\n');

    assert.doesNotMatch(source, /(?:save|restore|has|clear)[A-Za-z]*Draft/);
    assert.doesNotMatch(source, /checkGlobalDrafts|draftCleared|adoptDraftSource|stampVersions/);
    assert.doesNotMatch(source, /aliang-yttb-draft|lumina-(?:edm|carousel)-draft/);
});

test('legacy draft keys are removed during startup migration', () => {
    const source = readProjectFile('public/js/app.js');

    assert.match(source, /LEGACY_DRAFT_STORAGE_KEYS\.forEach\(key => localStorage\.removeItem\(key\)\)/);
    assert.match(source, /aliang-yttb-draft-blog/);
    assert.match(source, /lumina-carousel-draft/);
});

test('transcript replacement requires confirmation and returns Tab 1 to input mode', () => {
    const tab0 = readProjectFile('public/js/tab0-transcribe.js');
    const tab1 = readProjectFile('public/js/tab1-srt.js');

    assert.match(tab0, /title: '取代目前逐字稿？'/);
    assert.match(tab0, /\{ text: '取代', class: 'btn-danger'/);
    assert.match(tab0, /window\.dispatchEvent\(new Event\('lumina:showTab1Input'\)\)/);
    assert.match(tab1, /window\.addEventListener\('lumina:showTab1Input'[\s\S]*setMode\('input'\)/);
});
