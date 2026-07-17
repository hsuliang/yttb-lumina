export const TEXT_GENERATION_SYSTEM_INSTRUCTION = '請注意：你必須且只能使用「繁體中文（台灣）」進行回覆，絕對不可以使用簡體中文。所有事實、人名、機構、數字與事件必須以使用者本次提供的來源內容為準；來源未提供的資訊不得自行補寫。';

export function buildTranscriptionTerminologyInstruction(rules = []) {
    const positiveTerms = rules.filter(rule => rule.type === 'positive').map(rule => rule.term).filter(Boolean);
    const negativeTerms = rules.filter(rule => rule.type === 'negative').map(rule => rule.term).filter(Boolean);
    let instruction = '';

    if (positiveTerms.length > 0) {
        instruction += `\n以下詞彙是語音辨識參考字典：${positiveTerms.join(', ')}。只有在音訊確實出現相符發音或語意時才使用正確寫法，不得因字典存在而加入音訊未提及的詞彙。`;
    }
    if (negativeTerms.length > 0) {
        instruction += `\n語音辨識結果不得使用以下禁用詞彙：${negativeTerms.join(', ')}。`;
    }
    return instruction;
}
