import { processSubtitles } from './srt-processor.js';
import { showToast, showModal, hideModal, stopPromptRotation, saveFile } from './ui-components.js';
import { callGeminiAPI } from './gemini-api.js';
import { state } from './state.js';
import { activateSource, getCanonicalTranscript, isCurrentSource } from './content-source.js';
import { updateAiButtonStatus, getBalancedApiKey, hasTextAIEnabled, showGlobalSettingsModal, updateTabAvailability, switchTab, renderReplaceRules } from './app.js';
import { extractTopicTitleSuggestions, validateTopicTitleSuggestion } from './topic-title-validator.js';

/**
 * tab1-srt.js
 * 負責管理第一分頁「字幕整理與優化」的所有 UI 互動與邏輯。
 */

// --- 元素選擇 (模組級) ---
const generateChaptersBtn = document.getElementById('generate-chapters-btn');
const generateSummaryBtn = document.getElementById('generate-summary-btn');
const generateTopicTitleBtn = document.getElementById('generate-topic-title-btn');
const smartAreaContainer = document.getElementById('smart-area-container');
const smartArea = document.getElementById('smart-area');
const displayOriginal = document.getElementById('display-original');
const displayProcessed = document.getElementById('display-processed');
const fileInput = document.getElementById('file-input');
const maxCharsSlider = document.getElementById('max-chars-per-line');
const maxCharsValue = document.getElementById('max-chars-value');
const mergeShortLinesSlider = document.getElementById('merge-short-lines-threshold');
const mergeShortLinesValue = document.getElementById('merge-short-lines-value');
const keepPunctuationCheckbox = document.getElementById('keep-punctuation');
const fixTimestampsCheckbox = document.getElementById('fix-timestamps');
const timestampThresholdInput = document.getElementById('timestamp-threshold');
const processSrtBtn = document.getElementById('process-srt-btn');
const exportSrtBtn = document.getElementById('export-srt-btn');
const timelineShiftInput = document.getElementById('timeline-shift');
const timelineShiftValue = document.getElementById('timeline-shift-value');
const timestampThresholdValue = document.getElementById('timestamp-threshold-value');

// [第二階段優化] - 新增返回編輯按鈕的選擇器
const returnToEditBtn = document.getElementById('return-to-edit-btn');
// [第三階段優化] - 新增字幕教學面板選擇器
const toggleSubtitleHelpBtn = document.getElementById('toggle-subtitle-help-btn');
const subtitleHelpPanel = document.getElementById('subtitle-help-panel');
// [Tab 1 Empty State]
const tab1EmptyState = document.getElementById('tab1-empty-state');




// --- 輔助函式 (模組級) ---
function toggleEmptyState() {
    if (!smartArea || !tab1EmptyState) return;
    const hasContent = smartArea.value.length > 0;
    if (hasContent) {
        tab1EmptyState.classList.add('hidden');
    } else {
        tab1EmptyState.classList.remove('hidden');
    }
}

function updateCharCount(text = '') {
    const count = text.length;
    const display = document.getElementById('char-count-display');
    if (display) {
        display.textContent = `字數: ${count}`;
    }
}

function renderTopicTitle(text = '') {
    const container = document.getElementById('display-topic-title');
    if (!container) return;

    const fragment = document.createDocumentFragment();
    let cursor = 0;

    while (cursor < text.length) {
        const boldStart = text.indexOf('**', cursor);
        if (boldStart === -1) {
            fragment.appendChild(document.createTextNode(text.slice(cursor)));
            break;
        }

        fragment.appendChild(document.createTextNode(text.slice(cursor, boldStart)));
        const boldEnd = text.indexOf('**', boldStart + 2);
        if (boldEnd === -1) {
            fragment.appendChild(document.createTextNode(text.slice(boldStart + 2)));
            break;
        }

        const strong = document.createElement('strong');
        strong.textContent = text.slice(boldStart + 2, boldEnd);
        fragment.appendChild(strong);
        cursor = boldEnd + 2;
    }

    container.replaceChildren(fragment);
}

function setAiOutputText(type, text = '') {
    const output = document.getElementById(`display-${type}`);
    if (!output) return;
    if (type === 'topic-title') {
        renderTopicTitle(text);
    } else {
        output.value = text;
    }
}

function getAiOutputText(type) {
    const output = document.getElementById(`display-${type}`);
    if (!output) return '';
    return type === 'topic-title' ? output.textContent : output.value;
}

