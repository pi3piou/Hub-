import { NextResponse } from 'next/server';

/*
 * =========================================================
 * TMDB — STATUT ET ÉPISODES PAR SAISON
 *
 * Comparer uniquement le titre affiché (souvent traduit,
 * ex: "Moi, quand je me réincarne en Slime" pour "Tensei
 * Shitara Slime Datta Ken") fait rater des correspondances
 * pourtant correctes. On récupère donc aussi les titres
 * alternatifs TMDB (romanisations, abréviations comme
 * "TenSura") pour les meilleurs candidats, et on compare
 * contre ce pool enrichi plutôt qu'un seul titre.
 *
 * Le détail par saison n'est renvoyé que si le nombre
 * de saisons TMDB correspond exactement au nombre de
 * saisons Anime-Sama — sinon la correspondance entre
 * "Saison 3 TMDB" et "Saga 3 Anime-Sama" n'a aucune
 * garantie et on préfère ne rien affirmer.
 *
 * Nécessite la variable d'environnement TMDB_API_KEY
 * (API Read Access Token, v4 auth) sur Vercel.
 * =========================================================
 */

const TMDB_BASE = 'https://api.themoviedb.org/3';

/* Nombre de résultats de recherche à approfondir */
const CANDIDATES_TO_CHECK = 3;

type TMDBStatus =
  | 'Ended'
  | 'Canceled'
  | 'Returning Series'
  | 'In Production'
  | 'Planned'
  | 'Pilot';

const STATUS_LABEL: Record<TMDBStatus, string> = {
  Ended: 'Terminé',
  Canceled: 'Annulé',
  'Returning Series': 'En diffusion',
  'In Production': 'En production',
  Planned: 'À venir',
  Pilot: 'Pilote',
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function similarity(a: string, b: string) {
  const wordsA = new Set(normalize(a).split(' '));
  const wordsB = new Set(normalize(b).split(' '));

  wordsA.delete('');
  wordsB.delete('');

  if (wordsA.size === 0 || wordsB.size === 0) {
    return 0;
  }

  let shared = 0;

  for (const word of wordsA) {
    if (wordsB.has(word)) shared++;
  }

  return shared / Math.max(wordsA.size, wordsB.size);
}

async function tmdbFetch(path: string) {
  const token = process.env.TMDB_API_KEY;

  if (!token) {
    throw new Error('TMDB_API_KEY manquante');
  }

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 6000);

  try {
    const response = await fetch(
      `${TMDB_BASE}${path}`,
      {
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        next: { revalidate: 86400 },
      }
    );

    if (!response.ok) return null;

    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/*
 * Titres alternatifs TMDB pour une série : romanisations,
 * abréviations, titres régionaux. C'est ce pool qui permet
 * de retrouver "TenSura" ou "Tensei Shitara Slime Datta
 * Ken" même quand le titre affiché est traduit en français.
 */
async function fetchAlternativeTitles(id: number) {
  const data = await tmdbFetch(
    `/tv/${id}/alternative_titles`
  );

  const results = data?.results as
    | { title?: string }[]
    | undefined;

  if (!Array.isArray(results)) return [];

  return results
    .map((item) => item.title)
    .filter((title): title is string =>
      Boolean(title)
    );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const name = searchParams.get('name')?.trim();

  const altTitlesRaw =
    searchParams.get('alt') || '';

  const altTitles = altTitlesRaw
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);

  /* Nombre de saisons Anime-Sama, pour valider le mapping */
  const expectedSeasons = Number(
    searchParams.get('seasons') || 0
  );

  if (!name) {
    return NextResponse.json(
      { error: 'Nom manquant' },
      { status: 400 }
    );
  }

  if (!process.env.TMDB_API_KEY) {
    return NextResponse.json(
      { matched: false, reason: 'no_api_key' },
      { status: 200 }
    );
  }

  try {
    const search = await tmdbFetch(
      `/search/tv?query=${encodeURIComponent(
        name
      )}`
    );

    const results = (search?.results || []).slice(
      0,
      CANDIDATES_TO_CHECK
    );

    if (!results.length) {
      return NextResponse.json(
        { matched: false, reason: 'not_found' },
        {
          headers: {
            'Cache-Control':
              'public, s-maxage=86400',
          },
        }
      );
    }

    /*
     * Tous les titres du côté Anime-Sama : nom
     * principal et titres alternatifs connus.
     */
    const searchTitles = [name, ...altTitles];

    let best: {
      id: number;
      score: number;
    } | null = null;

    for (const candidate of results) {
      /*
       * Pool de comparaison pour ce candidat :
       * nom localisé, nom original, et tous ses
       * titres alternatifs TMDB.
       */
      const altFromTMDB =
        await fetchAlternativeTitles(candidate.id);

      const candidateTitles = [
        candidate.name,
        candidate.original_name,
        ...altFromTMDB,
      ].filter(Boolean) as string[];

      let candidateScore = 0;

      for (const ct of candidateTitles) {
        for (const st of searchTitles) {
          const score = similarity(ct, st);

          if (score > candidateScore) {
            candidateScore = score;
          }
        }
      }

      if (!best || candidateScore > best.score) {
        best = { id: candidate.id, score: candidateScore };
      }
    }

    if (!best) {
      return NextResponse.json(
        { matched: false, reason: 'not_found' },
        {
          headers: {
            'Cache-Control':
              'public, s-maxage=86400',
          },
        }
      );
    }

    const CONFIDENCE_THRESHOLD = 0.5;

    if (best.score < CONFIDENCE_THRESHOLD) {
      return NextResponse.json(
        {
          matched: false,
          reason: 'low_confidence',
          bestScore: best.score,
        },
        {
          headers: {
            'Cache-Control':
              'public, s-maxage=86400',
          },
        }
      );
    }

    const details = await tmdbFetch(
      `/tv/${best.id}?language=fr-FR`
    );

    if (!details) {
      return NextResponse.json(
        { matched: false, reason: 'details_error' },
        { status: 200 }
      );
    }

    const status = details.status as
      | TMDBStatus
      | undefined;

    /*
     * On exclut la saison 0 (spéciaux), qu'Anime-Sama
     * ne compte quasiment jamais comme une saga.
     */
    const rawSeasons = (details.seasons || []).filter(
      (season: { season_number: number }) =>
        season.season_number > 0
    );

    const seasonsMatch =
      expectedSeasons > 0 &&
      rawSeasons.length === expectedSeasons;

    const seasons = seasonsMatch
      ? rawSeasons.map(
          (season: {
            season_number: number;
            episode_count: number;
            name: string;
          }) => ({
            seasonNumber: season.season_number,
            episodeCount: season.episode_count,
            name: season.name,
          })
        )
      : null;

    return NextResponse.json(
      {
        matched: true,
        confidence: best.score,
        status: status || null,
        statusLabel: status
          ? STATUS_LABEL[status] || status
          : null,
        episodes: details.number_of_episodes ?? null,
        seasons,
        tmdbId: best.id,
      },
      {
        headers: {
          'Content-Type':
            'application/json; charset=utf-8',
          'Cache-Control':
            'public, s-maxage=86400, stale-while-revalidate=604800',
        },
      }
    );
  } catch (error) {
    console.error('TMDB lookup error:', error);

    return NextResponse.json(
      { matched: false, reason: 'error' },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300',
        },
      }
    );
  }
}
