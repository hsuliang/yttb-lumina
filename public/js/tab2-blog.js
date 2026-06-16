/**
 * tab2-blog.js
 * 負責管理第二分頁「部落格文章生成」的所有 UI 互動與 logique。
 */

let quillEditor;

function extractYouTubeId(url) {
    if (!url) return '';
    const trimmed = url.trim();
    if (trimmed.length === 11 && !trimmed.includes('/') && !trimmed.includes('.') && !trimmed.includes('?')) {
        return trimmed;
    }
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|live\/|shorts\/)([^#\&\?]*).*/;
    const match = trimmed.match(regExp);
    return (match && match[2].length === 11) ? match[2] : trimmed;
}

const SETTINGS_STORAGE_KEYS = {
    BLOG_PERSONA: 'aliang-yttb-setting-blog-persona',
    BLOG_WORD_COUNT: 'aliang-yttb-setting-blog-word-count',
    BLOG_TONE: 'aliang-yttb-setting-blog-tone',
    PROMPT_WIZARD: 'aliang-yttb-setting-prompt-wizard'
};
const BLOG_DRAFT_KEY = 'aliang-yttb-draft-blog';

window.hasBlogDraft = function () {
    return localStorage.getItem(BLOG_DRAFT_KEY) !== null;
}

window.restoreBlogDraft = function () {
    try {
        const draftJSON = localStorage.getItem(BLOG_DRAFT_KEY);
        if (!draftJSON) return;
        const draft = JSON.parse(draftJSON);

        document.getElementById('smart-area').value = draft.sourceContent || '';
        state.optimizedTextForBlog = draft.optimizedContent || '';
        state.blogSourceType = draft.sourceType || 'raw';

        document.getElementById('blog-title').value = draft.title || '';
        document.getElementById('blog-yt-id').value = draft.ytId || '';
        document.getElementById('blog-persona').value = draft.persona || '第一人稱視角';
        document.getElementById('blog-word-count').value = draft.wordCount || '約 1200 字';
        document.getElementById('blog-tone').value = draft.tone || '充滿能量與感染力';

        state.currentBlogTags = draft.tags || [];
        if (window.renderTags) window.renderTags();

        if (draft.ctaPreset) {
            document.getElementById('cta-preset-select').value = draft.ctaPreset;
        }
        document.getElementById('blog-cta').value = draft.ctaContent || '';
        if (window.handleCtaChange) window.handleCtaChange();

        const internalLinksEl = document.getElementById('internal-links-source');
        if (internalLinksEl) {
            internalLinksEl.value = draft.internalLinksSource || '';
        }

        if (draft.versions && draft.versions.length > 0) {
            state.blogArticleVersions = draft.versions;
            state.currentVersionIndex = draft.currentVersionIndex || 0;

            renderVersionTabs();
            renderCurrentVersionUI(); // This will now load content into Quill

            document.getElementById('blog-placeholder').classList.add('hidden');
            document.getElementById('blog-output-container').classList.remove('hidden');
            document.getElementById('generate-blog-variation-btn').disabled = false;

            const analyzeKeywordsBtn = document.getElementById('analyze-keywords-btn');
            const analyzeInternalLinksBtn = document.getElementById('analyze-internal-links-btn');
            if (analyzeKeywordsBtn) analyzeKeywordsBtn.disabled = false;
            if (analyzeInternalLinksBtn) analyzeInternalLinksBtn.disabled = false;
        }

        if (window.updateStepperUI) window.updateStepperUI();
        if (window.updateTabAvailability) window.updateTabAvailability();
        if (window.updateAiButtonStatus) window.updateAiButtonStatus();

        showToast('部落格草稿已成功恢復！');
    } catch (e) {
        console.error('無法讀取部落格草稿:', e);
        window.clearBlogDraft();
    }
}

window.clearBlogDraft = function () {
    localStorage.removeItem(BLOG_DRAFT_KEY);
}

function formatQuillVideos(html) {
    if (!html) return '';
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const iframes = doc.querySelectorAll('iframe.ql-video');

        iframes.forEach(iframe => {
            const src = iframe.getAttribute('src');
            if (src && src.includes('youtube.com/embed')) {
                const newIframe = doc.createElement('iframe');
                newIframe.setAttribute('style', 'width: 100%; aspect-ratio: 16/9;');
                newIframe.setAttribute('title', 'YouTube video player');
                newIframe.setAttribute('src', src);
                newIframe.setAttribute('frameborder', '0');
                newIframe.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
                newIframe.setAttribute('allowfullscreen', 'allowfullscreen');
                iframe.parentNode.replaceChild(newIframe, iframe);
            }
        });
        return doc.body.innerHTML;
    } catch (e) {
        console.error('Error formatting Quill videos:', e);
        return html;
    }
}

function getLatestHtmlContent() {
    if (!quillEditor) return '';
    return formatQuillVideos(quillEditor.root.innerHTML);
}

function convertHtmlToMarkdown(htmlContent) {
    if (!htmlContent) return '';
    let content = htmlContent;
    content = content.replace(/<div class="youtube-embed">.*?<\/div>/g, '[YouTube 影片]\n');
    content = content.replace(/<iframe[^>]*src="[^"]*youtube\.com\/embed\/[^"]*"[^>]*><\/iframe>/g, '[YouTube 影片]\n');
    content = content.replace(/<h3>(.*?)<\/h3>/g, '### $1');
    content = content.replace(/<h2>(.*?)<\/h2>/g, '## $1');
    content = content.replace(/<h1>(.*?)<\/h1>/g, '# $1');
    content = content.replace(/<hr\s*\/?>/g, '\n---\n');
    content = content.replace(/<strong>(.*?)<\/strong>/g, '**$1**');
    content = content.replace(/<em>(.*?)<\/em>/g, '*$1*');
    content = content.replace(/<li>(.*?)<\/li>/g, (match, p1) => `* ${p1.replace(/<p>|<\/p>/g, '')}\n`);
    content = content.replace(/<ul>/g, '').replace(/<\/ul>/g, '');
    content = content.replace(/<a href="(.*?)"[^>]*>(.*?)<\/a>/g, '[$2]($1)');
    content = content.replace(/<p><br><\/p>/g, '\n');
    content = content.replace(/<p>/g, '').replace(/<\/p>/g, '\n');
    content = content.replace(/<[^>]*>/g, '');
    content = content.replace(/\n{3,}/g, '\n\n');
    return content.trim();
}


