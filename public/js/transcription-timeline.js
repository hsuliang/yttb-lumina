export function splitPcmChunk(parentChunk, childDurationSeconds = 90) {
    const sampleRate = Number(parentChunk?.sampleRate);
    const parentOffsetSeconds = Number(parentChunk?.offsetSeconds || 0);
    const data = parentChunk?.data;

    if (!data || !Number.isFinite(sampleRate) || sampleRate <= 0 || childDurationSeconds <= 0) {
        return [];
    }

    const samplesPerChunk = Math.max(1, Math.ceil(childDurationSeconds * sampleRate));
    const children = [];

    for (let start = 0; start < data.length; start += samplesPerChunk) {
        const end = Math.min(start + samplesPerChunk, data.length);
        children.push({
            data: data.slice(start, end),
            sampleRate,
            offsetSeconds: parentOffsetSeconds + (start / sampleRate),
            durationSeconds: (end - start) / sampleRate,
        });
    }

    return children;
}

export function splitPcmByLowEnergy(
    data,
    sampleRate,
    targetDurationSeconds = 20,
    searchRadiusSeconds = 2,
    minimumChunkSeconds = 8
) {
    if (!data || !Number.isFinite(sampleRate) || sampleRate <= 0 || targetDurationSeconds <= 0) {
        return [];
    }

    const targetSamples = Math.max(1, Math.round(targetDurationSeconds * sampleRate));
    const searchSamples = Math.max(0, Math.round(searchRadiusSeconds * sampleRate));
    const minimumSamples = Math.max(1, Math.round(minimumChunkSeconds * sampleRate));
    const analysisWindow = Math.max(1, Math.round(sampleRate * 0.1));
    const chunks = [];
    let start = 0;

    while (start < data.length) {
        const remaining = data.length - start;
        if (remaining <= targetSamples + minimumSamples) {
            chunks.push({
                data: data.slice(start),
                sampleRate,
                offsetSeconds: start / sampleRate,
                durationSeconds: remaining / sampleRate,
            });
            break;
        }

        const targetEnd = start + targetSamples;
        const searchStart = Math.max(start + minimumSamples, targetEnd - searchSamples);
        const searchEnd = Math.min(data.length - minimumSamples, targetEnd + searchSamples);
        let bestEnd = targetEnd;
        let lowestEnergy = Number.POSITIVE_INFINITY;

        for (let candidate = searchStart; candidate <= searchEnd; candidate += analysisWindow) {
            const windowStart = Math.max(start, candidate - analysisWindow);
            const windowEnd = Math.min(data.length, candidate + analysisWindow);
            let sumSquares = 0;
            for (let i = windowStart; i < windowEnd; i++) {
                sumSquares += data[i] * data[i];
            }
            const energy = sumSquares / Math.max(1, windowEnd - windowStart);
            if (energy < lowestEnergy) {
                lowestEnergy = energy;
                bestEnd = candidate;
            }
        }

        const end = Math.max(start + 1, Math.min(bestEnd, data.length));
        chunks.push({
            data: data.slice(start, end),
            sampleRate,
            offsetSeconds: start / sampleRate,
            durationSeconds: (end - start) / sampleRate,
        });
        start = end;
    }

    return chunks;
}