function buildTopicTitleRepairPrompt(basePrompt, previousResult, violations) {
    return `${basePrompt}

【修正任務】
上一版輸出未完全符合硬性規格，請完整重寫全部內容，不要只列出修改片段，也不要提及修正過程。

必須修正的問題：
${violations.map(item => `- ${item}`).join('\n')}

再次確認：方案 A、B、C 各須包含「正選、備選一、備選二」三組完整配對，共 9 組。每個主標題必須在 10 字以內，可以短於 10 字；每個副標題必須介於 15 至 20 字。不可用程式式截斷破壞語意，請重新命名並在輸出前逐字計數。

【上一版輸出】
${previousResult}
【上一版輸出結束】`;
}

function setMode(mode) {
    const viewToggleHeader = document.getElementById('view-toggle-header');
    if (mode === 'input') {
        viewToggleHeader.classList.add('hidden');
        smartArea.classList.remove('hidden');
        displayOriginal.classList.add('hidden');
        displayProcessed.classList.add('hidden');
        const displayTopicTitle = document.getElementById('display-topic-title');
        const displaySummary = document.getElementById('display-summary');
        const displayChapters = document.getElementById('display-chapters');
        if (displayTopicTitle) displayTopicTitle.classList.add('hidden');
        if (displaySummary) displaySummary.classList.add('hidden');
        if (displayChapters) displayChapters.classList.add('hidden');
        updateCharCount(smartArea.value);
        toggleEmptyState();
    } else if (mode === 'preview') {
        viewToggleHeader.classList.remove('hidden');
        smartArea.classList.add('hidden');
        if (tab1EmptyState) tab1EmptyState.classList.add('hidden');
    }
}



// [第二階段優化] - 新增返回編輯模式的函式
function returnToEditMode() {
    setMode('input');
    if (state.originalContentForPreview) {
        smartArea.value = state.originalContentForPreview;
    }
    smartArea.dispatchEvent(new Event('input')); // 觸發 input 事件以更新UI
    smartArea.focus();
}

// --- 清除函式 ---
function resetTab1() {
    document.getElementById('view-toggle-header').classList.add('hidden');
    displayOriginal.classList.add('hidden');
    displayProcessed.classList.add('hidden');
    smartArea.value = '';
    smartArea.classList.remove('hidden');
    state.originalContentForPreview = '';
    state.processedSrtResult = '';
    state.originalFileName = '';
    exportSrtBtn.disabled = true;
    // 注意：不清空 state.batchReplaceRules，因為它是全域設定，不應被 Tab1 重置影響
    if (renderReplaceRules) renderReplaceRules();
    updateCharCount();
    toggleEmptyState();
}

