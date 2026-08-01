import { callGeminiAPI } from './gemini-api.js';

const TIMELINE_PATTERN = /^\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}$/;
const MAX_REPLACEMENT_CHARS = 24;
const PROOFREADING_BATCH_CHARS = 7000;
const PROOFREADING_OVERLAP_BLOCKS = 2;

function parseSrtDocument(srt) {
    const source = String(srt || '');
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    const trailingNewline = source.endsWith('\r\n') || source.endsWith('\n');
    const trimmed = source.trim();
    if (!trimmed) return { source, newline, trailingNewline, blocks: [], cues: [] };

    const blocks = trimmed.split(/\r?\n\s*\r?\n/).map(raw => ({
        raw,
        lines: raw.split(/\r?\n/),
    }));
    const cues = [];

    blocks.forEach((block, blockIndex) => {
        const timelineIndex = block.lines.findIndex(line => TIMELINE_PATTERN.test(line.trim()));
        if (timelineIndex <= 0 || timelineIndex >= block.lines.length - 1) return;
        const number = Number(block.lines[timelineIndex - 1].replace(/^\uFEFF/, '').trim());
        if (!Number.isInteger(number)) return;
        const textStart = timelineIndex + 1;
        cues.push({
            number,
            timeline: block.lines[timelineIndex].trim(),
            text: block.lines.slice(textStart).join(newline).trim(),
            textStart,
            blockIndex,
            lines: block.lines,
        });
    });

    return { source, newline, trailingNewline, blocks, cues };
}

function parseJsonPayload(value) {
    if (value && typeof value === 'object') return value;
    const cleaned = String(value || '')
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
    return JSON.parse(cleaned);
}

function countOccurrences(text, target) {
    if (!target) return 0;
    let count = 0;
    let fromIndex = 0;
    while (fromIndex <= text.length - target.length) {
        const index = text.indexOf(target, fromIndex);
        if (index < 0) break;
        count++;
        fromIndex = index + target.length;
    }
    return count;
}

function makeSuggestionId(cueNumber, original, suggested) {
    const value = `${cueNumber}\u0000${original}\u0000${suggested}`;
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `proof-${cueNumber}-${(hash >>> 0).toString(36)}`;
}

export function buildProofreadingPrompt(srt, terminology = []) {
    const terms = (terminology || [])
        .map(term => String(term || '').trim())
        .filter(Boolean)
        .slice(0, 100);
    const terminologySection = terms.length > 0
        ? `\n可參考的使用者專有名詞（仍須依上下文判斷，不可強制替換）：\n${terms.join('、')}\n`
        : '';

    return `你是臺灣繁體中文字幕的保守校對員。你沒有原始音訊，只能提出校對建議，不能直接改寫字幕。

任務：找出有明確上下文依據的同音字、錯別字或專有名詞誤辨。

嚴格規則：
1. 只能提出校對建議，不得輸出修改後的完整 SRT。
2. 不得修改序號、時間碼、斷句、標點、空格或語氣詞。
3. original 必須是指定 cueNumber 字幕文字中完全相同且只出現一次的連續片段。
4. suggested 只能是取代 original 的短詞或短語，不得重寫整句。
5. 無法由上下文確認時不要列出；不要猜測聽不清楚的原話。
6. 只回傳 confidence 為 high 或 medium 的項目。
7. 使用繁體中文（臺灣）。

輸出必須是以下 JSON 結構，不得加入 Markdown：
{
  "suggestions": [
    {
      "cueNumber": 12,
      "original": "預期",
      "suggested": "逾期",
      "reason": "借書超過歸還期限",
      "confidence": "high"
    }
  ]
}
${terminologySection}
待檢查的 SRT：
---
${String(srt || '').trim()}
---`;
}

