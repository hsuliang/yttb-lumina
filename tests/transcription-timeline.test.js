import test from 'node:test';
import assert from 'node:assert/strict';
import {
    formatAudioTime,
    normalizeSrtTimeline,
    offsetSrtTimestamps,
    splitPcmByLowEnergy,
    splitPcmChunk,
} from '../public/js/transcription-timeline.js';

test('audio range labels are available to both transcription engines', () => {
    assert.equal(formatAudioTime(0), '00:00:00');
    assert.equal(formatAudioTime(123.6), '00:02:04');
    assert.equal(formatAudioTime(3661), '01:01:01');
});

test('failed 180-second chunks split into exact non-overlapping 90-second ranges', () => {
    const parent = {
        data: new Float32Array(1800),
        sampleRate: 10,
        offsetSeconds: 180,
        durationSeconds: 180,
    };

    const children = splitPcmChunk(parent, 90);

    assert.equal(children.length, 2);
    assert.deepEqual(
        children.map(child => ({
            offsetSeconds: child.offsetSeconds,
            durationSeconds: child.durationSeconds,
        })),
        [
            { offsetSeconds: 180, durationSeconds: 90 },
            { offsetSeconds: 270, durationSeconds: 90 },
        ]
    );
    assert.equal(children[0].offsetSeconds + children[0].durationSeconds, children[1].offsetSeconds);
});

test('the final recovery chunk keeps its shorter duration and absolute offset', () => {
    const parent = {
        data: new Float32Array(1350),
        sampleRate: 10,
        offsetSeconds: 360,
        durationSeconds: 135,
    };

    const children = splitPcmChunk(parent, 90);

    assert.deepEqual(
        children.map(child => ({
            offsetSeconds: child.offsetSeconds,
            durationSeconds: child.durationSeconds,
        })),
        [
            { offsetSeconds: 360, durationSeconds: 90 },
            { offsetSeconds: 450, durationSeconds: 45 },
        ]
    );
});

test('recovery SRT timestamps use each child absolute offset and continuous sequence numbers', () => {
    const localSrt = '1\n00:00:01,250 --> 00:00:03,500\n測試字幕';
    const firstChild = offsetSrtTimestamps(localSrt, 180, 0);
    const secondChild = offsetSrtTimestamps(localSrt, 270, 1);

    assert.match(firstChild, /^1\n00:03:01,250 --> 00:03:03,500/m);
    assert.match(secondChild, /^2\n00:04:31,250 --> 00:04:33,500/m);
});

test('primary PCM chunks choose a nearby low-energy boundary without losing samples', () => {
    const data = new Float32Array(60).fill(1);
    data.fill(0, 18, 22);

    const chunks = splitPcmByLowEnergy(data, 10, 2, 1, 1);

    assert.ok(chunks.length >= 2);
    assert.ok(chunks[0].data.length >= 18 && chunks[0].data.length <= 22);
    assert.equal(chunks[0].offsetSeconds, 0);
    assert.equal(chunks.at(-1).offsetSeconds + chunks.at(-1).durationSeconds, 6);
    assert.equal(chunks.reduce((sum, chunk) => sum + chunk.data.length, 0), data.length);
});

test('final SRT normalization removes overlaps and adjacent duplicate captions', () => {
    const input = [
        '1\n00:00:01,000 --> 00:00:02,000\n第一段',
        '2\n00:00:01,800 --> 00:00:03,000\n第二段內容',
        '3\n00:00:03,200 --> 00:00:04,000\n重複字幕內容',
        '4\n00:00:04,300 --> 00:00:05,000\n重複字幕內容',
    ].join('\n\n');

    const normalized = normalizeSrtTimeline(input);
    assert.match(normalized, /00:00:01,000 --> 00:00:01,900/);
    assert.match(normalized, /00:00:01,900 --> 00:00:03,000/);
    assert.match(normalized, /00:00:03,200 --> 00:00:05,000\n重複字幕內容/);
    assert.doesNotMatch(normalized, /^4$/m);
});

test('final SRT normalization strips embedded timelines and repairs unreadable short cues', () => {
    const input = [
        '1\n00:00:00,000 --> 00:00:00,040\nP00:13.480 --> 00:13.560',
        '2\n00:00:00,040 --> 00:00:00,080\nP',
        '3\n00:00:00,080 --> 00:00:01,000\nT',
    ].join('\n\n');

    const normalized = normalizeSrtTimeline(input);
    assert.match(normalized, /^1\n00:00:00,000 --> 00:00:01,000\nPPT$/m);
    assert.doesNotMatch(normalized, /-->.+-->/);
    assert.doesNotMatch(normalized, /^2$/m);
});