// --- 初始化函式 ---
    // --- 函式定義 ---
    async function handleAiFeature(type) {
        const apiKey = getBalancedApiKey ? getBalancedApiKey() : (localStorage.getItem('geminiApiKey') || sessionStorage.getItem('geminiApiKey'));
        // ########## FIX END ##########

        if (!state.currentSourceId && smartArea.value.trim()) activateSource(smartArea.value);
        const requestSourceId = state.currentSourceId;
        const content = getCanonicalTranscript(smartArea.value);
        if (!content) {
            showModal({ title: '錯誤', message: '沒有可用於 AI 處理的字幕內容。' });
            return;
        }

        if (type === 'topic-title') {
            state.topicTitleSuggestions = [];
            state.topicTitleSuggestionsSourceId = '';
            window.dispatchEvent(new CustomEvent('lumina:topicTitleSuggestionsCleared'));
        }

        if (state.currentAbortController) {
            state.currentAbortController.abort();
            state.currentAbortController = null;
            return;
        }
        state.currentAbortController = new AbortController();

        const btn = type === 'chapters'
            ? generateChaptersBtn
            : type === 'topic-title'
                ? generateTopicTitleBtn
                : generateSummaryBtn;
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<span class="material-symbols-outlined text-[18px]">close</span>中斷生成';
        btn.classList.add('bg-error/10', 'text-error', 'border-error/20');
        // btn.disabled = true; // allow abort
        // btn.classList.add('btn-loading');

        // Switch to the appropriate tab immediately
        if (!state.originalContentForPreview && smartArea.value.trim()) {
            state.originalContentForPreview = smartArea.value.trim();
            displayOriginal.textContent = formatSrtForDisplay(state.originalContentForPreview, '');
        }
        setMode('preview');
        switchView(type);
        const targetOutput = document.getElementById(`display-${type}`);
        if (targetOutput) {
            setAiOutputText(type, '');
            targetOutput.classList.add('text-center', 'animate-pulse');
            targetOutput.style.color = '#f97316';
            targetOutput.style.fontSize = '1.1rem';
            targetOutput.style.fontWeight = '600';
        }

        let prompt;
        if (type === 'topic-title') {
            prompt = `你是一位專業的節目內容策展人與標題創意總監。請根據以下影片逐字稿，先萃取內容靈魂，再設計 3 套切入角度明確、可直接採用的爆款主副標題。每套方案必須提供 1 組正選與 2 組備選，共 9 組完整的主標題＋副標題配對。

內容分析原則：
1. 實用需求層：找出受眾的焦慮、麻煩或教學／生活痛點，以及逐字稿提供的具體解方或顛覆認知的做法。
2. 認知衝擊層：找出刻板印象與真實行動／結果之間的反差、衝突、荒謬情節、祕辛或戲劇張力。
3. 情感共鳴層：找出最具爭議、幽默、啟發性或直擊日常感受的真實金句與故事。

主副標題設定原則：
- 主標題負責錨定受眾與製造視覺衝擊，可以使用核心衝突、痛點提問、危機、反差情境或有力金句。
- 【硬性字數】每個主標題最多 10 字，可以短於 10 字；必須短而鮮明、具體、有記憶點並適合視覺呈現。
- 【硬性字數】每個副標題必須介於 15 至 20 字（含 15 與 20 字）；以一個精煉完整句為原則，只說明主標題未交代的內容、懸念與觀看價值。
- 計算字數時，每個中文字、英文字母、數字與內容中的標點符號都算 1 字。主副標題外層不要加「」、【】或其他括號，也不要輸出字數註記。
- 不可先寫一條很長的標題再從中間切成主副標題。主標題必須是可獨立成立的吸睛鉤子；副標題必須是可獨立閱讀、用來解釋主標題的完整補充，且不可重複主標題用詞或堆疊過多資訊。
- 套用公式：【主標題：核心衝突／痛點提問】＋【副標題：懸念反差／終極解方】。
- 三套方案必須真正採用不同切入點，不可只替換少數形容詞。同一方案中的正選、備選一、備選二也必須使用不同的事實鉤子或微切角，九組主標題與九組副標題皆不可重複。
- 輸出前請在內部逐字計算全部 9 個主標題與 9 個副標題；任何一項不符合字數時，先重新命名再輸出，不要展示計算或修改過程。
- 所有人名、機構、數字、事件、引言、遊戲名稱與觀點只能取自逐字稿；不得虛構、誇大或加入逐字稿沒有的權威身分。
- 必須以繁體中文撰寫，不要輸出分析清單、前言、結語或 Markdown 程式碼區塊，直接依照下列格式輸出完整內容。

請嚴格依照以下格式輸出：
**爆款主題命名建議（主副標題設定）**
依據逐字稿萃取出的內容靈魂，我為您設計了 3 種不同切入點的爆款標題：

**💡 方案 A：主打「認知衝擊」（適合吸引喜歡獵奇、反差與破解祕辛的受眾）**
**正選**
**主標題**：主標題內容
**副標題**：副標題內容
**備選一**
**主標題**：主標題內容
**副標題**：副標題內容
**備選二**
**主標題**：主標題內容
**副標題**：副標題內容
**設計概念**：用 2 至 3 句具體說明三組標題分別採用了逐字稿中的哪些衝突、反差、事件或金句，以及它們如何從不同微切角引發點擊動機。

**💡 方案 B：主打「實用需求」（適合重視具體解方、希望解決痛點的受眾）**
**正選**
**主標題**：主標題內容
**副標題**：副標題內容
**備選一**
**主標題**：主標題內容
**副標題**：副標題內容
**備選二**
**主標題**：主標題內容
**副標題**：副標題內容
**設計概念**：用 2 至 3 句具體說明三組標題分別鎖定了什麼受眾痛點、逐字稿提供什麼解方，以及它們如何從不同微切角建立觀看承諾。

**💡 方案 C：主打「情感共鳴」（適合重視陪伴、成長、品格或真實人生感受的受眾）**
**正選**
**主標題**：主標題內容
**副標題**：副標題內容
**備選一**
**主標題**：主標題內容
**副標題**：副標題內容
**備選二**
**主標題**：主標題內容
**副標題**：副標題內容
**設計概念**：用 2 至 3 句具體說明三組標題分別採用了逐字稿中的哪些情緒、金句或人生體悟，以及它們如何從不同微切角讓目標受眾產生共鳴。

逐字稿如下：
---
${content}
---`;
        } else if (type === 'summary') {
            prompt = `你是一位專業的節目內容策展人。請根據以下影片逐字稿，撰寫可直接放入 YouTube 資訊欄的 Show Notes。內容必須清晰緊湊、專業且帶有懸念，讓觀眾一眼看出本集價值，並兼顧自然的搜尋關鍵字。

請嚴格依照以下結構輸出：
1. 標題：以「【內容代號／集數】：【核心主題／來賓】＋【懸念副標題】！」為方向；逐字稿沒有內容代號、集數或來賓時，省略缺少的項目，不得虛構。
2. 節目介紹：先用問題點出受眾痛點，再介紹來賓或核心主題，最後說明本集最大價值並保留懸念。
3. 本集精彩亮點：挑選 3-5 個最有價值的重點，每點使用「📍 【亮點短標題】：一句話說明該亮點帶來的解方、反差或啟發」格式。
4. 收聽與互動：呼籲觀眾訂閱、按讚或分享，並拋出一個與本集主題直接相關、適合留言回答的問題。

其他要求：
- 必須以繁體中文撰寫，直接輸出完整 Show Notes，不要加入前言或說明。
- 優先呈現受眾痛點、具體解方、反差觀點或逐字稿中的有力金句，避免流水帳摘要。
- 所有人名、機構、數字、事件、引言與觀點只能取自逐字稿；未提供的資訊必須省略，不得自行補寫。

逐字稿如下：
---
${content}
---`;
        } else {
            prompt = `你是一位專業的影片編輯。請根據以下的影片逐字稿，幫我抓出這支影片的 YouTube 章節時間軸 (Timestamps)。\n要求：\n1. 判斷話題轉換的時間點。\n2. 章節標題要簡短、吸引人，並以繁體中文撰寫。\n3. 格式必須為嚴格的 "MM:SS 章節標題" 或 "HH:MM:SS 章節標題"，分鐘和秒數必須補零（例如 00:14、01:05、10:24）。\n4. 絕對禁止輸出任何開場白、問候語或前導詞，請直接輸出時間軸內容。\n\n【正確格式範例】\n00:00 影片開始\n01:14 葉子生長與陽光\n10:05 重點整理\n\n逐字稿如下：\n---\n${content}\n---`;
        }

        let latestCompleteResult = '';
        try {
            const streamOutput = async generationPrompt => {
                let isFirstChunk = true;
                return callGeminiAPI(apiKey, generationPrompt, false, (chunkText, fullText) => {
                    if (!isCurrentSource(requestSourceId)) return;
                    if (targetOutput) {
                        if (isFirstChunk && chunkText !== '') {
                            isFirstChunk = false;
                            targetOutput.classList.remove('text-center', 'animate-pulse');
                            targetOutput.style.color = '';
                            targetOutput.style.fontSize = '';
                            targetOutput.style.fontWeight = '';
                        }
                        let displayText = fullText;
                        if (type === 'chapters') {
                            // 修正 Qwen 可能出現的不規範時間格式 (例如 ": 標題", ":44 標題", "1:5 標題")
                            displayText = displayText.replace(/^:\s*(.+)$/gm, '00:00 $1');
                            displayText = displayText.replace(/^(\d{0,2}):(\d{1,2})\s+(.+)$/gm, (match, m, s, title) => {
                                const mins = m ? m.padStart(2, '0') : '00';
                                const secs = s ? s.padStart(2, '0') : '00';
                                return `${mins}:${secs} ${title}`;
                            });
                        }
                        setAiOutputText(type, displayText);
                        targetOutput.scrollTop = targetOutput.scrollHeight;
                        updateCharCount(getAiOutputText(type));
                    }
                }, state.currentAbortController.signal);
            };

            let result = await streamOutput(prompt);
            if (!isCurrentSource(requestSourceId)) return;
            latestCompleteResult = result;

            if (type === 'topic-title') {
                const validation = validateTopicTitleSuggestion(result);
                if (!validation.valid) {
                    console.warn('爆款主題格式或字數不符合規格，正在自動修正一次：', validation.violations);
                    if (targetOutput) {
                        setAiOutputText(type, '正在調整主副標題的字數與配對...');
                        targetOutput.classList.add('text-center', 'animate-pulse');
                        targetOutput.style.color = '#f97316';
                        targetOutput.style.fontSize = '1.1rem';
                        targetOutput.style.fontWeight = '600';
                    }

                    const repairPrompt = buildTopicTitleRepairPrompt(prompt, result, validation.violations);
                    result = await streamOutput(repairPrompt);
                    if (!isCurrentSource(requestSourceId)) return;
                    latestCompleteResult = result;

                    const repairedValidation = validateTopicTitleSuggestion(result);
                    if (!repairedValidation.valid) {
                        console.warn('爆款主題自動修正後仍有格式或字數不符：', repairedValidation.violations);
                    }
                }
            }

            if (type === 'topic-title') {
                const suggestions = extractTopicTitleSuggestions(result);
                state.topicTitleSuggestions = suggestions;
                state.topicTitleSuggestionsSourceId = suggestions.length ? requestSourceId : '';
                window.dispatchEvent(new CustomEvent('lumina:topicTitleSuggestionsReady', {
                    detail: { sourceId: requestSourceId, suggestions },
                }));
            }

            if (targetOutput) updateCharCount(getAiOutputText(type));
            // showModal({ title: successTitle, message: result, showCopyButton: true }); // Remove modal
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('生成已中斷');
                if (targetOutput) {
                    targetOutput.classList.remove('text-center', 'animate-pulse');
                    targetOutput.style.color = '';
                    targetOutput.style.fontSize = '';
                    targetOutput.style.fontWeight = '';
                    setAiOutputText(type, '生成已中斷。');
                }
                return;
            }
            if (type === 'topic-title' && latestCompleteResult && targetOutput) {
                targetOutput.classList.remove('text-center', 'animate-pulse');
                targetOutput.style.color = '';
                targetOutput.style.fontSize = '';
                targetOutput.style.fontWeight = '';
                setAiOutputText(type, latestCompleteResult);
            }
            if (error.message && error.message.includes('overloaded')) {
                showModal({ 
                    title: 'AI 正在尖峰時段，請稍候！', 
                    message: `別擔心，這不是您的程式或 API Key 有問題。

這代表 Gemini AI 模型目前正處於全球使用的高峰期，就像一位超級名廚的廚房突然湧入了大量訂單一樣。

建議您稍等一兩分鐘後，再點擊一次「生成」按鈕即可。

感謝您的耐心！`
                });
            } else {
                showModal({ title: '錯誤', message: error.message || String(error) });
            }
        } finally {
            state.currentAbortController = null;
            btn.disabled = false;
            btn.classList.remove('btn-loading', 'bg-error/10', 'text-error', 'border-error/20');
            btn.innerHTML = originalHtml;
        }
    }

    function switchView(viewToShow) {
        console.log("[switchView] Switching view to:", viewToShow);
        const buttons = document.querySelectorAll('.view-btn');
        buttons.forEach(btn => btn.classList.remove('active'));
        const activeBtn = document.querySelector(`.view-btn[data-view="${viewToShow}"]`);
        if (activeBtn) {
            activeBtn.classList.add('active');
        }

        // Hide all views first
        const displayOriginal = document.getElementById('display-original');
        const displayProcessed = document.getElementById('display-processed');
        const displayTopicTitle = document.getElementById('display-topic-title');
        const displaySummary = document.getElementById('display-summary');
        const displayChapters = document.getElementById('display-chapters');
        
        [displayOriginal, displayProcessed, displayTopicTitle, displaySummary, displayChapters].forEach(el => {
            if (el) el.classList.add('hidden');
        });

        const tab1AiActions = document.getElementById('tab1-ai-actions');
        if (tab1AiActions) {
            if (viewToShow === 'topic-title' || viewToShow === 'summary' || viewToShow === 'chapters') {
                tab1AiActions.classList.remove('hidden');
            } else {
                tab1AiActions.classList.add('hidden');
            }
        }

        if (viewToShow === 'original') {
            displayOriginal.classList.remove('hidden');
            updateCharCount(state.originalContentForPreview || '');
            console.log("[switchView] Showing original content, length:", (state.originalContentForPreview || '').length);
        } else if (viewToShow === 'topic-title') {
            if (displayTopicTitle) displayTopicTitle.classList.remove('hidden');
            updateCharCount(getAiOutputText('topic-title'));
        } else if (viewToShow === 'summary') {
            if (displaySummary) displaySummary.classList.remove('hidden');
            updateCharCount(displaySummary ? displaySummary.value : '');
        } else if (viewToShow === 'chapters') {
            if (displayChapters) displayChapters.classList.remove('hidden');
            updateCharCount(displayChapters ? displayChapters.value : '');
        } else {
            displayProcessed.classList.remove('hidden');
            updateCharCount(state.processedSrtResult || '');
            console.log("[switchView] Showing processed content, length:", (state.processedSrtResult || '').length);
        }
    }

    function updateContent(content, fileName = '') {
        smartArea.value = String(content || '');
        state.originalFileName = fileName;
        smartArea.dispatchEvent(new Event('input'));
        state.originalContentForPreview = smartArea.value.trim();
        displayOriginal.textContent = formatSrtForDisplay(state.originalContentForPreview, '');
        displayProcessed.textContent = '';
        setMode('input');
        toggleEmptyState();
    }

    async function handleFile(file) {
        if (!file) return;
        const nameLower = file.name.toLowerCase();
        if (!nameLower.endsWith('.srt') && !nameLower.endsWith('.txt') && !nameLower.endsWith('.pdf')) {
            showModal({ title: '檔案錯誤', message: '請上傳 .srt、.txt 或 .pdf 格式的檔案。' });
            return;
        }

        const baseName = file.name.split('.').slice(0, -1).join('.');

        if (nameLower.endsWith('.pdf')) {
            if (!window.pdfjsLib) {
                showModal({ title: '載入錯誤', message: 'PDF 解析器尚未準備就緒，請重試或重新整理網頁。' });
                return;
            }
            showModal({ title: '正在讀取 PDF...', showProgressBar: true });
            try {
                const arrayBuffer = await file.arrayBuffer();
                const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
                const pdf = await loadingTask.promise;
                let fullText = '';
                
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map(item => item.str).join(' ');
                    fullText += pageText + '\n';
                }
                
                hideModal();
                if (!fullText.trim()) {
                    showModal({ title: '讀取失敗', message: '無法從該 PDF 檔案中提取文字，可能是因為檔案為掃描圖檔或受密碼保護。' });
                } else {
                    updateContent(fullText, baseName);
                    showToast('✅ 成功匯入 PDF 文字！');
                }
            } catch (error) {
                console.error('PDF 讀取錯誤:', error);
                hideModal();
                showModal({ title: '讀取失敗', message: `讀取 PDF 時發生錯誤：${error.message}` });
            }
        } else {
            const reader = new FileReader();
            reader.onload = (e) => {
                updateContent(e.target.result, baseName);
                showToast('✅ 成功匯入文稿！');
            };
            reader.readAsText(file);
        }
    }

    function formatSrtForDisplay(srtContent, placeholder) {
        if (!srtContent || !srtContent.trim()) {
            return `<span class="text-[var(--gray-text)]">${placeholder}</span>`;
        }
        const blocks = srtContent.trim().split(/\n\s*\n/);
        return blocks.map(block => {
            const lines = block.split('\n');
            if (lines.length < 2) return block;
            return `${lines[0]}\n\n${lines[1]}\n\n${lines.slice(2).join('\n')}`;
        }).join('\n\n\n');
    }

    function processAndDisplaySrt() {
        const currentSrtContent = smartArea.value.trim();
        if (!currentSrtContent) {
            showModal({ title: '輸入錯誤', message: '沒有可以處理的字幕內容。' });
            return;
        }
        state.originalContentForPreview = currentSrtContent;
        
        const options = {
            maxCharsPerLine: parseInt(maxCharsSlider.value, 10),
            mergeShortLinesThreshold: parseInt(mergeShortLinesSlider.value, 10),
            keepPunctuation: keepPunctuationCheckbox.checked,
            fixTimestamps: fixTimestampsCheckbox.checked,
            timestampThreshold: parseInt(timestampThresholdInput.value, 10),
            batchReplaceRules: state.batchReplaceRules,
            protectedTerms: state.aiTerminologyRules
                .filter(rule => rule.type === 'positive')
                .map(rule => rule.term),
            timelineShift: parseInt(timelineShiftInput.value, 10) || 0
        };

        try {
            const result = processSubtitles(currentSrtContent, options);
            state.processedSrtResult = result.processedSrt;
            state.processedSourceId = state.currentSourceId;
            const report = result.report;

            setMode('preview');
            displayOriginal.textContent = formatSrtForDisplay(state.originalContentForPreview, '');
            displayProcessed.textContent = formatSrtForDisplay(state.processedSrtResult, '');
            switchView('processed');
            updateCharCount(state.processedSrtResult);
            
            // 計算行數縮減百分比
            let reductionPercent = 0;
            if (report.originalLineCount > 0) {
                reductionPercent = Math.round(((report.originalLineCount - report.finalLineCount) / report.originalLineCount) * 100);
            }
            
            // 構建報告訊息 HTML (使用字串組裝以避免換行符號造成的空白)
            let listItems = '';
            
            // 1. 行數縮減
            listItems += `<li class="flex flex-row items-center m-0 p-0"><span class="flex-shrink-0 w-6 text-center mr-2 text-base">📉</span><span><strong>行數縮減：</strong> ${report.originalLineCount} 行 ➔ ${report.finalLineCount} 行 ${reductionPercent > 0 ? `<span class="text-green-400 font-bold">(-${reductionPercent}%)</span>` : ''}</span></li>`;
            
            // 2. 段落合併
            listItems += `<li class="flex flex-row items-center m-0 p-0"><span class="flex-shrink-0 w-6 text-center mr-2 text-base">🔗</span><span><strong>段落合併：</strong> 執行 ${report.linesMerged} 次</span></li>`;
            
            // 3. 長句拆分 (條件式)
            if (report.linesSplit > 0) {
                listItems += `<li class="flex flex-row items-center m-0 p-0"><span class="flex-shrink-0 w-6 text-center mr-2 text-base">✂️</span><span><strong>長句拆分：</strong> 執行 ${report.linesSplit} 次</span></li>`;
            }
            
            // 4. 時間軸修復
            listItems += `<li class="flex flex-row items-center m-0 p-0"><span class="flex-shrink-0 w-6 text-center mr-2 text-base">⏱️</span><span><strong>時間軸修復：</strong> ${report.fixedOverlaps + report.fixedGaps} 處</span></li>`;
            
            // 5. 批次取代
            listItems += `<li class="flex flex-row items-center m-0 p-0"><span class="flex-shrink-0 w-6 text-center mr-2 text-base">🔄</span><span><strong>批次取代：</strong> 共執行 ${report.replacementsMade} 次</span></li>`;
            
            // 6. 時間平移 (條件式)
            if (report.timelineShifted !== 0) {
                listItems += `<li class="flex flex-row items-center m-0 p-0"><span class="flex-shrink-0 w-6 text-center mr-2 text-base">↔️</span><span><strong>時間平移：</strong> ${report.timelineShifted} ms</span></li>`;
            }

            const reportHtml = `<div class="py-1"><ul class="m-0 p-0 list-none space-y-1 text-sm text-white/90 leading-normal">${listItems}</ul><p class="text-center text-white/60 text-xs mt-3 pt-2 border-t border-white/10">您的字幕已準備好進行下一步！</p></div>`;

            showModal({
                title: '✅ 字幕整理報告',
                message: reportHtml, // 這裡直接傳入 HTML 字串，showModal 需支援 HTML (通常 innerHTML 即可)
                isHtml: true, // 確保 showModal 知道這是 HTML (如果您的實作需要這個 flag)
                buttons: [
                    { text: '留在本頁', class: 'btn-secondary', callback: hideModal },
                    { text: '前往生成文章 >', class: 'btn-primary', callback: () => {
                        hideModal();
                        switchTab('tab2');
                    }}
                ]
            });

            exportSrtBtn.disabled = false;
        } catch (error) {
            console.error('處理時發生錯誤:', error);
            showModal({ title: '處理失敗', message: `發生未預期的錯誤: ${error.message}` });
        }
    }

    function exportSrtFile() {
        if (!state.processedSrtResult) {
            showModal({ title: '匯出失敗', message: '沒有可供匯出的內容。' });
            return;
        }
        const blob = new Blob([state.processedSrtResult], { type: 'text/plain;charset=utf-8' });
        let fileName = state.originalFileName ? `${state.originalFileName}_已整理.srt` : `AliangYTTB_${new Date().toISOString().slice(2, 10).replace(/-/g, "")}.srt`;
        saveFile(blob, fileName);
    }

    // --- 事件監聽 ---
    generateChaptersBtn.addEventListener('click', () => handleAiFeature('chapters'));
    generateSummaryBtn.addEventListener('click', () => handleAiFeature('summary'));
    generateTopicTitleBtn.addEventListener('click', () => handleAiFeature('topic-title'));
    
    // 動態查詢並綁定檢視切換按鈕
    const viewButtons = document.querySelectorAll('.view-btn');
    console.log("[initializeTab1] Found view buttons count:", viewButtons.length);
    viewButtons.forEach(button => {
        button.addEventListener('click', () => {
            console.log("[viewButton click] Clicked:", button.dataset.view);
            switchView(button.dataset.view);
        });
    });
    maxCharsSlider.addEventListener('input', (e) => { maxCharsValue.textContent = e.target.value; });
    mergeShortLinesSlider.addEventListener('input', (e) => { mergeShortLinesValue.textContent = e.target.value; });
    if (timelineShiftInput && timelineShiftValue) {
        timelineShiftInput.addEventListener('input', (e) => { timelineShiftValue.textContent = e.target.value; });
    }
    if (timestampThresholdInput && timestampThresholdValue) {
        timestampThresholdInput.addEventListener('input', (e) => { timestampThresholdValue.textContent = e.target.value; });
    }
    fixTimestampsCheckbox.addEventListener('change', () => {
        timestampThresholdInput.disabled = !fixTimestampsCheckbox.checked;
        timestampThresholdInput.classList.toggle('opacity-50', !fixTimestampsCheckbox.checked);
    });
    
    if(returnToEditBtn) {
        returnToEditBtn.addEventListener('click', returnToEditMode);
    }
    
    if (toggleSubtitleHelpBtn && subtitleHelpPanel) {
        toggleSubtitleHelpBtn.addEventListener('click', () => {
            subtitleHelpPanel.classList.toggle('hidden');
            const svg = toggleSubtitleHelpBtn.querySelector('svg');
            if (svg) {
                svg.classList.toggle('rotate-180');
            }
        });
    }
    
    smartArea.addEventListener('input', () => {
        const needsInvalidation = Boolean(
            state.currentAbortController ||
            state.processedSrtResult ||
            state.optimizedTextForBlog ||
            state.blogArticleVersions.length ||
            state.socialPostVersions.length ||
            state.edmVersions.length ||
            state.carouselVersions.length ||
            state.infographicVersions.length ||
            state.topicTitleSuggestions.length
        );
        const { changed } = activateSource(smartArea.value);
        if (changed && needsInvalidation) {
            window.dispatchEvent(new CustomEvent('lumina:sourceChanged', { detail: { notify: true } }));
        }
        updateCharCount(smartArea.value);
        toggleEmptyState();
        if (updateTabAvailability) updateTabAvailability();
        if (updateAiButtonStatus) updateAiButtonStatus();
    });

    window.addEventListener('lumina:sourceChanged', () => {
        const displayTopicTitle = document.getElementById('display-topic-title');
        const displaySummary = document.getElementById('display-summary');
        const displayChapters = document.getElementById('display-chapters');
        if (displayProcessed) displayProcessed.textContent = '';
        if (displayTopicTitle) renderTopicTitle('');
        if (displaySummary) displaySummary.value = '';
        if (displayChapters) displayChapters.value = '';
        exportSrtBtn.disabled = true;
    });

    window.addEventListener('lumina:showTab1Input', () => {
        setMode('input');
        smartArea.focus();
    });

    if (tab1EmptyState) {
        tab1EmptyState.addEventListener('click', (e) => {
            if (e.target.closest('label') || e.target.closest('a') || e.target.tagName === 'INPUT') return;
            smartArea.focus();
        });
    }

    smartAreaContainer.addEventListener('dragover', (e) => { e.preventDefault(); smartAreaContainer.classList.add('dragover'); });
    smartAreaContainer.addEventListener('dragleave', (e) => { e.preventDefault(); smartAreaContainer.classList.remove('dragover'); });
    smartAreaContainer.addEventListener('drop', (e) => { e.preventDefault(); smartAreaContainer.classList.remove('dragover'); if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]); });
    fileInput.addEventListener('change', (e) => { if (e.target.files.length) handleFile(e.target.files[0]); });
    processSrtBtn.addEventListener('click', () => {
        showModal({
            title: '確認開始整理',
            message: '是否需要設定「批次取代 / 專有名詞替換」？\n如果您已經設定過或不需要，請點擊「直接開始」。',
            buttons: [
                { text: '前往設定', class: 'btn-secondary', callback: () => {
                    hideModal();
                    if (showGlobalSettingsModal) showGlobalSettingsModal('settings-tab-typo');
                }},
                { text: '直接開始', class: 'btn-primary', callback: () => {
                    hideModal();
                    processAndDisplaySrt();
                }}
            ]
        });
    });
    exportSrtBtn.addEventListener('click', exportSrtFile);

    // --- 初始化 ---
    timestampThresholdInput.disabled = !fixTimestampsCheckbox.checked;
    timestampThresholdInput.classList.toggle('opacity-50', !fixTimestampsCheckbox.checked);
    toggleEmptyState();

