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
上一版輸出未完全符合硬性規格或「鉤子＋承諾」爆款公式，請完整重寫全部內容，不要只列出修改片段，也不要提及修正過程。

必須修正的問題：
${violations.map(item => `- ${item}`).join('\n')}

再次確認：方案 A、B、C 各須包含「正選、備選一、備選二」三組完整配對，共 9 組。每個主標題必須在 10 字以內，可以短於 10 字；每個副標題必須介於 10 至 20 字。不可用程式式截斷或堆字湊長度，請重新命名並在輸出前逐字計數。修正時仍須保留內容靈魂、主標題的核心衝突與副標題的開放懸念，不能為了符合字數改成資料摘要。

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

內容靈魂萃取（只在內部進行，不得輸出分析過程）：
- 觀眾只有 3 秒鐘。先回答：「這份內容中，哪一個選擇、衝突、反差或人生問題，會讓完全不認識主角的人也忍不住停下來？」這一句才是內容靈魂；數字、工具與事件只是強化靈魂的素材，不能反過來取代主題。
- 實用需求層：找出受眾最痛的困境，以及內容真正提供的翻盤方法或可帶走的價值。
- 認知衝擊層：找出常理與真實選擇／結果之間最不可思議的反差。
- 情感共鳴層：找出最有態度的真實金句、最難的選擇，以及讓人想追問「後來呢？」的人性時刻。

爆款主副標題黃金公式：
【主標題 The Hook：核心衝突／痛點提問】＋【副標題 The Promise：懸念反差／終極解方】

主標題規則：
- 【硬性字數】最多 10 字，10 字是上限而不是目標；優先寫成 6 至 9 字的強力口語短句。
- 爆款修辭張力設定為 9／10，事實誇大仍是 0／10。直接把最反常的選擇、最大代價、最刺耳金句或最荒謬反差砸到觀眾眼前；可以使用驚嘆號、問號、挑釁、比喻與戲劇化動詞。
- 主標題不是章節名稱或資料摘要。不要塞滿背景、數字與結果，也不要使用「某某的故事、完整解析、心路歷程、實用指南」等平淡命名。
- 唸起來必須像創作者會說的人話，而不是報告標題；不可為了縮字創造生硬複合詞或殘缺語句。

副標題規則：
- 【硬性字數】介於 10 至 20 字（含 10 與 20 字），短而有餘韻；不要為了湊字塞入第二串數據。
- 副標題的任務不是提交事實證據，而是延續主標題、製造「開放迴圈」，讓觀眾想知道後來的結果、隱藏代價、意外反轉、真正做法或這個選擇究竟值不值得。
- 可採用懸念問句、結果留白、價值承諾或人性抉擇。問題可以大膽，但不能暗示逐字稿沒有的犯罪、傷害、成就或關係結果。
- 主標題先丟出衝突，副標題故意把關鍵答案留在影片裡。若讀完主副標就已知道全部事實、沒有任何問題想追問，必須重寫。

三套方案與九組選擇：
- 方案 A／認知衝擊：優先抓「違反常理的選擇＋後果懸念」，讓觀眾第一反應是「怎麼會這樣？」。
- 方案 B／實用需求：優先抓「令人崩潰的痛點＋翻盤承諾」，讓觀眾第一反應是「到底怎麼做到？」；不能退化成操作手冊標題。
- 方案 C／情感共鳴：優先抓「真實金句／人生代價＋未解的人性問題」，讓觀眾第一反應是「如果是我，還撐得下去嗎？」。
- 每個方案先在內部構思 6 組，再淘汰只有數據沒有靈魂、只有資訊沒有懸念、用詞生硬或與其他方案雷同的候選。先通過事實檢查，再以「好奇缺口 40％、核心衝突 30％、口語記憶點 20％、受眾相關性 10％」排序；最高者列為正選，另選兩組真正不同的備選。不要輸出評分或淘汰過程。

真實與通案邊界：
- 所有人名、機構、數字、時間、事件、引言、工具與觀點只能來自本次逐字稿；正式標題不得沿用提示詞或過往案例中的名詞。
- 可以放大真實事件的情緒、荒謬感、代價感與反差，但不得虛構事實、因果、動機、心理、成果或關係狀態。
- 不得把不同時間、人物或場景的事件拼成同一件事，也不得因為兩件事先後出現就自行寫成因果。
- 主副標可以自然共用必要的核心名詞；只要副標不是逐字重講同一完整事實，就不要為了避開重複而換成奇怪近義詞。
- 輸出前逐組朗讀，確認繁體中文自然、主副標共同圍繞同一個內容靈魂，並在 3 秒內產生一個尚未回答的問題。
- 輸出前逐字計算全部 9 個主標題與 9 個副標題；不符合字數就重新命名，不能截斷或堆字。
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
**設計概念**：用 2 至 3 句說明三組各自抓住哪個違反常理的選擇、留下什麼未解後果，以及為何正選的好奇缺口最強。只引用必要的逐字稿素材，不要把設計概念寫成資料摘要，也不得補寫逐字稿沒有的事實。

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
**設計概念**：用 2 至 3 句說明三組各自抓住哪個受眾痛點、承諾揭開什麼翻盤方法，以及為何正選最讓人想追問「怎麼做到」。只引用必要的逐字稿素材，不要把設計概念寫成操作清單，也不得補寫逐字稿沒有的成果。

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
**設計概念**：用 2 至 3 句說明三組各自抓住哪個真實態度或人生代價、留下什麼人性問題，以及為何正選最能讓受眾代入。只引用必要的逐字稿素材，不要寫成勵志心得，也不得把推測的心理或關係狀態寫成事實。

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
                        setAiOutputText(type, '正在調整主副標題的爆款張力與懸念...');
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
