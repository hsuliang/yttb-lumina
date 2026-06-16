/**
 * js/tab6-infographic.js
 * TAB6: 資訊圖表提示詞 (Infographic) 核心邏輯
 */

(function() {
    let infographicRoles = [];
    let activePromptLang = 'en'; // 'en' or 'zh'
    const INFOGRAPHIC_DRAFT_KEY = 'aliang-yttb-draft-infographic';

    // 初始化 TAB6
    window.initializeTab6 = function() {
        // 取得 UI 元素
        const typeSelect = document.getElementById('infographic-type');
        const addRoleBtn = document.getElementById('infographic-add-role-btn');
        const rolesContainer = document.getElementById('infographic-roles-container');
        const includeLogoCheckbox = document.getElementById('infographic-include-logo');
        const styleSelect = document.getElementById('infographic-style');
        const customStyleInput = document.getElementById('infographic-custom-style');
        const paletteSelect = document.getElementById('infographic-palette');
        const sizeSelect = document.getElementById('infographic-size');
        const captionLengthSelect = document.getElementById('infographic-caption-length');
        const generateBtn = document.getElementById('generate-infographic-btn');
        const generateVariationBtn = document.getElementById('generate-infographic-variation-btn');
        const copyPromptBtn = document.getElementById('copy-infographic-prompt-btn');
        const textContainer = document.getElementById('infographic-text-container');
        const placeholder = document.getElementById('infographic-placeholder');

        const enTab = document.getElementById('infographic-tab-en');
        const zhTab = document.getElementById('infographic-tab-zh');

        // 初始化與重置 UI
        infographicRoles = [];
        activePromptLang = 'en';
        renderInfographicRoles();

        // 綁定「+ 新增角色」按鈕
        if (addRoleBtn) {
            addRoleBtn.addEventListener('click', () => {
                if (infographicRoles.length < 4) {
                    syncRolesFromInputs();
                    infographicRoles.push({ name: '' });
                    renderInfographicRoles();
                    saveInfographicDraft();
                }
            });
        }

        // 監聽角色清單點擊事件（處理刪除按鈕）
        if (rolesContainer) {
            rolesContainer.addEventListener('click', (e) => {
                if (e.target.classList.contains('infographic-delete-role-btn')) {
                    const index = parseInt(e.target.dataset.index, 10);
                    // 在刪除前先同步目前的 input 內容避免輸入資料丟失
                    syncRolesFromInputs();
                    infographicRoles.splice(index, 1);
                    renderInfographicRoles();
                    saveInfographicDraft();
                }
            });
        }

        // 監聽型態選單改變事件（若手動選擇，則移除自動推薦狀態標記）
        if (typeSelect) {
            typeSelect.addEventListener('change', () => {
                if (typeSelect.value !== 'auto') {
                    typeSelect.removeAttribute('data-is-auto-recommend');
                } else {
                    typeSelect.dataset.isAutoRecommend = 'true';
                    window.analyzeInfographicContent();
                }
                saveInfographicDraft();
            });
        }

        // 監聽設定變更以儲存草稿
        if (styleSelect) {
            styleSelect.addEventListener('change', () => {
                toggleCustomStyleVisibility();
                saveInfographicDraft();
            });
        }
        if (customStyleInput) customStyleInput.addEventListener('input', saveInfographicDraft);
        if (paletteSelect) paletteSelect.addEventListener('change', saveInfographicDraft);
        if (sizeSelect) sizeSelect.addEventListener('change', saveInfographicDraft);
        if (captionLengthSelect) captionLengthSelect.addEventListener('change', saveInfographicDraft);
        if (includeLogoCheckbox) includeLogoCheckbox.addEventListener('change', saveInfographicDraft);

        // 英/中提示詞頁籤切換
        if (enTab && zhTab) {
            enTab.addEventListener('click', () => {
                activePromptLang = 'en';
                renderCurrentInfographicVersionUI();
                saveInfographicDraft();
            });
            zhTab.addEventListener('click', () => {
                activePromptLang = 'zh';
                renderCurrentInfographicVersionUI();
                saveInfographicDraft();
            });
        }

        // 複製提示詞
        if (copyPromptBtn) {
            copyPromptBtn.addEventListener('click', () => {
                const promptTextarea = document.getElementById('infographic-prompt-textarea');
                if (promptTextarea) {
                    navigator.clipboard.writeText(promptTextarea.value)
                        .then(() => showToast('提示詞已複製到剪貼簿！', { type: 'success' }))
                        .catch(err => {
                            console.error('複製失敗:', err);
                            showToast('複製失敗，請手動全選複製。');
                        });
                }
            });
        }

        // 點擊「生成提示詞」
        if (generateBtn) {
            generateBtn.addEventListener('click', () => handleGenerateInfographic('', false));
        }

        // 點擊「另一版本」
        if (generateVariationBtn) {
            generateVariationBtn.addEventListener('click', () => {
                VariationHub.open('infographic', (modifier, shouldOverride) => {
                    handleGenerateInfographic(modifier, shouldOverride);
                });
            });
        }

        // 載入草稿 (防禦性檢查)
        if (window.hasInfographicDraft && window.hasInfographicDraft()) {
            setTimeout(() => {
                if (confirm('偵測到上次有未儲存的資訊圖表提示詞草稿，是否要恢復？')) {
                    window.restoreInfographicDraft && window.restoreInfographicDraft();
                } else {
                    window.clearInfographicDraft && window.clearInfographicDraft();
                    if (window.updateTabAvailability) window.updateTabAvailability();
                }
            }, 150);
        }
    };

    // 同步 input 內容回 `infographicRoles` 陣列
    function syncRolesFromInputs() {
        const container = document.getElementById('infographic-roles-container');
        if (!container) return;
        const nameInputs = container.querySelectorAll('.infographic-role-name');
        infographicRoles = Array.from(nameInputs).map((input, idx) => ({
            name: input.value.trim()
        }));
    }

    // 渲染角色清單 UI
    function renderInfographicRoles() {
        const container = document.getElementById('infographic-roles-container');
        const addBtn = document.getElementById('infographic-add-role-btn');
        if (!container) return;
        
        container.innerHTML = '';
        infographicRoles.forEach((role, index) => {
            const div = document.createElement('div');
            div.className = 'flex items-center gap-2 bg-[var(--gray-bg)] p-2 rounded border border-[var(--card-border)] relative group';
            div.innerHTML = `
                <div class="flex-grow">
                    <input type="text" class="infographic-role-name w-full p-1 text-xs rounded border border-[var(--card-border)] bg-[var(--bg-color)] text-[var(--body-text)]" placeholder="角色/素材名稱 (如：ㄚ亮笑長)" value="${role.name}">
                </div>
                <button type="button" class="infographic-delete-role-btn text-red-500 hover:text-red-700 text-xs font-semibold px-1 focus:outline-none" data-index="${index}" title="刪除此角色">✕</button>
            `;
            // 監聽輸入框變更事件以同步並儲存草稿
            const input = div.querySelector('.infographic-role-name');
            input.addEventListener('input', () => {
                syncRolesFromInputs();
                saveInfographicDraft();
            });
            container.appendChild(div);
        });

        if (addBtn) {
            addBtn.disabled = infographicRoles.length >= 4;
        }
    }

    // 動態自訂風格輸入框顯示狀態
    function toggleCustomStyleVisibility() {
        const styleSelect = document.getElementById('infographic-style');
        const customStyleContainer = document.getElementById('infographic-custom-style-container');
        if (styleSelect && customStyleContainer) {
            if (styleSelect.value === 'custom') {
                customStyleContainer.classList.remove('hidden');
            } else {
                customStyleContainer.classList.add('hidden');
            }
        }
    }

    // 自動推薦型態判定演算法
    window.analyzeInfographicContent = function() {
        const smartArea = document.getElementById('smart-area');
        const statusEl = document.getElementById('infographic-ai-recommendation-status');
        const typeSelect = document.getElementById('infographic-type');
        if (!smartArea || !statusEl || !typeSelect) return;

        const content = smartArea.value.trim();
        if (content.length === 0) {
            statusEl.textContent = '🔍 請先在分頁 1 貼上您的字幕或文章內容。';
            return;
        }

        let scores = {
            statistical: 0,
            informational: 0,
            timeline: 0,
            process: 0,
            comparison: 0,
            geographic: 0,
            hierarchical: 0,
            list: 0,
            resume: 0
        };

        // 1. 數據統計型 (Statistical)
        const statisticalKeywords = ['數據', '百分比', '調查', '統計', '數據顯示', '報告', '數字', '比例', '營收', '市場份額', '數據分析'];
        statisticalKeywords.forEach(k => {
            const matches = content.split(k).length - 1;
            scores.statistical += matches * 0.4;
        });
        const percentMatches = content.match(/\d+%/g);
        if (percentMatches) {
            scores.statistical += percentMatches.length * 1.0;
        }

        // 2. 資訊與概念型 (Informational)
        const informationalKeywords = ['名詞解釋', '概念', '定義', '知識', '懶人包', '普及', '簡介', '什麼是', '解說'];
        informationalKeywords.forEach(k => {
            const matches = content.split(k).length - 1;
            scores.informational += matches * 0.4;
        });

        // 3. 時間軸型 (Timeline)
        const timelineKeywords = ['年', '月', '日', '世紀', '歷史', '發展', '演進', '時程', '階段', '起初', '後來', '起源', '歷程', '傳記', '演變', '過去', '未來'];
        timelineKeywords.forEach(k => {
            const matches = content.split(k).length - 1;
            scores.timeline += matches * 0.4;
        });
        const yearMatches = content.match(/\d{4}年/g);
        if (yearMatches) {
            scores.timeline += yearMatches.length * 1.0;
        }

        // 4. 流程步驟型 (Process)
        const processKeywords = ['步驟', '流程', '第一', '首先', '接著', '然後', '最後', '方法', '指引', '指南', 'SOP', '步驟一', '步驟二', '步驟三', '做法', '如何'];
        processKeywords.forEach(k => {
            const matches = content.split(k).length - 1;
            scores.process += matches * 0.4;
        });
        const numMatches = content.match(/\d+[\.\、]/g);
        if (numMatches) {
            scores.process += numMatches.length * 0.8;
        }

        // 5. 對比比較型 (Comparison)
        const comparisonKeywords = ['優點', '缺點', 'PK', 'VS', '比較', '對照', '相較於', '傳統', '現代', '兩者', '差異', '不同處', '對手', '相對於', '優劣', '好壞'];
        comparisonKeywords.forEach(k => {
            const matches = content.split(k).length - 1;
            scores.comparison += matches * 0.7;
        });

        // 6. 地理地圖型 (Geographic)
        const geographicKeywords = ['地理', '地圖', '國家', '城市', '地區', '區域', '分布', '世界', '台灣', '全球', '省份', '位置', '經緯度'];
        geographicKeywords.forEach(k => {
            const matches = content.split(k).length - 1;
            scores.geographic += matches * 0.7;
        });

        // 7. 階層關係型 (Hierarchical)
        const hierarchicalKeywords = ['階層', '金字塔', '底層', '頂端', '層級', '權重', '等級', '優先級', '層次', '組織架構', '架構圖', '樹狀圖', '上下級', '依賴關係'];
        hierarchicalKeywords.forEach(k => {
            const matches = content.split(k).length - 1;
            scores.hierarchical += matches * 0.7;
        });

        // 8. 清單條列型 (List)
        const listKeywords = ['清單', '條列', '重點', '整理', '技巧', '清單型', '重點一', '核心', '要點', '心法', '守則', '秘訣', '規則', '項目'];
        listKeywords.forEach(k => {
            const matches = content.split(k).length - 1;
            scores.list += matches * 0.4;
        });

        // 9. 個人履歷型 (Resume)
        const resumeKeywords = ['履歷', '經歷', '學歷', '工作經驗', '技能', '自傳', '求職', '專業背景', '個人簡介', '專長', '職涯', '項目經驗'];
        resumeKeywords.forEach(k => {
            const matches = content.split(k).length - 1;
            scores.resume += matches * 0.8;
        });

        // 尋找最高分
        let recommendedType = 'informational';
        let maxScore = 0;
        for (const [type, score] of Object.entries(scores)) {
            if (score > maxScore) {
                maxScore = score;
                recommendedType = type;
            }
        }

        // 門檻防護：若最高分低於 1.5 分，則判定為「資訊與概念型」
        if (maxScore < 1.5) {
            recommendedType = 'informational';
        }

        const typeNames = {
            statistical: '數據統計型 (Statistical)',
            informational: '資訊與概念型 (Informational)',
            timeline: '時間軸型 (Timeline)',
            process: '流程步驟型 (Process)',
            comparison: '對比比較型 (VS / Comparison)',
            geographic: '地理地圖型 (Geographic)',
            hierarchical: '階層關係型 (Hierarchical)',
            list: '清單條列型 (List)',
            resume: '個人履歷型 (Resume)'
        };

        // 更新狀態列 UI (改用直覺的推薦強度標籤，不顯示數字分數)
        if (maxScore < 1.5) {
            statusEl.innerHTML = `💡 AI 建議：<strong>資訊與概念型 (Informational)</strong> (內容結構以概念說明為主，推薦使用文字配合視覺圖標呈現)`;
        } else {
            let confidenceText = '';
            if (maxScore >= 10) {
                confidenceText = '🔥 強力推薦';
            } else if (maxScore >= 5) {
                confidenceText = '✨ 建議選用';
            } else {
                confidenceText = '👍 適合選用';
            }
            statusEl.innerHTML = `💡 AI 建議：<strong>${typeNames[recommendedType].split(' (')[0]}</strong> (${confidenceText})`;
        }

        // 若下拉選單設定為自動，或有自動推薦狀態標記
        if (typeSelect.value === 'auto' || typeSelect.dataset.isAutoRecommend === 'true') {
            typeSelect.dataset.isAutoRecommend = 'true';
            
            // 變更 select 顯示提示
            const autoOption = typeSelect.querySelector('option[value="auto"]');
            if (autoOption) {
                autoOption.textContent = `AI 智慧推薦 (目前推薦：${typeNames[recommendedType].split(' (')[0]})`;
            }
        }
    };

    // 取得實際要採用的圖表型態
    function getResolvedType() {
        const typeSelect = document.getElementById('infographic-type');
        if (!typeSelect) return 'informational';
        
        if (typeSelect.value !== 'auto') {
            return typeSelect.value;
        }

        // 從 AI 建議狀態中抓取推薦
        const statusEl = document.getElementById('infographic-ai-recommendation-status');
        if (statusEl) {
            const text = statusEl.textContent;
            if (text.includes('數據統計')) return 'statistical';
            if (text.includes('資訊與概念')) return 'informational';
            if (text.includes('時間軸')) return 'timeline';
            if (text.includes('流程步驟')) return 'process';
            if (text.includes('對比比較')) return 'comparison';
            if (text.includes('地理地圖')) return 'geographic';
            if (text.includes('階層關係')) return 'hierarchical';
            if (text.includes('清單條列')) return 'list';
            if (text.includes('個人履歷')) return 'resume';
        }
        return 'informational';
    }

    // 進行極簡的 Markdown 轉 HTML 渲染器，用於智慧報告
    function simpleMarkdownToHtml(md) {
        if (!md) return '';
        let html = md.trim();
        
        // 轉義 HTML 特殊字元防止 XSS
        html = html
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // 轉換粗體 **bold** 為 <strong>
        html = html.replace(/\*\((.*?)\*\//g, '<strong>$1</strong>')
                   .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        
        // 轉換清單 `- item` 或 `* item` 為 <li> 元素，並做適當分組
        const lines = html.split('\n');
        let inList = false;
        let finalLines = [];
        
        lines.forEach(line => {
            const trimmed = line.trim();
            const listMatch = trimmed.match(/^[-*+]\s+(.*)$/);
            if (listMatch) {
                if (!inList) {
                    finalLines.push('<ul class="list-disc pl-5 space-y-1 my-2">');
                    inList = true;
                }
                finalLines.push(`<li>${listMatch[1]}</li>`);
            } else {
                if (inList) {
                    finalLines.push('</ul>');
                    inList = false;
                }
                if (trimmed.length > 0) {
                    finalLines.push(`<p class="mb-2">${trimmed}</p>`);
                }
            }
        });
        
        if (inList) {
            finalLines.push('</ul>');
        }
        
        return finalLines.join('\n');
    }

    // 解析 API 回傳的雙語提示詞區塊
    function parseInfographicResponse(result) {
        // 📌 區塊一：AI 智慧推薦報告
        let reportHtml = '';
        const reportMatch = result.match(/### 📌 區塊一：AI 智慧推薦報告 \(AI Analysis Report\)([\s\S]*?)(?=### 💬 區塊二|$)/i) || 
                            result.match(/### 區塊一：AI 智慧推薦報告 \(AI Analysis Report\)([\s\S]*?)(?=### 💬 區塊二|$)/i) ||
                            result.match(/### 📌 區塊一[\s\S]*?\n([\s\S]*?)(?=### 💬 區塊二|$)/i) ||
                            result.match(/### 區塊一[\s\S]*?\n([\s\S]*?)(?=### 區塊二|$)/i);
        
        if (reportMatch && reportMatch[1]) {
            reportHtml = simpleMarkdownToHtml(reportMatch[1].trim());
        } else {
            const block2Idx = result.indexOf('### 💬 區塊二');
            const block2IdxAlt = result.indexOf('### 區塊二');
            const targetIdx = block2Idx !== -1 ? block2Idx : (block2IdxAlt !== -1 ? block2IdxAlt : -1);
            if (targetIdx !== -1) {
                const headText = result.substring(0, targetIdx).replace(/### 📌 區塊一：AI 智慧推薦報告 \(AI Analysis Report\)/i, '').trim();
                if (headText) reportHtml = simpleMarkdownToHtml(headText);
            }
        }

        // 💬 區塊二：英文提示詞
        let promptTextEn = '';
        const promptEnMatch = result.match(/### 💬 區塊二：英文提示詞 \(English Prompt\)([\s\S]*?)(?=### 💬 區塊三|$)/i) ||
                              result.match(/### 區塊二：英文提示詞 \(English Prompt\)([\s\S]*?)(?=### 區塊三|$)/i) ||
                              result.match(/### 💬 區塊二[\s\S]*?\n([\s\S]*?)(?=### 💬 區塊三|$)/i) ||
                              result.match(/### 區塊二[\s\S]*?\n([\s\S]*?)(?=### 區塊三|$)/i) ||
                              result.match(/### 💬 區塊二：給 Gemini \/ ChatGPT \/ Claude 一鍵生成提示詞 \(Universal AI Prompt\)([\s\S]*?)(?=### 💬 區塊三|$)/i) ||
                              result.match(/### 💬 區塊二：給 Gemini \/ ChatGPT \/ Claude 一鍵生成提示詞 \(Universal AI Prompt\)([\s\S]*?)$/i);
        
        const rawEnPart = promptEnMatch ? promptEnMatch[1].trim() : result.trim();
        const codeEnBlockMatch = rawEnPart.match(/```(?:markdown|prompt|text)?([\s\S]*?)```/i);
        promptTextEn = codeEnBlockMatch ? codeEnBlockMatch[1].trim() : rawEnPart;

        // 💬 區塊三：中文提示詞
        let promptTextZh = '';
        const promptZhMatch = result.match(/### 💬 區塊三：中文提示詞 \(Chinese Prompt\)([\s\S]*?)$/i) ||
                              result.match(/### 區塊三：中文提示詞 \(Chinese Prompt\)([\s\S]*?)$/i) ||
                              result.match(/### 💬 區塊三[\s\S]*?\n([\s\S]*?)$/i) ||
                              result.match(/### 區塊三[\s\S]*?\n([\s\S]*?)$/i);
        if (promptZhMatch && promptZhMatch[1]) {
            const rawZhPart = promptZhMatch[1].trim();
            const codeZhBlockMatch = rawZhPart.match(/```(?:markdown|prompt|text)?([\s\S]*?)```/i);
            promptTextZh = codeZhBlockMatch ? codeZhBlockMatch[1].trim() : rawZhPart;
        } else {
            promptTextZh = promptTextEn; 
        }

        return {
            reportHtml,
            promptTextEn,
            promptTextZh
        };
    }

    function renderInfographicVersionTabs() {
        const tabsContainer = document.getElementById('infographic-versions-tabs-container');
        if (!tabsContainer) return;
        tabsContainer.innerHTML = '';
        state.infographicVersions.forEach((version, index) => {
            const tab = document.createElement('button');
            tab.className = 'tab-btn text-sm py-2 px-4';
            tab.textContent = `版本 ${index + 1}`;
            if (index === state.currentInfographicVersionIndex) {
                tab.classList.add('active');
            }
            tab.addEventListener('click', () => switchInfographicVersionView(index));
            tabsContainer.appendChild(tab);
        });
    }

    function switchInfographicVersionView(index) {
        state.currentInfographicVersionIndex = index;
        renderInfographicVersionTabs();
        renderCurrentInfographicVersionUI();
    }

    function renderCurrentInfographicVersionUI() {
        const promptTextarea = document.getElementById('infographic-prompt-textarea');
        const placeholder = document.getElementById('infographic-placeholder');
        const textContainer = document.getElementById('infographic-text-container');
        const copyPromptBtn = document.getElementById('copy-infographic-prompt-btn');
        const reportContainer = document.getElementById('infographic-analysis-report-container');
        const reportContent = document.getElementById('infographic-analysis-report-content');
        const generateVariationBtn = document.getElementById('generate-infographic-variation-btn');

        const enTab = document.getElementById('infographic-tab-en');
        const zhTab = document.getElementById('infographic-tab-zh');

        if (!state.infographicVersions || state.infographicVersions.length === 0) {
            if (placeholder) placeholder.classList.remove('hidden');
            if (textContainer) textContainer.classList.add('hidden');
            if (copyPromptBtn) copyPromptBtn.classList.add('hidden');
            if (reportContainer) reportContainer.classList.add('hidden');
            if (generateVariationBtn) generateVariationBtn.disabled = true;
            return;
        }

        const currentVersion = state.infographicVersions[state.currentInfographicVersionIndex];
        if (!currentVersion) return;

        if (placeholder) placeholder.classList.add('hidden');
        if (textContainer) textContainer.classList.remove('hidden');
        if (copyPromptBtn) copyPromptBtn.classList.remove('hidden');
        if (generateVariationBtn) generateVariationBtn.disabled = false;

        // 填入分析報告
        if (reportContainer && reportContent) {
            if (currentVersion.reportHtml) {
                reportContent.innerHTML = currentVersion.reportHtml;
                reportContainer.classList.remove('hidden');
            } else {
                reportContainer.classList.add('hidden');
            }
        }

        // 依目前語言填入提示詞並切換頁籤樣式
        if (enTab && zhTab) {
            const isLumina = enTab.classList.contains('rounded-md') || document.querySelector('.bg-secondary');
            if (isLumina) {
                if (activePromptLang === 'zh') {
                    enTab.className = 'px-3 py-1 rounded-md text-xs font-semibold text-on-surface-variant hover:text-on-surface bg-transparent transition-colors';
                    zhTab.className = 'px-3 py-1 rounded-md text-xs font-semibold bg-secondary text-[#341100] shadow-sm transition-colors';
                    if (promptTextarea) promptTextarea.value = currentVersion.promptTextZh || currentVersion.promptTextEn || '';
                } else {
                    enTab.className = 'px-3 py-1 rounded-md text-xs font-semibold bg-secondary text-[#341100] shadow-sm transition-colors';
                    zhTab.className = 'px-3 py-1 rounded-md text-xs font-semibold text-on-surface-variant hover:text-on-surface bg-transparent transition-colors';
                    if (promptTextarea) promptTextarea.value = currentVersion.promptTextEn || '';
                }
            } else {
                if (activePromptLang === 'zh') {
                    enTab.className = 'px-3 py-1 text-xs font-semibold rounded bg-[var(--gray-bg)] border border-[var(--card-border)] text-[var(--body-text)] focus:outline-none';
                    zhTab.className = 'px-3 py-1 text-xs font-semibold rounded bg-[var(--link-color)] text-white focus:outline-none';
                    if (promptTextarea) promptTextarea.value = currentVersion.promptTextZh || currentVersion.promptTextEn || '';
                } else {
                    enTab.className = 'px-3 py-1 text-xs font-semibold rounded bg-[var(--link-color)] text-white focus:outline-none';
                    zhTab.className = 'px-3 py-1 text-xs font-semibold rounded bg-[var(--gray-bg)] border border-[var(--card-border)] text-[var(--body-text)] focus:outline-none';
                    if (promptTextarea) promptTextarea.value = currentVersion.promptTextEn || '';
                }
            }
        }
    }

    // 呼叫 Gemini 進行生成
    async function handleGenerateInfographic(variationModifier = '', shouldOverride = false) {
        const generateBtn = document.getElementById('generate-infographic-btn');
        const generateVariationBtn = document.getElementById('generate-infographic-variation-btn');
        const apiKey = window.getBalancedApiKey ? window.getBalancedApiKey() : (localStorage.getItem('geminiApiKey') || sessionStorage.getItem('geminiApiKey'));
        if (!apiKey) {
            if (window.showApiKeyModal) window.showApiKeyModal();
            return;
        }

        syncRolesFromInputs();

        // 取得輸入文字 (優選部落格/優化文章，對齊 Tab 5 邏輯)
        let sourceContent = '';
        if (state.blogArticleVersions && state.blogArticleVersions.length > 0) {
            sourceContent = state.blogArticleVersions[state.currentBlogVersionIndex].htmlContent;
        } else if (state.optimizedTextForBlog && state.optimizedTextForBlog.trim().length > 0) {
            sourceContent = `<p>${state.optimizedTextForBlog.replace(/\n/g, '</p><p>')}</p>`;
        } else {
            sourceContent = document.getElementById('smart-area').value;
        }

        if (!sourceContent || sourceContent.trim().length === 0) {
            showToast('請先貼上逐字稿內容或生成部落格文章！');
            return;
        }

        sourceContent = sourceContent.replace(/<[^>]+>/g, ' '); // 清除 HTML 標籤

        const resolvedType = getResolvedType();
        const style = document.getElementById('infographic-style').value;
        const customStyleText = document.getElementById('infographic-custom-style')?.value.trim() || '';
        const palette = document.getElementById('infographic-palette').value;
        const size = document.getElementById('infographic-size')?.value || '9:16';
        const captionLength = document.getElementById('infographic-caption-length')?.value || 'medium';
        const includeLogo = document.getElementById('infographic-include-logo')?.checked ?? false;

        // 封裝角色與 Logo 指代
        const validRoles = infographicRoles.filter(r => r.name.trim() !== '');
        let roleInstruction = '';
        let logoIndex = 1;
        let logoInstruction = '';

        if (validRoles.length > 0) {
            const roleLines = validRoles.map((role, idx) => {
                return `- ${role.name} (在提示詞中必須指代為 image${idx + 1})`;
            });
            logoIndex = validRoles.length + 1;
            roleInstruction = `**自備素材與角色指代設定**：
在生成圖表的排版及繪圖提示詞中，提及以下您所設定的角色/素材人物時，必須使用對應的 image 變數指代：
${roleLines.join('\n')}
並且在給 AI 的排版指令中，明確指定如何將這些 image1 等素材巧妙地貼到對應的位置上。在輸出時必須完整保留如 「image1 (角色名稱)」這樣的指代格式，絕對不可刪除或翻譯。`;
        } else {
            roleInstruction = `**自備素材與角色指代設定**：
本篇並無設定 any 角色或圖片素材。繪圖提示詞中不要出現特定的講者或引導員，專注於場景、數據、抽象概念或背景元件之設計。`;
        }

        if (includeLogo) {
            logoInstruction = `\n- 浮水印/Logo 規則：請在提示詞最後一欄指定：「在圖表右上角（或合適的角落）必須放上 image${logoIndex} 的 Logo 浮水印，並保留其原始比例與配色，不可重繪或裁剪。」`;
        }

        // 圖表型態特徵描述
        const typeDescriptions = {
            statistical: '數據統計型 (Statistical)：以數據、百分比或調查結果為核心，使用大型突出數字、圓餅圖、長條圖或進度環來突顯特定的統計結論。',
            informational: '資訊與概念型 (Informational)：以文字敘述配合大量視覺圖標 (Icons)，將複雜、抽象的概念、定義或專有名詞轉化為簡單直觀的懶人包。',
            timeline: '時間軸型 (Timeline)：利用一條中心時間主線（水平或垂直），依據先後順序串聯並呈現事物的歷史演進、發展歷程或階段事件。',
            process: '流程步驟型 (Process)：使用清晰的箭頭指向、順序線條或步驟序號（如 1, 2, 3），引導讀者了解操作指南、SOP 或業務工作流。',
            comparison: '對比比較型 (VS / Comparison)：著重於兩方或多方規格、優缺點、傳統與現代的對照 PK，使用對稱分欄或對比色塊排版。',
            geographic: '地理地圖型 (Geographic)：以地圖、區域版塊或地理坐標為核心，展示數據在不同國家、城市或地理位置上的空間分布與差異。',
            hierarchical: '階層關係型 (Hierarchical)：展示架構、等級、優先級或上下級依賴關係，常採用金字塔型、樹狀圖或向心環狀圖。',
            list: '清單條列型 (List)：將多項技巧、核心要點、秘訣或守則，使用整齊的並列卡片 (Cards)、序列徽章或網格模組進行條列式呈現。',
            resume: '個人履歷型 (Resume)：以個人簡介、專業專長、學經歷、技能雷達圖或工作經驗項目為核心，進行結構化與視覺化的個人品牌呈現。'
        };

        // 風格與配色描述
        const styleDescriptions = {
            auto: 'AI 參考內容自動決定風格 (由 AI 依內容主題與情境自動匹配最合適的插畫畫風，例如：教育或趣味可用溫慢可愛Q版風，專業或科技可用現代極簡扁平風，故事或情感可用寫實水彩風等，以確保視覺一致性)。',
            'warm-cute-chibi': '溫慢可愛Q版教育風，採用頭大身體小的 Q 版角色、溫慢柔和的色調、厚筆觸手繪感，適合知識或教育內容。',
            'modern-minimalist-flat': '現代極簡插畫風，採用向量扁平插畫、乾淨簡約的幾何線條、高留白比例，具備高度現代感與質感。',
            'realistic-watercolor': '寫實手繪水彩風，採用細緻的水彩邊緣渲染、手繪紙張筆觸質感，適合人文故事與文學主題。',
            minimalist: '現代極簡幾何風，採用俐落線條、大面積留白、大字體高對比，風格具商務專業感。',
            '3d-clay': '3D 黏土/擬物風，帶有手作玩具的立體感、高質感微距光影與平滑材質表面，極具立體吸睛度。',
            'neo-brutalism': '高對比新醜風，使用粗邊框、明亮撞色、不對稱排版，具備強烈的前衛社群風格。',
            'flat-business': '扁平商業插畫，使用經典的商業角色人物、柔和溫暖的色彩、結構明確的排版。',
            doodle: '手繪塗鴉風，包含手繪箭頭、手寫字體、手繪圖框與簡約草圖線條。'
        };

        const paletteDescriptions = {
            'tech-cool': '科技冷調 (以深藍、藏青、霓虹靛、石墨黑為主色，輔以亮藍為高亮色)。',
            'business-warm': '商業暖調 (以中灰、深灰、暖橙、熟紅為主，給人專業且具行動力之感)。',
            morandi: '莫蘭迪色系 (低飽和度的粉藍、粉綠、米白、淺灰，高雅溫潤)。',
            'high-contrast': '高飽和撞色 (亮黃、深紫、螢光綠撞色搭配，吸睛度極高)。',
            auto: 'AI 自動配色推薦 (由 AI 依內容情感自動選定一套和諧的配色集)。'
        };

        const captionLengthInstructions = {
            short: '說明文字字數控制在 150 字以內，極致簡化說明。',
            medium: '說明文字字數控制在 200 字以內，字數適中。',
            long: '說明文字字數控制在 250 字以內，包含完整細節。'
        };

        // 確定風格描述，若為 variation 且 Override 則覆寫，否則追加
        let styleDescriptionText = '';
        if (style === 'custom') {
            styleDescriptionText = `自訂畫風風格，請精確遵循此畫風引導：${customStyleText}`;
        } else {
            styleDescriptionText = styleDescriptions[style] || styleDescriptions['auto'];
        }

        if (variationModifier) {
            if (shouldOverride) {
                styleDescriptionText = `由你決定風格，但必須依據此風格調整指令：${variationModifier}`;
            } else {
                styleDescriptionText += `，並在此基礎上追加風格修飾：${variationModifier}`;
            }
        }

        // 組裝 System Prompt
        const prompt = `您是專業的資訊圖表視覺導演 (Infographic Director)。
您的任務是：分析以下「字幕或文章內容」，並將其轉化為一份「資訊圖表規劃書」，內含給 Gemini / ChatGPT / Claude 等 AI 助手一鍵複製使用的資訊圖表生成提示詞。

【使用者設定規格】
- **圖表型態**：${typeDescriptions[resolvedType]}
- **視覺風格**：${styleDescriptionText}
- **配色方案**：${paletteDescriptions[palette]}
- **圖表尺寸**：縱橫比設定為 ${size}
- **說明文字字數要求**：${captionLengthInstructions[captionLength]}
${roleInstruction}${logoInstruction}

【輸出格式規範】
請嚴格以下列三個區塊的 Markdown 格式進行輸出，不要輸出任何額外的廢話：

### 📌 區塊一：AI 智慧推薦報告 (AI Analysis Report)
- **排版邏輯說明**：說明為何推薦/使用此排版型態（簡述 2 句話）。
- **版面布局 blueprint**：用文字詳細說明如何分配畫面空間（例如：上方10%放主標，中間用對角線拉出4個步驟卡片等，以及使用者設定的 image1 ~ image4 應如何精確貼在版面上）。

### 💬 區塊二：英文提示詞 (English Prompt)
請生成一個可以「一鍵複製」的精緻畫風與排版 Prompt，該 Prompt 的**指令主要以純英文撰寫**（這對 Midjourney, DALL-E 3 等工具最精確，文字部分維持繁體中文）。
該 Prompt 必須命令繪圖 AI 執行以下工作：
1. 繪製一張符合規格的 Infographic 圖片。
2. 限制文字數量：${captionLengthInstructions[captionLength]} (且文字文案部分應維持以繁體中文 (Traditional Chinese) 顯示，視覺指令與畫風描述為英文)。
3. **完美融入角色圖片與 Logo 變數**：在 Prompt 中寫明如何將 \`image1 (角色A)\`、\`image2 (角色B)\` 等素材嵌入指定位置，若勾選 Logo，必須要求在指定位置嵌入 \`image${logoIndex}\`。
4. 整體風格是 [${styleDescriptionText}]，配色是 [${paletteDescriptions[palette]}]。

請將這段英文提示詞放在一個 Markdown 的 \`\`\` 程式碼區塊中。

### 💬 區塊三：中文提示詞 (Chinese Prompt)
請生成與區塊二內容對應的中文版一鍵複製 Prompt（所有繪圖指令、版面分配與畫風描述改以**繁體中文（台灣）**撰寫）。
該 Prompt 必須包含相同的文字長度限制「${captionLengthInstructions[captionLength]}」、角色圖片變數嵌入與 Logo 說明，並保持相同的畫風與色彩設定。

請將這段中文提示詞放在一個 Markdown 的 \`\`\` 程式碼區塊中。

【原始內容】
${sourceContent}
`;

        // 開啟載入 Modal
        const isVariation = variationModifier !== '';
        showModal({ title: `AI 資訊圖表提示詞${isVariation ? '新版本' : ''}生成中...`, showProgressBar: true, taskType: 'infographic' });
        
        const activeBtn = isVariation ? generateVariationBtn : generateBtn;
        activeBtn.disabled = true;
        activeBtn.classList.add('btn-loading');

        try {
            const result = await callGeminiAPI(apiKey, prompt);
            
            // 解析三個區塊
            const parsed = parseInfographicResponse(result);

            const newVersion = {
                rawResult: result,
                reportHtml: parsed.reportHtml,
                promptTextEn: parsed.promptTextEn,
                promptTextZh: parsed.promptTextZh
            };

            if (isVariation) {
                state.infographicVersions.push(newVersion);
                state.currentInfographicVersionIndex = state.infographicVersions.length - 1;
            } else {
                state.infographicVersions = [newVersion];
                state.currentInfographicVersionIndex = 0;
            }

            renderInfographicVersionTabs();
            renderCurrentInfographicVersionUI();
            saveInfographicDraft();

            hideModal();
            showToast(`資訊圖表提示詞${isVariation ? '新版本' : ''}已生成！`, { type: 'success' });

        } catch (error) {
            console.error("資訊圖表提示詞生成失敗:", error);
            hideModal();
            showToast('生成失敗，請重試！');
        } finally {
            activeBtn.disabled = false;
            activeBtn.classList.remove('btn-loading');
            if (window.updateAiButtonStatus) window.updateAiButtonStatus();
        }
    }

    window.restoreInfographicDraft = function() {
        try {
            const draftJSON = localStorage.getItem(INFOGRAPHIC_DRAFT_KEY);
            if (!draftJSON) return;
            const draft = JSON.parse(draftJSON);

            document.getElementById('smart-area').value = draft.sourceContent || '';
            state.optimizedTextForBlog = draft.optimizedContent || '';
            state.blogSourceType = draft.sourceType || 'raw';

            document.getElementById('infographic-type').value = draft.type || 'auto';
            document.getElementById('infographic-style').value = draft.style || 'auto';
            const customStyleInput = document.getElementById('infographic-custom-style');
            if (customStyleInput) customStyleInput.value = draft.customStyle || '';
            document.getElementById('infographic-palette').value = draft.palette || 'auto';
            
            const sizeSelect = document.getElementById('infographic-size');
            if (sizeSelect) sizeSelect.value = draft.size || '9:16';

            const captionLengthSelect = document.getElementById('infographic-caption-length');
            if (captionLengthSelect) captionLengthSelect.value = draft.captionLength || 'medium';

            const logoCheckbox = document.getElementById('infographic-include-logo');
            if (logoCheckbox) logoCheckbox.checked = (draft.includeLogo === true);

            activePromptLang = draft.activePromptLang || 'en';

            if (draft.roles && Array.isArray(draft.roles)) {
                infographicRoles = draft.roles;
                renderInfographicRoles();
            }

            if (draft.versions && draft.versions.length > 0) {
                state.infographicVersions = draft.versions;
                state.currentInfographicVersionIndex = draft.currentVersionIndex || 0;

                renderInfographicVersionTabs();
                renderCurrentInfographicVersionUI();
            }

            toggleCustomStyleVisibility();

            if (window.updateTabAvailability) window.updateTabAvailability();
            if (window.updateAiButtonStatus) window.updateAiButtonStatus();

            showToast('資訊圖表提示詞草稿已成功恢復！');
        } catch (e) {
            console.error('無法讀取資訊圖表提示詞草稿:', e);
            window.clearInfographicDraft();
        }
    };

    window.hasInfographicDraft = function() {
        return localStorage.getItem(INFOGRAPHIC_DRAFT_KEY) !== null;
    };

    window.clearInfographicDraft = function() {
        localStorage.removeItem(INFOGRAPHIC_DRAFT_KEY);
    };

    function saveInfographicDraft() {
        const rawContent = state.processedSrtResult ? state.processedSrtResult.trim() : document.getElementById('smart-area').value.trim();
        if (rawContent.length === 0 && state.infographicVersions.length === 0) return;

        const size = document.getElementById('infographic-size')?.value || '9:16';
        const includeLogo = document.getElementById('infographic-include-logo')?.checked ?? false;
        const captionLength = document.getElementById('infographic-caption-length')?.value || 'medium';
        const customStyle = document.getElementById('infographic-custom-style')?.value || '';

        const draft = {
            sourceContent: document.getElementById('smart-area').value,
            optimizedContent: state.optimizedTextForBlog,
            sourceType: state.blogSourceType,
            type: document.getElementById('infographic-type').value,
            style: document.getElementById('infographic-style').value,
            customStyle: customStyle,
            palette: document.getElementById('infographic-palette').value,
            size: size,
            captionLength: captionLength,
            includeLogo: includeLogo,
            activePromptLang: activePromptLang,
            roles: infographicRoles,
            versions: state.infographicVersions,
            currentVersionIndex: state.currentInfographicVersionIndex,
            timestamp: new Date().getTime(),
        };

        try {
            localStorage.setItem(INFOGRAPHIC_DRAFT_KEY, JSON.stringify(draft));
        } catch (e) {
            console.error('無法儲存資訊圖表提示詞草稿:', e);
        }
    }
})();