export function offsetSrtTimestamps(srt, offsetSeconds, seqOffset = 0) {
    if (!srt) return '';

    function addMs(timeStr, addMs) {
        const match = timeStr.match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
        if (!match) return timeStr;

        let totalMs = (
            parseInt(match[1]) * 3600000 +
            parseInt(match[2]) * 60000 +
            parseInt(match[3]) * 1000 +
            parseInt(match[4])
        ) + addMs;
        totalMs = Math.max(0, totalMs);

        const hours = Math.floor(totalMs / 3600000);
        const minutes = Math.floor((totalMs % 3600000) / 60000);
        const seconds = Math.floor((totalMs % 60000) / 1000);
        const milliseconds = totalMs % 1000;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
    }

    const offsetMs = Math.round(offsetSeconds * 1000);
    let localSeq = 1;

    return srt
        .replace(
            /(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/g,
            (_, start, end) => `${addMs(start, offsetMs)} --> ${addMs(end, offsetMs)}`
        )
        .replace(
            /^(\d+)$/gm,
            () => String(seqOffset + localSeq++)
        );
}

function parseSrtTime(timeText) {
    const match = String(timeText || '').trim().match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
    if (!match) return Number.NaN;
    return Number(match[1]) * 3600000
        + Number(match[2]) * 60000
        + Number(match[3]) * 1000
        + Number(match[4]);
}

function formatSrtTime(milliseconds) {
    const value = Math.max(0, Math.round(milliseconds));
    const hours = Math.floor(value / 3600000);
    const minutes = Math.floor((value % 3600000) / 60000);
    const seconds = Math.floor((value % 60000) / 1000);
    const millis = value % 1000;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

function cleanCueText(text) {
    return String(text || '')
        .replace(/(?:\d{2}:)?\d{2}:\d{2}[.,]\d{2,3}\s*-->\s*(?:\d{2}:)?\d{2}:\d{2}[.,]\d{2,3}/g, '')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

function cueTextLength(text) {
    return Array.from(String(text || '').replace(/\s+/g, '')).length;
}

function joinCueText(left, right) {
    if (!left) return right;
    if (!right) return left;
    if (/[A-Z]$/.test(left) && /^[A-Z](?:\b|$)/.test(right)) return left + right;
    const chinesePhrasePause = /\p{Script=Han}$/u.test(left)
        && /^\p{Script=Han}/u.test(right)
        && cueTextLength(left) >= 2
        && cueTextLength(right) >= 2
        && /^(?:但更重要的是|更重要的是|但是|可是|不過|所以|因此|然後|接下來|另外|其實|如果|因為|有些|很多|好|那)/u.test(right);
    const needsSpace = chinesePhrasePause
        || (/[a-zA-Z0-9]$/.test(left) && /^[a-zA-Z0-9]/.test(right));
    return left + (needsSpace ? ' ' : '') + right;
}

function removePathologicalCueBursts(cues, windowMs = 600, minimumCues = 3, minimumChars = 40) {
    const rejected = new Set();
    for (let start = 0; start < cues.length; start++) {
        let totalChars = 0;
        let end = start;
        while (end < cues.length && cues[end].endMs - cues[start].startMs <= windowMs) {
            totalChars += cueTextLength(cues[end].text);
            end++;
        }
        if (end - start >= minimumCues && totalChars >= minimumChars) {
            for (let index = start; index < end; index++) rejected.add(index);
            start = end - 1;
        }
    }
    return cues.filter((_, index) => !rejected.has(index));
}

function repairUnreadableCues(cues, minDurationMs = 700, maxChars = 28, maxCps = 22) {
    const result = cues.map(cue => ({ ...cue }));
    for (let index = 0; index < result.length; index++) {
        const cue = result[index];
        const duration = cue.endMs - cue.startMs;
        const targetDuration = Math.max(minDurationMs, Math.ceil(cueTextLength(cue.text) / maxCps * 1000));
        if (duration >= targetDuration) continue;

        const previous = result[index - 1];
        const next = result[index + 1];
        const previousText = previous ? joinCueText(previous.text, cue.text) : '';
        const nextText = next ? joinCueText(cue.text, next.text) : '';
        if (previous && cue.startMs - previous.endMs <= 300 && cueTextLength(previousText) <= maxChars) {
            previous.endMs = cue.endMs;
            previous.text = previousText;
            result.splice(index, 1);
            index = Math.max(-1, index - 2);
            continue;
        }
        if (next && next.startMs - cue.endMs <= 300 && cueTextLength(nextText) <= maxChars) {
            cue.endMs = next.endMs;
            cue.text = nextText;
            result.splice(index + 1, 1);
            index--;
            continue;
        }

        let needed = targetDuration - duration;
        const rightGap = next ? Math.max(0, next.startMs - cue.endMs) : needed;
        const extendRight = Math.min(needed, rightGap);
        cue.endMs += extendRight;
        needed -= extendRight;

        const leftGap = previous ? Math.max(0, cue.startMs - previous.endMs) : Math.min(needed, cue.startMs);
        const extendLeft = Math.min(needed, leftGap);
        cue.startMs -= extendLeft;
        needed -= extendLeft;

        if (needed > 0 && next) {
            const borrow = Math.min(needed, Math.max(0, next.endMs - next.startMs - minDurationMs));
            cue.endMs += borrow;
            next.startMs += borrow;
            needed -= borrow;
        }
        if (needed > 0 && previous) {
            const borrow = Math.min(needed, Math.max(0, previous.endMs - previous.startMs - minDurationMs));
            cue.startMs -= borrow;
            previous.endMs -= borrow;
        }
    }
    return result.filter(cue => cue.text && cue.endMs > cue.startMs);
}

export function normalizeSrtTimeline(srt) {
    if (!srt?.trim()) return '';
    const cues = [];
    for (const block of srt.trim().split(/\n\s*\n/)) {
        const lines = block.trim().split('\n');
        const timeIndex = lines.findIndex(line => line.includes('-->'));
        if (timeIndex < 0) continue;
        const times = lines[timeIndex].split('-->');
        if (times.length !== 2) continue;
        const startMs = parseSrtTime(times[0]);
        const endMs = parseSrtTime(times[1]);
        const text = cleanCueText(lines.slice(timeIndex + 1).join('\n'));
        if (!text || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
        cues.push({ startMs, endMs, text });
    }
    cues.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);

    const normalized = [];
    for (const originalCue of cues) {
        const cue = { ...originalCue };
        const previous = normalized.at(-1);
        if (!previous) {
            normalized.push(cue);
            continue;
        }

        const compactLength = Array.from(cue.text.replace(/\s+/g, '')).length;
        if (compactLength >= 4 && cue.text === previous.text && cue.startMs - previous.endMs <= 500) {
            previous.endMs = Math.max(previous.endMs, cue.endMs);
            continue;
        }

        if (cue.startMs < previous.endMs) {
            const boundary = Math.round((cue.startMs + previous.endMs) / 2);
            if (boundary > previous.startMs && cue.endMs > boundary) {
                previous.endMs = boundary;
                cue.startMs = boundary;
            } else if (cue.endMs > previous.endMs) {
                cue.startMs = previous.endMs;
            } else {
                continue;
            }
        }
        if (cue.endMs > cue.startMs) normalized.push(cue);
    }

    const readable = repairUnreadableCues(removePathologicalCueBursts(normalized));
    return readable.map((cue, index) => [
        index + 1,
        `${formatSrtTime(cue.startMs)} --> ${formatSrtTime(cue.endMs)}`,
        cue.text,
    ].join('\n')).join('\n\n');
}
