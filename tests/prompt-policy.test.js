import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildTranscriptionTerminologyInstruction,
    TEXT_GENERATION_SYSTEM_INSTRUCTION,
} from '../public/js/prompt-policy.js';

test('general text generation never receives the terminology dictionary', () => {
    assert.doesNotMatch(TEXT_GENERATION_SYSTEM_INSTRUCTION, /專有名詞|參考字典|必須輸出/);
});

test('transcription terminology is a conditional recognition hint', () => {
    const instruction = buildTranscriptionTerminologyInstruction([
        { type: 'positive', term: '正確專名' },
        { type: 'negative', term: '禁用錯詞' },
    ]);
    assert.match(instruction, /正確專名/);
    assert.match(instruction, /音訊確實出現/);
    assert.match(instruction, /不得因字典存在而加入/);
    assert.match(instruction, /禁用錯詞/);
});
