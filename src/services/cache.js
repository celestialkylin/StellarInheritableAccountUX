import { useSyncExternalStore } from "react";

const emptyEntry = Object.freeze({ data: null, fetchedAt: null, loaded: false });

const stores = {
  info: { data: null, fetchedAt: null, loaded: false },
  candidates: { data: null, fetchedAt: null, loaded: false },
};

/** @type {Map<string, Set<() => void>>} */
const listeners = new Map();

function notify(key) {
  const set = listeners.get(key);
  if (!set) return;
  for (const cb of set) cb();
}

function ensureStore(key) {
  if (!stores[key]) {
    stores[key] = { data: null, fetchedAt: null, loaded: false };
  }
  return stores[key];
}

export function getCache(key) {
  return stores[key]?.data ?? null;
}

export function getCacheMeta(key) {
  const s = stores[key];
  return { loaded: s?.loaded ?? false, fetchedAt: s?.fetchedAt ?? null };
}

export function setCache(key, data) {
  stores[key] = { data, fetchedAt: Date.now(), loaded: true };
  notify(key);
}

export function invalidateCache(key) {
  const s = stores[key];
  if (!s) return;
  // Replace the entry so useSyncExternalStore snapshots change by reference.
  stores[key] = { data: s.data, fetchedAt: s.fetchedAt, loaded: false };
  notify(key);
}

export function clearAllCaches() {
  for (const key of Object.keys(stores)) {
    stores[key] = { data: null, fetchedAt: null, loaded: false };
    notify(key);
  }
}

/**
 * Subscribe to cache updates for a key. Listener is called with no args;
 * read via getCache / getCacheMeta / useCacheState.
 * @returns {() => void} unsubscribe
 */
export function subscribeCache(key, listener) {
  ensureStore(key);
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key);
  };
}

/**
 * React hook: shared cache data + meta that re-renders on set/invalidate.
 * @returns {[unknown, { loaded: boolean, fetchedAt: number | null }]}
 */
export function useCacheState(key) {
  const entry = useSyncExternalStore(
    (onStoreChange) => subscribeCache(key, onStoreChange),
    () => stores[key] ?? emptyEntry,
    () => stores[key] ?? emptyEntry,
  );
  return [entry.data, { loaded: entry.loaded, fetchedAt: entry.fetchedAt }];
}
