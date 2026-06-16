/**
 * ui-components.js
 * 負責管理通用的 UI 元件，如彈出視窗、主題、摺疊面板等。
 */

// 元素選擇 (新增)
const modeToggleBtn = document.getElementById('mode-toggle-btn');
const sunIcon = document.getElementById('sun-icon');
const moonIcon = document.getElementById('moon-icon');

// 函式 (新增)
window.applyMode = function(mode) {
    if (sunIcon && moonIcon) {
        if (mode === 'dark') {
            sunIcon.classList.add('hidden');
            moonIcon.classList.remove('hidden');
            // 如果當前是亮色主題，切換到預設的暗色主題
            if (document.body.dataset.theme !== 'dark-knight') {
                 window.applyTheme('dark-knight');
            }
        } else {
            sunIcon.classList.remove('hidden');
            moonIcon.classList.add('hidden');
            // 如果當前是暗色主題，切換回預設的亮色主題
            if (document.body.dataset.theme === 'dark-knight') {
                window.applyTheme(localStorage.getItem('selectedLightTheme') || 'old-newspaper');
            }
        }
    }
    localStorage.setItem('selectedMode', mode);
}

// 函式 (新增)
window.toggleMode = function() {
    const currentMode = localStorage.getItem('selectedMode') || 'light';
    window.applyMode(currentMode === 'light' ? 'dark' : 'light');
}

// 函式 (修改)
window.applyTheme = function(themeName) {
    document.body.dataset.theme = themeName;

    // 判斷主題是亮色還是暗色，並儲存對應的偏好
    if (themeName === 'dark-knight') {
        localStorage.setItem('selectedMode', 'dark');
        // 暗黑模式下，不需要儲存 selectedTheme，因為它代表的是暗色本身
    } else {
        localStorage.setItem('selectedMode', 'light');
        localStorage.setItem('selectedLightTheme', themeName); // 記住使用者選擇的亮色主題
    }
    
    window.renderThemeSwatches();
    window.updateModeIcons();
}

// 函式 (新增)
window.updateModeIcons = function() {
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
    modeToggleBtn.addEventListener('click', window.toggleMode);
}


window.renderThemeSwatches = function() {
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
            window.applyTheme(value);
        });
        themeSwatchesContainer.appendChild(swatch);
    }
}

window.stopPromptRotation = function() {
    if (state.promptInterval) {
        clearInterval(state.promptInterval);
        state.promptInterval = null;
    }
    state.currentAiTask = null;
}

window.startPromptRotation = function(taskType) {
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
window.showToast = function(message, options = {}) {
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


window.showModal = function(options) {
    window.stopPromptRotation();
    const { title, message, showCopyButton = false, showProgressBar = false, buttons = [], taskType = null, isHtml = false, large = false } = options;
    
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
        modalMessage.classList.remove('hidden');
        if (taskType && AI_PROMPT_MESSAGES[taskType]) {
            window.startPromptRotation(taskType);
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
            button.textContent = btnInfo.text;
            button.className = `font-bold py-2 px-4 rounded-lg text-xs hover:brightness-110 shadow-md transition-all ${btnInfo.class}`;
            button.addEventListener('click', btnInfo.callback);
            modalCustomButtons.appendChild(button);
        });
    } else {
        modalDefaultButtons.classList.remove('hidden');
        modalCustomButtons.classList.add('hidden');
    }
    modal.classList.remove('hidden');
}

window.hideModal = function() {
    window.stopPromptRotation();
    const modalModelBadge = document.getElementById('modal-model-badge');
    if (modalModelBadge) {
        modalModelBadge.classList.add('hidden');
    }
    document.getElementById('modal').classList.add('hidden');
}

window.copyModalContent = function() {
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

window.toggleAccordion = function(btn, panel) {
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

window.populateSelectWithOptions = function(selectElement, options) {
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
    
    window.applyTheme(savedTheme);
});