import { BLOGGER_API_BASE_URL } from './blogger-config.js';

export class BloggerApiError extends Error {
    constructor(message, { status = 0, code = '', details = null } = {}) {
        super(message);
        this.name = 'BloggerApiError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

function buildRequestUrl(path, query = {}) {
    const url = new URL(`${BLOGGER_API_BASE_URL}${path}`);
    Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            url.searchParams.set(key, String(value));
        }
    });
    return url;
}

export async function bloggerRequest(path, {
    accessToken,
    method = 'GET',
    query = {},
    body,
    signal
} = {}) {
    if (!accessToken) {
        throw new BloggerApiError('缺少 Blogger 存取權杖。', { status: 401, code: 'UNAUTHORIZED' });
    }

    let response;
    try {
        response = await fetch(buildRequestUrl(path, query), {
            method,
            signal,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
    } catch (error) {
        if (error.name === 'AbortError') throw error;
        throw new BloggerApiError(`Blogger 網路請求失敗：${error.message}`, { code: 'NETWORK_ERROR' });
    }

    const responseText = await response.text();
    let data = null;
    if (responseText) {
        try {
            data = JSON.parse(responseText);
        } catch (_) {
            data = { raw: responseText };
        }
    }

    if (!response.ok) {
        const apiError = data?.error;
        const message = apiError?.message || `Blogger API 回應錯誤（${response.status}）。`;
        throw new BloggerApiError(message, {
            status: response.status,
            code: apiError?.status || apiError?.code || '',
            details: data
        });
    }

    return data;
}

export async function listBloggerBlogs(accessToken, options = {}) {
    const data = await bloggerRequest('/users/self/blogs', { accessToken, ...options });
    return Array.isArray(data?.items) ? data.items : [];
}

export function insertBloggerPost({ accessToken, blogId, post, isDraft = true, signal }) {
    return bloggerRequest(`/blogs/${encodeURIComponent(blogId)}/posts`, {
        accessToken,
        method: 'POST',
        query: { isDraft },
        body: post,
        signal
    });
}

export function updateBloggerPost({ accessToken, blogId, postId, post, signal }) {
    return bloggerRequest(`/blogs/${encodeURIComponent(blogId)}/posts/${encodeURIComponent(postId)}`, {
        accessToken,
        method: 'PATCH',
        body: post,
        signal
    });
}

export function publishBloggerPost({ accessToken, blogId, postId, signal }) {
    return bloggerRequest(`/blogs/${encodeURIComponent(blogId)}/posts/${encodeURIComponent(postId)}/publish`, {
        accessToken,
        method: 'POST',
        signal
    });
}
