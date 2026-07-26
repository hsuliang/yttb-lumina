import test from 'node:test';
import assert from 'node:assert/strict';
import { offsetSrtTimestamps, splitPcmChunk } from '../public/js/transcription-timeline.js';

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
