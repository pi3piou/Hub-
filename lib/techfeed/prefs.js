const READ_KEY = 'techfeed-read';
const SOURCES_KEY = 'techfeed-sources';
const APP_KEY = 'techfeed-appname';
const TABMODE_KEY = 'techfeed-tabmode';
const MAX_READ = 600;

export const BUILTIN_SOURCES = [
  { id: 'iPhoneAddict', name: 'iPhoneAddict', label: 'iAddict', url: 'https://iphoneaddict.fr/feed', color: '#2f7bf6', favorite: true, builtin: true },
  { id: 'KultureGeek', name: 'KultureGeek', label: 'KultureGeek', url: 'https://kulturegeek.fr/feed', color: '#f08b2c', favorite: true, builtin: true },
  { id: 'Numerama', name: 'Numerama', label: 'Numerama', url: 'https://www.numerama.com/feed', color: '#8b5cf6', favorite: true, builtin: true },
];

export function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function loadSources() {
  if (typeof window === 'undefined') return BUILTIN_SOURCES.map((s) => ({ ...s }));
  try {
    const raw = localStorage.getItem(SOURCES_KEY);
    if (!raw) return BUILTIN_SOURCES.map((s) => ({ ...s }));
    const stored = JSON.parse(raw);
    if (!Array.isArray(stored) || stored.length === 0) {
      return BUILTIN_SOURCES.map((s) => ({ ...s }));
    }
    return stored;
  } catch (e) {
    return BUILTIN_SOURCES.map((s) => ({ ...s }));
  }
}

export function saveSources(list) {
  try {
    localStorage.setItem(SOURCES_KEY, JSON.stringify(list));
  } catch (e) {}
  return list;
}

export function applySourceColors(list) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const source of list) {
    root.style.setProperty('--tint-' + slug(source.name), source.color);
  }
}

export function makeSource({ name, url, color }) {
  return {
    id: 'src' + Date.now().toString(36),
    name,
    label: name.length > 13 ? name.slice(0, 12) + '…' : name,
    url,
    color: color || '#64748b',
    favorite: true,
    builtin: false,
  };
}

export function sourceIcon(source) {
  if (source.iconUrl) return source.iconUrl;
  try {
    const origin = new URL(source.url).origin;
    return 'https://www.google.com/s2/favicons?sz=64&domain_url=' + encodeURIComponent(origin);
  } catch (e) {
    return null;
  }
}


export function loadAppName() {
  if (typeof window === 'undefined') return 'TechFeed';
  try {
    return localStorage.getItem(APP_KEY) || 'TechFeed';
  } catch (e) {
    return 'TechFeed';
  }
}

export function saveAppName(name) {
  try { localStorage.setItem(APP_KEY, name); } catch (e) {}
  return name;
}

export function loadTabMode() {
  if (typeof window === 'undefined') return 'name';
  try {
    return localStorage.getItem(TABMODE_KEY) || 'name';
  } catch (e) {
    return 'name';
  }
}

export function saveTabMode(mode) {
  try { localStorage.setItem(TABMODE_KEY, mode); } catch (e) {}
  return mode;
}

export function loadRead() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(READ_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function saveRead(list) {
  const trimmed = list.slice(-MAX_READ);
  try {
    localStorage.setItem(READ_KEY, JSON.stringify(trimmed));
  } catch (e) {}
  return trimmed;
}
