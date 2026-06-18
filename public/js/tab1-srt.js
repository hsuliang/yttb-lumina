import { processSubtitles } from './srt-processor.js';
import { showToast, showModal, hideModal } from './ui-components.js';
import { callGeminiAPI } from './gemini-api.js';
import { state } from './state.js';
import { updateAiButtonStatus, getBalancedApiKey, showGlobalSettingsModal, updateTabAvailability, switchTab, renderReplaceRules } from './app.js';

/**
 * tab1-srt.js
 * 負責管理第一分頁「字幕整理與優化」的所有 UI 互動與邏輯。
 */

// --- 元素選擇 (模組級) ---
const generateChaptersBtn = document.getElementById('generate-chapters-btn');
const generateSummaryBtn = document.getElementById('generate-summary-btn');
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

function setMode(mode) {
    const viewToggleHeader = document.getElementById('view-toggle-header');
    if (mode === 'input') {
        viewToggleHeader.classList.add('hidden');
        smartArea.classList.remove('hidden');
        displayOriginal.classList.add('hidden');
        displayProcessed.classList.add('hidden');
        // smartArea.value = ''; // 返回編輯時不清空
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
    smartArea.value = state.originalContentForPreview;
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
    state.batchReplaceRules = [];
    if (renderReplaceRules) renderReplaceRules();
    updateCharCount();
    toggleEmptyState();
}

// --- 初始化函式 ---
    // --- 函式定義 ---
    async function handleAiFeature(type) {
        const apiKey = getBalancedApiKey ? getBalancedApiKey() : (localStorage.getItem('geminiApiKey') || sessionStorage.getItem('geminiApiKey'));
        // ########## FIX END ##########

        const content = state.processedSrtResult.trim() || smartArea.value.trim();
        if (!content) {
            showModal({ title: '錯誤', message: '沒有可用於 AI 處理的字幕內容。' });
            return;
        }

        const btn = type === 'chapters' ? generateChaptersBtn : generateSummaryBtn;
        const originalHtml = btn.innerHTML;
        let prompt = '';
        let modalTitle = 'AI 處理中...';
        let successTitle = 'AI 處理完成';

        btn.disabled = true;
        btn.classList.add('btn-loading');

        if (type === 'chapters') {
            prompt = `你是一個專業的 YouTube 影片剪輯師。請根據以下影片字幕內容，為這部影片生成 YouTube 影片章節。\n規則：\n1. 格式必須是 "時間戳 - 標題" (例如：00:00 - 影片開頭)。\n2. 時間戳必須從 00:00 開始。\n3. 根據影片長度合理分配章節數量，30分鐘內影片最多10個章節，依此類推。\n4. 章節標題需簡潔且能總結該段落的核心內容。\n5. 不要包含前言或結語，直接輸出章節列表。\n\n字幕內容如下：\n---\n${content}\n---`;
            successTitle = 'AI 章節生成 完成';
        } else if (type === 'summary') {
            prompt = `你是一位專業的 YouTube 內容策劃。請根據下方的影片逐字稿，撰寫一段約 150 字左右、引人入勝的影片摘要，用於 YouTube 的說明欄。\n規則：\n1. 摘要需包含影片的核心觀點和最吸引人的亮點。\n2. 語氣需充滿能量與好奇心，鼓勵觀眾觀看影片。\n3. 不要使用任何 markdown 語法，直接輸出純文字段落。\n4. 直接輸出摘要內容，不要有任何前言或結語 (例如不要寫「這是一段摘要」)。\n\n影片逐字稿如下：\n---\n${content}\n---`;
            successTitle = 'AI 影片摘要 完成';
        }
        
        showModal({ title: modalTitle, showProgressBar: true, taskType: 'chapters' });

        try {
            const result = await callGeminiAPI(apiKey, prompt);
            showModal({ title: successTitle, message: result, showCopyButton: true });
        } catch (error) {
            if (error.message && error.message.includes('overloaded')) {
                showModal({ 
                    title: 'AI 正在尖峰時段，請稍候！', 
                    message: '別擔心，這不是您的程式或 API Key 有問題。\n\n這代表 Gemini AI 模型目前正處於全球使用的高峰期，就像一位超級名廚的廚房突然湧入了大量訂單一樣。\n\n建議您稍等一兩分鐘後，再點擊一次「生成」按鈕即可。\n\n感謝您的耐心！',
                    buttons: [
                        { text: '關閉', class: 'btn-secondary', callback: hideModal },
                        { text: '立即重試', class: 'btn-primary', callback: () => { 
                            hideModal(); 
                            handleAiFeature(type); 
                        } }
                    ]
                });
            } else {
                showModal({ title: 'AI 處理失敗', message: `發生錯誤：${error.message}` });
            }
        } finally {
            btn.disabled = false;
            btn.classList.remove('btn-loading');
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

        if (viewToShow === 'original') {
            displayOriginal.classList.remove('hidden');
            displayProcessed.classList.add('hidden');
            updateCharCount(state.originalContentForPreview || '');
            console.log("[switchView] Showing original content, length:", (state.originalContentForPreview || '').length);
        } else {
            displayOriginal.classList.add('hidden');
            displayProcessed.classList.remove('hidden');
            updateCharCount(state.processedSrtResult || '');
            console.log("[switchView] Showing processed content, length:", (state.processedSrtResult || '').length);
        }
    }

    function updateContent(content, fileName = '') {
        smartArea.value = content;
        state.originalFileName = fileName;
        smartArea.dispatchEvent(new Event('input'));
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
            timelineShift: parseInt(timelineShiftInput.value, 10) || 0
        };

        try {
            const result = processSubtitles(currentSrtContent, options);
            state.processedSrtResult = result.processedSrt;
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
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        let fileName = state.originalFileName ? `${state.originalFileName}_已整理.srt` : `AliangYTTB_${new Date().toISOString().slice(2, 10).replace(/-/g, "")}.srt`;
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // --- 事件監聽 ---
    generateChaptersBtn.addEventListener('click', () => handleAiFeature('chapters'));
    generateSummaryBtn.addEventListener('click', () => handleAiFeature('summary'));
    
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
        updateCharCount(smartArea.value);
        toggleEmptyState();
        if (updateTabAvailability) updateTabAvailability();
        if (updateAiButtonStatus) updateAiButtonStatus();
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
                    if (showGlobalSettingsModal) showGlobalSettingsModal('settings-tab-dict');
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