function cleanHtml(html) {
    if (!html) return '';
    let cleaned = html;
    cleaned = cleaned.replace(/```html/g, '').replace(/```/g, '').trim();
    cleaned = cleaned.replace(/<p>(\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '');
    cleaned = cleaned.replace(/<\/h2>\s*(<p><br><\/p>)/gi, '</h2>');
    cleaned = cleaned.replace(/>\s+</g, '><');
    return cleaned.trim();
}

window.updateStepperUI = function () {
    const step1 = document.getElementById('stepper-step-1');
    const step2 = document.getElementById('stepper-step-2');
    const step3 = document.getElementById('stepper-step-3');

    [step1, step2, step3].forEach(step => step.classList.remove('active', 'completed'));

    const hasSourceContent = document.getElementById('smart-area').value.trim().length > 0;
    const isOptimized = state.blogSourceType === 'optimized' || state.blogSourceType === 'blog';
    const hasGeneratedBlog = state.blogArticleVersions.length > 0;

    if (hasSourceContent || window.hasBlogDraft()) { step1.classList.add('completed'); }
    else { step1.classList.add('active'); return; }

    if (isOptimized) { step2.classList.add('completed'); }
    else { step2.classList.add('active'); }

    if (hasGeneratedBlog) {
        step1.classList.add('completed');
        step2.classList.add('completed');
        step3.classList.add('completed');
        document.getElementById('generate-blog-btn').textContent = "重新生成文章";
    } else if (hasSourceContent || window.hasBlogDraft()) {
        step3.classList.add('active');
        document.getElementById('generate-blog-btn').textContent = "生成部落格文章";
    }
};

// ########## REFACTORED: ADDED isRetry PARAMETER ##########
function assembleBlogPrompt(options) {
    const { persona, tone, wordCount, tagsString, sourceText, variationModifier, isRetry = false, shouldOverride = false } = options;
    const wizardSettings = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEYS.PROMPT_WIZARD)) || {};
    let rules = [];

    if (isRetry) {
        rules.push("- **最高優先級指令**: 你上次的回應格式不正確。這次請務必、絕對要嚴格遵循 [ARTICLE_START] 和 [SEO_START] 的分隔標記來組織你的完整回應。");
    }

    if (variationModifier) { rules.push(`- 風格變化指令: ${variationModifier}`); }
    if (wizardSettings.structSummary) { rules.push('- 文章開頭：請自動產生一段「前言摘要」，用 <p> 標籤包圍。'); }
    else if (wizardSettings.structPoints) { rules.push('- 文章開頭：請自動條列出 2-5 點「本集重點」，並用 <ul><li>...</li></ul> 結構。'); }
    rules.push(`- 寫作人稱：${persona}`);

    if (!variationModifier || !shouldOverride) {
        const toneFinetune = wizardSettings.toneFinetune ? ` (${wizardSettings.toneFinetune})` : '';
        rules.push(`- 寫作語氣：${tone}${toneFinetune}`);
    }

    rules.push(`- 文章字數：${wordCount}`);
    if (tagsString) rules.push(`- 指定標籤：${tagsString}`);
    let h2_style_rule = "每個段落都需要一個簡潔有力的小標題";
    if (wizardSettings.h2Style === 'question') { h2_style_rule = "每個段落都需要一個帶有疑問句、引發好奇的小標題"; }
    else if (wizardSettings.h2Style === 'emoji') { h2_style_rule = "每個段落都需要一個活潑有趣、可加入 Emoji 的小標題"; }
    rules.push(`- 格式要求：每個小標題用 <h2> 標籤包圍，其後的內文用 <p> 標籤包圍。`);
    if (wizardSettings.elemBold) { rules.push('- 特殊元素：請在內文中適度將重要的關鍵字詞加上 <strong> 粗體標籤。'); }
    if (wizardSettings.elemTable) { rules.push('- 特殊元素：請在文章結尾處，自動生成一個「重點回顧」的 HTML 表格(<table>)，總結文章要點。'); }
    if (wizardSettings.elemQuote) { rules.push('- 特殊元素：請在文章內文中，選擇一句最精彩的「金句」，並用 <blockquote> 標籤將其引用出來。'); }

    rules.push('- **重要限制**: 你的輸出內容中，絕對不可以包含 YouTube 嵌入代碼或任何 CTA (行動呼籲) 內容。也不要包含 `<h1>` 標題，主標題將由前端處理。');
    rules.push('- **分隔線 (極重要)**: 在每一組「<h2>大標題 + 內文」的完整區塊結束後，必須輸出並加上一條 `<hr>` 水平分隔線標籤，作為段落區塊之間的分隔。');

    const finalRules = rules.join('\n');
    return `你是一位專業的部落格小編，你的任務是將[逐字稿]轉換成一篇格式良好、語氣自然的部落格文章。

你的工作分為兩個部分。請嚴格按照以下格式與分隔標記輸出，不要有任何額外的文字或說明。

[ARTICLE_START]
請仔細閱讀下方提供的[逐字稿]，並根據以下[規則]撰寫一篇部落格文章。
[ARTICLE_END]

[SEO_START]
根據你寫好的文章內容，提供以下 SEO 建議。
- SEO 標題: [請在此生成 SEO 標題]
- 搜尋描述: [請在此生成一段約 150 字的搜尋描述]
- 固定網址: [請在此生成小寫英文、單字用-連接的網址]
- 標籤: [請根據文章內容和上方指定的標籤，生成最合適的標籤組合，用半形逗號,隔開]
[SEO_END]

[規則]:
${finalRules}

[逐字稿]:
---
${sourceText}
---`;
}


function renderKeywords(keywordsData) {
    const coreList = document.getElementById('seo-keywords-core');
    const longtailList = document.getElementById('seo-keywords-longtail');
    const resultContainer = document.getElementById('keywords-result-container');
    coreList.innerHTML = '';
    longtailList.innerHTML = '';
    if (keywordsData && keywordsData.core_keywords && keywordsData.core_keywords.length > 0) {
        keywordsData.core_keywords.forEach(kw => { const li = document.createElement('li'); li.textContent = kw; coreList.appendChild(li); });
    } else { coreList.innerHTML = '<li>無建議</li>'; }
    if (keywordsData && keywordsData.long_tail_keywords && keywordsData.long_tail_keywords.length > 0) {
        keywordsData.long_tail_keywords.forEach(kw => { const li = document.createElement('li'); li.textContent = kw; longtailList.appendChild(li); });
    } else { longtailList.innerHTML = '<li>無建議</li>'; }
    resultContainer.classList.remove('hidden');
}

function renderInternalLinks(linksData) {
    const resultContainer = document.getElementById('internal-links-result-container');
    resultContainer.innerHTML = '';
    if (!linksData || linksData.length === 0) {
        resultContainer.innerHTML = `<p class="text-sm text-[var(--gray-text)] text-center p-2">找不到合適的內部連結建議。</p>`;
        return;
    }
    linksData.forEach(suggestion => {
        const card = document.createElement('div');
        card.className = 'internal-link-suggestion';
        card.innerHTML = `
            <strong>建議錨點文字：</strong><p>${suggestion.anchor_text}</p>
            <strong class="mt-2">上下文句子：</strong><blockquote>${suggestion.context_sentence}</blockquote>
            <div class="suggestion-target">
                <strong>建議連結至：</strong><p><a href="${suggestion.suggested_link_url}" target="_blank" rel="noopener">${suggestion.suggested_link_title}</a></p>
            </div>`;
        resultContainer.appendChild(card);
    });
}

function renderVersionTabs() {
    const tabsContainer = document.getElementById('blog-versions-tabs-container');
    tabsContainer.innerHTML = '';
    state.blogArticleVersions.forEach((version, index) => {
        const tab = document.createElement('button');
        tab.className = 'tab-btn text-sm py-2 px-4';
        tab.textContent = `版本 ${index + 1}`;
        if (index === state.currentBlogVersionIndex) { tab.classList.add('active'); }
        tab.addEventListener('click', () => switchVersionView(index));
        tabsContainer.appendChild(tab);
    });
}

