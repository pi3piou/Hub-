const STORAGE_KEY = 'techfeed-article-cache';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

export function loadCache() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const now = Date.now();
    const clean = {};
    for (const id of Object.keys(parsed)) {
      const entry = parsed[id];
      if (entry && typeof entry.ts === 'number' && now - entry.ts < MAX_AGE_MS) {
        clean[id] = entry;
      }
    }
    return clean;
  } catch (e) {
    return {};
  }
}

export function saveEntry(cache, id, content, image) {
  const next = { ...cache, [id]: { content, image: image || null, ts: Date.now() } };
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      // Stockage plein : on continue sans bloquer l'app
    }
  }
  return next;
}

