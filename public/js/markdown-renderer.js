const MARKDOWN_BOLD_PATTERN = /\\?\*\\?\*([^*\n]+?)\\?\*\\?\*/g;

function appendMarkdownBoldNodes(parent, text, ownerDocument) {
    const source = String(text ?? '');
    let lastIndex = 0;
    let match;

    MARKDOWN_BOLD_PATTERN.lastIndex = 0;
    while ((match = MARKDOWN_BOLD_PATTERN.exec(source)) !== null) {
        if (match.index > lastIndex) {
            parent.appendChild(ownerDocument.createTextNode(source.slice(lastIndex, match.index)));
        }

        const strong = ownerDocument.createElement('strong');
        strong.textContent = match[1];
        parent.appendChild(strong);
        lastIndex = MARKDOWN_BOLD_PATTERN.lastIndex;
    }

    if (lastIndex < source.length) {
        parent.appendChild(ownerDocument.createTextNode(source.slice(lastIndex)));
    }
}

export function renderMarkdownBold(element, text) {
    if (!element) return;
    const ownerDocument = element.ownerDocument || document;
    element.replaceChildren();
    appendMarkdownBoldNodes(element, text, ownerDocument);
}

export function convertMarkdownBoldToHtml(text) {
    MARKDOWN_BOLD_PATTERN.lastIndex = 0;
    return String(text ?? '').replace(MARKDOWN_BOLD_PATTERN, '<strong>$1</strong>');
}

export function normalizeMarkdownBoldHtml(html) {
    const source = String(html ?? '');
    if (!source || typeof DOMParser === 'undefined') return convertMarkdownBoldToHtml(source);

    const documentNode = new DOMParser().parseFromString(source, 'text/html');
    const textNodes = [];
    const walker = documentNode.createTreeWalker(documentNode.body, 4);
    let currentNode;
    while ((currentNode = walker.nextNode())) textNodes.push(currentNode);

    textNodes.forEach(node => {
        MARKDOWN_BOLD_PATTERN.lastIndex = 0;
        if (!MARKDOWN_BOLD_PATTERN.test(node.nodeValue)) return;
        const fragment = documentNode.createDocumentFragment();
        appendMarkdownBoldNodes(fragment, node.nodeValue, documentNode);
        node.parentNode.replaceChild(fragment, node);
    });

    return documentNode.body.innerHTML;
}