export function initializeTab1() {}


// --- 浮動按鈕事件綁定 ---
const tab1CopyBtn = document.getElementById('tab1-copy-btn');
const tab1DownloadBtn = document.getElementById('tab1-download-btn');
const tab1FloatingActions = document.getElementById('tab1-floating-actions');

if (tab1CopyBtn) {
    tab1CopyBtn.addEventListener('click', () => {
        const activeViewBtn = document.querySelector('.view-btn.active');
        if (!activeViewBtn) return;
        const view = activeViewBtn.dataset.view;
        const outputText = getAiOutputText(view);
        if (outputText) {
            navigator.clipboard.writeText(outputText).then(() => {
                showToast('已複製到剪貼簿！');
                const originalHtml = tab1CopyBtn.innerHTML;
                tab1CopyBtn.innerHTML = '<span class="material-symbols-outlined text-[18px]">check</span>已複製!';
                setTimeout(() => {
                    tab1CopyBtn.innerHTML = originalHtml;
                }, 2000);
            });
        }
    });
}

if (tab1DownloadBtn) {
    tab1DownloadBtn.addEventListener('click', () => {
        const activeViewBtn = document.querySelector('.view-btn.active');
        if (!activeViewBtn) return;
        const view = activeViewBtn.dataset.view;
        const outputText = getAiOutputText(view);
        if (outputText) {
            const prefix = view === 'topic-title' ? '爆款主題建議' : view === 'summary' ? 'AI摘要' : 'AI章節';
            let fileName = state.originalFileName ? `${state.originalFileName}_${prefix}.txt` : `AliangYTTB_${prefix}.txt`;
            saveFile(outputText, fileName);
        }
    });
}
