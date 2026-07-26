import { state } from './state.js';

export function createSourceId(content = '') {
    const normalized = String(content).replace(/\r\n/g, '\n').trim();
    if (!normalized) return '';

    let hash = 2166136261;
    for (let i = 0; i < normalized.length; i++) {
        hash ^= normalized.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return `src-${normalized.length}-${(hash >>> 0).toString(16)}`;
}

export function activateSource(content = '') {
    const normalized = String(content).replace(/\r\n/g, '\n').trim();
    const sourceId = createSourceId(normalized);
    const changed = sourceId !== state.currentSourceId;
    state.currentSourceId = sourceId;
    state.currentSourceText = normalized;
    return { sourceId, changed };
}

export function getCanonicalTranscript(rawContent = '') {
    if (
        state.processedSrtResult &&
        state.processedSourceId &&
        state.processedSourceId === state.currentSourceId
    ) {
        return state.processedSrtResult.trim();
    }
    return String(rawContent).trim();
}

export function getPreferredSource(rawContent = '', { allowBlog = true } = {}) {
    const currentBlog = state.blogArticleVersions?.[state.currentBlogVersionIndex];
    if (allowBlog && currentBlog?.sourceId === state.currentSourceId && currentBlog.htmlContent) {
        return { type: 'blog', text: currentBlog.htmlContent };
    }
    if (
        state.optimizedTextForBlog &&
        state.optimizedSourceId &&
        state.optimizedSourceId === state.currentSourceId
    ) {
        return { type: 'optimized', text: state.optimizedTextForBlog };
    }
    return { type: 'transcript', text: getCanonicalTranscript(rawContent) };
}

export function isCurrentSource(sourceId) {
    return Boolean(sourceId) && sourceId === state.currentSourceId;
}

export function shouldConfirmSourceReplacement(currentContent = '', incomingContent = '') {
    const currentId = createSourceId(currentContent);
    const incomingId = createSourceId(incomingContent);
    return Boolean(currentId && incomingId && currentId !== incomingId);
}
