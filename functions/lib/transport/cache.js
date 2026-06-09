"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCachedValue = getCachedValue;
const cacheStore = new Map();
async function refreshEntry(key, entry, options) {
    if (!entry.refreshPromise) {
        entry.refreshPromise = options
            .loader()
            .then((value) => {
            entry.value = value;
            entry.freshUntil = Date.now() + options.ttlMs;
            entry.staleUntil = entry.freshUntil + options.staleMs;
            entry.refreshPromise = undefined;
            return value;
        })
            .catch((error) => {
            entry.refreshPromise = undefined;
            throw error;
        });
    }
    return entry.refreshPromise;
}
async function getCachedValue(key, options) {
    const now = Date.now();
    const existing = cacheStore.get(key);
    if (existing?.value !== undefined && now < existing.freshUntil) {
        return { value: existing.value, cache: 'fresh' };
    }
    if (existing?.value !== undefined && now < existing.staleUntil) {
        void refreshEntry(key, existing, options).catch(() => { });
        return { value: existing.value, cache: 'stale' };
    }
    const entry = existing ?? { freshUntil: 0, staleUntil: 0 };
    cacheStore.set(key, entry);
    try {
        const value = await refreshEntry(key, entry, options);
        return { value, cache: existing?.value === undefined ? 'miss' : 'fresh' };
    }
    catch (error) {
        if (entry.value !== undefined) {
            return { value: entry.value, cache: 'stale' };
        }
        throw error;
    }
}
