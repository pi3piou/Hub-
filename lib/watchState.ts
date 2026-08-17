/*
 * =========================================================
 * ÉTAT DE VISIONNAGE
 *
 * Centralise la lecture et l'écriture des clés
 * existantes. Le format stocké n'est pas modifié :
 *   anime_watched_{slug}_s{saison}_{lang}  → number[]
 *   anime_progress_{slug}_{lang}           → SeasonProgress[]
 * =========================================================
 */

export type Lang = 'vostfr' | 'vf';

export interface SeasonProgress {
  season: number;
  watched: number;
  total: number;
  lastEpisode: number;
  updatedAt: number;
}

export function getWatchKey(
  slug: string,
  season: number,
  lang: string
) {
  return `anime_watched_${slug}_s${season}_${lang}`;
}

export function getProgressKey(
  slug: string,
  lang: string
) {
  return `anime_progress_${slug}_${lang}`;
}

export function readWatched(
  slug: string,
  season: number,
  lang: string
): number[] {
  try {
    const raw = localStorage.getItem(
      getWatchKey(slug, season, lang)
    );

    if (!raw) return [];

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(Number)
      .filter(
        (number) =>
          Number.isInteger(number) && number >= 0
      );
  } catch {
    return [];
  }
}

export function readProgress(
  slug: string,
  lang: string
): SeasonProgress[] {
  try {
    const raw = localStorage.getItem(
      getProgressKey(slug, lang)
    );

    if (!raw) return [];

    const parsed = JSON.parse(raw);

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getSeasonProgress(
  slug: string,
  season: number,
  lang: string
) {
  return (
    readProgress(slug, lang).find(
      (item) => item.season === season
    ) || null
  );
}

/*
 * Écrit la progression d'une saison en conservant
 * exactement la structure attendue par les pages.
 */
export function writeSeasonProgress(
  slug: string,
  lang: string,
  entry: SeasonProgress
) {
  try {
    const key = getProgressKey(slug, lang);

    let progress = readProgress(slug, lang);

    const exists = progress.some(
      (item) => item.season === entry.season
    );

    progress = exists
      ? progress.map((item) =>
          item.season === entry.season
            ? entry
            : item
        )
      : [...progress, entry];

    progress.sort((a, b) => a.season - b.season);

    localStorage.setItem(
      key,
      JSON.stringify(progress)
    );

    return progress;
  } catch {
    return readProgress(slug, lang);
  }
}

/*
 * Marque tous les épisodes jusqu'à l'index donné.
 * Utilisé par l'appui long et par le bouton
 * « marquer la saison ».
 */
export function markEpisodesUpTo(
  slug: string,
  season: number,
  lang: string,
  lastIndex: number,
  total: number
) {
  const next: number[] = [];

  for (let index = 0; index <= lastIndex; index++) {
    next.push(index);
  }

  /* On conserve les épisodes déjà vus au-delà */
  const existing = readWatched(slug, season, lang);

  for (const index of existing) {
    if (index > lastIndex && index < total) {
      next.push(index);
    }
  }

  const unique = Array.from(new Set(next)).sort(
    (a, b) => a - b
  );

  try {
    localStorage.setItem(
      getWatchKey(slug, season, lang),
      JSON.stringify(unique)
    );
  } catch {
    // localStorage indisponible
  }

  writeSeasonProgress(slug, lang, {
    season,
    watched: unique.length,
    total,
    lastEpisode: lastIndex,
    updatedAt: Date.now(),
  });

  return unique;
}

export function clearSeason(
  slug: string,
  season: number,
  lang: string
) {
  try {
    localStorage.removeItem(
      getWatchKey(slug, season, lang)
    );

    const progress = readProgress(
      slug,
      lang
    ).filter((item) => item.season !== season);

    localStorage.setItem(
      getProgressKey(slug, lang),
      JSON.stringify(progress)
    );
  } catch {
    // Rien
  }
}

export function isSeasonComplete(
  progress: SeasonProgress | null
) {
  return Boolean(
    progress &&
      progress.total > 0 &&
      progress.watched >= progress.total
  );
}

/*
 * Progression fusionnée des deux langues,
 * pour l'affichage sur la fiche.
 */
export function readMergedProgress(slug: string) {
  const merged = new Map<number, SeasonProgress>();

  for (const lang of ['vostfr', 'vf']) {
    for (const item of readProgress(slug, lang)) {
      const existing = merged.get(item.season);

      if (
        !existing ||
        item.watched > existing.watched
      ) {
        merged.set(item.season, item);
      }
    }
  }

  return merged;
}
