import { NextResponse } from 'next/server';

/*
 * =========================================================
 * TMDB — STATUT ET ÉPISODES PAR SAISON
 *
 * Source prioritaire : donne à la fois un statut fiable
 * (Ended, Returning Series...) et le détail par saison.
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
      )}&language=fr-FR`
    );

    const candidate = search?.results?.[0];

    if (!candidate) {
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

    const searchTitles = [name, ...altTitles];

    const candidateTitles = [
      candidate.name,
      candidate.original_name,
    ].filter(Boolean) as string[];

    let bestScore = 0;

    for (const ct of candidateTitles) {
      for (const st of searchTitles) {
        const score = similarity(ct, st);

        if (score > bestScore) bestScore = score;
      }
    }

    const CONFIDENCE_THRESHOLD = 0.5;

    if (bestScore < CONFIDENCE_THRESHOLD) {
      return NextResponse.json(
        {
          matched: false,
          reason: 'low_confidence',
          bestScore,
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
      `/tv/${candidate.id}?language=fr-FR`
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
        confidence: bestScore,
        status: status || null,
        statusLabel: status
          ? STATUS_LABEL[status] || status
          : null,
        episodes: details.number_of_episodes ?? null,
        seasons,
        tmdbId: candidate.id,
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
