const fs = require('fs');
let content = fs.readFileSync('public/js/tab0-transcribe.js', 'utf8');

// Update buildTranscriptionPrompt
const oldBuildPrompt = `function buildTranscriptionPrompt(language) {
    const langHint = language === 'auto' ? '自動偵測語言' :
                     language === 'zh' ? '中文（繁體）' :
                     language === 'en' ? 'English' :
                     language === 'ja' ? '日本語' : '自動偵測語言';

    return \`請將以下音訊內容轉寫為標準 SRT 字幕格式。

嚴格要求：
1. 語言偏好：\${langHint}`;

const newBuildPrompt = `function buildTranscriptionPrompt(language, customDict) {
    const langHint = language === 'auto' ? '自動偵測語言' :
                     language === 'zh' ? '中文（繁體）' :
                     language === 'en' ? 'English' :
                     language === 'ja' ? '日本語' : '自動偵測語言';

    let dictInstruction = '';
    if (customDict) {
        dictInstruction = \`\\n\\n特別要求：\\n請嚴格遵守以下專有名詞，當遇到聽起來類似的詞彙時，必須輸出以下指定的正向詞彙：\\n\${customDict}\`;
    }

    return \`請將以下音訊內容轉寫為標準 SRT 字幕格式。\${dictInstruction}

嚴格要求：
1. 語言偏好：\${langHint}`;

content = content.replace(oldBuildPrompt, newBuildPrompt);

// Update transcribeWithGemini
const oldTranscribeG = `async function transcribeWithGemini(file, language) {`;
const newTranscribeG = `async function transcribeWithGemini(file, language, customDict) {`;
content = content.replace(oldTranscribeG, newTranscribeG);

// Update prompt building inside transcribeWithGemini
const oldPromptBuild = `const prompt = buildTranscriptionPrompt(language);`;
const newPromptBuild = `const prompt = buildTranscriptionPrompt(language, customDict);`;
content = content.replace(oldPromptBuild, newPromptBuild);

// Now update the button logic that calls these
const startBtnLogicOld = `                    if (state.transcribeEngine === 'whisper') {
                        // Whisper：靜態模式（進度由 handleWhisperProgress 控制）
                        startProgressMessages(true);
                        if (progressMessage) progressMessage.textContent = '正在準備音訊...';
                        let customDictVal = '';
                        if (state.batchReplaceRules && state.batchReplaceRules.length > 0) {
                            customDictVal = '強制替換：\\n' + state.batchReplaceRules.map(r => \`\${r.original}=\${r.replacement}\`).join('\\n');
                        }
                        result = await transcribeWithWhisper(
                            selectedFile,
                            state.transcribeLanguage,
                            customDictVal,
                            handleWhisperProgress
                        );
                    } else {
                        // Gemini：循環提示訊息與進度條
                        const estSec = selectedFile ? selectedFile.size / 16000 : 60;
                        startProgressMessages(false, estSec);
                        result = await transcribeWithGemini(selectedFile, state.transcribeLanguage);
                    }`;

const startBtnLogicNew = `                    // 準備專有名詞 (只取 Positive)
                    let terminologyDict = '';
                    if (state.aiTerminologyRules && state.aiTerminologyRules.length > 0) {
                        const positiveTerms = state.aiTerminologyRules.filter(r => r.type === 'positive').map(r => r.term);
                        if (positiveTerms.length > 0) {
                            terminologyDict = positiveTerms.join(', ');
                        }
                    }

                    if (state.transcribeEngine === 'whisper') {
                        // Whisper：靜態模式（進度由 handleWhisperProgress 控制）
                        startProgressMessages(true);
                        if (progressMessage) progressMessage.textContent = '正在準備音訊...';
                        
                        // Whisper 結合了強制替換和專有名詞 (因為 whisper 的 prompt 主要用來給定語境詞彙)
                        let whisperPrompt = terminologyDict;
                        if (state.batchReplaceRules && state.batchReplaceRules.length > 0) {
                            const replaceDict = '強制替換：\\n' + state.batchReplaceRules.map(r => \`\${r.original}=\${r.replacement}\`).join('\\n');
                            whisperPrompt = whisperPrompt ? whisperPrompt + '\\n' + replaceDict : replaceDict;
                        }

                        result = await transcribeWithWhisper(
                            selectedFile,
                            state.transcribeLanguage,
                            whisperPrompt,
                            handleWhisperProgress
                        );
                    } else {
                        // Gemini：循環提示訊息與進度條
                        const estSec = selectedFile ? selectedFile.size / 16000 : 60;
                        startProgressMessages(false, estSec);
                        result = await transcribeWithGemini(selectedFile, state.transcribeLanguage, terminologyDict);
                    }`;

content = content.replace(startBtnLogicOld, startBtnLogicNew);

const confirmSettingsOld = `            showModal({
                title: '確認開始辨識',
                message: '是否需要設定「專有名詞 / 錯字替換」？\\n如果您已經設定過或不需要，請點擊「直接開始」。',
                buttons: [
                    { text: '前往設定', class: 'btn-secondary', callback: () => {
                        hideModal();
                        if (showGlobalSettingsModal) showGlobalSettingsModal('settings-tab-dict');
                    }},
                    { text: '直接開始', class: 'btn-primary', callback: () => {
                        hideModal();
                        confirmDictAndStart();
                    }}
                ]
            });`;

const confirmSettingsNew = `            showModal({
                title: '確認開始辨識',
                message: '是否需要設定「專有名詞」或「錯字替換」？\\n(這些設定能大幅提升辨識準確度)\\n如果您已經設定過或不需要，請點擊「直接開始」。',
                buttons: [
                    { text: '設定錯字', class: 'btn-secondary', callback: () => {
                        hideModal();
                        if (showGlobalSettingsModal) showGlobalSettingsModal('settings-tab-typo');
                    }},
                    { text: '設定專有名詞', class: 'btn-secondary', callback: () => {
                        hideModal();
                        if (showGlobalSettingsModal) showGlobalSettingsModal('settings-tab-terminology');
                    }},
                    { text: '直接開始', class: 'btn-primary', callback: () => {
                        hideModal();
                        confirmDictAndStart();
                    }}
                ]
            });`;

content = content.replace(confirmSettingsOld, confirmSettingsNew);

fs.writeFileSync('public/js/tab0-transcribe.js', content);
console.log('tab0 updated successfully');
