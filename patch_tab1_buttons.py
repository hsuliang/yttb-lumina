import re

with open('public/js/tab1-srt.js', 'r') as f:
    content = f.read()

# I need to add event listeners for the copy and download buttons.
# I will append them at the end of the file.

append_logic = """

// --- 浮動按鈕事件綁定 ---
const tab1CopyBtn = document.getElementById('tab1-copy-btn');
const tab1DownloadBtn = document.getElementById('tab1-download-btn');
const tab1FloatingActions = document.getElementById('tab1-floating-actions');

if (tab1CopyBtn) {
    tab1CopyBtn.addEventListener('click', () => {
        const activeViewBtn = document.querySelector('.view-btn.active');
        if (!activeViewBtn) return;
        const view = activeViewBtn.dataset.view;
        const textarea = document.getElementById(`display-${view}`);
        if (textarea && textarea.value) {
            navigator.clipboard.writeText(textarea.value).then(() => {
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
        const textarea = document.getElementById(`display-${view}`);
        if (textarea && textarea.value) {
            const blob = new Blob([textarea.value], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const prefix = view === 'summary' ? 'AI摘要' : 'AI章節';
            let fileName = state.originalFileName ? `${state.originalFileName}_${prefix}.txt` : `AliangYTTB_${prefix}.txt`;
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    });
}
"""

# Also modify switchView to toggle the floating actions
search_switchview = """        if (viewToShow === 'original') {"""
replace_switchview = """        if (tab1FloatingActions) {
            if (viewToShow === 'summary' || viewToShow === 'chapters') {
                tab1FloatingActions.classList.remove('hidden');
            } else {
                tab1FloatingActions.classList.add('hidden');
            }
        }

        if (viewToShow === 'original') {"""

content = content.replace(search_switchview, replace_switchview)
content += append_logic

with open('public/js/tab1-srt.js', 'w') as f:
    f.write(content)