export function parseProofreadingSuggestions(response, srt) {
    const payload = parseJsonPayload(response);
    const candidates = Array.isArray(payload) ? payload : payload?.suggestions;
    if (!Array.isArray(candidates)) throw new Error('AI 校對回應缺少 suggestions 陣列。');

    const document = parseSrtDocument(srt);
    const cueByNumber = new Map(document.cues.map((cue, index) => [cue.number, { cue, index }]));
    const seen = new Set();
    const suggestions = [];

    for (const candidate of candidates) {
        const cueNumber = Number(candidate?.cueNumber);
        const original = String(candidate?.original || '').trim();
        const suggested = String(candidate?.suggested || '').trim();
        const confidence = String(candidate?.confidence || '').toLowerCase();
        const entry = cueByNumber.get(cueNumber);
        if (!entry || !original || !suggested || original === suggested) continue;
        if (!['high', 'medium'].includes(confidence)) continue;
        if (Array.from(original).length > MAX_REPLACEMENT_CHARS
            || Array.from(suggested).length > MAX_REPLACEMENT_CHARS) continue;
        if (/\r|\n|-->|\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(original + suggested)) continue;
        if (countOccurrences(entry.cue.text, original) !== 1) continue;

        const key = `${cueNumber}\u0000${original}\u0000${suggested}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const previous = document.cues[entry.index - 1]?.text || '';
        const next = document.cues[entry.index + 1]?.text || '';
        suggestions.push({
            id: makeSuggestionId(cueNumber, original, suggested),
            source: 'ai',
            cueNumber,
            timeline: entry.cue.timeline,
            time: entry.cue.timeline.split('-->')[0].trim(),
            original,
            suggested,
            reason: String(candidate?.reason || '依上下文判斷').trim().slice(0, 100),
            confidence,
            context: [previous, entry.cue.text, next].filter(Boolean).join(' ｜ '),
            cueText: entry.cue.text,
        });
    }

    return suggestions;
}

export function expandConsistencySuggestions(srt, suggestions) {
    const document = parseSrtDocument(srt);
    const mappings = new Map();
    const existing = new Set();

    for (const suggestion of suggestions || []) {
        const original = String(suggestion?.original || '');
        const suggested = String(suggestion?.suggested || '');
        if (Array.from(original).length < 2 || !suggested) continue;
        const targets = mappings.get(original) || new Set();
        targets.add(suggested);
        mappings.set(original, targets);
        existing.add(`${suggestion.cueNumber}\u0000${original}\u0000${suggested}`);
    }

    const expanded = [...(suggestions || [])];
    for (const [original, targets] of mappings) {
        if (targets.size !== 1) continue;
        const [suggested] = targets;
        document.cues.forEach((cue, index) => {
            const key = `${cue.number}\u0000${original}\u0000${suggested}`;
            if (existing.has(key) || countOccurrences(cue.text, original) !== 1) return;
            const previous = document.cues[index - 1]?.text || '';
            const next = document.cues[index + 1]?.text || '';
            expanded.push({
                id: makeSuggestionId(cue.number, original, suggested),
                source: 'consistency',
                cueNumber: cue.number,
                timeline: cue.timeline,
                time: cue.timeline.split('-->')[0].trim(),
                original,
                suggested,
                reason: `同詞「${original}」在其他字幕已建議為「${suggested}」，請確認此處語意。`,
                confidence: 'medium',
                context: [previous, cue.text, next].filter(Boolean).join(' ｜ '),
                cueText: cue.text,
            });
            existing.add(key);
        });
    }

    return expanded.sort((left, right) => {
        const sourceOrder = Number(left.source === 'consistency')
            - Number(right.source === 'consistency');
        return left.cueNumber - right.cueNumber
            || sourceOrder
            || left.id.localeCompare(right.id);
    });
}

export function splitSrtForProofreading(
    srt,
    maxChars = PROOFREADING_BATCH_CHARS,
    overlapBlocks = PROOFREADING_OVERLAP_BLOCKS,
) {
    const document = parseSrtDocument(srt);
    if (document.blocks.length === 0) return [];

    const limit = Math.max(1, Number(maxChars) || PROOFREADING_BATCH_CHARS);
    const overlap = Math.max(0, Math.floor(Number(overlapBlocks) || 0));
    const batches = [];
    let current = [];
    let currentLength = 0;
    for (const block of document.blocks) {
        let addition = block.raw.length + (current.length > 0 ? 2 : 0);
        if (current.length > 0 && currentLength + addition > limit) {
            batches.push(current.join('\n\n'));
            current = overlap > 0 ? current.slice(-overlap) : [];
            currentLength = current.reduce((length, item, index) => (
                length + item.length + (index > 0 ? 2 : 0)
            ), 0);
            addition = block.raw.length + (current.length > 0 ? 2 : 0);
        }
        current.push(block.raw);
        currentLength += addition;
    }
    if (current.length > 0) batches.push(current.join('\n\n'));
    return batches;
}

export async function requestProofreadingSuggestions({
    apiKey,
    srt,
    terminology = [],
    abortSignal = null,
    onProgress = null,
}) {
    const batches = splitSrtForProofreading(srt);
    const candidates = [];

    for (let index = 0; index < batches.length; index++) {
        onProgress?.(index + 1, batches.length);
        const response = await callGeminiAPI(
            apiKey,
            buildProofreadingPrompt(batches[index], terminology),
            true,
            null,
            abortSignal,
        );
        const payload = parseJsonPayload(response);
        const items = Array.isArray(payload) ? payload : payload?.suggestions;
        if (!Array.isArray(items)) throw new Error('AI 校對回應格式不正確。');
        candidates.push(...items);
    }

    const suggestions = parseProofreadingSuggestions({ suggestions: candidates }, srt);
    return expandConsistencySuggestions(srt, suggestions);
}

export function getSrtTimelineSignature(srt) {
    return parseSrtDocument(srt).cues.map(cue => `${cue.number}\u0000${cue.timeline}`);
}

export function applyProofreadingSuggestions(srt, suggestions, selectedIds) {
    const selected = new Set(selectedIds || []);
    const chosen = (suggestions || []).filter(suggestion => selected.has(suggestion.id));
    if (chosen.length === 0) return { srt: String(srt || ''), applied: [], skipped: [] };

    const document = parseSrtDocument(srt);
    const cueByKey = new Map(document.cues.map(cue => [
        `${cue.number}\u0000${cue.timeline}`,
        cue,
    ]));
    const grouped = new Map();
    for (const suggestion of chosen) {
        const key = `${suggestion.cueNumber}\u0000${suggestion.timeline}`;
        const list = grouped.get(key) || [];
        list.push(suggestion);
        grouped.set(key, list);
    }

    const applied = [];
    const skipped = [];
    for (const [key, items] of grouped) {
        const cue = cueByKey.get(key);
        if (!cue || cue.text !== items[0].cueText) {
            skipped.push(...items);
            continue;
        }

        const operations = [];
        for (const suggestion of items) {
            const index = cue.text.indexOf(suggestion.original);
            const overlaps = operations.some(operation => (
                index < operation.end && index + suggestion.original.length > operation.start
            ));
            if (index < 0 || countOccurrences(cue.text, suggestion.original) !== 1 || overlaps) {
                skipped.push(suggestion);
                continue;
            }
            operations.push({
                start: index,
                end: index + suggestion.original.length,
                suggestion,
            });
        }

        let corrected = cue.text;
        operations.sort((left, right) => right.start - left.start).forEach(operation => {
            corrected = corrected.slice(0, operation.start)
                + operation.suggestion.suggested
                + corrected.slice(operation.end);
            applied.push(operation.suggestion);
        });
        if (operations.length > 0) {
            cue.lines.splice(cue.textStart, cue.lines.length - cue.textStart, corrected);
        }
    }

    if (applied.length === 0) {
        return { srt: document.source, applied, skipped };
    }

    const body = document.blocks.map(block => block.lines.join(document.newline))
        .join(`${document.newline}${document.newline}`);
    const correctedSrt = body + (document.trailingNewline ? document.newline : '');
    const beforeSignature = getSrtTimelineSignature(document.source);
    const afterSignature = getSrtTimelineSignature(correctedSrt);
    if (JSON.stringify(beforeSignature) !== JSON.stringify(afterSignature)) {
        throw new Error('安全檢查失敗：校對結果改動了字幕時間軸。');
    }

    return { srt: correctedSrt, applied, skipped };
}

export function srtToPlainText(srt) {
    return parseSrtDocument(srt).cues.map(cue => cue.text).join('\n');
}

export function srtToVtt(srt) {
    const converted = String(srt || '').replace(
        /(\d{2}:\d{2}:\d{2}),(\d{3})(\s+-->\s+)(\d{2}:\d{2}:\d{2}),(\d{3})/g,
        '$1.$2$3$4.$5',
    );
    return `WEBVTT\n\n${converted.trim()}`;
}
