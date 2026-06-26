import { state, THEMES, AI_PROMPT_MESSAGES } from './state.js';

/**
 * ui-components.js
 * 負責管理通用的 UI 元件，如彈出視窗、主題、摺疊面板等。
 */

// 元素選擇 (新增)
const modeToggleBtn = document.getElementById('mode-toggle-btn');
const sunIcon = document.getElementById('sun-icon');
const moonIcon = document.getElementById('moon-icon');

// 函式 (新增)
export const applyMode = function(mode) {
    if (sunIcon && moonIcon) {
        if (mode === 'dark') {
            sunIcon.classList.add('hidden');
            moonIcon.classList.remove('hidden');
            // 如果當前是亮色主題，切換到預設的暗色主題
            if (document.body.dataset.theme !== 'dark-knight') {
                 applyTheme('dark-knight');
            }
        } else {
            sunIcon.classList.remove('hidden');
            moonIcon.classList.add('hidden');
            // 如果當前是暗色主題，切換回預設的亮色主題
            if (document.body.dataset.theme === 'dark-knight') {
                applyTheme(localStorage.getItem('selectedLightTheme') || 'old-newspaper');
            }
        }
    }
    localStorage.setItem('selectedMode', mode);
}

// 函式 (新增)
export const toggleMode = function() {
    const currentMode = localStorage.getItem('selectedMode') || 'light';
    applyMode(currentMode === 'light' ? 'dark' : 'light');
}

// 函式 (修改)
export const applyTheme = function(themeName) {
    document.body.dataset.theme = themeName;

    // 判斷主題是亮色還是暗色，並儲存對應的偏好
    if (themeName === 'dark-knight') {
        localStorage.setItem('selectedMode', 'dark');
        // 暗黑模式下，不需要儲存 selectedTheme，因為它代表的是暗色本身
    } else {
        localStorage.setItem('selectedMode', 'light');
        localStorage.setItem('selectedLightTheme', themeName); // 記住使用者選擇的亮色主題
    }
    
    renderThemeSwatches();
    updateModeIcons();
}

// 函式 (新增)
export const updateModeIcons = function() {
     if (sunIcon && moonIcon) {
         const currentMode = localStorage.getItem('selectedMode') || 'light';
         if (currentMode === 'dark') {
            sunIcon.classList.add('hidden');
            moonIcon.classList.remove('hidden');
         } else {
            sunIcon.classList.remove('hidden');
            moonIcon.classList.add('hidden');
         }
     }
}

// 事件監聽 (新增)
if (modeToggleBtn) {
    modeToggleBtn.addEventListener('click', toggleMode);
}


export const renderThemeSwatches = function() {
    const themeSwatchesContainer = document.querySelector('.theme-swatches-container');
    if (!themeSwatchesContainer) return; // Add a guard clause
    themeSwatchesContainer.innerHTML = '';
    
    const currentTheme = document.body.dataset.theme || 'old-newspaper';
    
    // 過濾掉暗黑模式，它由獨立的按鈕控制
    const lightThemes = Object.entries(THEMES).filter(([value]) => value !== 'dark-knight');

    for (const [value, text] of lightThemes) {
        const swatch = document.createElement('div');
        swatch.className = `theme-swatch ${value}`;
        swatch.dataset.themeValue = value;
        swatch.title = text;
        swatch.setAttribute('role', 'button');
        swatch.setAttribute('tabindex', '0');
        if (value === currentTheme) {
            swatch.classList.add('active');
        }
        swatch.addEventListener('click', () => {
            applyTheme(value);
        });
        themeSwatchesContainer.appendChild(swatch);
    }
}

export const stopPromptRotation = function() {
    if (state.promptInterval) {
        clearInterval(state.promptInterval);
        state.promptInterval = null;
    }
    state.currentAiTask = null;
}

export const startPromptRotation = function(taskType) {
    state.currentAiTask = taskType;
    let messageIndex = 0;
    const messages = AI_PROMPT_MESSAGES[taskType];
    const modalMessage = document.getElementById('modal-message');
    modalMessage.textContent = messages[messageIndex];
    state.promptInterval = setInterval(() => {
        messageIndex = (messageIndex + 1) % messages.length;
        modalMessage.textContent = messages[messageIndex];
    }, 4000);
}