test('final SRT normalization removes impossible dense hallucination bursts', () => {
    const input = [
        '1\n00:00:00,000 --> 00:00:01,000\n前一段正常內容',
        '2\n00:00:01,000 --> 00:00:01,080\n這是不可能在八十毫秒說完的錯誤字幕',
        '3\n00:00:01,080 --> 00:00:01,140\n這也是密集出現的錯誤辨識內容',
        '4\n00:00:01,140 --> 00:00:01,200\n第三段同樣不可能是正常人聲',
        '5\n00:00:01,400 --> 00:00:02,400\n後一段正常內容',
    ].join('\n\n');

    const normalized = normalizeSrtTimeline(input);
    assert.match(normalized, /前一段正常內容/);
    assert.match(normalized, /後一段正常內容/);
    assert.doesNotMatch(normalized, /八十毫秒|密集出現|第三段同樣/);
});

test('final SRT normalization merges a short orphaned tail', () => {
    const input = [
        '1\n00:00:13,774 --> 00:00:18,719\n就是還能上線的老師們真的是太值得值得鼓勵了齁實在是很',
        '2\n00:00:18,719 --> 00:00:19,419\n強這樣',
    ].join('\n\n');
    const normalized = normalizeSrtTimeline(input);

    assert.match(normalized, /00:00:13,774 --> 00:00:19,419/);
    assert.match(normalized, /實在是很強這樣/);
    assert.doesNotMatch(normalized, /^2$/m);
});

test('final SRT normalization splits overlong timing without breaking a domain name', () => {
    const normalized = normalizeSrtTimeline(
        '1\n00:00:00,000 --> 00:00:10,789\n您就輸入lumioclass.com'
    );
    const timelines = [...normalized.matchAll(
        /(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})/g
    )];
    const toMs = values => (((Number(values[0]) * 60 + Number(values[1])) * 60
        + Number(values[2])) * 1000) + Number(values[3]);

    assert.equal(timelines.length, 2);
    assert.ok(timelines.every(match => toMs(match.slice(5)) - toMs(match.slice(1, 5)) <= 6000));
    assert.match(normalized, /^lumioclass\.com$/m);
    assert.doesNotMatch(normalized, /lumioclas\n|^s\.com$/m);
});

test('final SRT normalization keeps the leading music label in one cue', () => {
    const normalized = normalizeSrtTimeline(
        '1\n00:00:00,000 --> 00:00:09,970\n《 字幕君：ㄚ亮笑長的內容助手》 【音樂】'
    );

    assert.equal(normalized.split(/\n\s*\n/).length, 1);
    assert.match(normalized, /00:00:00,000 --> 00:00:09,970/);
    assert.match(normalized, /《 字幕君：ㄚ亮笑長的內容助手》 【音樂】/);
});

test('final SRT normalization limits instantaneous reading speed to 20 characters per second', () => {
    const text = '幫忙一下他 因為 你會發現好 沒有人 給我的';
    const input = [
        '1\n00:00:31,613 --> 00:00:33,620\n為什麼這些圖看起來都不是 ㄟ',
        `2\n00:00:33,620 --> 00:00:34,439\n${text}`,
        '3\n00:00:34,439 --> 00:00:36,590\n這很不AI 喔 有啦 觀察小卡是AI做的',
    ].join('\n\n');
    const normalized = normalizeSrtTimeline(input);
    const block = normalized.split(/\n\s*\n/).find(item => item.includes(text));
    const timeline = block.match(
        /(\d{2}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2}):(\d{2}):(\d{2}),(\d{3})/
    );
    const toMs = values => (((Number(values[0]) * 60 + Number(values[1])) * 60
        + Number(values[2])) * 1000) + Number(values[3]);
    const durationMs = toMs(timeline.slice(5)) - toMs(timeline.slice(1, 5));
    const characters = Array.from(text.replace(/\s/g, '')).length;

    assert.ok(durationMs >= Math.ceil(characters / 20 * 1000));
    assert.match(normalized, /幫忙一下他 因為 你會發現好 沒有人 給我的/);
});
