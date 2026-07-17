import test from 'node:test';
import assert from 'node:assert/strict';
import { state } from '../public/js/state.js';
import {
    activateSource,
    adoptDraftSource,
    createSourceId,
    getCanonicalTranscript,
    getPreferredSource,
    isCurrentSource,
} from '../public/js/content-source.js';

function resetState() {
    state.currentSourceId = '';
    state.currentSourceText = '';
    state.processedSrtResult = '';
    state.processedSourceId = '';
    state.optimizedTextForBlog = '';
    state.optimizedSourceId = '';
    state.blogArticleVersions = [];
    state.currentBlogVersionIndex = 0;
}

test('changing from transcript A to B invalidates A-derived source selection', () => {
    resetState();
    const sourceA = activateSource('逐字稿 A').sourceId;
    state.processedSrtResult = '整理後的 A';
    state.processedSourceId = sourceA;
    state.blogArticleVersions = [{ sourceId: sourceA, htmlContent: '<p>A 的文章</p>' }];

    activateSource('逐字稿 B');

    assert.equal(getCanonicalTranscript('逐字稿 B'), '逐字稿 B');
    assert.deepEqual(getPreferredSource('逐字稿 B'), { type: 'transcript', text: '逐字稿 B' });
});

test('derived content is selected only when it belongs to the active source', () => {
    resetState();
    const sourceId = activateSource('目前逐字稿').sourceId;
    state.optimizedTextForBlog = '目前優化稿';
    state.optimizedSourceId = sourceId;
    state.blogArticleVersions = [{ sourceId, htmlContent: '<p>目前文章</p>' }];

    assert.equal(getPreferredSource('目前逐字稿').type, 'blog');
    assert.equal(isCurrentSource(sourceId), true);
    assert.equal(createSourceId('目前逐字稿'), sourceId);
});

test('drafts from another transcript cannot replace the active workspace', () => {
    resetState();
    activateSource('目前逐字稿');

    assert.equal(adoptDraftSource('另一份舊逐字稿'), false);
    assert.equal(state.currentSourceText, '目前逐字稿');
});
