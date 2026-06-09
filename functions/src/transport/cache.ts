import type { CacheState } from './types';

type CacheEntry<T> = {
  value?: T;
  freshUntil: number;
  staleUntil: number;
  refreshPromise?: Promise<T>;
};

const cacheStore = new Map<string, CacheEntry<unknown>>();

type CacheOptions<T> = {
  ttlMs: number;
  staleMs: number;
  loader: () => Promise<T>;
};

async function refreshEntry<T>(key: string, entry: CacheEntry<T>, options: CacheOptions<T>): Promise<T> {
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

export async function getCachedValue<T>(
  key: string,
  options: CacheOptions<T>,
): Promise<{ value: T; cache: CacheState }> {
  const now = Date.now();
  const existing = cacheStore.get(key) as CacheEntry<T> | undefined;

  if (existing?.value !== undefined && now < existing.freshUntil) {
    return { value: existing.value, cache: 'fresh' };
  }

  if (existing?.value !== undefined && now < existing.staleUntil) {
    void refreshEntry(key, existing, options).catch(() => {});
    return { value: existing.value, cache: 'stale' };
  }

  const entry = existing ?? { freshUntil: 0, staleUntil: 0 };
  cacheStore.set(key, entry);

  try {
    const value = await refreshEntry(key, entry, options);
    return { value, cache: existing?.value === undefined ? 'miss' : 'fresh' };
  } catch (error) {
    if (entry.value !== undefined) {
      return { value: entry.value, cache: 'stale' };
    }
    throw error;
  }
}