// [第二階段優化] - 強化 showToast 函式，使其可以包含可點擊的按鈕
/**
 * 顯示一個自動消失的 Toast 通知。
 * @param {string} message - 要顯示的訊息。
 * @param {object} [options={}] - 通知的選項。
 * @param {string} [options.type='success'] - 類型 ('success' 或 'error')。
 * @param {number} [options.duration=3000] - 持續時間 (毫秒)。
 * @param {object} [options.action=null] - 附加操作。
 * @param {string} options.action.text - 按鈕文字。
 * @param {function} options.action.callback - 按鈕點擊後的回呼函式。
 */
export const showToast = function(message, options = {}) {
    const { type = 'success', duration = 5000, action = null } = options;
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;
    toast.appendChild(messageSpan);

    if (action && action.text && typeof action.callback === 'function') {
        toast.classList.add('toast-with-action');
        const actionButton = document.createElement('button');
        actionButton.className = 'toast-action-btn';
        actionButton.textContent = action.text;
        actionButton.onclick = () => {
            action.callback();
            // 點擊按鈕後立即移除 toast，避免計時器再次觸發
            if (toast.parentNode) {
                toast.remove();
            }
        };
        toast.appendChild(actionButton);
    }

    container.appendChild(toast);

    setTimeout(() => {
        // 確保元素還在 DOM 中再移除
        if (toast.parentNode) {
            toast.remove();
        }
    }, duration);
}


export const showModal = function(options) {
    const { title, message, showCopyButton = false, showProgressBar = false, buttons = [], taskType = null, isHtml = false, large = false } = options;
    
    // 防呆：如果是使用者主動取消任務產生的錯誤，不顯示錯誤視窗
    if (message && (typeof message === 'string') && (message.includes('AbortError') || message.includes('The user aborted a request'))) {
        console.log('使用者已取消任務，攔截錯誤視窗');
        showToast('已取消任務');
        return;
    }

    stopPromptRotation();
    
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modal-title');
    const modalMessage = document.getElementById('modal-message');
    const modalCopyBtn = document.getElementById('modal-copy-btn');
    const modalProgressBar = document.getElementById('modal-progress-bar');
    const modalDefaultButtons = document.getElementById('modal-default-buttons');
    const modalCustomButtons = document.getElementById('modal-custom-buttons');
    
    const modalModelBadge = document.getElementById('modal-model-badge');
    const modalModelName = document.getElementById('modal-model-name');
    if (modalModelBadge) {
        modalModelBadge.classList.add('hidden');
    }
    if (modalModelName) {
        modalModelName.textContent = '';
    }

    // Adjust width for large modals
    const modalCard = modal.querySelector('.glass-panel, .main-card') || modal.firstElementChild;
    if (modalCard) {
        if (large) {
            modalCard.classList.remove('md:w-1/2', 'max-w-lg');
            modalCard.classList.add('md:w-[65%]', 'max-w-3xl');
        } else {
            modalCard.classList.remove('md:w-[65%]', 'max-w-3xl');
            modalCard.classList.add('md:w-1/2', 'max-w-lg');
        }
    }

    modalTitle.textContent = title;
    modalCopyBtn.classList.toggle('hidden', !showCopyButton);
    modalProgressBar.classList.toggle('hidden', !showProgressBar);
    
    if (showProgressBar) {
state.currentAbortController = new AbortController();
        modalMessage.classList.remove('hidden');
        if (taskType && AI_PROMPT_MESSAGES[taskType]) {
            startPromptRotation(taskType);
        } else {
            modalMessage.textContent = "請稍候，AI 正在思考中...";
        }
    } else {
        modalMessage.classList.remove('hidden');
        if (isHtml) {
            modalMessage.innerHTML = message;
        } else {
            modalMessage.textContent = message;
        }
    }

    if (buttons.length > 0) {
        modalDefaultButtons.classList.add('hidden');
        modalCustomButtons.classList.remove('hidden');
        modalCustomButtons.innerHTML = '';
        buttons.forEach(btnInfo => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = btnInfo.text;
            button.className = `font-bold py-2 px-4 rounded-lg text-xs hover:brightness-110 shadow-md transition-all ${btnInfo.class}`;
            button.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                btnInfo.callback(e);
            });
            modalCustomButtons.appendChild(button);
        });
    } else {
        modalDefaultButtons.classList.remove('hidden');
        modalCustomButtons.classList.add('hidden');
    }
    modal.classList.remove('hidden');
}

