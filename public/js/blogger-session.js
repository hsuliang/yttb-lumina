import { BLOGGER_SETTINGS_KEYS } from './blogger-config.js';
import {
    BloggerAuthError,
    clearBloggerAccessToken,
    getBloggerAccessToken,
    hasBloggerClientId,
    requestBloggerAccessToken
} from './blogger-auth.js';
import { BloggerApiError, listBloggerBlogs } from './blogger-api.js';

const BLOGGER_SESSION_EVENT = 'lumina:blogger-session-changed';
let bloggerBlogs = [];

function getStorage() {
    return typeof localStorage === 'undefined' ? null : localStorage;
}

function readSavedBlog() {
    const storage = getStorage();
    if (!storage) return { id: '', name: '' };

    try {
        return {
            id: storage.getItem(BLOGGER_SETTINGS_KEYS.BLOG_ID) || '',
            name: storage.getItem(BLOGGER_SETTINGS_KEYS.BLOG_NAME) || ''
        };
    } catch (_) {
        return { id: '', name: '' };
    }
}

function persistSelectedBlog(blog) {
    const storage = getStorage();
    if (!storage) return;

    try {
        if (!blog?.id) {
            storage.removeItem(BLOGGER_SETTINGS_KEYS.BLOG_ID);
            storage.removeItem(BLOGGER_SETTINGS_KEYS.BLOG_NAME);
            return;
        }
        storage.setItem(BLOGGER_SETTINGS_KEYS.BLOG_ID, blog.id);
        storage.setItem(BLOGGER_SETTINGS_KEYS.BLOG_NAME, blog.name || '');
    } catch (error) {
        console.warn('無法儲存 Blogger 網誌選擇:', error);
    }
}

function emitSessionChanged() {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(BLOGGER_SESSION_EVENT));
    }
}

function normalizeBlogs(blogs) {
    return (Array.isArray(blogs) ? blogs : [])
        .filter(blog => blog?.id)
        .map(blog => ({
            id: String(blog.id),
            name: String(blog.name || ''),
            url: String(blog.url || '')
        }));
}

export function getBloggerBlogs() {
    return bloggerBlogs.map(blog => ({ ...blog }));
}

export function getSelectedBloggerBlog() {
    return { ...readSavedBlog() };
}

export function getBloggerSession() {
    return {
        clientIdConfigured: hasBloggerClientId(),
        connected: Boolean(getBloggerAccessToken()),
        blogs: getBloggerBlogs(),
        selectedBlog: getSelectedBloggerBlog()
    };
}

export function setSelectedBloggerBlog(blog) {
    persistSelectedBlog(blog);
    emitSessionChanged();
    return getSelectedBloggerBlog();
}

export function notifyBloggerSessionChanged() {
    emitSessionChanged();
}

export async function connectBlogger({ forceConsent = false } = {}) {
    const accessToken = await requestBloggerAccessToken({ forceConsent });

    try {
        bloggerBlogs = normalizeBlogs(await listBloggerBlogs(accessToken));
    } catch (error) {
        if (error instanceof BloggerApiError && error.status === 401) {
            clearBloggerAccessToken();
            bloggerBlogs = [];
        }
        emitSessionChanged();
        throw error;
    }

    const savedBlog = readSavedBlog();
    if (!savedBlog.id && bloggerBlogs.length === 1) {
        persistSelectedBlog(bloggerBlogs[0]);
    }
    emitSessionChanged();
    return getBloggerSession();
}

export function refreshBloggerBlogs() {
    return connectBlogger();
}

export function disconnectBlogger() {
    clearBloggerAccessToken();
    bloggerBlogs = [];
    persistSelectedBlog(null);
    emitSessionChanged();
    return getBloggerSession();
}

export function getBloggerErrorMessage(error) {
    if (error instanceof BloggerAuthError) {
        if (error.code === 'MISSING_CLIENT_ID') return error.message;
        if (error.code === 'access_denied' || error.code === 'popup_closed') {
            return '您已取消 Google Blogger 授權。';
        }
        return error.message;
    }

    if (error instanceof BloggerApiError) {
        if (error.status === 401) return 'Google Blogger 授權已過期，請重新連結 Google 帳戶。';
        if (error.status === 403) return '目前 Google 帳戶沒有此 Blogger 網誌的發佈權限，或 Blogger API 尚未啟用。';
        if (error.status === 404) return '找不到指定的 Blogger 網誌或文章，請重新選擇網誌。';
        if (error.status === 429) return 'Blogger API 暫時忙碌，請稍後再試。';
        return error.message;
    }

    return error?.message || 'Blogger 操作失敗，請稍後再試。';
}
