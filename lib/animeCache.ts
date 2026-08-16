/*
 * =========================================================
 * CACHE CLIENT
 *
 * Trois niveaux :
 *   1. Map en mémoire      → instantané
 *   2. sessionStorage      → survit à un rechargement
 *   3. requête réseau      → dernier recours
 *
 * Permet aussi de précharger une saison pendant que
 * l'utilisateur lit la fiche.
 * =========================================================
 */

const EPISODES_TTL = 15 * 60 * 1000;
const INFO_TTL = 60 * 60 * 1000;

export interface Player {
  name: string;
  urls: string[];
}

export interface EpisodesData {
  slug: string;
  saison: number;
  lang: 'vostfr' | 'vf';
  players: Player[];
  defaultPlayerIndex: number;
  totalEpisodes: number;
  hasVF: boolean;
}

export interface AnimeInfoData {
  slug: string;
  name: string;
  image: string;
  synopsis: string;
  genres: string[];
  status: string;
  year: string;
  type: string;
  seasons: number[];
  totalSeasons: number;
}

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const memory = new Map<string, Entry<unknown>>();

/*
 * Évite deux requêtes simultanées vers la même clé.
 * On ne transmet volontairement aucun AbortSignal :
 * une promesse partagée ne doit pas pouvoir être
 * annulée par un seul de ses consommateurs.
 */
const inflight = new Map<string, Promise<unknown>>();

export function getAnimeName(slug: string) {
  return slug
    .split('-')
    .filter(Boolean)
    .map(
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1)
    )
    .join(' ');
}

function episodesKey(
  slug: string,
  season: number,
  lang: string
) {
  return `techfeed_episodes_${slug}_s${season}_${lang}`;
}

function infoKey(slug: string) {
  return `techfeed_info_${slug}`;
}

function readEntry<T>(key: string): T | null {
  const local = memory.get(key) as
    | Entry<T>
    | undefined;

  if (local) {
    if (local.expiresAt > Date.now()) {
      return local.value;
    }

    memory.delete(key);
  }

  try {
    const raw = sessionStorage.getItem(key);

    if (!raw) return null;

    const parsed = JSON.parse(raw) as Entry<T>;

    if (
      !parsed ||
      typeof parsed.expiresAt !== 'number' ||
      parsed.expiresAt <= Date.now()
    ) {
      sessionStorage.removeItem(key);
      return null;
    }

    memory.set(key, parsed as Entry<unknown>);

    return parsed.value;
  } catch {
    return null;
  }
}

function writeEntry<T>(
  key: string,
  value: T,
  ttl: number
) {
  const entry: Entry<T> = {
    value,
    expiresAt: Date.now() + ttl,
  };

  memory.set(key, entry as Entry<unknown>);

  try {
    sessionStorage.setItem(
      key,
      JSON.stringify(entry)
    );
  } catch {
    /*
     * Quota dépassé ou navigation privée :
     * la mémoire suffit.
     */
  }
}

async function request<T>(
  url: string,
  key: string,
  ttl: number
): Promise<T> {
  const cached = readEntry<T>(key);

  if (cached) return cached;

  const existing = inflight.get(key);

  if (existing) {
    return existing as Promise<T>;
  }

  const promise = (async () => {
    const response = await fetch(url);

    const json = await response.json();

    if (!response.ok || json.error) {
      throw new Error(
        json.error || 'Requête échouée'
      );
    }

    writeEntry<T>(key, json as T, ttl);

    return json as T;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, promise);

  return promise;
}

/* =========================================================
   FICHE
   ========================================================= */

export function getCachedInfo(slug: string) {
  return readEntry<AnimeInfoData>(infoKey(slug));
}

export function loadAnimeInfo(slug: string) {
  return request<AnimeInfoData>(
    `/api/anime/info?slug=${encodeURIComponent(
      slug
    )}`,
    infoKey(slug),
    INFO_TTL
  );
}

/* =========================================================
   ÉPISODES
   ========================================================= */

export function getCachedEpisodes(
  slug: string,
  season: number,
  lang: 'vostfr' | 'vf'
) {
  return readEntry<EpisodesData>(
    episodesKey(slug, season, lang)
  );
}

export function loadEpisodes(
  slug: string,
  season: number,
  lang: 'vostfr' | 'vf'
) {
  return request<EpisodesData>(
    `/api/anime/episodes?slug=${encodeURIComponent(
      slug
    )}&saison=${season}&lang=${lang}`,
    episodesKey(slug, season, lang),
    EPISODES_TTL
  );
}

/*
 * Préchargement silencieux : on ignore les erreurs,
 * l'utilisateur n'attend rien.
 */
export function prefetchEpisodes(
  slug: string,
  season: number,
  lang: 'vostfr' | 'vf' = 'vostfr'
) {
  if (getCachedEpisodes(slug, season, lang)) {
    return;
  }

  loadEpisodes(slug, season, lang).catch(() => {
    // Rien
  });
}

export function prefetchAnimeInfo(slug: string) {
  if (getCachedInfo(slug)) return;

  loadAnimeInfo(slug).catch(() => {
    // Rien
  });
}
