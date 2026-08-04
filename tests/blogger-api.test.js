import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BloggerApiError,
    insertBloggerPost,
    listBloggerBlogs,
    publishBloggerPost,
    updateBloggerPost
} from '../public/js/blogger-api.js';

function mockFetch(responseBody, { status = 200 } = {}) {
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, options) => {
        calls.push({ url: String(input), options });
        return {
            ok: status >= 200 && status < 300,
            status,
            text: async () => JSON.stringify(responseBody)
        };
    };
    return {
        calls,
        restore: () => { globalThis.fetch = originalFetch; }
    };
}

test('listBloggerBlogs requests the current user blogs endpoint with bearer auth', async () => {
    const mock = mockFetch({ items: [{ id: '123', name: '測試網誌' }] });
    try {
        const blogs = await listBloggerBlogs('test-access-token');
        assert.deepEqual(blogs, [{ id: '123', name: '測試網誌' }]);
        assert.equal(mock.calls[0].url, 'https://www.googleapis.com/blogger/v3/users/self/blogs');
        assert.equal(mock.calls[0].options.headers.Authorization, 'Bearer test-access-token');
    } finally {
        mock.restore();
    }
});

test('insertBloggerPost sends a draft payload without leaking the access token into the body', async () => {
    const mock = mockFetch({ id: 'post-1', status: 'DRAFT' });
    try {
        await insertBloggerPost({
            accessToken: 'secret-token',
            blogId: 'blog/123',
            post: { title: '標題', content: '<p>內容</p>' },
            isDraft: true
        });
        const call = mock.calls[0];
        assert.equal(call.url, 'https://www.googleapis.com/blogger/v3/blogs/blog%2F123/posts?isDraft=true');
        assert.equal(call.options.method, 'POST');
        assert.deepEqual(JSON.parse(call.options.body), { title: '標題', content: '<p>內容</p>' });
        assert.equal(call.options.body.includes('secret-token'), false);
    } finally {
        mock.restore();
    }
});

test('update and publish use the expected Blogger post endpoints', async () => {
    const mock = mockFetch({ id: 'post-1', url: 'https://example.com/post-1' });
    try {
        await updateBloggerPost({
            accessToken: 'token',
            blogId: 'blog-1',
            postId: 'post/1',
            post: { title: '新標題', content: '<p>新內容</p>' }
        });
        await publishBloggerPost({ accessToken: 'token', blogId: 'blog-1', postId: 'post/1' });
        assert.equal(mock.calls[0].url, 'https://www.googleapis.com/blogger/v3/blogs/blog-1/posts/post%2F1');
        assert.equal(mock.calls[0].options.method, 'PATCH');
        assert.equal(mock.calls[1].url, 'https://www.googleapis.com/blogger/v3/blogs/blog-1/posts/post%2F1/publish');
        assert.equal(mock.calls[1].options.method, 'POST');
        assert.equal(mock.calls[1].options.body, undefined);
    } finally {
        mock.restore();
    }
});

test('Blogger API errors preserve status for user-facing handling', async () => {
    const mock = mockFetch({ error: { message: 'Forbidden', status: 'PERMISSION_DENIED' } }, { status: 403 });
    try {
        await assert.rejects(
            () => listBloggerBlogs('token'),
            error => error instanceof BloggerApiError && error.status === 403 && error.code === 'PERMISSION_DENIED'
        );
    } finally {
        mock.restore();
    }
});
