// js/variation-hub.js

const VARIATION_HUB_STORAGE_PREFIX = 'aliang-yttb-custom-variations-';

const VariationHub = (function() {
    let modal, titleEl, styleSelect, customInput, overrideCheckbox, saveBtn, deleteBtn, cancelBtn, confirmBtn;
    let currentType = ''; // 'blog', 'social', 'edm'
    let currentCallback = null;

    // Default styles for each type (can be extended by user-saved presets)
    const DEFAULT_STYLES = {
        blog: [
            { name: '隨機驚喜', value: '' }, // Empty value triggers random logic if needed
            // --- 基礎語氣 (加強版) ---
            { name: '充滿能量', value: '請注入「充滿能量與感染力」的語氣。使用積極、正面且強而有力的動詞，句式節奏要明快，展現出對主題的高度熱情，讓讀者閱讀時也能感受到被激勵的情緒。' },
            { name: '專業權威', value: '請展現「專業且具權威性」的語氣。用詞精準、客觀，避免過於情緒化的字眼。多使用肯定句與邏輯推演，建立專家形象，讓讀者對內容深信不疑。' },
            { name: '口語親切', value: '請使用「口語化且親切」的語氣。就像在跟鄰居或朋友說話一樣，使用大眾習慣的日常用語，拉近與讀者的距離，消除距離感與說教感。' },
            { name: '幽默風趣', value: '請採用「幽默風趣」的語氣。在不影響資訊傳遞的前提下，適度加入機智的譬喻、雙關語或輕鬆的調侃，讓文章讀起來生動有趣，不再枯燥乏味。' },
            // --- 進階風格 ---
            { name: '親切對話風', value: '請切換為「親切對話」模式。想像你正在咖啡廳與好朋友面對面聊天，使用輕鬆、自然的口語詞彙（如「其實」、「你知道嗎」）。請避免生硬的教科書用語，讓讀者感到放鬆且容易吸收，但仍需保持內容的正確性。' },
            { name: '專家顧問風', value: '請採用「專家顧問」的專業語氣。多使用精確的領域術語與邏輯推演，強調因果關係與數據佐證。句式應簡練有力，展現出權威感與可信度，讓讀者覺得這是一篇含金量極高的分析文章。' },
            { name: '情境帶入法', value: '請運用「情境帶入法」來重寫開頭。先描述一個讀者可能感同身受的具體場景、困難或痛點故事，引發強烈共鳴後，再自然地轉折帶出本文的解決方案。讓讀者覺得「這就是在說我！」而更有興趣往下看。' },
            { name: '乾貨清單風', value: '請將文章重組為「乾貨清單」結構。大幅減少冗長的連接段落，將核心知識點全部轉化為清晰的條列式清單 (Listicle) 或步驟說明。每個條列項目都要有明確的小標題，讓讀者能在一分鐘內快速掃描並掌握所有重點。' },
        ],
        social: [
            { name: '隨機驚喜', value: '' },
            // --- 基礎語氣 (加強版) ---
            { name: '能量感染力', value: '請在貼文中展現「高能量」。使用驚嘆號、激勵人心的短句，以及能引發情緒共鳴的用詞。讓這篇貼文在動態牆上顯得熱情洋溢，吸引人按讚。' },
            { name: '專業權威感', value: '請保持「專業權威」的形象。即使是社群貼文，也要維持含金量。用詞簡練、觀點犀利，展現行業領袖的風範，建立信任感。' },
            { name: '親切口語化', value: '請用極度「親切口語」的方式撰寫。多用「大家」、「我們」這類詞彙，像是在跟粉絲閒聊。可以適度使用繁體中文社群常見的語助詞，增加互動感。' },
            { name: '幽默風趣感', value: '請把貼文寫得「幽默風趣」。這是在社群媒體，不用太嚴肅。嘗試用一個有趣的觀點或反轉作為切入點，讓粉絲看了會想轉發或留言『太好笑了』。' },
            // --- 進階風格 ---
            { name: '視覺系排版', value: '請強化「視覺閱讀體驗」。在每個段落開頭、重點關鍵字前後，適當加入符合語意的 Emoji 符號。利用 Emoji 作為視覺錨點，引導視線流動，讓整篇貼文看起來色彩豐富、充滿活力，適合在滑手機時快速瀏覽。' },
            { name: '極簡觀點風', value: '請採用「極簡觀點」風格。刪除所有不必要的贅字與形容詞，只保留最核心的洞察與結論。每句話都要像格言一樣精鍊有力，直擊重點，適合專業人士在 LinkedIn 或 Twitter 上快速吸收資訊。' },
            { name: '懸疑提問法', value: '請使用「懸疑提問法」作為開頭鉤子 (Hook)。提出一個違背常理、令人震驚或極度想知道答案的問題（例如：「你以為...其實...」）。在貼文前三行絕對不要揭曉答案，強迫讀者點擊「查看更多」來尋找真相。' },
            { name: '懶人包風格', value: '請將貼文包裝成「懶人包」風格。直接告訴讀者：「這裡有 X 個你必須知道的重點」。接著使用清晰的數字編號或符號清單列出精華，最後再用一句話總結。適合喜歡收藏實用資訊的社群受眾。' },
        ],
        edm: [
            { name: '隨機驚喜', value: '' },
            // --- 基礎風格 (加強版) ---
            { name: '知識分享', value: '請聚焦於「知識分享」。這封信的價值在於提供有用的資訊。結構要清晰，重點要明確，讓讀者覺得開信能學到東西，而不是在看廣告。' },
            { name: '促銷優惠', value: '請強化「促銷優惠」的急迫感與誘因。清楚說明優惠內容、截止日期與讀者能獲得的好處。使用強烈的行動呼籲 (CTA)，引導讀者立即行動。' },
            { name: '故事敘述', value: '請採用「故事敘述」手法。不要平鋪直敘，試著用一個微型的故事架構（背景-衝突-解決）來包裝這次的主題，讓讀者因為想知道結局而把信看完。' },
            { name: '快速更新', value: '請採用「快速更新」風格。讀者很忙，請直接講重點。用類似新聞快訊的方式，條列出最近的更新項目或亮點，效率至上。' },
            // --- 進階風格 ---
            { name: '粉絲專屬信', value: '請把這封信寫得像是一封「給老粉絲的私密信」。使用極具熱情與溫度的語氣，感謝讀者一直以來的支持。字裡行間要流露出興奮感，彷彿你迫不及待要跟他們分享一個天大的好消息。讓讀者感受到被重視與專屬感。' },
            { name: '商務提案風', value: '請採用「商務提案」的專業架構。開頭直接切入讀者的潛在需求或利益點，中間提供邏輯嚴謹的解決方案與價值主張，結尾給出明確且自信的行動呼籲。語氣要專業、客觀且具說服力。' },
            { name: '故事行銷法', value: '請運用「故事行銷」技巧。不要一開始就賣東西或講道理，而是先說一個簡短但精彩的相關故事（可以是親身經歷、客戶案例或寓言）。用故事帶出情感連結，最後再將故事的寓意連結到本次的主題與 CTA。' },
            { name: '快訊摘要風', value: '請採用「週報快訊」的格式。假設讀者時間非常寶貴，請用最精簡的文字摘要核心內容。使用明確的標題、短段落和條列點，讓讀者能在 30 秒內看完並抓到重點，直接引導他們點擊連結去查看完整內容。' },
        ],
        carousel: [
            { name: '隨機驚喜', value: '' },
            { name: '更為科幻未來風格', value: '請將繪圖風格調整為帶有未來感、科幻、霓虹光影與高科技教室的氛圍，提示詞中要表現出科技感與未來教育元素。' },
            { name: '復古懷舊手繪風', value: '請將繪圖風格調整為溫暖復古、帶有老式手繪繪本質感、柔和的紙質紋理與暖黃光影，強調溫情與童趣。' },
            { name: '極簡現代扁平風', value: '請將繪圖風格調整為極簡現代扁平插畫，使用大膽的色塊搭配、簡潔的線條與幾何構圖，避免過多繁複的裝飾細節。' },
            { name: '超可愛Q版黏土風', value: '請將繪圖風格調整為 3D 黏土捏製風格 (Claymation style)，角色要像精緻的玩具黏土模型一樣立體、圓潤、可愛，帶有真實黏土的手作質感與微距攝影光影。' }
        ],
        infographic: [
            { name: '隨機驚喜', value: '' },
            { name: '數據對比與核心指標可視化', value: '請在資訊圖表設計中，更加強化數據比較、百分比與核心指標的可視化呈現，並引導 AI 繪圖工具在相應位置預留清楚的數字或統計圖表插圖空間。' },
            { name: '生動的故事與流程引導', value: '請以故事化或引人入勝的步驟流程流向重新規劃圖表版面，強化步驟與步驟之間的箭頭、方向指引或引導線，使圖表讀起來像一條順暢的旅程。' },
            { name: '重點大字極簡風', value: '請採用重點大字高對比極簡風格，大幅縮減說明的細節文字，專注於傳達最核心的一句大口號或核心論點，以大留白、極簡裝飾和俐落邊框呈現。' },
            { name: '資訊模組卡片化', value: '請將內容切分為多個大小一致的資訊模組卡片，並整齊排列在畫面上，每個模組都有獨立的背景色塊與小插圖，方便滑讀。' }
        ]
    };

    function loadCustomStyles(type) {
        try {
            const stored = localStorage.getItem(VARIATION_HUB_STORAGE_PREFIX + type);
            return stored ? JSON.parse(stored) : [];
        } catch (e) {
            console.error('Error loading custom variation styles:', e);
            return [];
        }
    }

    function saveCustomStyles(type, styles) {
        try {
            localStorage.setItem(VARIATION_HUB_STORAGE_PREFIX + type, JSON.stringify(styles));
        } catch (e) {
            console.error('Error saving custom variation styles:', e);
            showToast('儲存自訂風格失敗，可能是儲存空間不足。', { type: 'error' });
        }
    }

    function populateStyleSelect() {
        const customStyles = loadCustomStyles(currentType);
        const allStyles = [...DEFAULT_STYLES[currentType], ...customStyles];
        
        styleSelect.innerHTML = ''; // Clear existing options
        allStyles.forEach((style, index) => {
            const option = document.createElement('option');
            option.value = style.value;
            option.textContent = style.name;
            // Mark custom styles in dropdown
            if (index >= DEFAULT_STYLES[currentType].length) {
                option.textContent = `[自訂] ${style.name}`;
                option.dataset.isCustom = 'true';
                option.dataset.customIndex = index - DEFAULT_STYLES[currentType].length;
            }
            styleSelect.appendChild(option);
        });

        // Set default selection, try to restore previous selection if available
        const currentCustomInput = customInput.value.trim();
        if (currentCustomInput && allStyles.some(s => s.value === currentCustomInput)) {
            styleSelect.value = currentCustomInput;
        } else {
            styleSelect.value = ''; // Default to '隨機驚喜' if no match
            customInput.value = ''; // Also reset custom input if not matching
        }
        
        // Ensure delete button state is correct after populating
        const selectedOption = styleSelect.options[styleSelect.selectedIndex];
        if (selectedOption && selectedOption.dataset.isCustom === 'true') {
            deleteBtn.classList.remove('hidden');
        } else {
            deleteBtn.classList.add('hidden');
        }
    }

    function handleStyleSelectChange() {
        const selectedOption = styleSelect.options[styleSelect.selectedIndex];
        customInput.value = selectedOption.value;
        
        // Show delete button only for custom styles
        if (selectedOption.dataset.isCustom === 'true') {
            deleteBtn.classList.remove('hidden');
        } else {
            deleteBtn.classList.add('hidden');
        }
    }

    function handleCustomInputChange() {
        // If user types, the select dropdown should reflect if it matches a preset.
        // If not, it just means the user is typing a custom value that isn't saved.
        const currentInputValue = customInput.value.trim();
        const selectedOption = styleSelect.options[styleSelect.selectedIndex];
        
        // If current input value matches a default style or custom style, select it in the dropdown.
        const allStyles = [...DEFAULT_STYLES[currentType], ...loadCustomStyles(currentType)];
        const matchingStyle = allStyles.find(s => s.value === currentInputValue);

        if (matchingStyle) {
            styleSelect.value = matchingStyle.value;
            // Re-check delete button visibility based on selection
            const updatedSelectedOption = styleSelect.options[styleSelect.selectedIndex];
            if (updatedSelectedOption && updatedSelectedOption.dataset.isCustom === 'true') {
                deleteBtn.classList.remove('hidden');
            } else {
                deleteBtn.classList.add('hidden');
            }
        } else {
            // If no match, ensure no custom style is selected in dropdown and hide delete button
            styleSelect.value = ''; // Or a special 'custom' option if we add one
            deleteBtn.classList.add('hidden');
        }
    }

    function saveCurrentStyle() {
        const styleName = prompt('請為這個自訂風格命名：');
        if (!styleName || !styleName.trim()) {
            showToast('風格名稱不能為空。', { type: 'error' });
            return;
        }

        const customStyles = loadCustomStyles(currentType);
        const newStyle = { name: styleName.trim(), value: customInput.value.trim() };

        if (!newStyle.value) {
            showToast('自訂指令內容不能為空，請輸入指令後再儲存。', { type: 'error' });
            return;
        }

        // Prevent duplicate names or values
        if (customStyles.some(s => s.name === newStyle.name)) {
            showToast('已有同名風格，請換一個名稱。', { type: 'error' });
            return;
        }
        if (customStyles.some(s => s.value === newStyle.value)) {
            showToast('已有相同指令內容的風格，請勿重複儲存。', { type: 'error' });
            return;
        }

        customStyles.push(newStyle);
        saveCustomStyles(currentType, customStyles);
        populateStyleSelect(); // Re-populate to show new style
        styleSelect.value = newStyle.value; // Select the newly saved style
        showToast('自訂風格已儲存！', { type: 'success' });
        deleteBtn.classList.remove('hidden');
    }

    function deleteCurrentStyle() {
        const selectedOption = styleSelect.options[styleSelect.selectedIndex];
        if (!selectedOption || selectedOption.dataset.isCustom !== 'true') {
            showToast('只能刪除自訂風格。', { type: 'error' });
            return;
        }

        const customIndex = parseInt(selectedOption.dataset.customIndex, 10);
        const customStyles = loadCustomStyles(currentType);

        if (confirm(`您確定要刪除風格範本「${customStyles[customIndex].name}」嗎？`)) {
            customStyles.splice(customIndex, 1);
            saveCustomStyles(currentType, customStyles);
            populateStyleSelect(); // Re-populate
            showToast('自訂風格已刪除。', { type: 'success' });
        }
    }

    function init() {
        modal = document.getElementById('variation-hub-modal');
        titleEl = document.getElementById('variation-hub-title');
        styleSelect = document.getElementById('variation-style-select');
        customInput = document.getElementById('variation-custom-input');
        overrideCheckbox = document.getElementById('variation-override-checkbox');
        saveBtn = document.getElementById('save-variation-preset-btn');
        deleteBtn = document.getElementById('delete-variation-preset-btn');
        cancelBtn = document.getElementById('cancel-variation-btn');
        confirmBtn = document.getElementById('generate-variation-confirm-btn');

        styleSelect.addEventListener('change', handleStyleSelectChange);
        customInput.addEventListener('input', handleCustomInputChange);
        saveBtn.addEventListener('click', saveCurrentStyle);
        deleteBtn.addEventListener('click', deleteCurrentStyle);
        cancelBtn.addEventListener('click', close);
        confirmBtn.addEventListener('click', () => {
            if (currentCallback) {
                const modifier = customInput.value.trim();
                const shouldOverride = overrideCheckbox.checked;
                // Pass the modifier to the callback, or an empty string if "隨機驚喜" was effectively chosen
                currentCallback(modifier === '' && styleSelect.value === '' ? '' : modifier, shouldOverride);
            }
            close();
        });
    }

    function open(type, callback) {
        currentType = type;
        currentCallback = callback;

        titleEl.textContent = `調整 ${
            type === 'blog' ? '部落格文章' :
            type === 'social' ? '社群貼文' :
            type === 'edm' ? '電子報內容' :
            type === 'carousel' ? '社群輪播圖提示詞' :
            type === 'infographic' ? '資訊圖表提示詞' : ''
        } 生成風格`;

        populateStyleSelect();
        overrideCheckbox.checked = false; // Reset checkbox
        modal.classList.remove('hidden');
    }

    function close() {
        modal.classList.add('hidden');
        currentType = '';
        currentCallback = null;
    }

    return {
        init: init,
        open: open,
        close: close
    };
})();

// Ensure it initializes when the DOM is ready
document.addEventListener('DOMContentLoaded', VariationHub.init);