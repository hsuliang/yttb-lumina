import OpenCC from 'opencc-js/cn2t';

const toTaiwanTraditional = OpenCC.Converter({ from: 'cn', to: 'tw' });

export function buildWhisperDictionary(terminologyRules = [], replacementRules = [], maxLength = 6000) {
    const entries = [];
    for (const rule of terminologyRules) {
        if (rule?.type === 'positive' && rule.term?.trim()) entries.push(rule.term.trim());
    }
    for (const rule of replacementRules) {
        const original = rule?.original?.trim();
        const replacement = rule?.replacement?.trim();
        if (original && replacement && original !== replacement) entries.push(`${original}=${replacement}`);
    }

    const uniqueEntries = [...new Set(entries)];
    const accepted = [];
    for (const entry of uniqueEntries) {
        const candidate = [...accepted, entry].join('\n');
        if (candidate.length > maxLength) break;
        accepted.push(entry);
    }
    return accepted.join('\n');
}

function countMatches(text, pattern) {
    return Array.from(String(text || '').matchAll(pattern)).length;
}

export function isProbablyChinese(text) {
    const value = String(text || '');
    const hanCount = countMatches(value, /\p{Script=Han}/gu);
    if (hanCount < 2) return false;

    const kanaCount = countMatches(value, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
    const hangulCount = countMatches(value, /\p{Script=Hangul}/gu);
    return hangulCount === 0 && kanaCount <= Math.max(1, Math.floor(hanCount * 0.05));
}

export function shouldUseTaiwanTraditional(payload, selectedLanguage) {
    if (selectedLanguage === 'zh') return true;
    if (selectedLanguage !== 'auto') return false;

    const detected = String(payload?.detectedLanguage || '').toLowerCase();
    if (/^(zh|chinese|mandarin)/.test(detected)) return true;
    if (/^(ja|japanese|ko|korean)/.test(detected)) return false;
    return isProbablyChinese(payload?.text || payload?.srt || '');
}

export function normalizeTranscriptionPayload(payload, selectedLanguage) {
    if (!shouldUseTaiwanTraditional(payload, selectedLanguage)) return payload;
    return {
        ...payload,
        text: toTaiwanTraditional(String(payload?.text || '')),
        srt: toTaiwanTraditional(String(payload?.srt || '')),
        vtt: toTaiwanTraditional(String(payload?.vtt || '')),
    };
}
