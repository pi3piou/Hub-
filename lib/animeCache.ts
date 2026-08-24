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
  requestedLang: 'vostfr' | 'vf';
  fallback: boolean;
  players: Player[];
  defaultPlayerIndex: number;
  totalEpisodes: number;
  hasVF: boolean;
  hasVOSTFR: boolean;

  /*
   * Un nom par entree, dans l'ordre du lecteur. Rempli pour
   * les films et les hors-series, vide pour les saisons — et
   * absent des fiches mises en cache par une version
   * precedente, d'ou le point d'interrogation.
   */
  episodeNames?: string[];
}


export type SeasonKind = 'season' | 'film' | 'special';

/*
 * `path` et `kind` sont facultatifs : une fiche déjà mise en
 * cache par une version précédente de l'application n'en a
 * pas, et elle doit continuer à s'afficher jusqu'à
 * l'expiration de son entrée. En leur absence, la partie est
 * traitée comme une saison ordinaire — ce qu'elle était
 * forcément à l'époque où le cache a été écrit.
 */

export interface SeasonEntry {
  number: number;
  label: string;
  langs: string[];
  path?: string;
  kind?: SeasonKind;
}

export interface AnimeInfoData {
  slug: string;
  name: string;
  altTitles: string[];
  image: string;
  synopsis: string;
  genres: string[];
  status: string;
  year: string;
  type: string;
  seasonEntries: SeasonEntry[];
  seasons: number[];
  totalSeasons: number;
  langs: string[];
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

/* =========================================================
   ANILIST — STATUT ET TOTAL D'ÉPISODES
   ========================================================= */

export interface AniListData {
  matched: boolean;
  reason?: string;
  confidence?: number;
  status?:
    | 'FINISHED'
    | 'RELEASING'
    | 'NOT_YET_RELEASED'
    | 'CANCELLED'
    | 'HIATUS'
    | null;
  statusLabel?: string | null;
  episodes?: number | null;
  anilistId?: number;
}

const ANILIST_TTL = 24 * 60 * 60 * 1000;

function anilistKey(slug: string) {
  return `techfeed_anilist_${slug}`;
}

export function getCachedAniList(slug: string) {
  return readEntry<AniListData>(anilistKey(slug));
}

export function loadAniList(
  slug: string,
  name: string,
  altTitles: string[] = []
) {
  const params = new URLSearchParams({ name });

  if (altTitles.length) {
    params.set('alt', altTitles.join('|'));
  }

  return request<AniListData>(
    `/api/anime/anilist?${params.toString()}`,
    anilistKey(slug),
    ANILIST_TTL
  );
}

export function prefetchAniList(
  slug: string,
  name: string,
  altTitles: string[] = []
) {
  if (getCachedAniList(slug)) return;

  loadAniList(slug, name, altTitles).catch(() => {
    // Rien : simple enrichissement, pas bloquant
  });
}

/* =========================================================
   TMDB — STATUT ET ÉPISODES PAR SAISON
   ========================================================= */

export interface TMDBSeason {
  seasonNumber: number;
  episodeCount: number;
  name?: string;
}

export interface TMDBData {
  matched: boolean;
  reason?: string;
  confidence?: number;
  status?: string | null;
  statusLabel?: string | null;
  episodes?: number | null;
  seasons?: TMDBSeason[] | null;
  tmdbId?: number;
}

const TMDB_TTL = 24 * 60 * 60 * 1000;

function tmdbKey(slug: string) {
  return `techfeed_tmdb_${slug}`;
}

export function getCachedTMDB(slug: string) {
  return readEntry<TMDBData>(tmdbKey(slug));
}

export function loadTMDB(
  slug: string,
  name: string,
  altTitles: string[] = [],
  seasonCount = 0
) {
  const params = new URLSearchParams({ name });

  if (altTitles.length) {
    params.set('alt', altTitles.join('|'));
  }

  if (seasonCount > 0) {
    params.set('seasons', String(seasonCount));
  }

  return request<TMDBData>(
    `/api/anime/tmdb?${params.toString()}`,
    tmdbKey(slug),
    TMDB_TTL
  );
}

export function prefetchTMDB(
  slug: string,
  name: string,
  altTitles: string[] = [],
  seasonCount = 0
) {
  if (getCachedTMDB(slug)) return;

  loadTMDB(slug, name, altTitles, seasonCount).catch(
    () => {
      // Simple enrichissement, pas bloquant
    }
  );
}
