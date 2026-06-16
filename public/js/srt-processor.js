/**
 * srt-processor.js
 * 核心字幕處理邏輯，所有函式都是純函式，不操作 DOM。
 */

function timeToMs(time) {
    const parts = time.split(/[:,]/);
    if (parts.length !== 4) return 0;
    return parseInt(parts[0]) * 3600000 + parseInt(parts[1]) * 60000 + parseInt(parts[2]) * 1000 + parseInt(parts[3]);
}

function msToTime(ms) {
    if (isNaN(ms)) ms = 0;
    const hours = Math.floor(ms / 3600000);
    ms %= 3600000;
    const minutes = Math.floor(ms / 60000);
    ms %= 60000;
    const seconds = Math.floor(ms / 1000);
    const milliseconds = ms % 1000;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

function parseSrt(srtContent) {
    const blocks = srtContent.trim().replace(/\r\n/g, '\n').split(/\n\n/);
    const subtitles = [];
    for (const block of blocks) {
        const lines = block.trim().split('\n');
        if (lines.length < 1) continue;
        
        let timeLineIndex = lines.findIndex(line => line.includes('-->'));
        if (timeLineIndex === -1) continue;

        const timeMatch = lines[timeLineIndex].match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
        if (!timeMatch) continue;

        const text = lines.slice(timeLineIndex + 1).join('\n');
        
        subtitles.push({
            index: subtitles.length + 1,
            startTime: timeMatch[1],
            endTime: timeMatch[2],
            startMs: timeToMs(timeMatch[1]),
            endMs: timeToMs(timeMatch[2]),
            text,
        });
    }
    return subtitles;
}

function stringifySrt(subtitles) {
    return subtitles.map((sub, i) => {
        return `${i + 1}\n${msToTime(sub.startMs)} --> ${msToTime(sub.endMs)}\n${sub.text}`;
    }).join('\n\n');
}

window.processSubtitles = function(srtContent, options) {
    const { maxCharsPerLine, keepPunctuation, fixTimestamps, timestampThreshold, batchReplaceRules, mergeShortLinesThreshold, timelineShift } = options;
    let report = { fixedGaps: 0, fixedOverlaps: 0, linesSplit: 0, linesMerged: 0, replacementsMade: 0, timelineShifted: 0 };
    let isPlainText = false;

    if (!srtContent.includes('-->')) {
        isPlainText = true;
        srtContent = srtContent.trim().split(/\n+/).map((line, index) => {
            const start = msToTime(index * 5000);
            const end = msToTime(index * 5000 + 4000);
            return `${index + 1}\n${start} --> ${end}\n${line}`;
        }).join('\n\n');
    }
    
    let subs = parseSrt(srtContent);
    const originalLineCount = subs.length;

    if (timelineShift && !isNaN(timelineShift) && timelineShift !== 0) {
        report.timelineShifted = timelineShift;
        subs.forEach(sub => {
            sub.startMs += timelineShift;
            sub.endMs += timelineShift;
            if (sub.startMs < 0) sub.startMs = 0;
            if (sub.endMs < 0) sub.endMs = 0;
        });
    }

    if (batchReplaceRules.length > 0) {
        subs.forEach(sub => {
            for (const rule of batchReplaceRules) {
                if (rule.original) {
                    const regex = new RegExp(rule.original, 'g');
                    const matches = sub.text.match(regex);
                    if(matches) {
                        report.replacementsMade += matches.length;
                    }
                    sub.text = sub.text.replace(regex, rule.replacement);
                }
            }
        });
    }

    const punctuationRegex = /[.,\/#!$%\^&\*;:{}=\-_`~?，。？！、；：]/g;
    if (!keepPunctuation) {
        subs.forEach(sub => {
            sub.text = sub.text.replace(punctuationRegex, '');
        });
    }

    let mergedSubs = [];
    if (subs.length > 0) {
        mergedSubs.push(subs[0]);
        for (let i = 1; i < subs.length; i++) {
            let last = mergedSubs[mergedSubs.length - 1];
            let current = subs[i];
            if (mergeShortLinesThreshold > 0 && last.text.trim().length > 0 && last.text.trim().length <= mergeShortLinesThreshold) {
                last.text = `${last.text.trim()} ${current.text.trim()}`;
                last.endMs = current.endMs;
                report.linesMerged++;
            } else {
                mergedSubs.push(current);
            }
        }
    }
    subs = mergedSubs;
    
    let newSubs = [];
    subs.forEach(sub => {
        if (sub.text.length <= maxCharsPerLine) {
            newSubs.push(sub);
            return;
        }
        report.linesSplit++;
        const duration = sub.endMs - sub.startMs;
        const text = sub.text;
        let lines = [];
        const words = text.split(/(\s+)/);
        if (words.length === 1 && words[0].length > maxCharsPerLine) {
            let remainingText = words[0];
            while (remainingText.length > 0) {
                lines.push(remainingText.substring(0, maxCharsPerLine));
                remainingText = remainingText.substring(maxCharsPerLine);
            }
        } else {
            let currentLine = '';
            for (const word of words) {
                if (currentLine.length > 0 && currentLine.length + word.length > maxCharsPerLine) {
                    lines.push(currentLine.trim());
                    currentLine = word;
                } else {
                    currentLine += word;
                }
            }
            lines.push(currentLine.trim());
        }
        const totalLength = lines.reduce((sum, line) => sum + line.length, 0) || 1;
        let timeOffset = sub.startMs;
        for (const line of lines) {
            if (line.length === 0) continue;
            const lineDuration = Math.max(1, Math.round(duration * (line.length / totalLength)));
            newSubs.push({ ...sub, text: line, startMs: timeOffset, endMs: timeOffset + lineDuration });
            timeOffset += lineDuration;
        }
    });
    subs = newSubs;
    
    subs.forEach(sub => {
        while (sub.text.match(/^[.,\/#!$%\^&\*;:{}=\-_`~?，。？！、；：]/) ) {
            sub.text = sub.text.substring(1).trim();
        }
    });

    if (fixTimestamps && !isPlainText) {
        for (let i = 0; i < subs.length - 1; i++) {
            let current = subs[i];
            let next = subs[i + 1];
            if (current.endMs > next.startMs) {
                report.fixedOverlaps++;
                const midPoint = Math.round((current.endMs + next.startMs) / 2);
                current.endMs = midPoint;
                next.startMs = midPoint;
            }
            const gap = next.startMs - current.endMs;
            if (gap > 0 && gap <= timestampThreshold) {
                report.fixedGaps++;
                next.startMs = current.endMs;
            }
        }
    }
    const finalSrt = stringifySrt(subs);
    
    report.originalLineCount = originalLineCount;
    report.finalLineCount = subs.length;
    
    return { processedSrt: finalSrt, report: report };
}