export const hideModal = function() {
    stopPromptRotation();
    // Do NOT abort here, otherwise successful tasks that call hideModal() will trigger an AbortError.
    const modalModelBadge = document.getElementById('modal-model-badge');
    if (modalModelBadge) {
        modalModelBadge.classList.add('hidden');
    }
    document.getElementById('modal').classList.add('hidden');
}

export const copyModalContent = function() {
    const modalMessage = document.getElementById('modal-message');
    const modalCopyBtn = document.getElementById('modal-copy-btn');
    navigator.clipboard.writeText(modalMessage.textContent).then(() => {
        modalCopyBtn.textContent = '已複製！';
        setTimeout(() => { modalCopyBtn.textContent = '複製內容'; }, 2000);
    }).catch(err => {
        console.error('複製失敗: ', err);
        modalCopyBtn.textContent = '複製失敗';
        setTimeout(() => { modalCopyBtn.textContent = '複製內容'; }, 2000);
    });
}

export const toggleAccordion = function(btn, panel) {
    btn.classList.toggle('open');
    panel.classList.toggle('open');
    panel.classList.toggle('hidden');
    
    // Rotate the arrow icon if present
    const arrow = btn.querySelector('.material-symbols-outlined, svg');
    if (arrow) {
        if (arrow.classList.contains('material-symbols-outlined')) {
            arrow.style.transform = panel.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)';
        } else {
            // For old SVG arrow compatibility
            arrow.style.transform = btn.classList.contains('open') ? 'rotate(90deg)' : '';
        }
    }
}

export const populateSelectWithOptions = function(selectElement, options) {
    selectElement.innerHTML = '';
    for (const [value, text] of Object.entries(options)) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        selectElement.appendChild(option);
    }
}

// 頁面載入時，立即檢查並套用儲存的模式
document.addEventListener('DOMContentLoaded', () => {
    const savedMode = localStorage.getItem('selectedMode') || 'light';
    const savedTheme = savedMode === 'dark' 
        ? 'dark-knight' 
        : (localStorage.getItem('selectedLightTheme') || 'old-newspaper');
    
    applyTheme(savedTheme);
});
window.checkGlobalDrafts = function() {
    if (window._draftChoice !== undefined) return window._draftChoice;
    window._draftChoice = confirm('偵測到您有未儲存的草稿，是否要全部恢復？');
    return window._draftChoice;
};

/**
 * 通用檔案下載工具（基於 FileSaver.js 的可靠實作）。
 * 解決部分瀏覽器忽略 a.download 屬性導致檔名變成 UUID 的問題。
 * @param {string|Blob} content - 檔案內容字串或 Blob 物件
 * @param {string} fileName - 下載的檔案名稱（含副檔名）
 * @param {string} [mimeType='text/plain;charset=utf-8'] - MIME 類型
 */
export function saveFile(content, fileName, mimeType = 'text/plain;charset=utf-8') {
    const blob = (content instanceof Blob) ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    
    // 必須同步點擊！如果用 setTimeout 異步點擊，瀏覽器（特別是 Safari 和 Chrome）會因為安全性考量
    // 將其視為非使用者主動觸發的導頁，從而忽略 a.download 屬性，導致檔名變成 Blob URL 的 UUID。
    a.click();
    
    // 延遲移除元素和銷毀 URL，確保瀏覽器有足夠時間啟動下載
    setTimeout(() => {
        if (a.parentNode) {
            document.body.removeChild(a);
        }
        URL.revokeObjectURL(url);
    }, 2000);
}