function switchVersionView(index) {
    if (state.blogArticleVersions[state.currentBlogVersionIndex]) {
        state.blogArticleVersions[state.currentBlogVersionIndex].htmlContent = getLatestHtmlContent();
    }
    state.currentBlogVersionIndex = index;
    renderVersionTabs();
    renderCurrentVersionUI();
}

function renderCurrentVersionUI() {
    const currentVersion = state.blogArticleVersions[state.currentBlogVersionIndex];
    if (!currentVersion) return;

    if (quillEditor) {
        const contentToLoad = currentVersion.htmlContent;
        if (getLatestHtmlContent() !== contentToLoad) {
            quillEditor.root.innerHTML = contentToLoad;
        }
    }

    const latestHtml = getLatestHtmlContent();
    document.getElementById('html-source-preview').value = latestHtml;
    document.getElementById('markdown-source-preview').value = convertHtmlToMarkdown(latestHtml);

    document.getElementById('seo-title-text').textContent = currentVersion.seoData.title;
    document.getElementById('seo-description-text').textContent = currentVersion.seoData.description;
    document.getElementById('seo-permalink-text').textContent = currentVersion.seoData.permalink;
    document.getElementById('seo-tags-text').textContent = currentVersion.seoData.tags;
    if (currentVersion.advancedSeoData.keywords) {
        renderKeywords(currentVersion.advancedSeoData.keywords);
    } else { document.getElementById('keywords-result-container').classList.add('hidden'); }
    if (currentVersion.advancedSeoData.internalLinks) {
        renderInternalLinks(currentVersion.advancedSeoData.internalLinks);
    } else { document.getElementById('internal-links-result-container').innerHTML = ''; }
}


