const stores = {
  info: { data: null, fetchedAt: null, loaded: false },
  candidates: { data: null, fetchedAt: null, loaded: false },
};

export function getCache(key) {
  return stores[key]?.data ?? null;
}

export function getCacheMeta(key) {
  const s = stores[key];
  return { loaded: s?.loaded ?? false, fetchedAt: s?.fetchedAt ?? null };
}

export function setCache(key, data) {
  stores[key] = { data, fetchedAt: Date.now(), loaded: true };
}

export function invalidateCache(key) {
  if (stores[key]) {
    stores[key].loaded = false;
  }
}

export function clearAllCaches() {
  for (const key of Object.keys(stores)) {
    stores[key] = { data: null, fetchedAt: null, loaded: false };
  }
}