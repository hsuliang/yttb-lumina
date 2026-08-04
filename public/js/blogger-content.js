const ALLOWED_TAGS = new Set([
    'a', 'blockquote', 'br', 'code', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'hr', 'iframe', 'img', 'li', 'ol', 'p', 'pre', 's', 'span', 'strong', 'table',
    'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul'
]);

const BLOCKED_TAGS = new Set(['base', 'embed', 'form', 'link', 'meta', 'object', 'script', 'style']);

function isHttpUrl(value) {
    try {
        const url = new URL(value, 'https://www.blogger.com');
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

function isAllowedYouTubeUrl(value) {
    try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        return (host === 'youtube.com' || host === 'www.youtube.com' ||
            host === 'youtube-nocookie.com' || host === 'www.youtube-nocookie.com') &&
            url.pathname.startsWith('/embed/');
    } catch (_) {
        return false;
    }
}

function unwrapElement(element) {
    const parent = element.parentNode;
    if (!parent) return;
    while (element.firstChild) parent.insertBefore(element.firstChild, element);
    parent.removeChild(element);
}

function sanitizeWithDom(html) {
    const parser = new DOMParser();
    const documentNode = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const root = documentNode.body.firstElementChild;
    if (!root) return '';

    [...root.querySelectorAll('*')].forEach(element => {
        const tag = element.tagName.toLowerCase();
        if (BLOCKED_TAGS.has(tag)) {
            element.remove();
            return;
        }
        if (!ALLOWED_TAGS.has(tag)) {
            unwrapElement(element);
            return;
        }

        if (tag === 'a') {
            const href = element.getAttribute('href');
            [...element.attributes].forEach(attribute => element.removeAttribute(attribute.name));
            if (href && isHttpUrl(href)) {
                element.setAttribute('href', new URL(href, 'https://www.blogger.com').href);
                element.setAttribute('target', '_blank');
                element.setAttribute('rel', 'noopener noreferrer');
            }
        } else if (tag === 'img') {
            const src = element.getAttribute('src');
            const alt = element.getAttribute('alt');
            [...element.attributes].forEach(attribute => element.removeAttribute(attribute.name));
            if (!src || !isHttpUrl(src)) {
                element.remove();
                return;
            }
            element.setAttribute('src', new URL(src, 'https://www.blogger.com').href);
            if (alt) element.setAttribute('alt', alt.slice(0, 300));
        } else if (tag === 'iframe') {
            const src = element.getAttribute('src');
            [...element.attributes].forEach(attribute => element.removeAttribute(attribute.name));
            if (!src || !isAllowedYouTubeUrl(src)) {
                element.remove();
                return;
            }
            element.setAttribute('src', new URL(src).href);
            element.setAttribute('style', 'width: 100%; aspect-ratio: 16/9;');
            element.setAttribute('title', 'YouTube video player');
            element.setAttribute('frameborder', '0');
            element.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
            element.setAttribute('allowfullscreen', 'allowfullscreen');
        } else {
            [...element.attributes].forEach(attribute => element.removeAttribute(attribute.name));
        }
    });

    return root.innerHTML.trim();
}

function sanitizeWithoutDom(html) {
    return String(html || '')
        .replace(/<\s*(script|style|iframe|object|embed|form|meta|link|base)\b[\s\S]*?<\/\s*\1\s*>/gi, '')
        .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/\s+style\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .trim();
}

export function sanitizeBloggerHtml(html) {
    if (typeof DOMParser === 'undefined') return sanitizeWithoutDom(html);
    return sanitizeWithDom(String(html || ''));
}

export function removeLeadingTitleHeading(html, title) {
    if (!html || !title) return String(html || '').trim();

    if (typeof DOMParser === 'undefined') {
        const escapedTitle = String(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return String(html).replace(
            new RegExp(`^\\s*<h1\\b[^>]*>\\s*${escapedTitle}\\s*</h1>\\s*`, 'i'),
            ''
        ).trim();
    }

    const parser = new DOMParser();
    const documentNode = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const root = documentNode.body.firstElementChild;
    const firstElement = root?.firstElementChild;
    if (firstElement?.tagName.toLowerCase() === 'h1' &&
        firstElement.textContent.trim() === String(title).trim()) {
        firstElement.remove();
    }
    return root?.innerHTML.trim() || '';
}

export function normalizeBloggerLabels(labels = []) {
    const values = Array.isArray(labels) ? labels : [labels];
    const result = [];
    const seen = new Set();
    values.flatMap(value => String(value || '').split(/[,，\n]/)).forEach(value => {
        const label = value.trim();
        if (!label || seen.has(label)) return;
        seen.add(label);
        result.push(label);
    });
    return result;
}

export function createContentHash({ title = '', content = '', labels = [] } = {}) {
    const input = JSON.stringify({ title, content, labels });
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildBloggerPost({ title, htmlContent, labels = [] } = {}) {
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) throw new Error('文章標題不能為空。');

    const contentWithoutDuplicateTitle = removeLeadingTitleHeading(htmlContent, cleanTitle);
    const content = sanitizeBloggerHtml(contentWithoutDuplicateTitle);
    if (!content) throw new Error('文章內容不能為空。');

    const normalizedLabels = normalizeBloggerLabels(labels);
    return {
        title: cleanTitle,
        content,
        ...(normalizedLabels.length > 0 ? { labels: normalizedLabels } : {}),
        contentHash: createContentHash({ title: cleanTitle, content, labels: normalizedLabels })
    };
}