function initializeTab2() {
    const generateBlogBtn = document.getElementById('generate-blog-btn');
    const generateBlogVariationBtn = document.getElementById('generate-blog-variation-btn');
    const optimizeTextForBlogBtn = document.getElementById('optimize-text-for-blog-btn');
    const blogTitleInput = document.getElementById('blog-title');
    const blogYtIdInput = document.getElementById('blog-yt-id');
    const blogPersonaSelect = document.getElementById('blog-persona');
    const blogWordCountSelect = document.getElementById('blog-word-count');
    const blogToneSelect = document.getElementById('blog-tone');
    const ctaPresetSelect = document.getElementById('cta-preset-select');
    const blogCtaTextarea = document.getElementById('blog-cta');
    const blogOutputContainer = document.getElementById('blog-output-container');
    const blogPlaceholder = document.getElementById('blog-placeholder');
    const downloadHtmlBtn = document.getElementById('download-html-btn');
    const downloadMdBtn = document.getElementById('download-md-btn');
    const allBlogViewButtons = document.querySelectorAll('.blog-view-btn');
    const saveCtaBtn = document.getElementById('save-cta-btn');
    const deleteCtaBtn = document.getElementById('delete-cta-btn');
    const tagInput = document.getElementById('tag-input');
    const saveTagsBtn = document.getElementById('save-tags-btn');
    const aiStyleToggleBtn = document.getElementById('ai-style-toggle-btn');
    const aiStylePanel = document.getElementById('ai-style-panel');
    const seoToggleBtn = document.getElementById('seo-toggle-btn');
    const seoPanel = document.getElementById('seo-panel');
    const advancedSeoToggleBtn = document.getElementById('advanced-seo-toggle-btn');
    const advancedSeoPanel = document.getElementById('advanced-seo-panel');
    const analyzeKeywordsBtn = document.getElementById('analyze-keywords-btn');
    const analyzeInternalLinksBtn = document.getElementById('analyze-internal-links-btn');
    const internalLinksSource = document.getElementById('internal-links-source');
    const openPromptWizardBtn = document.getElementById('open-prompt-wizard-btn');
    const promptWizardModal = document.getElementById('prompt-wizard-modal');
    const closePromptWizardBtn = document.getElementById('close-prompt-wizard-btn');
    const savePromptWizardBtn = document.getElementById('save-prompt-wizard-btn');
    const restorePromptDefaultsBtn = document.getElementById('restore-prompt-defaults-btn');
    const wizardStructSummary = document.getElementById('wizard-struct-summary');
    const wizardStructPoints = document.getElementById('wizard-struct-points');
    const wizardStructNone = document.getElementById('wizard-struct-none');
    const wizardToneFinetune = document.getElementById('wizard-tone-finetune');
    const wizardElemBold = document.getElementById('wizard-elem-bold');
    const wizardElemTable = document.getElementById('wizard-elem-table');
    const wizardElemQuote = document.getElementById('wizard-elem-quote');

    function openPromptWizard() {
        loadAndPopulateWizard();
        promptWizardModal.classList.remove('hidden');
    }

    function closePromptWizard() {
        promptWizardModal.classList.add('hidden');
    }

    function savePromptSettings() {
        const settings = {
            structSummary: wizardStructSummary.checked,
            structPoints: wizardStructPoints.checked,
            structNone: wizardStructNone.checked,
            h2Style: document.querySelector('input[name="wizard-h2-style"]:checked').value,
            elemBold: wizardElemBold.checked,
            elemTable: wizardElemTable.checked,
            elemQuote: wizardElemQuote.checked,
            toneFinetune: wizardToneFinetune.value.trim()
        };
        localStorage.setItem(SETTINGS_STORAGE_KEYS.PROMPT_WIZARD, JSON.stringify(settings));
        showToast('AI 寫作風格已儲存！');
        closePromptWizard();
    }

    function restoreDefaultSettings() {
        if (confirm('您確定要清除所有自訂風格，並恢復為預設設定嗎？')) {
            localStorage.removeItem(SETTINGS_STORAGE_KEYS.PROMPT_WIZARD);
            loadAndPopulateWizard();
            showToast('已恢復為預設寫作風格。');
        }
    }

    function loadAndPopulateWizard() {
        const settings = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEYS.PROMPT_WIZARD)) || {};
        wizardStructSummary.checked = settings.structSummary || false;
        wizardStructPoints.checked = settings.structPoints || false;
        wizardStructNone.checked = settings.structNone || false;

        document.querySelector(`input[name="wizard-h2-style"][value="${settings.h2Style || 'default'}"]`).checked = true;

        wizardElemBold.checked = settings.elemBold || false;
        wizardElemTable.checked = settings.elemTable || false;
        wizardElemQuote.checked = settings.elemQuote || false;

        wizardToneFinetune.value = settings.toneFinetune || '';
    }

    function handleStructureCheck() {
        if (this.id === 'wizard-struct-none' && this.checked) {
            wizardStructSummary.checked = false;
            wizardStructPoints.checked = false;
        } else if (this.id !== 'wizard-struct-none' && this.checked) {
            wizardStructNone.checked = false;
        }
    }

    function saveSetting(key, value) { try { localStorage.setItem(key, value); } catch (e) { console.error(`無法儲存設定 ${key}:`, e); } }

    function loadSettings() {
        const persona = localStorage.getItem(SETTINGS_STORAGE_KEYS.BLOG_PERSONA);
        if (persona) blogPersonaSelect.value = persona;
        blogWordCountSelect.value = localStorage.getItem(SETTINGS_STORAGE_KEYS.BLOG_WORD_COUNT) || '約 1200 字';
        const tone = localStorage.getItem(SETTINGS_STORAGE_KEYS.BLOG_TONE);
        if (tone) blogToneSelect.value = tone;
    }

    function saveBlogDraft() {
        const hasContent = document.getElementById('smart-area').value.trim().length > 0;
        if (!hasContent && state.blogArticleVersions.length === 0 && !getLatestHtmlContent()) return;

        if (state.blogArticleVersions[state.currentBlogVersionIndex]) {
            state.blogArticleVersions[state.currentBlogVersionIndex].htmlContent = getLatestHtmlContent();
        }

        const draft = {
            sourceContent: document.getElementById('smart-area').value,
            optimizedContent: state.optimizedTextForBlog,
            sourceType: state.blogSourceType,
            title: blogTitleInput.value, ytId: blogYtIdInput.value,
            persona: blogPersonaSelect.value, wordCount: blogWordCountSelect.value, tone: blogToneSelect.value,
            tags: state.currentBlogTags, ctaPreset: ctaPresetSelect.value, ctaContent: blogCtaTextarea.value,
            versions: state.blogArticleVersions,
            currentVersionIndex: state.currentBlogVersionIndex,
            internalLinksSource: internalLinksSource ? internalLinksSource.value : '',
            timestamp: new Date().getTime(),
        };
        try { localStorage.setItem(BLOG_DRAFT_KEY, JSON.stringify(draft)); }
        catch (e) { console.error('無法儲存部落格草稿:', e); }
    }

    window.handleCtaChange = function () {
        const selected = ctaPresetSelect.value;
        saveCtaBtn.classList.toggle('hidden', selected !== 'custom');
        deleteCtaBtn.classList.toggle('hidden', !selected.startsWith('custom_'));
        if (selected.startsWith('custom_')) { const customCtas = loadCustomCTAsFromStorage(); const index = parseInt(selected.split('_')[1], 10); blogCtaTextarea.value = customCtas[index]?.content || ''; blogCtaTextarea.readOnly = true; }
        else if (PRESET_CTAS[selected]) { blogCtaTextarea.value = PRESET_CTAS[selected].content; blogCtaTextarea.readOnly = true; }
        else { blogCtaTextarea.value = ''; blogCtaTextarea.readOnly = false; blogCtaTextarea.placeholder = '可在此自訂 CTA，或選擇上方預設'; }
    }
    function loadCustomCTAsFromStorage() { try { const storedCtas = localStorage.getItem(CUSTOM_CTA_STORAGE_KEY); return storedCtas ? JSON.parse(storedCtas) : []; } catch (error) { console.error("無法讀取自訂 CTA:", error); return []; } }
    function renderCtaSelect(selectedValue = 'custom') { const customCtas = loadCustomCTAsFromStorage(); let allCtaOptions = { 'custom': '自訂 CTA', ...Object.fromEntries(Object.entries(PRESET_CTAS).map(([key, value]) => [key, value.title])) }; customCtas.forEach((cta, index) => { allCtaOptions[`custom_${index}`] = `[自訂] ${cta.title}`; }); const currentVal = ctaPresetSelect.value; populateSelectWithOptions(ctaPresetSelect, allCtaOptions); ctaPresetSelect.value = allCtaOptions[currentVal] ? currentVal : selectedValue; }
    function addTag(tagText) { const trimmedTag = tagText.trim(); if (trimmedTag && !state.currentBlogTags.includes(trimmedTag)) { state.currentBlogTags.push(trimmedTag); renderTags(); saveBlogDraft(); } }
    function removeTag(tagToRemove) { state.currentBlogTags = state.currentBlogTags.filter(tag => tag !== tagToRemove); renderTags(); saveBlogDraft(); }
    window.renderTags = function () { const tagContainer = document.getElementById('tag-container'); tagContainer.querySelectorAll('.tag-pill').forEach(pill => pill.remove());[...state.currentBlogTags].reverse().forEach(tag => { const pill = document.createElement('span'); pill.className = 'tag-pill'; pill.textContent = tag; const deleteBtn = document.createElement('span'); deleteBtn.className = 'tag-delete-btn'; deleteBtn.innerHTML = '&times;'; deleteBtn.setAttribute('role', 'button'); deleteBtn.setAttribute('tabindex', '0'); deleteBtn.addEventListener('click', () => removeTag(tag)); pill.appendChild(deleteBtn); tagContainer.prepend(pill); }); }
    function loadCustomTagsFromStorage() { try { const storedTags = localStorage.getItem(CUSTOM_TAGS_STORAGE_KEY); return storedTags ? JSON.parse(storedTags) : []; } catch (error) { console.error("無法讀取自訂標籤:", error); return []; } }
    function renderTagSuggestions() { const tagSuggestions = document.getElementById('tag-suggestions'); tagSuggestions.innerHTML = ''; const customTags = loadCustomTagsFromStorage(); const allSuggestions = [...new Set([...PRESET_TAGS, ...customTags])]; allSuggestions.forEach(tag => { const suggestion = document.createElement('span'); suggestion.className = 'tag-suggestion'; suggestion.textContent = tag; suggestion.setAttribute('role', 'button'); suggestion.setAttribute('tabindex', '0'); suggestion.addEventListener('click', () => { addTag(tag); }); tagSuggestions.appendChild(suggestion); }); }

    function confirmUseOptimizedText(text) {
        state.optimizedTextForBlog = text;
        state.blogSourceType = 'optimized';

        if (quillEditor) {
            const html = `<p>${text.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;
            quillEditor.root.innerHTML = html;
        }

        if (window.updateSourceStatusUI) window.updateSourceStatusUI();
        saveBlogDraft();
        hideModal();
        showToast('文本已優化並載入編輯器！');
        window.updateStepperUI();
        if (window.updateTabAvailability) window.updateTabAvailability();
    }

    function switchBlogView(viewToShow) {
        allBlogViewButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.blogView === viewToShow));
        document.querySelectorAll('.blog-view-content').forEach(content => content.classList.toggle('hidden', content.id !== `blog-view-${viewToShow}`));

        if (viewToShow === 'html' || viewToShow === 'markdown') {
            const latestHtml = getLatestHtmlContent();
            document.getElementById('html-source-preview').value = latestHtml;
            document.getElementById('markdown-source-preview').value = convertHtmlToMarkdown(latestHtml);
        }
    }

    function resetTab2() {
        state.blogSourceType = 'raw'; state.optimizedTextForBlog = ''; state.blogArticleVersions = []; state.currentBlogVersionIndex = 0;
        if (window.updateSourceStatusUI) window.updateSourceStatusUI();
        blogOutputContainer.classList.add('hidden'); blogPlaceholder.classList.remove('hidden');
        blogTitleInput.value = ''; blogYtIdInput.value = '';
        ctaPresetSelect.value = 'custom'; handleCtaChange();
        state.currentBlogTags = []; renderTags();
        if (quillEditor) quillEditor.setText('');
        window.clearBlogDraft(); window.updateStepperUI();
        renderVersionTabs();
        generateBlogVariationBtn.disabled = true;
    }
    function saveCustomCTA() { const content = blogCtaTextarea.value.trim(); if (!content) { showModal({ title: '錯誤', message: 'CTA 內容不能為空。' }); return; } const title = prompt('請為這個 CTA 命名（例如：我的個人 Blog 宣傳）：'); if (!title || !title.trim()) { return; } const customCtas = loadCustomCTAsFromStorage(); const newCta = { title: title.trim(), content }; customCtas.push(newCta); try { localStorage.setItem(CUSTOM_CTA_STORAGE_KEY, JSON.stringify(customCtas)); showToast('自訂 CTA 已儲存！'); const newKey = `custom_${customCtas.length - 1}`; renderCtaSelect(newKey); handleCtaChange(); } catch (error) { console.error("無法儲存自訂 CTA:", error); showModal({ title: '儲存失敗', message: '無法儲存 CTA，可能是儲存空間已滿。' }); } }
    function deleteCustomCTA() { const selectedValue = ctaPresetSelect.value; if (!selectedValue.startsWith('custom_')) return; const customCtas = loadCustomCTAsFromStorage(); const index = parseInt(selectedValue.split('_')[1], 10); const ctaToDelete = customCtas[index]; if (!ctaToDelete) return; if (confirm(`您確定要刪除「${ctaToDelete.title}」這個 CTA 嗎？`)) { customCtas.splice(index, 1); localStorage.setItem(CUSTOM_CTA_STORAGE_KEY, JSON.stringify(customCtas)); showToast('自訂 CTA 已刪除。'); renderCtaSelect('custom'); handleCtaChange(); } }
    function saveCustomTagsToStorage() { const customTags = loadCustomTagsFromStorage(); const allTags = new Set([...customTags, ...state.currentBlogTags]); const newCustomTags = [...allTags].filter(tag => !PRESET_TAGS.includes(tag)); try { localStorage.setItem(CUSTOM_TAGS_STORAGE_KEY, JSON.stringify(newCustomTags)); showToast('自訂標籤庫已更新！'); renderTagSuggestions(); } catch (error) { console.error("無法儲存自訂標籤:", error); showModal({ title: '儲存失敗', message: '無法儲存標籤，可能是儲存空間已滿。' }); } }
    function initializeTags() { renderTagSuggestions(); tagInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput.value); tagInput.value = ''; } }); saveTagsBtn.addEventListener('click', saveCustomTagsToStorage); }

    async function optimizeTextForBlog() {
        const apiKey = window.getBalancedApiKey ? window.getBalancedApiKey() : (localStorage.getItem('geminiApiKey') || sessionStorage.getItem('geminiApiKey'));
        if (!apiKey) { if (window.showApiKeyModal) window.showApiKeyModal(); return; }

        // 1. 定義來源：優先檢查是否有「已整理」的文本，若無則取用輸入框的原始文本
        const processedContent = state.processedSrtResult ? state.processedSrtResult.trim() : '';
        const rawContent = document.getElementById('smart-area').value.trim();

        // 2. 定義執行 AI 優化的內部函式 (避免程式碼重複)
        const executeOptimization = async (contentToUse) => {
            const prompt = `你是一位專業的文案編輯。請將以下的 SRT 字幕逐字稿，優化成一篇流暢易讀的純文字文章。\n規則：\n1. 加上適當的標點符號與段落，讓文章更通順。\n2. 絕對不可以改寫、改變原文的語意。\n3. 不可新增任何字幕中沒有的資訊或自己的評論。\n4. 修正明顯的錯別字，但保留口語化的風格。\n5. 移除所有時間戳和行號。\n6. 直接輸出優化後的文章，不要有任何前言或結語。\n\n字幕逐字稿如下：\n---\n${contentToUse}\n---`;

            showModal({ title: 'AI 優化中...', showProgressBar: true, taskType: 'optimize' });
            const btn = optimizeTextForBlogBtn;
            btn.disabled = true;
            btn.classList.add('btn-loading');

            try {
                const result = await callGeminiAPI(apiKey, prompt);
                showModal({
                    title: '文本優化完成',
                    message: result,
                    showCopyButton: false,
                    large: true,
                    buttons: [
                        {
                            text: '複製內容',
                            class: 'btn-secondary',
                            callback: (e) => {
                                navigator.clipboard.writeText(result).then(() => {
                                    const btn = e.target;
                                    const originalText = btn.textContent;
                                    btn.textContent = '已複製！';
                                    setTimeout(() => { btn.textContent = originalText; }, 2000);
                                }).catch(err => {
                                    console.error('複製失敗: ', err);
                                    const btn = e.target;
                                    btn.textContent = '複製失敗';
                                    setTimeout(() => { btn.textContent = '複製內容'; }, 2000);
                                });
                            }
                        },
                        {
                            text: '下載此版本',
                            class: 'btn-secondary',
                            callback: () => {
                                const blob = new Blob([result], { type: 'text/plain;charset=utf-8' });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = `${document.getElementById('blog-title').value.trim() || 'optimized_text'}.txt`;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                                URL.revokeObjectURL(url);
                            }
                        },
                        { text: '取消', class: 'btn-secondary', callback: hideModal },
                        { text: '確認使用此版本', class: 'btn-primary', callback: () => confirmUseOptimizedText(result) }
                    ]
                });
            } catch (error) {
                if (error.message && error.message.includes('overloaded')) {
                    showModal({
                        title: 'AI 正在尖峰時段，請稍候！',
                        message: '別擔心...',
                        buttons: [
                            { text: '關閉', class: 'btn-secondary', callback: hideModal },
                            { text: '立即重試', class: 'btn-primary', callback: () => { hideModal(); executeOptimization(contentToUse); } }
                        ]
                    });
                } else {
                    showModal({ title: 'AI 處理失敗', message: `發生錯誤：${error.message}` });
                }
            } finally {
                btn.disabled = false;
                btn.classList.remove('btn-loading');
            }
        };

        // 3. 邏輯判斷流程
        if (processedContent) {
            // 情況 A：已經有整理過的文本 -> 直接執行
            await executeOptimization(processedContent);
        } else if (rawContent) {
            // 情況 B：只有原始文本 (未經過 Tab 1 整理) -> 詢問使用者
            showModal({
                title: '提醒：尚未整理字幕',
                message: '系統偵測到您尚未在分頁 1 執行「開始整理」。\n\n直接使用原始字幕（包含時間軸與換行）進行優化，可能會因為雜訊過多影響 AI 的產出品質。\n\n建議您先回到分頁 1 點擊「開始整理」按鈕。',
                buttons: [
                    { text: '取消，回去整理', class: 'btn-secondary', callback: hideModal },
                    {
                        text: '沒關係，繼續執行', class: 'btn-primary', callback: () => {
                            hideModal();
                            executeOptimization(rawContent);
                        }
                    }
                ]
            });
        } else {
            // 情況 C：完全沒有內容
            showModal({ title: '錯誤', message: '請先在「智慧區域」中輸入內容。' });
        }
    }

    async function analyzeKeywords() {
        const apiKey = window.getBalancedApiKey ? window.getBalancedApiKey() : (localStorage.getItem('geminiApiKey') || sessionStorage.getItem('geminiApiKey'));
        if (!apiKey) { if (window.showApiKeyModal) window.showApiKeyModal(); return; }

        const currentHtml = getLatestHtmlContent();
        if (!currentHtml) {
            showToast('請先生成部落格文章後再分析關鍵字。', { type: 'error' });
            return;
        }

        const prompt = `你是一位 SEO 專家。請根據以下這篇部落格文章，分析並提取出 5 個核心關鍵字和 5 個長尾關鍵字。請以嚴格的 JSON 格式輸出，不要有任何 markdown 標記，結構如下：\n{ "core_keywords": ["關鍵字1", "關鍵字2", ...], "long_tail_keywords": ["長尾關鍵字1", "長尾關鍵字2", ...] }\n\n文章內容：\n---\n${currentHtml.replace(/<[^>]+>/g, ' ')}\n---`;

        analyzeKeywordsBtn.disabled = true;
        document.getElementById('keywords-loader').classList.remove('hidden');
        document.getElementById('keywords-result-container').classList.add('hidden');
        try {
            const jsonString = await callGeminiAPI(apiKey, prompt, true);
            const jsonData = JSON.parse(jsonString);
            state.blogArticleVersions[state.currentBlogVersionIndex].advancedSeoData.keywords = jsonData;
            renderKeywords(jsonData);
            saveBlogDraft();
        } catch (error) {
            console.error("關鍵字分析失敗:", error);
            if (error.message && error.message.includes('overloaded')) {
                showModal({
                    title: 'AI 正在尖峰時段，請稍候！',
                    message: '目前模型負載過高，您可以稍後再試。',
                    buttons: [
                        { text: '關閉', class: 'btn-secondary', callback: hideModal },
                        { text: '立即重試', class: 'btn-primary', callback: () => { hideModal(); analyzeKeywords(); } }
                    ]
                });
            } else {
                let errorMessage = '關鍵字分析失敗，請重試。';
                if (error instanceof SyntaxError) {
                    errorMessage = 'AI 回應格式錯誤，無法解析。請重試。';
                }
                showToast(errorMessage, { type: 'error' });
                document.getElementById('keywords-result-container').classList.remove('hidden');
                document.getElementById('seo-keywords-core').innerHTML = '<li>分析失敗</li>';
                document.getElementById('seo-keywords-longtail').innerHTML = '<li>分析失敗</li>';
            }
        } finally {
            analyzeKeywordsBtn.disabled = false;
            document.getElementById('keywords-loader').classList.add('hidden');
        }
    }

    async function analyzeInternalLinks() {
        const apiKey = window.getBalancedApiKey ? window.getBalancedApiKey() : (localStorage.getItem('geminiApiKey') || sessionStorage.getItem('geminiApiKey'));
        if (!apiKey) { if (window.showApiKeyModal) window.showApiKeyModal(); return; }

        const currentHtml = getLatestHtmlContent();
        const linksSourceText = internalLinksSource.value.trim();

        if (!currentHtml) {
            showToast('請先生成部落格文章。', { type: 'error' });
            return;
        }
        if (!linksSourceText) {
            showToast('請貼上您的網站文章列表。', { type: 'error' });
            return;
        }

        const prompt = `你是一位網站內容策略師。下方有 [新文章] 和一份 [現有文章列表]。請從 [新文章] 中找出 2-3 個最適合安插內部連結的句子或詞彙，並建議可以連結到 [現有文章列表] 中的哪篇文章。請以嚴格的 JSON 格式輸出，不要有任何 markdown 標記，結構如下：\n[{ "anchor_text": "建議的錨點文字", "context_sentence": "包含錨點文字的完整上下文句子", "suggested_link_url": "從列表中找到對應的完整網址", "suggested_link_title": "從列表中找到對應的文章標題" }]\n\n[新文章]:\n---\n${currentHtml.replace(/<[^>]+>/g, ' ')}\n---\n\n[現有文章列表]:\n---\n${linksSourceText}\n---`;

        analyzeInternalLinksBtn.disabled = true;
        document.getElementById('internal-links-loader').classList.remove('hidden');
        document.getElementById('internal-links-result-container').innerHTML = '';

        try {
            const jsonString = await callGeminiAPI(apiKey, prompt, true);
            const jsonData = JSON.parse(jsonString);
            state.blogArticleVersions[state.currentBlogVersionIndex].advancedSeoData.internalLinks = jsonData;
            renderInternalLinks(jsonData);
            saveBlogDraft();
        } catch (error) {
            console.error("內部連結分析失敗:", error);
            if (error.message && error.message.includes('overloaded')) {
                showModal({
                    title: 'AI 正在尖峰時段，請稍候！',
                    message: '目前模型負載過高，您可以稍後再試。',
                    buttons: [
                        { text: '關閉', class: 'btn-secondary', callback: hideModal },
                        { text: '立即重試', class: 'btn-primary', callback: () => { hideModal(); analyzeInternalLinks(); } }
                    ]
                });
            } else {
                let errorMessage = '內部連結分析失敗，請重試。';
                if (error instanceof SyntaxError) {
                    errorMessage = 'AI 回應格式錯誤，無法解析。請重試。';
                }
                showToast(errorMessage, { type: 'error' });
                document.getElementById('internal-links-result-container').innerHTML = `<p class="text-sm text-red-500 text-center p-2">分析失敗，請檢查您的輸入或稍後重試。</p>`;
            }
        } finally {
            analyzeInternalLinksBtn.disabled = false;
            document.getElementById('internal-links-loader').classList.add('hidden');
        }
    }

    // ########## FINAL ROBUST VERSION WITH SMART RETRY ##########
    async function proceedGenerateBlogPost(variationModifier = '', shouldOverride = false) {
        const apiKey = window.getBalancedApiKey ? window.getBalancedApiKey() : (localStorage.getItem('geminiApiKey') || sessionStorage.getItem('geminiApiKey'));
        if (!apiKey) { if (window.showApiKeyModal) window.showApiKeyModal(); return; }

        const sourceText = (state.blogSourceType === 'optimized') ? state.optimizedTextForBlog : (state.processedSrtResult ? state.processedSrtResult.trim() : document.getElementById('smart-area').value.trim());
        if (!sourceText) { showModal({ title: '錯誤', message: '缺少文章生成的來源內容。' }); return; }

        // === Determine if this is a variation based on modifier presence ===
        const isVariation = variationModifier !== '';
        if (isVariation && state.blogArticleVersions[state.currentBlogVersionIndex]) {
            console.log(`Saving content of Version ${state.currentBlogVersionIndex + 1} before generating new one.`);
            state.blogArticleVersions[state.currentBlogVersionIndex].htmlContent = getLatestHtmlContent();
        }
        // === END FIX ===

        let tone = blogToneSelect.value;
        // The variationModifier is now directly passed as an argument.

        const promptOptions = { persona: blogPersonaSelect.value, tone: tone, wordCount: blogWordCountSelect.value, tagsString: state.currentBlogTags.join(', '), sourceText: sourceText, variationModifier: variationModifier, shouldOverride: shouldOverride };

        showModal({ title: 'AI 生成中...', showProgressBar: true, taskType: 'blog' });
        const btn = isVariation ? generateBlogVariationBtn : generateBlogBtn;
        btn.disabled = true;
        btn.classList.add('btn-loading');

        try {
            let prompt = assembleBlogPrompt(promptOptions);
            let fullResponse = await callGeminiAPI(apiKey, prompt);

            // Smart Retry Logic
            const requiredTags = ['[ARTICLE_START]', '[ARTICLE_END]', '[SEO_START]', '[SEO_END]'];
            const isResponseValid = (response) => requiredTags.every(tag => response.includes(tag));

            if (!isResponseValid(fullResponse)) {
                console.warn("第一次嘗試格式不完整 (缺少部分標籤)，正在自動重試...");
                showModal({ title: 'AI 回應校驗失敗', message: '初步回應格式不完整，正在自動為您重試一次...', showProgressBar: true, taskType: 'blog' });

                const retryPromptOptions = { ...promptOptions, isRetry: true };
                prompt = assembleBlogPrompt(retryPromptOptions);
                fullResponse = await callGeminiAPI(apiKey, prompt);

                if (!isResponseValid(fullResponse)) {
                    // 如果重試後還是缺少標籤，嘗試用更寬鬆的方式解析，或者拋出錯誤
                    console.error("重試後格式依然不完整:", fullResponse);
                    // 不要直接拋出錯誤，試試看能不能救回部分內容
                    if (!fullResponse.includes('[ARTICLE_START]')) {
                        throw new Error("AI 回應嚴重錯誤：找不到文章開始標籤。");
                    }
                }
            }

            // Regex now allows for missing end tag in worst case (fallback) by using logical OR with end of string if needed, 
            // but since we validated above, strict matching is preferred. 
            // However, to be safe against regex failure:
            let articleHtml = "";
            const articleMatch = fullResponse.match(/\[ARTICLE_START\]([\s\S]*?)\[ARTICLE_END\]/);

            if (articleMatch) {
                articleHtml = articleMatch[1].trim();
            } else {
                // Fallback: If regex fails but START tag exists, take everything after START
                const startIdx = fullResponse.indexOf('[ARTICLE_START]');
                if (startIdx !== -1) {
                    console.warn("Regex extraction failed, using fallback extraction.");
                    let contentAfterStart = fullResponse.substring(startIdx + '[ARTICLE_START]'.length);
                    // If SEO_START exists, cut off there
                    const seoStartIdx = contentAfterStart.indexOf('[SEO_START]');
                    if (seoStartIdx !== -1) {
                        contentAfterStart = contentAfterStart.substring(0, seoStartIdx);
                    }
                    articleHtml = contentAfterStart.trim();
                }
            }

            if (!articleHtml) {
                throw new Error("無法從 AI 回應中提取文章內容。");
            }

            // --- Step 1: Clean and load main article content ---
            quillEditor.root.innerHTML = cleanHtml(articleHtml);

            // --- Step 2: Safely prepend YouTube video ---
            const ytId = blogYtIdInput.value.trim();
            if (ytId) {
                const youtubeEmbedHtml = `<iframe src="https://www.youtube.com/embed/${ytId}" style="width: 100%; aspect-ratio: 16/9;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen="allowfullscreen" frameborder="0" title="YouTube video player"></iframe>`;
                quillEditor.clipboard.dangerouslyPasteHTML(0, youtubeEmbedHtml + '<p><br></p>');
            }

            // --- Step 3: Safely prepend Title and append CTA ---
            const mainTitle = blogTitleInput.value.trim();
            if (mainTitle) {
                quillEditor.insertText(0, mainTitle + '\n', { 'header': 1 });
            }
            const ctaContent = blogCtaTextarea.value.trim();
            if (ctaContent) {
                const editorLength = quillEditor.getLength();
                quillEditor.clipboard.dangerouslyPasteHTML(editorLength - 1, `<hr>${ctaContent}`);
            }

            // --- Process SEO data ---
            const seoMatch = fullResponse.match(/\[SEO_START\]([\s\S]*?)\[SEO_END\]/);
            const seoData = {};
            if (seoMatch) {
                const seoText = seoMatch[1].trim();
                const extract = (key, text) => {
                    const regex = new RegExp(`^\\s*[-\\*]*\\s*${key}[\\s:：]*(.*)$`, 'im');
                    const line = text.split('\n').find(line => regex.test(line));
                    return line ? (line.match(regex)[1] || '').trim() : 'N/A';
                }
                seoData.title = extract('SEO 標題', seoText);
                seoData.description = extract('搜尋描述', seoText);
                seoData.permalink = extract('固定網址', seoText);
                seoData.tags = extract('標籤', seoText);
            }

            const newVersion = { htmlContent: getLatestHtmlContent(), seoData: seoData, advancedSeoData: { keywords: null, internalLinks: null } };

            if (isVariation) {
                // The old version is already saved. Just push the new one.
                state.blogArticleVersions.push(newVersion);
                state.currentBlogVersionIndex = state.blogArticleVersions.length - 1;
            } else {
                state.blogArticleVersions = [newVersion];
                state.currentBlogVersionIndex = 0;
            }

            state.blogSourceType = 'blog';
            renderVersionTabs();
            renderCurrentVersionUI();

            analyzeKeywordsBtn.disabled = false;
            analyzeInternalLinksBtn.disabled = false;
            generateBlogVariationBtn.disabled = false;

            saveBlogDraft();
            blogPlaceholder.classList.add('hidden');
            blogOutputContainer.classList.remove('hidden');
            switchBlogView('preview');
            hideModal();
            if (window.updateTabAvailability) window.updateTabAvailability();

        } catch (error) {
            console.error("文章生成或解析失敗:", error);
            if (error.message && error.message.includes('overloaded')) {
                showModal({ title: 'AI 正在尖峰時段，請稍候！', message: '別擔心...', buttons: [{ text: '關閉', class: 'btn-secondary', callback: hideModal }, { text: '立即重試', class: 'btn-primary', callback: () => { hideModal(); proceedGenerateBlogPost(isVariation); } }] });
            } else {
                showModal({ title: '文章生成失敗', message: `發生錯誤，可能是 AI 回應格式不符或網路問題。\n\n錯誤詳情: ${error.message}` });
            }
        } finally {
            btn.disabled = false;
            btn.classList.remove('btn-loading');
            window.updateStepperUI();
        }
    }

    function generateBlogPost() {
        if (state.blogArticleVersions.length > 0 && !confirm("這將會清除所有已生成的版本並重新開始，您確定嗎？")) {
            return;
        }
        const rawContent = state.processedSrtResult ? state.processedSrtResult.trim() : document.getElementById('smart-area').value.trim();
        if (state.blogSourceType === 'raw' && rawContent) {
            showModal({ title: '提醒', message: '您尚未優化文本，直接生成可能會影響文章品質。確定要繼續嗎？', buttons: [{ text: '取消', class: 'btn-secondary', callback: hideModal }, { text: '確定繼續', class: 'btn-primary', callback: () => { hideModal(); proceedGenerateBlogPost(false); } }] });
        } else {
            proceedGenerateBlogPost(false);
        }
    }

    function generateBlogVariation() {
        // Open the VariationHub modal for blog posts, passing the proceed function as callback
        // The callback will receive the chosen variationModifier from the modal.
        VariationHub.open('blog', (modifier, shouldOverride) => {
            proceedGenerateBlogPost(modifier, shouldOverride);
        });
    }

    function getFileName() {
        const title = document.getElementById('blog-title').value.trim();
        if (title) {
            return title.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_');
        } else {
            const d = new Date();
            return `${d.getFullYear()}${(d.getMonth() + 1).toString().padStart(2, '0')}${d.getDate().toString().padStart(2, '0')}`;
        }
    }

    function downloadAsHtml() {
        const htmlContent = getLatestHtmlContent();
        const fileName = getFileName();
        if (!htmlContent) return;

        const content = `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="UTF-8"><title>${fileName}</title><style>body{font-family:sans-serif;line-height:1.6;} iframe{width:100%;aspect-ratio:16/9;} .youtube-embed{margin-bottom:1em;}</style></head><body>${htmlContent}</body></html>`;
        const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${fileName}.html`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function downloadAsMarkdown() {
        const htmlContent = getLatestHtmlContent();
        const fileName = getFileName();
        if (!htmlContent) return;

        const content = convertHtmlToMarkdown(htmlContent);
        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${fileName}.md`;
        a.click();
        URL.revokeObjectURL(url);
    }

    optimizeTextForBlogBtn.addEventListener('click', optimizeTextForBlog);
    generateBlogBtn.addEventListener('click', generateBlogPost);
    generateBlogVariationBtn.addEventListener('click', generateBlogVariation);
    downloadHtmlBtn.addEventListener('click', downloadAsHtml);
    downloadMdBtn.addEventListener('click', downloadAsMarkdown);
    ctaPresetSelect.addEventListener('change', () => { handleCtaChange(); saveBlogDraft(); });
    saveCtaBtn.addEventListener('click', saveCustomCTA);
    deleteCtaBtn.addEventListener('click', deleteCustomCTA);
    aiStyleToggleBtn.addEventListener('click', () => toggleAccordion(aiStyleToggleBtn, aiStylePanel));
    seoToggleBtn.addEventListener('click', () => toggleAccordion(seoToggleBtn, seoPanel));
    allBlogViewButtons.forEach(button => button.addEventListener('click', () => switchBlogView(button.dataset.blogView)));
    const copyButtonLogic = (btn) => { const targetId = btn.dataset.copyTarget; const targetElement = document.getElementById(targetId); if (targetElement) { const content = targetElement.tagName === 'TEXTAREA' ? targetElement.value : targetElement.textContent; navigator.clipboard.writeText(content).then(() => { const originalIcon = btn.innerHTML; btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-500" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>`; setTimeout(() => { btn.innerHTML = originalIcon; }, 2000); }); } };
    document.querySelectorAll('.seo-copy-btn').forEach(button => button.addEventListener('click', () => copyButtonLogic(button)));
    document.querySelectorAll('.source-copy-btn').forEach(button => button.addEventListener('click', () => copyButtonLogic(button)));

    blogTitleInput.addEventListener('input', saveBlogDraft);
    blogYtIdInput.addEventListener('input', (e) => {
        const val = e.target.value.trim();
        if (val.includes('/') || val.includes('.') || val.includes('?')) {
            const parsedId = extractYouTubeId(val);
            if (parsedId && parsedId !== val) {
                e.target.value = parsedId;
                showToast(`已自動解析出 YouTube 影片 ID: ${parsedId}`);
            }
        }
        saveBlogDraft();
    });
    blogPersonaSelect.addEventListener('change', (e) => { saveSetting(SETTINGS_STORAGE_KEYS.BLOG_PERSONA, e.target.value); saveBlogDraft(); });
    blogWordCountSelect.addEventListener('change', (e) => { saveSetting(SETTINGS_STORAGE_KEYS.BLOG_WORD_COUNT, e.target.value); saveBlogDraft(); });
    blogToneSelect.addEventListener('change', (e) => { saveSetting(SETTINGS_STORAGE_KEYS.BLOG_TONE, e.target.value); saveBlogDraft(); });
    blogCtaTextarea.addEventListener('input', saveBlogDraft);

    advancedSeoToggleBtn.addEventListener('click', () => toggleAccordion(advancedSeoToggleBtn, advancedSeoPanel));
    analyzeKeywordsBtn.addEventListener('click', analyzeKeywords);
    analyzeInternalLinksBtn.addEventListener('click', analyzeInternalLinks);
    internalLinksSource.addEventListener('input', saveBlogDraft);

    openPromptWizardBtn.addEventListener('click', openPromptWizard);
    closePromptWizardBtn.addEventListener('click', closePromptWizard);
    savePromptWizardBtn.addEventListener('click', savePromptSettings);
    restorePromptDefaultsBtn.addEventListener('click', restoreDefaultSettings);
    wizardStructSummary.addEventListener('change', handleStructureCheck);
    wizardStructPoints.addEventListener('change', handleStructureCheck);
    wizardStructNone.addEventListener('change', handleStructureCheck);

    const personaOptions = { '第一人稱視角': '第一人稱', '第三人稱視角': '第三人稱' };
    const wordCountOptions = { '約 800 字': '約 800 字', '約 1200 字': '約 1200 字', '約 1500 字': '約 1500 字' };
    const toneOptions = { '充滿能量與感染力': '能量感染力', '專業且具權威性': '專業權威', '口語化且親切': '口語親切', '幽默風趣': '幽默風趣' };
    populateSelectWithOptions(blogPersonaSelect, personaOptions);
    populateSelectWithOptions(blogWordCountSelect, wordCountOptions);
    populateSelectWithOptions(blogToneSelect, toneOptions);

    renderCtaSelect();
    initializeTags();
    handleCtaChange();
    loadSettings();

    // 註冊 Quill 水平線 (<hr>) 嵌入元件以支援段落區塊分隔線
    const BlockEmbed = Quill.import('blots/block/embed');
    class DividerBlot extends BlockEmbed {}
    DividerBlot.blotName = 'divider';
    DividerBlot.tagName = 'hr';
    Quill.register(DividerBlot);

    const editorOptions = {
        theme: 'snow',
        modules: {
            toolbar: [
                [{ 'header': [1, 2, 3, false] }],
                ['bold', 'italic', 'underline', 'link'],
                [{ 'list': 'ordered' }, { 'list': 'bullet' }],
                ['clean']
            ]
        }
    };
    quillEditor = new Quill('#blog-editor-container', editorOptions);

    let saveTimeout;
    quillEditor.on('text-change', (delta, oldDelta, source) => {
        if (source === 'user') {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                saveBlogDraft();
                showToast('草稿已自動儲存', { type: 'success', duration: 1500 });
            }, 2000);
        }
    });

    if (window.hasBlogDraft()) {
        setTimeout(() => {
            if (confirm('偵測到上次有未儲存的部落格文章草稿，是否要恢復？')) {
                restoreBlogDraft();
            } else {
                window.clearBlogDraft();
                if (window.updateTabAvailability) window.updateTabAvailability();
            }
        }, 100);
    }
    window.updateStepperUI();
}