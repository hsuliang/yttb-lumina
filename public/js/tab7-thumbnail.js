import { showToast, showModal, hideModal } from './ui-components.js';
import { callGeminiAPI } from './gemini-api.js';
import { state } from './state.js';
import { activateSource, getPreferredSource, isCurrentSource } from './content-source.js';
import { VariationHub } from './variation-hub.js';
import { getBalancedApiKey, hasTextAIEnabled, showApiKeyModal } from './app.js';
import { buildThumbnailPrompt, ensureThumbnailAspectRatio } from './thumbnail-prompt.js';

const THUMBNAIL_SECTION_PATTERN = /^\[(人物設定|主體與動作|地點\/背景|構圖\/鏡頭|文字|藝術風格)\]\s*([：:])\s*(.*)$/;

function normalizeThumbnailPrompt(text) {
    return text.replace(/^\s*\*\*\[(人物設定|主體與動作|地點\/背景|構圖\/鏡頭|文字|藝術風格)\]\*\*\s*([：:])\s*/gm, '[$1]$2 ');
}

export function initializeTab7() {
    const generateBtn = document.getElementById('generate-thumbnail-btn');
    const variationBtn = document.getElementById('generate-thumbnail-variation-btn');
    const styleSelect = document.getElementById('thumbnail-style');
    const customStyleContainer = document.getElementById('thumbnail-custom-style-container');
    const customStyleTextarea = document.getElementById('thumbnail-custom-style');
    const rolesContainer = document.getElementById('thumbnail-roles-container');
    const addRoleBtn = document.getElementById('thumbnail-add-role-btn');
    const versionsContainer = document.getElementById('thumbnail-versions-tabs-container');
    const placeholder = document.getElementById('thumbnail-placeholder');
    const outputContainer = document.getElementById('thumbnail-output-container');
    const promptDisplay = document.getElementById('thumbnail-prompt-display');
    const copyBtn = document.getElementById('copy-thumbnail-prompt-btn');
    const titleInput = document.getElementById('thumbnail-title');
    const subtitleInput = document.getElementById('thumbnail-subtitle');
    const includeLogoInput = document.getElementById('thumbnail-include-logo');
    const shotSelect = document.getElementById('thumbnail-shot');
    const topicTitleSelection = document.getElementById('thumbnail-topic-title-selection');
    const topicTitleSelect = document.getElementById('thumbnail-topic-title-select');

    if (!generateBtn || !variationBtn || !rolesContainer || !versionsContainer || !promptDisplay || !titleInput || !subtitleInput || !includeLogoInput || !shotSelect || !topicTitleSelection || !topicTitleSelect) return;

    let roles = [];

    function syncRolesFromInputs() {
        roles = Array.from(rolesContainer.querySelectorAll('.thumbnail-role-name'))
            .map(input => ({ name: input.value.trim() }));
    }

    function renderRoles() {
        rolesContainer.innerHTML = '';
        roles.forEach((role, index) => {
            const row = document.createElement('div');
            row.className = 'flex items-center gap-2 bg-[var(--gray-bg)] p-2 rounded border border-[var(--card-border)] relative group w-full';

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'thumbnail-role-name flex-grow min-w-0 p-1 text-xs rounded border border-[var(--card-border)] bg-[var(--bg-color)] text-[var(--body-text)]';
            input.placeholder = '角色/素材名稱 (如：ㄚ亮笑長)';
            input.value = role.name;
            input.addEventListener('input', syncRolesFromInputs);

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'thumbnail-delete-role-btn text-red-500 hover:text-red-700 text-xs font-semibold px-1 focus:outline-none';
            deleteBtn.dataset.index = String(index);
            deleteBtn.title = '刪除此角色';
            deleteBtn.textContent = '✕';

            row.append(input, deleteBtn);
            rolesContainer.appendChild(row);
        });
        addRoleBtn.disabled = roles.length >= 4;
    }

    function renderVersionTabs() {
        versionsContainer.innerHTML = '';
        state.thumbnailVersions.forEach((version, index) => {
            const tab = document.createElement('button');
            tab.className = 'tab-btn text-sm py-2 px-4';
            tab.textContent = `版本 ${index + 1}`;
            if (index === state.currentThumbnailVersionIndex) tab.classList.add('active');
            tab.addEventListener('click', () => {
                state.currentThumbnailVersionIndex = index;
                renderVersionTabs();
                renderCurrentVersion();
            });
            versionsContainer.appendChild(tab);
        });
    }

    function clearTopicTitleSelection() {
        topicTitleSelect.replaceChildren(new Option('請先在逐字稿整理頁面生成爆款主題建議', ''));
        topicTitleSelect.value = '';
        topicTitleSelection.classList.add('hidden');
    }

    function renderTopicTitleSuggestions(suggestions = state.topicTitleSuggestions, sourceId = state.topicTitleSuggestionsSourceId) {
        const currentSuggestions = sourceId === state.currentSourceId ? suggestions : [];
        if (!currentSuggestions.length) {
            clearTopicTitleSelection();
            return;
        }

        topicTitleSelect.replaceChildren(new Option('請選擇主標題＋副標題', ''));
        currentSuggestions.forEach((suggestion, index) => {
            const option = new Option(
                `方案 ${suggestion.scheme}・${suggestion.option}｜${suggestion.mainTitle}｜${suggestion.subtitle}`,
                String(index),
            );
            topicTitleSelect.appendChild(option);
        });
        topicTitleSelection.classList.remove('hidden');
    }

    function setLoadingState(isLoading) {
        promptDisplay.classList.toggle('text-center', isLoading);
        promptDisplay.classList.toggle('animate-pulse', isLoading);
        promptDisplay.style.color = isLoading ? '#f97316' : '';
        promptDisplay.style.fontSize = isLoading ? '1.1rem' : '';
        promptDisplay.style.fontWeight = isLoading ? '600' : '';
    }

    function renderPrompt(text) {
        const normalizedText = normalizeThumbnailPrompt(text);
        promptDisplay.replaceChildren();
        normalizedText.split('\n').forEach((line, index, lines) => {
            const headingMatch = line.match(THUMBNAIL_SECTION_PATTERN);
            if (headingMatch) {
                const heading = document.createElement('strong');
                heading.textContent = `[${headingMatch[1]}]${headingMatch[2]}`;
                promptDisplay.append(heading, document.createTextNode(` ${headingMatch[3]}`));
            } else {
                promptDisplay.append(document.createTextNode(line));
            }
            if (index < lines.length - 1) promptDisplay.append(document.createTextNode('\n'));
        });
    }

    function renderCurrentVersion() {
        const currentVersion = state.thumbnailVersions[state.currentThumbnailVersionIndex];
        if (!currentVersion) {
            outputContainer.classList.add('hidden');
            placeholder.classList.remove('hidden');
            variationBtn.disabled = true;
            return;
        }
        placeholder.classList.add('hidden');
        outputContainer.classList.remove('hidden');
        variationBtn.disabled = false;
        setLoadingState(false);
        renderPrompt(currentVersion.textContent);
    }

    function resetTab7() {
        state.thumbnailVersions = [];
        state.currentThumbnailVersionIndex = 0;
        roles = [];
        titleInput.value = '';
        subtitleInput.value = '';
        includeLogoInput.checked = false;
        shotSelect.value = 'auto';
        styleSelect.value = 'auto';
        customStyleTextarea.value = '';
        customStyleContainer.classList.add('hidden');
        clearTopicTitleSelection();
        renderRoles();
        renderVersionTabs();
        renderCurrentVersion();
    }

    function collectPrompt(variationModifier, shouldOverride) {
        const rawSource = document.getElementById('smart-area').value;
        if (!state.currentSourceId && rawSource.trim()) activateSource(rawSource);
        const sourceContent = getPreferredSource(rawSource).text;
        syncRolesFromInputs();

        return buildThumbnailPrompt({
            sourceContent,
            roles: roles.map(role => role.name),
            includeLogo: includeLogoInput.checked,
            title: titleInput.value,
            subtitle: subtitleInput.value,
            shot: shotSelect.value,
            style: styleSelect.value,
            customStyle: customStyleTextarea.value,
            variationModifier,
            shouldOverride,
        });
    }

    async function handleGenerate({ variationModifier = '', shouldOverride = false, isVariation = false } = {}) {
        if (state.currentAbortController) {
            state.currentAbortController.abort();
            state.currentAbortController = null;
            return;
        }
        if (!hasTextAIEnabled()) {
            showApiKeyModal();
            return;
        }

        let prompt;
        try {
            prompt = collectPrompt(variationModifier, shouldOverride);
        } catch (error) {
            showModal({ title: '無法生成提示詞', message: error.message });
            return;
        }

        const requestSourceId = state.currentSourceId;
        const apiKey = getBalancedApiKey();
        state.currentAbortController = new AbortController();
        const activeBtn = isVariation ? variationBtn : generateBtn;
        const originalBtnHtml = activeBtn.innerHTML;
        activeBtn.innerHTML = '<span class="material-symbols-outlined text-[18px]">close</span>中斷生成';
        activeBtn.classList.add('bg-error/10', 'text-error', 'border-error/20');
        placeholder.classList.add('hidden');
        outputContainer.classList.remove('hidden');
        renderPrompt('正在設計 YT 封面提示詞…');
        setLoadingState(true);

        try {
            let receivedFirstChunk = false;
            const result = await callGeminiAPI(apiKey, prompt, false, (chunkText, fullText) => {
                if (!isCurrentSource(requestSourceId)) return;
                if (!receivedFirstChunk && chunkText) {
                    receivedFirstChunk = true;
                    setLoadingState(false);
                }
                renderPrompt(fullText);
                promptDisplay.scrollTop = promptDisplay.scrollHeight;
            }, state.currentAbortController.signal, '@cf/openai/gpt-oss-120b');

            if (!isCurrentSource(requestSourceId)) return;
            const textContent = ensureThumbnailAspectRatio(
                normalizeThumbnailPrompt(result.trim().replace(/^```(?:markdown|text|prompt)?\s*|\s*```$/gi, '')),
            );
            const version = { sourceId: requestSourceId, textContent };

            if (isVariation) {
                state.thumbnailVersions.push(version);
                state.currentThumbnailVersionIndex = state.thumbnailVersions.length - 1;
            } else {
                state.thumbnailVersions = [version];
                state.currentThumbnailVersionIndex = 0;
            }
            renderVersionTabs();
            renderCurrentVersion();
            showToast(`YT 封面提示詞${isVariation ? '新版本' : ''}已生成！`, { type: 'success' });
        } catch (error) {
            console.error('YT 封面提示詞生成失敗:', error);
            setLoadingState(false);
            if (error.name === 'AbortError' || error.message?.includes('aborted')) {
                renderPrompt('生成已中斷。');
            } else if (error.message?.includes('overloaded')) {
                showModal({
                    title: 'AI 正在尖峰時段，請稍候！',
                    message: '目前模型負載過高，您可以稍後再試。',
                    buttons: [
                        { text: '關閉', class: 'btn-secondary', callback: hideModal },
                        {
                            text: '立即重試',
                            class: 'btn-primary',
                            callback: () => {
                                hideModal();
                                handleGenerate({ variationModifier, shouldOverride, isVariation });
                            },
                        },
                    ],
                });
            } else {
                showModal({ title: '生成失敗', message: `發生錯誤：${error.message}` });
            }
            if (!isVariation && state.thumbnailVersions.length === 0) renderCurrentVersion();
        } finally {
            state.currentAbortController = null;
            activeBtn.innerHTML = originalBtnHtml;
            activeBtn.classList.remove('bg-error/10', 'text-error', 'border-error/20');
        }
    }

    addRoleBtn.addEventListener('click', () => {
        if (roles.length >= 4) return;
        syncRolesFromInputs();
        roles.push({ name: '' });
        renderRoles();
    });

    rolesContainer.addEventListener('click', event => {
        if (!event.target.classList.contains('thumbnail-delete-role-btn')) return;
        syncRolesFromInputs();
        roles.splice(Number(event.target.dataset.index), 1);
        renderRoles();
    });

    styleSelect.addEventListener('change', () => {
        customStyleContainer.classList.toggle('hidden', styleSelect.value !== 'custom');
    });

    topicTitleSelect.addEventListener('change', () => {
        if (topicTitleSelect.value === '') return;
        const suggestion = state.topicTitleSuggestions[Number(topicTitleSelect.value)];
        if (!suggestion || state.topicTitleSuggestionsSourceId !== state.currentSourceId) return;
        titleInput.value = suggestion.mainTitle;
        subtitleInput.value = suggestion.subtitle;
    });

    generateBtn.addEventListener('click', () => handleGenerate());
    variationBtn.addEventListener('click', () => {
        VariationHub.open('thumbnail', (variationModifier, shouldOverride) => {
            handleGenerate({ variationModifier, shouldOverride, isVariation: true });
        });
    });

    copyBtn.addEventListener('click', async () => {
        const currentVersion = state.thumbnailVersions[state.currentThumbnailVersionIndex];
        if (!currentVersion) return;
        try {
            await navigator.clipboard.writeText(currentVersion.textContent);
            showToast('YT 封面提示詞已複製！', { type: 'success' });
        } catch (_) {
            showToast('複製失敗，請手動選取提示詞。', { type: 'error' });
        }
    });

    window.addEventListener('lumina:topicTitleSuggestionsReady', event => {
        renderTopicTitleSuggestions(event.detail?.suggestions, event.detail?.sourceId);
    });
    window.addEventListener('lumina:topicTitleSuggestionsCleared', clearTopicTitleSelection);
    window.addEventListener('lumina:clearDownstreamTabs', resetTab7);
    renderRoles();
    renderVersionTabs();
    renderTopicTitleSuggestions();
    renderCurrentVersion();
}
