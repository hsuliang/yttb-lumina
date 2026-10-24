import { buildMultiImageTask, buildSingleImageRule, toImageNumber } from './multi-image-prompt.js';

const BRACKETED_IMAGE_MARKER = /(?:^|\n)[ \t]*\[[ \t]*第[ \t]*([1-5一二三四五])[ \t]*張[ \t]*(?:圖片)?(?:提示詞)?[ \t]*\][^\n]*/gi;
const PLAIN_IMAGE_MARKER = /(?:^|\n)[ \t]*第[ \t]*([1-5一二三四五])[ \t]*張(?:圖片)?(?:提示詞)?(?:[ \t]*[:：—-][^\n]*|[ \t]*(?=\n|$))/gi;
const OLD_SINGLE_IMAGE_RULE = /這是一張單一且完整的圖片，絕對不要使用分割畫面、拼貼格、多圖組合或漫畫方格的形式(?:\s*\(single complete image[^)]*\))?[。.]?/g;
const NEW_SINGLE_IMAGE_RULE = /(?:^|\n)\s*(?:\*\*)?單張完整圖片與獨立任務限制：(?:\*\*)?[\s\S]*$/;

function collectImageMarkers(text, pattern) {
    pattern.lastIndex = 0;
    const markers = [];
    let match;
    while ((match = pattern.exec(text)) !== null) {
        markers.push({ number: match[1], index: match.index });
    }
    return markers;
}

export function extractCarouselPromptBlocks(text = '') {
    const source = String(text || '');
    const bracketed = collectImageMarkers(source, BRACKETED_IMAGE_MARKER);
    const markers = bracketed.length ? bracketed : collectImageMarkers(source, PLAIN_IMAGE_MARKER);
    return markers.map((marker, index) => ({
        number: toImageNumber(marker.number),
        content: source.slice(marker.index, markers[index + 1]?.index ?? source.length).trim(),
    }));
}

export function normalizeCarouselPromptOutput(text = '') {
    const blocks = extractCarouselPromptBlocks(String(text || '').trim());
    if (!blocks.length) throw new Error('無法辨識輪播圖逐張提示詞，請重新生成。');
    if (blocks.length > 4) throw new Error('輪播圖超過預定的 4 張，請重新生成。');

    const imagePrompts = blocks.map((block, index) => {
        if (block.number !== index + 1) throw new Error('輪播圖圖片編號不連續，請重新生成。');
        const content = block.content
            .replace(NEW_SINGLE_IMAGE_RULE, '')
            .replace(OLD_SINGLE_IMAGE_RULE, '')
            .trim();
        return `${content}\n\n${buildSingleImageRule(block.number)}`;
    });

    return `${buildMultiImageTask(blocks.length, true)}\n\n${imagePrompts.join('\n\n')}`;
}
