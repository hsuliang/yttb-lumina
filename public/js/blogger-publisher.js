import {
    clearBloggerAccessToken,
    hasBloggerClientId,
    requestBloggerAccessToken
} from './blogger-auth.js';
import {
    BloggerApiError,
    insertBloggerPost,
    publishBloggerPost,
    updateBloggerPost
} from './blogger-api.js';
import { buildBloggerPost } from './blogger-content.js';
import {
    getBloggerErrorMessage,
    getBloggerSession,
    notifyBloggerSessionChanged,
    refreshBloggerBlogs,
    setSelectedBloggerBlog
} from './blogger-session.js';
import { showModal, showToast } from './ui-components.js';

function getPublishMode(elements) {
    return elements.modeInputs.find(input => input.checked)?.value || 'draft';
}

export function initializeBloggerPublisher({ getSnapshot, onPublished } = {}) {
    const elements = {
        publishButton: document.getElementById('blogger-publish-btn'),
        status: document.getElementById('blogger-publish-status'),
        modal: document.getElementById('blogger-publish-modal'),
        modalCloseButton: document.getElementById('blogger-modal-close-btn'),
        modalCancelButton: document.getElementById('blogger-modal-cancel-btn'),
        connectButton: document.getElementById('blogger-connect-btn'),
        refreshBlogsButton: document.getElementById('blogger-refresh-blogs-btn'),
        authStatus: document.getElementById('blogger-auth-status'),
        clientIdWarning: document.getElementById('blogger-client-id-warning'),
        blogSelect: document.getElementById('blogger-blog-select'),
        blogSelectionNote: document.getElementById('blogger-blog-selection-note'),
        previewTitle: document.getElementById('blogger-preview-title'),
        previewLabels: document.getElementById('blogger-preview-labels'),
        modalStatus: document.getElementById('blogger-modal-status'),
        confirmButton: document.getElementById('blogger-confirm-publish-btn'),
        modeInputs: [...document.querySelectorAll('input[name="blogger-mode"]')]
    };

    if (!elements.publishButton || !elements.modal || typeof getSnapshot !== 'function') return;
    if (elements.publishButton.dataset.bloggerPublisherBound === 'true') return;
    elements.publishButton.dataset.bloggerPublisherBound = 'true';

    const initialSession = getBloggerSession();
    const viewState = {
        blogs: initialSession.blogs,
        pendingSnapshot: null,
        busy: false,
        selectedBlogId: initialSession.selectedBlog.id
    };

    const setOuterStatus = (message, type = 'muted', url = '') => {
        if (!elements.status) return;
        elements.status.className = 'text-[10px] mt-1 ' + (
            type === 'success' ? 'text-success' :
                type === 'warning' ? 'text-warning' :
                    type === 'error' ? 'text-error' : 'text-on-surface-variant'
        );
        elements.status.textContent = message;
        if (url) {
            const link = document.createElement('a');
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = ' 開啟';
            link.className = 'text-primary hover:underline ml-1';
            elements.status.appendChild(link);
        }
    };

    const setModalStatus = (message, type = 'muted') => {
        if (!elements.modalStatus) return;
        elements.modalStatus.className = 'text-xs min-h-[1.25rem] ' + (
            type === 'success' ? 'text-success' :
                type === 'warning' ? 'text-warning' :
                    type === 'error' ? 'text-error' : 'text-on-surface-variant'
        );
        elements.modalStatus.textContent = message;
    };

    const getSnapshotForPublish = () => {
        const snapshot = getSnapshot();
        if (!snapshot?.version || !snapshot.htmlContent) return null;

        const seoTags = snapshot.version.seoData?.tags || '';
        const post = buildBloggerPost({
            title: snapshot.title,
            htmlContent: snapshot.htmlContent,
            labels: [...(snapshot.labels || []), seoTags]
        });
        return { ...snapshot, post };
    };

    const renderExistingState = snapshot => {
        const publication = snapshot?.version?.blogger;
        if (!publication) {
            setOuterStatus('尚未發佈至 Blogger');
            return;
        }
        const label = publication.status === 'published' ? '已發佈至 Blogger' : 'Blogger 草稿已建立';
        setOuterStatus(label, 'success', publication.postUrl);
    };

    const updateConfirmState = () => {
        const publication = viewState.pendingSnapshot?.version?.blogger;
        const hasSelectedBlog = Boolean(elements.blogSelect?.value);
        const sameBlog = !publication?.blogId || publication.blogId === elements.blogSelect?.value;
        const session = getBloggerSession();
        const ready = session.clientIdConfigured && session.connected && hasSelectedBlog && sameBlog && !viewState.busy;

        if (elements.confirmButton) {
            elements.confirmButton.disabled = !ready;
            const mode = getPublishMode(elements);
            elements.confirmButton.textContent = publication?.postId
                ? (publication.status === 'published'
                    ? '更新已發佈文章'
                    : mode === 'publish' ? '更新並發佈' : '更新 Blogger 草稿')
                : (mode === 'publish' ? '直接發佈' : '建立 Blogger 草稿');
        }
        if (elements.blogSelectionNote) {
            elements.blogSelectionNote.textContent = publication?.postId && !sameBlog
                ? '此文章版本已連結另一個 Blogger 網誌，請選回原網誌以更新。'
                : '';
        }
    };

    const renderBlogs = () => {
        if (!elements.blogSelect) return;
        const session = getBloggerSession();
        const savedBlog = session.selectedBlog;
        elements.blogSelect.replaceChildren();

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = session.connected && viewState.blogs.length > 0
            ? '請選擇要使用的 Blogger 網誌'
            : '請先連結 Google Blogger';
        elements.blogSelect.appendChild(placeholder);

        viewState.blogs.forEach(blog => {
            const option = document.createElement('option');
            option.value = blog.id;
            option.textContent = blog.name ? `${blog.name}${blog.url ? ` (${blog.url})` : ''}` : blog.id;
            option.dataset.blogName = blog.name || '';
            elements.blogSelect.appendChild(option);
        });

        const savedExists = viewState.blogs.some(blog => blog.id === savedBlog.id);
        if (savedExists) {
            elements.blogSelect.value = savedBlog.id;
        } else if (viewState.blogs.length === 1) {
            elements.blogSelect.value = viewState.blogs[0].id;
        } else {
            elements.blogSelect.value = '';
        }

        viewState.selectedBlogId = elements.blogSelect.value;
        elements.blogSelect.disabled = viewState.busy || !session.connected || viewState.blogs.length === 0;
        updateConfirmState();
    };

    const renderSessionState = () => {
        const session = getBloggerSession();
        viewState.blogs = session.blogs;
        viewState.selectedBlogId = session.selectedBlog.id;

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
            elements.connectButton.disabled = viewState.busy || !session.clientIdConfigured;
            elements.connectButton.textContent = session.connected
                ? '前往全域設定管理'
                : '前往全域設定連結';
        }
        if (elements.refreshBlogsButton) {
            elements.refreshBlogsButton.disabled = viewState.busy || !session.connected;
        }
        renderBlogs();
    };

    const openBloggerSettings = () => {
        if (viewState.busy) return;
        elements.modal.classList.add('hidden');
        window.dispatchEvent(new CustomEvent('lumina:open-global-settings', {
            detail: { tabId: 'settings-tab-blogger' }
        }));
    };

    const setBusy = busy => {
        viewState.busy = busy;
        const session = getBloggerSession();
        elements.connectButton && (elements.connectButton.disabled = busy || !session.clientIdConfigured);
        elements.refreshBlogsButton && (elements.refreshBlogsButton.disabled = busy || !session.connected);
        elements.blogSelect && (elements.blogSelect.disabled = busy || !session.connected || viewState.blogs.length === 0);
        elements.modeInputs.forEach(input => { input.disabled = busy; });
        updateConfirmState();
    };

    const refreshBlogs = async () => {
        if (!hasBloggerClientId()) {
            setModalStatus('尚未設定 Google Blogger OAuth Client ID。', 'warning');
            return;
        }
        setBusy(true);
        setModalStatus('正在重新取得 Blogger 網誌…');
        try {
            const session = await refreshBloggerBlogs();
            viewState.blogs = session.blogs;
            renderSessionState();
            if (session.blogs.length === 0) {
                setModalStatus('此 Google 帳戶找不到可管理的 Blogger 網誌。', 'warning');
            } else {
                setModalStatus(`已取得 ${session.blogs.length} 個 Blogger 網誌。`, 'success');
            }
        } catch (error) {
            if (error instanceof BloggerApiError && error.status === 401) {
                clearBloggerAccessToken();
                notifyBloggerSessionChanged();
            }
            setModalStatus(getBloggerErrorMessage(error), 'error');
        } finally {
            setBusy(false);
        }
    };

    const openModal = () => {
        let snapshot;
        try {
            snapshot = getSnapshotForPublish();
        } catch (error) {
            showModal({ title: '無法準備 Blogger 文章', message: error.message });
            return;
        }
        if (!snapshot) {
            showToast('請先生成一篇部落格文章。', { type: 'warning' });
            return;
        }

        viewState.pendingSnapshot = snapshot;
        elements.previewTitle.textContent = snapshot.post.title;
        elements.previewLabels.textContent = snapshot.post.labels?.join('、') || '沒有設定標籤';
        elements.modal.classList.remove('hidden');

        const session = getBloggerSession();
        renderSessionState();
        setModalStatus(
            !session.clientIdConfigured
                ? '請先完成目前部署環境的 OAuth Client ID 設定。'
                : !session.connected
                    ? '請點擊「前往全域設定連結」，完成 Google Blogger 授權。'
                    : session.blogs.length === 0
                        ? '此 Google 帳戶目前沒有可管理的 Blogger 網誌。'
                        : '請選擇 Blogger 網誌後建立草稿或直接發佈。'
        );
        renderExistingState(snapshot);

        const existingStatus = snapshot.version.blogger?.status;
        const publishInput = elements.modeInputs.find(input => input.value === 'publish');
        if (publishInput) publishInput.checked = existingStatus === 'published';
        updateConfirmState();
    };

    const closeModal = () => {
        if (viewState.busy) return;
        elements.modal.classList.add('hidden');
        viewState.pendingSnapshot = null;
    };

    const performPublish = async () => {
        if (viewState.busy) return;

        let snapshot;
        try {
            snapshot = getSnapshotForPublish();
        } catch (error) {
            showModal({ title: '無法準備 Blogger 文章', message: error.message });
            return;
        }
        if (!snapshot) return;
        if (!elements.blogSelect.value) {
            setModalStatus('請先選擇 Blogger 網誌。', 'warning');
            return;
        }

        const publication = snapshot.version.blogger;
        if (publication?.postId && publication.blogId !== elements.blogSelect.value) {
            setModalStatus('此版本已連結另一個 Blogger 網誌，請選回原網誌。', 'warning');
            return;
        }

        const selectedOption = elements.blogSelect.selectedOptions[0];
        const blogId = elements.blogSelect.value;
        const blogName = selectedOption?.dataset.blogName || selectedOption?.textContent || blogId;
        const mode = getPublishMode(elements);
        const postPayload = {
            title: snapshot.post.title,
            content: snapshot.post.content,
            ...(snapshot.post.labels?.length ? { labels: snapshot.post.labels } : {})
        };

        setBusy(true);
        setModalStatus(publication?.postId ? '正在更新 Blogger 文章…' : '正在建立 Blogger 草稿…');

        let remoteInfo = null;
        try {
            const accessToken = await requestBloggerAccessToken();
            let response;

            if (publication?.postId) {
                response = await updateBloggerPost({
                    accessToken,
                    blogId,
                    postId: publication.postId,
                    post: postPayload
                });
                remoteInfo = {
                    ...publication,
                    blogId,
                    blogName,
                    postId: publication.postId,
                    postUrl: response?.url || publication.postUrl || '',
                    status: publication.status || 'draft',
                    contentHash: snapshot.post.contentHash,
                    lastSyncedAt: new Date().toISOString()
                };
            } else {
                response = await insertBloggerPost({
                    accessToken,
                    blogId,
                    post: postPayload,
                    isDraft: true
                });
                if (!response?.id) throw new BloggerApiError('Blogger 沒有回傳新文章 ID。', { code: 'POST_ID_MISSING' });
                remoteInfo = {
                    blogId,
                    blogName,
                    postId: response.id,
                    postUrl: response.url || '',
                    status: 'draft',
                    contentHash: snapshot.post.contentHash,
                    lastSyncedAt: new Date().toISOString()
                };
            }

            if (mode === 'publish' && remoteInfo.status !== 'published') {
                setModalStatus('草稿已建立，正在公開發佈…');
                const publishedResponse = await publishBloggerPost({
                    accessToken,
                    blogId,
                    postId: remoteInfo.postId
                });
                remoteInfo = {
                    ...remoteInfo,
                    status: 'published',
                    postUrl: publishedResponse?.url || remoteInfo.postUrl,
                    publishedAt: publishedResponse?.published || new Date().toISOString()
                };
            } else if (publication?.status === 'published') {
                remoteInfo.status = 'published';
            }

            onPublished?.({ ...remoteInfo, versionIndex: snapshot.versionIndex, sourceId: snapshot.sourceId }, snapshot);
            renderExistingState({ version: { blogger: remoteInfo } });
            elements.modal.classList.add('hidden');
            viewState.pendingSnapshot = null;
            showToast(remoteInfo.status === 'published' ? '✅ Blogger 文章已發佈！' : '✅ Blogger 草稿已建立！', { type: 'success' });
        } catch (error) {
            if (error instanceof BloggerApiError && error.status === 401) {
                clearBloggerAccessToken();
                notifyBloggerSessionChanged();
            }
            if (remoteInfo) {
                onPublished?.({ ...remoteInfo, versionIndex: snapshot.versionIndex, sourceId: snapshot.sourceId }, snapshot);
                renderExistingState({ version: { blogger: remoteInfo } });
            }
            setModalStatus(
                remoteInfo?.status === 'draft' && mode === 'publish'
                    ? `草稿已建立，但公開發佈失敗：${getBloggerErrorMessage(error)}`
                    : getBloggerErrorMessage(error),
                'error'
            );
        } finally {
            setBusy(false);
        }
    };

    elements.publishButton.addEventListener('click', openModal);
    elements.modalCloseButton?.addEventListener('click', closeModal);
    elements.modalCancelButton?.addEventListener('click', closeModal);
    elements.connectButton?.addEventListener('click', openBloggerSettings);
    elements.refreshBlogsButton?.addEventListener('click', refreshBlogs);
    elements.blogSelect?.addEventListener('change', () => {
        const selectedOption = elements.blogSelect.selectedOptions[0];
        viewState.selectedBlogId = elements.blogSelect.value;
        setSelectedBloggerBlog(viewState.selectedBlogId
            ? { id: viewState.selectedBlogId, name: selectedOption?.dataset.blogName || '' }
            : null);
        updateConfirmState();
    });
    elements.modeInputs.forEach(input => input.addEventListener('change', updateConfirmState));
    elements.confirmButton?.addEventListener('click', performPublish);

    window.addEventListener('lumina:blog-version-changed', () => {
        try {
            renderExistingState(getSnapshot());
        } catch (_) {
            setOuterStatus('尚未生成文章');
        }
    });

    window.addEventListener('lumina:blogger-session-changed', () => {
        renderSessionState();
        if (elements.modal.classList.contains('hidden')) return;

        const session = getBloggerSession();
        setModalStatus(
            !session.clientIdConfigured
                ? '請先完成目前部署環境的 OAuth Client ID 設定。'
                : !session.connected
                    ? '請點擊「前往全域設定連結」，完成 Google Blogger 授權。'
                    : session.blogs.length === 0
                        ? '此 Google 帳戶目前沒有可管理的 Blogger 網誌。'
                        : '請選擇 Blogger 網誌後建立草稿或直接發佈。'
        );
    });

    try {
        renderExistingState(getSnapshot());
    } catch (_) {
        setOuterStatus('尚未生成文章');
    }
}
