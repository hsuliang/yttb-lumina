import {
    connectBlogger,
    disconnectBlogger,
    getBloggerErrorMessage,
    getBloggerSession,
    refreshBloggerBlogs,
    setSelectedBloggerBlog
} from './blogger-session.js';
import { showToast } from './ui-components.js';

export function initializeBloggerSettings() {
    const elements = {
        clientIdWarning: document.getElementById('blogger-settings-client-id-warning'),
        authStatus: document.getElementById('blogger-settings-auth-status'),
        connectButton: document.getElementById('blogger-settings-connect-btn'),
        refreshButton: document.getElementById('blogger-settings-refresh-btn'),
        disconnectButton: document.getElementById('blogger-settings-disconnect-btn'),
        blogSelect: document.getElementById('blogger-settings-blog-select'),
        selectionNote: document.getElementById('blogger-settings-selection-note'),
        status: document.getElementById('blogger-settings-status')
    };

    if (!elements.connectButton || elements.connectButton.dataset.bloggerSettingsBound === 'true') return;
    elements.connectButton.dataset.bloggerSettingsBound = 'true';

    let busy = false;

    const setStatus = (message, type = 'muted') => {
        if (!elements.status) return;
        elements.status.className = 'text-xs min-h-[1.25rem] ' + (
            type === 'success' ? 'text-success' :
                type === 'warning' ? 'text-warning' :
                    type === 'error' ? 'text-error' : 'text-on-surface-variant'
        );
        elements.status.textContent = message;
    };

    const renderBlogs = session => {
        if (!elements.blogSelect) return;

        elements.blogSelect.replaceChildren();
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = session.blogs.length > 0
            ? '請選擇預設的 Blogger 網誌'
            : '請先連結 Google Blogger';
        elements.blogSelect.appendChild(placeholder);

        session.blogs.forEach(blog => {
            const option = document.createElement('option');
            option.value = blog.id;
            option.textContent = blog.name ? `${blog.name}${blog.url ? ` (${blog.url})` : ''}` : blog.id;
            option.dataset.blogName = blog.name;
            elements.blogSelect.appendChild(option);
        });

        const selectedExists = session.blogs.some(blog => blog.id === session.selectedBlog.id);
        elements.blogSelect.value = selectedExists ? session.selectedBlog.id : '';
        elements.blogSelect.disabled = busy || !session.connected || session.blogs.length === 0;

        if (elements.selectionNote) {
            elements.selectionNote.textContent = !session.connected
                ? session.blogs.length > 0 ? '請重新連結 Google 帳戶以確認可用的 Blogger 網誌。' : ''
                : session.selectedBlog.id && !selectedExists
                    ? '目前保存的預設網誌已不在此 Google 帳戶中，請重新選擇。'
                    : session.blogs.length > 0
                        ? '選擇後會保存為下次發佈的預設網誌。'
                        : '';
        }
    };

    const render = () => {
        const session = getBloggerSession();
        if (elements.clientIdWarning) {
            elements.clientIdWarning.classList.toggle('hidden', session.clientIdConfigured);
        }
        if (elements.authStatus) {
            elements.authStatus.textContent = !session.clientIdConfigured
                ? '尚未設定 OAuth Client ID'
                : session.connected
                    ? 'Google Blogger 已連結'
                    : '尚未連結 Google Blogger';
        }
        if (elements.connectButton) {
            elements.connectButton.disabled = busy || !session.clientIdConfigured;
            elements.connectButton.textContent = session.connected
                ? '重新連結 Google 帳戶'
                : '連結 Google Blogger';
        }
        if (elements.refreshButton) {
            elements.refreshButton.disabled = busy || !session.connected;
        }
        if (elements.disconnectButton) {
            elements.disconnectButton.disabled = busy || !session.connected;
        }
        renderBlogs(session);
    };

    const runConnection = async (operation, successMessage) => {
        if (busy) return;
        busy = true;
        setStatus('正在連結 Google Blogger…');
        render();
        try {
            const session = await operation();
            setStatus(`${successMessage}（共 ${session.blogs.length} 個網誌）`, 'success');
            showToast('Google Blogger 連線設定已更新。', { type: 'success' });
        } catch (error) {
            setStatus(getBloggerErrorMessage(error), 'error');
        } finally {
            busy = false;
            render();
        }
    };

    elements.connectButton.addEventListener('click', () => {
        const forceConsent = getBloggerSession().connected;
        runConnection(() => connectBlogger({ forceConsent }), '已取得 Blogger 網誌');
    });

    elements.refreshButton?.addEventListener('click', () => {
        runConnection(refreshBloggerBlogs, '已重新取得 Blogger 網誌');
    });

    elements.disconnectButton?.addEventListener('click', () => {
        if (!getBloggerSession().connected || !confirm('確定要解除 Google Blogger 連線並清除預設網誌嗎？')) return;
        disconnectBlogger();
        setStatus('已解除 Google Blogger 連線。', 'success');
        showToast('已解除 Google Blogger 連線。', { type: 'success' });
        render();
    });

    elements.blogSelect?.addEventListener('change', () => {
        const selectedOption = elements.blogSelect.selectedOptions[0];
        setSelectedBloggerBlog(elements.blogSelect.value
            ? { id: elements.blogSelect.value, name: selectedOption?.dataset.blogName || '' }
            : null);
        setStatus(elements.blogSelect.value ? '預設 Blogger 網誌已保存。' : '請選擇預設 Blogger 網誌。');
        render();
    });

    window.addEventListener('lumina:blogger-session-changed', render);
    render();
}
