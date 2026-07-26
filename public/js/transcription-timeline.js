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
