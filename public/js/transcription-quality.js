const SEVERE_QUALITY_REASONS = new Set([
    'timestamp_leak',
    'prompt_leak',
    'invalid_characters',
    'repeated_character',
    'repeated_short_loop',
    'repeated_phrase',
]);

export function isWorkersAiDailyLimitError(value) {
    const code = String(value?.code || '');
    const message = typeof value === 'string'
        ? value
        : `${value?.error || ''} ${value?.message || ''}`;
    return code === 'AI_DAILY_LIMIT'
        || /(?:4006|used up your daily free allocation|daily free allocation.+neurons)/i.test(message);
}

export function shouldRetryWhisperResponse(status, errorPayload) {
    if (isWorkersAiDailyLimitError(errorPayload)) return false;
    return status === 429 || status >= 500;
}

export function getWorkersAiUsageNotice(value) {
    if (!isWorkersAiDailyLimitError(value)) return null;
    return {
        title: 'Workers AI 今日免費額度已用完',
        message: 'Cloudflare Workers AI 每日 10,000 neurons 的免費額度已用完，本次辨識已停止。已完成的字幕仍會保留；請等待每日額度重置後再試，或升級 Cloudflare Workers Paid 方案。',
    };
}

export function collectReliableTranscriptionText(results) {
    return (results || [])
        .filter(result => !result?.data?.quality?.suspect)
        .map(result => String(result?.data?.text || '').trim())
        .filter(Boolean);
}

export function shouldSplitSuspectTranscription(quality, recoveryDepth, durationSeconds) {
    return Boolean(quality?.suspect)
        && quality.severity !== 'severe'
        && recoveryDepth < 2
        && durationSeconds > 6;
}

function replaceSrtWithMarker(srt, marker) {
    const timelines = [...String(srt || '').matchAll(
        /(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/g
    )];
    if (timelines.length === 0) return String(srt || '');
    return `1\n${timelines[0][1]} --> ${timelines.at(-1)[2]}\n${marker}`;
}

function prefixFirstCue(srt, marker) {
    let marked = false;
    return String(srt || '').split(/\n\s*\n/).map(block => {
        if (marked) return block;
        const lines = block.split('\n');
        const timelineIndex = lines.findIndex(line => line.includes('-->'));
        if (timelineIndex < 0 || timelineIndex >= lines.length - 1) return block;
        const text = lines.slice(timelineIndex + 1).join(' ').trim();
        lines.splice(timelineIndex + 1, lines.length, `${marker} ${text}`.trim());
        marked = true;
        return lines.join('\n');
    }).join('\n\n');
}

export function markUncertainTranscription(payload) {
    if (!payload?.quality?.suspect) return payload;

    const reasons = payload.quality.reasons || [];
    const severe = payload.quality.severity === 'severe'
        || reasons.some(reason => SEVERE_QUALITY_REASONS.has(reason));
    const marker = severe ? '【辨識不清】' : '【待確認】';
    const candidateText = String(payload.text || '').trim();

    return {
        ...payload,
        text: severe ? marker : `${marker} ${candidateText}`.trim(),
        srt: severe
            ? replaceSrtWithMarker(payload.srt, marker)
            : prefixFirstCue(payload.srt, marker),
        quality: {
            ...payload.quality,
            markedUncertain: true,
        },
    };
}
