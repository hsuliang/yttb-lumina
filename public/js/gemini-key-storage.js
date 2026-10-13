const KEY_NAME = 'geminiApiKey';
const STATE_NAME = 'geminiApiState';
const LEGACY_KEYS_NAME = 'geminiApiKeys';

export function getGeminiApiKey() {
    let key = localStorage.getItem(KEY_NAME) || sessionStorage.getItem(KEY_NAME) || '';
    const legacyStorage = localStorage.getItem(LEGACY_KEYS_NAME) ? localStorage : sessionStorage;
    const legacy = legacyStorage.getItem(LEGACY_KEYS_NAME);

    if (!key && legacy) {
        try {
            const entries = JSON.parse(legacy);
            key = Array.isArray(entries) ? (entries[0]?.key || entries[0] || '') : (typeof entries === 'string' ? entries : '');
            if (typeof key === 'string' && key) legacyStorage.setItem(KEY_NAME, key);
        } catch (_) {
            key = '';
        }
    }

    // Old versions stored multiple keys. Keep only the selected key on upgrade.
    localStorage.removeItem(LEGACY_KEYS_NAME);
    sessionStorage.removeItem(LEGACY_KEYS_NAME);
    return typeof key === 'string' ? key : '';
}

export function getGeminiApiState(key) {
    const storage = sessionStorage.getItem(KEY_NAME) === key ? sessionStorage : localStorage;
    try {
        const state = JSON.parse(storage.getItem(STATE_NAME) || '{}');
        return state.key === key ? state : { key };
    } catch (_) {
        return { key };
    }
}

export function updateGeminiApiState(key, updater) {
    if (!key) return;
    const storage = sessionStorage.getItem(KEY_NAME) === key ? sessionStorage : localStorage;
    const state = getGeminiApiState(key);
    updater(state);
    storage.setItem(STATE_NAME, JSON.stringify(state));
}

export function clearGeminiApiKey() {
    for (const storage of [localStorage, sessionStorage]) {
        storage.removeItem(KEY_NAME);
        storage.removeItem(STATE_NAME);
        storage.removeItem(LEGACY_KEYS_NAME);
    }
}

export function saveGeminiApiKey(key, isSession = false) {
    const previousKey = getGeminiApiKey();
    const previousState = previousKey === key ? getGeminiApiState(key) : null;
    clearGeminiApiKey();
    const storage = isSession ? sessionStorage : localStorage;
    storage.setItem(KEY_NAME, key);
    if (previousState) storage.setItem(STATE_NAME, JSON.stringify(previousState));
}
