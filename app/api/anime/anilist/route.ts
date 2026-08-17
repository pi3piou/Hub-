import { NextResponse } from 'next/server';

/*
 * =========================================================
 * STATUT EXTERNE — ANILIST
 *
 * Anime-Sama n'expose jamais de champ "statut" fiable
 * sur ses fiches (vérifié sur plusieurs animes, y
 * compris des séries clairement terminées). AniList,
 * lui, a un champ status structuré : FINISHED,
 * RELEASING, NOT_YET_RELEASED, CANCELLED, HIATUS.
 *
 * Recherche par titre — jamais garantie à 100 %, donc
 * on renvoie null plutôt qu'une correspondance
 * hasardeuse si la confiance est trop faible.
 * =========================================================
 */

const ANILIST_URL = 'https://graphql.anilist.co';

const QUERY = `
  query ($search: String) {
    Media(search: $search, type: ANIME) {
      id
      title {
        romaji
        english
      }
      status
      episodes
    }
  }
`;

type AniListStatus =
  | 'FINISHED'
  | 'RELEASING'
  | 'NOT_YET_RELEASED'
  | 'CANCELLED'
  | 'HIATUS';

const STATUS_LABEL: Record<AniListStatus, string> = {
  FINISHED: 'Terminé',
  RELEASING: 'En diffusion',
  NOT_YET_RELEASED: 'À venir',
  CANCELLED: 'Annulé',
  HIATUS: 'En pause',
};

/*
 * Normalise pour comparer deux titres malgré la casse,
 * la ponctuation et les espaces multiples.
 */
function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/*
 * Similarité grossière mais suffisante : proportion
 * de mots du titre recherché retrouvés dans le titre
 * candidat, dans un sens ou dans l'autre.
 */
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const name = searchParams.get('name')?.trim();

  const altTitlesRaw =
    searchParams.get('alt') || '';

  const altTitles = altTitlesRaw
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);

  if (!name) {
    return NextResponse.json(
      { error: 'Nom manquant' },
      { status: 400 }
    );
  }

  try {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 6000);

    const response = await fetch(ANILIST_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        query: QUERY,
        variables: { search: name },
      }),

      /* Le statut d'une série change très peu */
      next: { revalidate: 86400 },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return NextResponse.json(
        { matched: false, reason: 'anilist_error' },
        {
          headers: {
            'Cache-Control':
              'public, s-maxage=3600',
          },
        }
      );
    }

    const json = await response.json();

    const media = json?.data?.Media;

    if (!media) {
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
     * Confiance dans la correspondance : on compare
     * le nom Anime-Sama (et ses titres alternatifs)
     * aux titres AniList disponibles.
     */
    const candidates = [
      media.title?.romaji,
      media.title?.english,
    ].filter(Boolean) as string[];

    const searchTitles = [name, ...altTitles];

    let bestScore = 0;

    for (const candidate of candidates) {
      for (const searchTitle of searchTitles) {
        const score = similarity(
          candidate,
          searchTitle
        );

        if (score > bestScore) {
          bestScore = score;
        }
      }
    }

    /*
     * En dessous de ce seuil, la correspondance est
     * trop incertaine : mieux vaut ne rien affirmer.
     */
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

    const status = media.status as
      | AniListStatus
      | null;

    return NextResponse.json(
      {
        matched: true,
        confidence: bestScore,
        status,
        statusLabel: status
          ? STATUS_LABEL[status]
          : null,
        episodes: media.episodes ?? null,
        anilistId: media.id,
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
    console.error('AniList lookup error:', error);

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