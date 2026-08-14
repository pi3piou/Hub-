import { NextResponse } from 'next/server';

const BASE_URL = 'https://anime-sama.to';

interface Player {
  name: string;
  urls: string[];
}

function cleanUrl(value: string) {
  return value
    .trim()
    .replace(/^['"`]/, '')
    .replace(/['"`;,]+$/, '');
}

function getPlayerName(urls: string[], index: number) {
  const joined = urls.join(' ').toLowerCase();

  if (joined.includes('sibnet')) return 'Sibnet';
  if (joined.includes('vidmoly')) return 'Vidmoly';
  if (joined.includes('sendvid')) return 'Sendvid';
  if (joined.includes('vk.com')) return 'VK';

  return `Lecteur ${index + 1}`;
}

function parsePlayers(text: string): Player[] {
  const players: Player[] = [];

  const regex =
    /(?:var|let|const)\s+(eps\d+)\s*=\s*\[([\s\S]*?)\]\s*;/gi;

  for (const match of text.matchAll(regex)) {
    const content = match[2];

    const matches = content.match(
      /https?:\/\/[^"'`\s,\]]+/gi
    );

    if (!matches) continue;

    const urls = Array.from(
      new Set(matches.map(cleanUrl).filter(Boolean))
    );

    if (!urls.length) continue;

    players.push({
      name: getPlayerName(urls, players.length),
      urls,
    });
  }

  return players;
}

async function fetchSource(
  slug: string,
  season: number,
  lang: string
) {
  const url = `${BASE_URL}/catalogue/${encodeURIComponent(
    slug
  )}/saison${season}/${lang}/episodes.js`;

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 8000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        Accept: '*/*',
        Referer: `${BASE_URL}/`,
      },
    });

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const slug = searchParams.get('slug')?.trim();
  const lang =
    searchParams.get('lang') === 'vf'
      ? 'vf'
      : 'vostfr';

  const requestedSeason = Math.max(
    1,
    Number(searchParams.get('saison')) || 1
  );

  if (!slug) {
    return NextResponse.json(
      { error: 'Slug manquant' },
      { status: 400 }
    );
  }

  try {
    const currentText = await fetchSource(
      slug,
      requestedSeason,
      lang
    );

    if (!currentText) {
      return NextResponse.json(
        {
          error: 'Saison indisponible',
          slug,
          saison: requestedSeason,
          lang,
        },
        { status: 404 }
      );
    }

    const players = parsePlayers(currentText);

    /*
     * On teste les saisons en parallèle plutôt que
     * d'effectuer 20 requêtes HEAD séquentielles.
     */
    const seasonNumbers = Array.from(
      { length: 20 },
      (_, index) => index + 1
    );

    const seasonResults = await Promise.all(
      seasonNumbers.map(async (season) => {
        const text = await fetchSource(
          slug,
          season,
          lang
        );

        return {
          season,
          available: Boolean(text),
        };
      })
    );

    const availableSeasons = seasonResults
      .filter((item) => item.available)
      .map((item) => item.season);

    const totalSeasons =
      availableSeasons.length > 0
        ? Math.max(...availableSeasons)
        : requestedSeason;

    const vfText =
      lang === 'vostfr'
        ? await fetchSource(slug, 1, 'vf')
        : null;

    const hasVF = Boolean(vfText);

    const defaultPlayerIndex = Math.max(
      0,
      players.findIndex((player) =>
        player.name.toLowerCase().includes('sibnet')
      )
    );

    return NextResponse.json(
      {
        slug,
        saison: requestedSeason,
        totalSeasons,
        hasVF,
        players,
        defaultPlayerIndex:
          players.length > 0
            ? defaultPlayerIndex
            : 0,
        totalEpisodes:
          players[defaultPlayerIndex]?.urls.length ||
          players[0]?.urls.length ||
          0,
      },
      {
        headers: {
          'Cache-Control':
            'public, s-maxage=300, stale-while-revalidate=600',
        },
      }
    );
  } catch (error) {
    console.error('Anime API error:', error);

    return NextResponse.json(
      { error: 'Erreur serveur' },
      { status: 500 }
    );
  }
}