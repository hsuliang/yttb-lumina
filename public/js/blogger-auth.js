import { BLOGGER_CLIENT_ID, BLOGGER_SCOPE } from './blogger-config.js';

let googleScriptPromise = null;
let tokenRequestPromise = null;
let accessToken = '';
let accessTokenExpiresAt = 0;

export class BloggerAuthError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'BloggerAuthError';
        this.code = code;
    }
}

function hasGoogleOAuthClient() {
    return typeof window !== 'undefined' &&
        window.google?.accounts?.oauth2?.initTokenClient;
}

function loadGoogleIdentityScript() {
    if (hasGoogleOAuthClient()) return Promise.resolve();
    if (googleScriptPromise) return googleScriptPromise;

    googleScriptPromise = new Promise((resolve, reject) => {
        const existingScript = document.querySelector('script[data-lumina-google-identity="true"]');
        const script = existingScript || document.createElement('script');

        const handleLoad = () => {
            if (hasGoogleOAuthClient()) {
                resolve();
            } else {
                reject(new BloggerAuthError('GIS_UNAVAILABLE', 'Google 身分服務尚未準備完成，請稍後再試。'));
            }
        };
        const handleError = () => {
            reject(new BloggerAuthError('GIS_LOAD_FAILED', '無法載入 Google 授權服務，請檢查網路或內容安全政策設定。'));
        };

        script.addEventListener('load', handleLoad, { once: true });
        script.addEventListener('error', handleError, { once: true });

        if (!existingScript) {
            script.src = 'https://accounts.google.com/gsi/client';
            script.async = true;
            script.defer = true;
            script.dataset.luminaGoogleIdentity = 'true';
            document.head.appendChild(script);
        } else if (hasGoogleOAuthClient()) {
            handleLoad();
        }
    }).catch(error => {
        googleScriptPromise = null;
        throw error;
    });

    return googleScriptPromise;
}

export function hasBloggerClientId() {
    return Boolean(BLOGGER_CLIENT_ID);
}

export function getBloggerAccessToken() {
    if (accessToken && accessTokenExpiresAt > Date.now() + 60000) {
        return accessToken;
    }
    return '';
}

export function clearBloggerAccessToken() {
    accessToken = '';
    accessTokenExpiresAt = 0;
}

export async function requestBloggerAccessToken({ forceConsent = false } = {}) {
    if (!BLOGGER_CLIENT_ID) {
        throw new BloggerAuthError(
            'MISSING_CLIENT_ID',
            '尚未設定 Google Blogger OAuth Client ID，請設定 VITE_GOOGLE_BLOGGER_CLIENT_ID 後重新建置。'
        );
    }

    const existingToken = getBloggerAccessToken();
    if (existingToken && !forceConsent) return existingToken;
    if (tokenRequestPromise) return tokenRequestPromise;

    tokenRequestPromise = (async () => {
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            throw new BloggerAuthError('BROWSER_REQUIRED', 'Blogger 授權只能在瀏覽器中進行。');
        }

        await loadGoogleIdentityScript();

        return new Promise((resolve, reject) => {
            let settled = false;
            const finishError = (error) => {
                if (settled) return;
                settled = true;
                reject(error);
            };

            try {
                const tokenClient = window.google.accounts.oauth2.initTokenClient({
                    client_id: BLOGGER_CLIENT_ID,
                    scope: BLOGGER_SCOPE,
                    callback: response => {
                        if (response?.error) {
                            finishError(new BloggerAuthError(
                                response.error,
                                response.error_description || 'Google Blogger 授權未完成。'
                            ));
                            return;
                        }
                        if (!response?.access_token) {
                            finishError(new BloggerAuthError('TOKEN_MISSING', 'Google 未回傳 Blogger 存取權杖。'));
                            return;
                        }

                        settled = true;
                        accessToken = response.access_token;
                        accessTokenExpiresAt = Date.now() + (Number(response.expires_in || 3600) * 1000);
                        resolve(accessToken);
                    },
                    error_callback: error => {
                        finishError(new BloggerAuthError(
                            error?.type || 'AUTH_FAILED',
                            'Google Blogger 授權視窗未完成，請重新嘗試。'
                        ));
                    }
                });

                const requestOptions = forceConsent ? { prompt: 'consent' } : {};
                tokenClient.requestAccessToken(requestOptions);
            } catch (error) {
                finishError(error instanceof BloggerAuthError
                    ? error
                    : new BloggerAuthError('AUTH_FAILED', error.message || 'Google Blogger 授權失敗。'));
            }
        });
    })().finally(() => {
        tokenRequestPromise = null;
    });

    return tokenRequestPromise;
}
