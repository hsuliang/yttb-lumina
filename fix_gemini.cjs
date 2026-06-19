const fs = require('fs');
let content = fs.readFileSync('public/js/gemini-api.js', 'utf8');

const systemInstructionLogic = `
                let terminologyInstruction = '';
                if (state.aiTerminologyRules && state.aiTerminologyRules.length > 0) {
                    const positiveTerms = state.aiTerminologyRules.filter(r => r.type === 'positive').map(r => r.term);
                    const negativeTerms = state.aiTerminologyRules.filter(r => r.type === 'negative').map(r => r.term);
                    
                    if (positiveTerms.length > 0) {
                        terminologyInstruction += \`\\n請嚴格遵守以下專有名詞，必須輸出這些指定的正向詞彙：\${positiveTerms.join(', ')}。\`;
                    }
                    if (negativeTerms.length > 0) {
                        terminologyInstruction += \`\\n絕對禁用以下詞彙（或類似翻譯）：\${negativeTerms.join(', ')}。\`;
                    }
                }
`;

// Replace in callGeminiAPI
const oldSysInstAPI = `                const systemInstruction = {
                    role: "system",
                    parts: [{ text: "請注意：你必須且只能使用「繁體中文（台灣）」進行回覆，絕對不可以使用簡體中文。"}]
                };`;
const newSysInstAPI = systemInstructionLogic + `
                const systemInstruction = {
                    role: "system",
                    parts: [{ text: "請注意：你必須且只能使用「繁體中文（台灣）」進行回覆，絕對不可以使用簡體中文。" + terminologyInstruction }]
                };`;
content = content.replace(oldSysInstAPI, newSysInstAPI);

// Replace in callGeminiAudioAPI
const oldSysInstAudio = `                const systemInstruction = {
                    role: "system",
                    parts: [{ text: "你是一個專業的語音轉寫員。你必須且只能使用「繁體中文（台灣）」進行回覆，絕對不可以使用簡體中文。請嚴格遵守使用者要求的輸出格式。" }]
                };`;
const newSysInstAudio = systemInstructionLogic + `
                const systemInstruction = {
                    role: "system",
                    parts: [{ text: "你是一個專業的語音轉寫員。你必須且只能使用「繁體中文（台灣）」進行回覆，絕對不可以使用簡體中文。請嚴格遵守使用者要求的輸出格式。" + terminologyInstruction }]
                };`;
content = content.replace(oldSysInstAudio, newSysInstAudio);

fs.writeFileSync('public/js/gemini-api.js', content);
console.log('gemini-api.js updated successfully');
