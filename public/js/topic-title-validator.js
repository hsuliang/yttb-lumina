const SCHEME_LABELS = ['A', 'B', 'C'];
const OPTION_LABELS = ['正選', '備選一', '備選二'];
const OUTER_WRAPPERS = [
    ['「', '」'],
    ['『', '』'],
    ['【', '】'],
    ['《', '》'],
    ['〈', '〉'],
    ['（', '）'],
    ['(', ')'],
    ['[', ']'],
    ['"', '"'],
    ["'", "'"],
];

export function normalizeTopicTitleValue(value = '') {
    let normalized = String(value).replace(/\*\*/g, '').trim();
    let wrapperRemoved = true;

    while (wrapperRemoved && normalized) {
        wrapperRemoved = false;
        for (const [opening, closing] of OUTER_WRAPPERS) {
            if (normalized.startsWith(opening) && normalized.endsWith(closing)) {
                normalized = normalized.slice(opening.length, -closing.length).trim();
                wrapperRemoved = true;
                break;
            }
        }
    }

    return normalized;
}

export function countTopicTitleCharacters(value = '') {
    return Array.from(normalizeTopicTitleValue(value)).length;
}

function parseSchemeSection(section) {
    const options = new Map();
    let currentOption = null;

    section
        .replace(/\*\*/g, '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .forEach(line => {
            const optionMatch = line.match(/^(正選|備選一|備選二)\s*[：:]?$/);
            if (optionMatch) {
                currentOption = optionMatch[1];
                if (!options.has(currentOption)) options.set(currentOption, {});
                return;
            }

            if (!currentOption) return;
            const mainTitleMatch = line.match(/^主標題\s*[：:]\s*(.+)$/);
            if (mainTitleMatch) {
                options.get(currentOption).mainTitle = normalizeTopicTitleValue(mainTitleMatch[1]);
                return;
            }

            const subtitleMatch = line.match(/^副標題\s*[：:]\s*(.+)$/);
            if (subtitleMatch) {
                options.get(currentOption).subtitle = normalizeTopicTitleValue(subtitleMatch[1]);
            }
        });

    return options;
}

export function extractTopicTitleSuggestions(text = '') {
    const plainText = String(text).replace(/\*\*/g, '');
    const schemeMatches = [...plainText.matchAll(/^💡\s*方案\s*([ABC])\s*[：:]/gm)];
    const suggestions = [];

    schemeMatches.forEach((match, index) => {
        const end = schemeMatches[index + 1]?.index ?? plainText.length;
        const options = parseSchemeSection(plainText.slice(match.index, end));
        for (const optionLabel of OPTION_LABELS) {
            const option = options.get(optionLabel);
            if (option?.mainTitle && option?.subtitle) {
                suggestions.push({
                    scheme: match[1],
                    option: optionLabel,
                    mainTitle: option.mainTitle,
                    subtitle: option.subtitle,
                });
            }
        }
    });

    return suggestions;
}

export function validateTopicTitleSuggestion(text = '') {
    const source = String(text);
    const plainText = source.replace(/\*\*/g, '');
    const schemeMatches = [...plainText.matchAll(/^💡\s*方案\s*([ABC])\s*[：:]/gm)];
    const sections = new Map();
    const violations = [];
    const mainTitles = new Set();
    const subtitles = new Set();
    let pairCount = 0;

    schemeMatches.forEach((match, index) => {
        const end = schemeMatches[index + 1]?.index ?? plainText.length;
        if (!sections.has(match[1])) {
            sections.set(match[1], parseSchemeSection(plainText.slice(match.index, end)));
        }
    });

    if (schemeMatches.length !== SCHEME_LABELS.length) {
        violations.push(`必須完整輸出方案 A、B、C，目前辨識到 ${schemeMatches.length} 個方案。`);
    }

    for (const schemeLabel of SCHEME_LABELS) {
        const options = sections.get(schemeLabel);
        if (!options) {
            violations.push(`缺少方案 ${schemeLabel} 或方案標題格式不正確。`);
            continue;
        }

        for (const optionLabel of OPTION_LABELS) {
            const option = options.get(optionLabel);
            if (!option?.mainTitle || !option?.subtitle) {
                violations.push(`方案 ${schemeLabel} 的${optionLabel}必須同時包含主標題與副標題。`);
                continue;
            }

            pairCount += 1;
            const mainTitleLength = countTopicTitleCharacters(option.mainTitle);
            const subtitleLength = countTopicTitleCharacters(option.subtitle);

            if (mainTitleLength > 10) {
                violations.push(`方案 ${schemeLabel} ${optionLabel}的主標題「${option.mainTitle}」為 ${mainTitleLength} 字，必須在 10 字以內。`);
            }
            if (subtitleLength < 15 || subtitleLength > 20) {
                violations.push(`方案 ${schemeLabel} ${optionLabel}的副標題「${option.subtitle}」為 ${subtitleLength} 字，必須介於 15 至 20 字。`);
            }
            if (mainTitles.has(option.mainTitle)) {
                violations.push(`主標題「${option.mainTitle}」重複，九組主標題必須各不相同。`);
            }
            if (subtitles.has(option.subtitle)) {
                violations.push(`副標題「${option.subtitle}」重複，九組副標題必須各不相同。`);
            }

            mainTitles.add(option.mainTitle);
            subtitles.add(option.subtitle);
        }
    }

    if (pairCount !== 9) {
        violations.push(`必須提供 9 組完整主副標題，目前辨識到 ${pairCount} 組。`);
    }

    return {
        valid: violations.length === 0,
        violations,
        pairCount,
    };
}
