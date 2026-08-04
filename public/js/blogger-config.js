const runtimeClientId = typeof window !== 'undefined'
    ? window.__LUMINA_BLOGGER_CLIENT_ID__
    : '';

const buildClientId = import.meta.env?.VITE_GOOGLE_BLOGGER_CLIENT_ID || '';

export const BLOGGER_CLIENT_ID = String(buildClientId || runtimeClientId || '').trim();
export const BLOGGER_SCOPE = 'https://www.googleapis.com/auth/blogger';
export const BLOGGER_API_BASE_URL = 'https://www.googleapis.com/blogger/v3';

export const BLOGGER_SETTINGS_KEYS = {
    BLOG_ID: 'aliang-blogger-selected-blog-id',
    BLOG_NAME: 'aliang-blogger-selected-blog-name'
};
