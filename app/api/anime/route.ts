import { NextResponse } from 'next/server';

const BASE_URL = 'https://anime-sama.to';

interface Player {
  name: string;
  urls: string[];
}

interface AnimeInfo {
  title: string;
  description: string;
  image: string;
  genres: string[];
  status: string;
  year: string;
  type: string;
}

function cleanUrl(value: string) {
  return value
    .trim()
    .replace(/^['"`]/, '')
    .replace(/['"`;,]+$/, '');
}

function getPlayerName(
  urls: string[],
  index: number
) {
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
      new Set(
        matches
          .map(cleanUrl)
          .filter(Boolean)
      )
    );

    if (!urls.length) continue;

    players.push({
      name: getPlayerName(
        urls,
        players.length
      ),
      urls,
    });
  }

  return players;
}

async function fetchText(url: string) {
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
        Accept:
          'text/html,application/xhtml+xml,application/javascript,*/*',
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

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function getMeta(
  html: string,
  property: string
) {
  const regex = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`,
    'i'
  );

  const reverseRegex = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`,
    'i'
  );

  return (
    html.match(regex)?.[1] ||
    html.match(reverseRegex)?.[1] ||
    ''
  );
}

function extractText(
  html: string,
  patterns: RegExp[]
) {
  for (const regex of patterns) {
    const match = html.match(regex);

    if (match?.[1]) {
      return decodeHtml(match[1]);
    }
  }

  return '';
}

function parseGenres(html: string) {
  const genres = new Set<string>();

  const patterns = [
    /(?:genre|genres)[^>]*>([\s\S]{0,500})</i,
    /(?:Genre|Genres)\s*:?\s*([^<\n]{2,200})/i,
  ];

  for (const regex of patterns) {
    const match = html.match(regex);

    if (!match?.[1]) continue;

    match[1]
      .replace(/<[^>]+>/g, ',')
      .split(/[,|•/]/)
      .map((item) =>
        decodeHtml(item)
          .replace(
            /^(genre|genres)\s*:?\s*/i,
            ''
          )
          .trim()
      )
      .filter(
        (item) =>
          item.length >= 2 &&
          item.length <= 40
      )
      .forEach((item) =>
        genres.add(item)
      );
  }

  return Array.from(genres).slice(0, 12);
}

function parseSeasons(html: string): number[] {
  const seasons = new Set<number>();

  const patterns = [
    /saison\s*(\d+)/gi,
    /saison(\d+)/gi,
  ];

  for (const regex of patterns) {
    for (const match of html.matchAll(regex)) {
      const number = Number(match[1]);

      if (
        Number.isInteger(number) &&
        number >= 1 &&
        number <= 100
      ) {
        seasons.add(number);
      }
    }
  }

  return Array.from(seasons).sort(
    (a, b) => a - b
  );
}

function parseAnimeInfo(
  html: string,
  slug: string
): AnimeInfo {
  const title =
    decodeHtml(
      getMeta(html, 'og:title')
    ) ||
    extractText(html, [
      /<h1[^>]*>([\s\S]*?)<\/h1>/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i,
    ]) ||
    slug
      .split('-')
      .filter(Boolean)
      .map(
        (word) =>
          word.charAt(0).toUpperCase() +
          word.slice(1)
      )
      .join(' ');

  const description =
    decodeHtml(
      getMeta(html, 'og:description')
    ) ||
    extractText(html, [
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
      /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i,
    ]);

  const image =
    getMeta(html, 'og:image') ||
    getMeta(html, 'twitter:image');

  const genres = parseGenres(html);

  const year = extractText(html, [
    /(?:année|annee|year)\s*:?\s*<[^>]*>\s*(\d{4})/i,
    /(?:année|annee|year)\s*:?\s*(\d{4})/i,
    /\b(19\d{2}|20\d{2})\b/,
  ]);

  const status = extractText(html, [
    /(?:statut|status)\s*:?\s*<[^>]*>\s*([^<]+)/i,
    /(?:statut|status)\s*:?\s*([^<\n]+)/i,
  ]);

  const type = extractText(html, [
    /(?:type)\s*:?\s*<[^>]*>\s*([^<]+)/i,
    /(?:type)\s*:?\s*([^<\n]+)/i,
  ]);

  return {
    title,
    description,
    image,
    genres,
    status,
    year,
    type,
  };
}

async function fetchEpisodes(
  slug: string,
  season: number,
  lang: string
) {
  const url =
    `${BASE_URL}/catalogue/` +
    `${encodeURIComponent(slug)}/` +
    `saison${season}/` +
    `${lang}/episodes.js`;

  return fetchText(url);
}

export async function GET(
  request: Request
) {
  const { searchParams } =
    new URL(request.url);

  const slug =
    searchParams.get('slug')?.trim();

  const lang =
    searchParams.get('lang') === 'vf'
      ? 'vf'
      : 'vostfr';

  const requestedSeason = Math.max(
    1,
    Number(
      searchParams.get('saison')
    ) || 1
  );

  if (!slug) {
    return NextResponse.json(
      {
        error: 'Slug manquant',
      },
      {
        status: 400,
      }
    );
  }

  try {
    /*
     * PAGE CATALOGUE
     */

    const catalogueUrl =
      `${BASE_URL}/catalogue/` +
      `${encodeURIComponent(slug)}/`;

    const catalogueHtml =
      await fetchText(catalogueUrl);

    if (!catalogueHtml) {
      return NextResponse.json(
        {
          error:
            "Impossible de récupérer la page de l’anime",
        },
        {
          status: 502,
        }
      );
    }

    /*
     * FICHE COMPLÈTE
     */

    const info = parseAnimeInfo(
      catalogueHtml,
      slug
    );

    /*
     * SAISONS
     */

    let seasons =
      parseSeasons(catalogueHtml);

    if (!seasons.length) {
      seasons = [requestedSeason];
    }

    if (
      !seasons.includes(
        requestedSeason
      )
    ) {
      seasons.push(
        requestedSeason
      );

      seasons.sort(
        (a, b) => a - b
      );
    }

    /*
     * ÉPISODES
     */

    const episodesText =
      await fetchEpisodes(
        slug,
        requestedSeason,
        lang
      );

    if (!episodesText) {
      return NextResponse.json(
        {
          error:
            'Saison indisponible',
          slug,
          saison:
            requestedSeason,
          lang,
          seasons,
          info,
        },
        {
          status: 404,
        }
      );
    }

    const players =
      parsePlayers(
        episodesText
      );

    /*
     * VF
     */

    let hasVF = false;

    if (lang === 'vostfr') {
      const vfText =
        await fetchEpisodes(
          slug,
          requestedSeason,
          'vf'
        );

      hasVF = Boolean(vfText);
    } else {
      hasVF = true;
    }

    /*
     * LECTEUR PAR DÉFAUT
     */

    let defaultPlayerIndex = 0;

    const sibnetIndex =
      players.findIndex(
        (player) =>
          player.name
            .toLowerCase()
            .includes('sibnet')
      );

    if (sibnetIndex >= 0) {
      defaultPlayerIndex =
        sibnetIndex;
    }

    const totalEpisodes =
      players[
        defaultPlayerIndex
      ]?.urls.length ||
      players[0]?.urls.length ||
      0;

    /*
     * RÉPONSE
     */

    return NextResponse.json(
      {
        slug,
        saison:
          requestedSeason,

        seasons,

        totalSeasons:
          seasons.length,

        hasVF,

        players,

        defaultPlayerIndex,

        totalEpisodes,

        info,
      },
      {
        headers: {
          'Cache-Control':
            'public, s-maxage=300, stale-while-revalidate=600',
        },
      }
    );
  } catch (error) {
    console.error(
      'Anime API error:',
      error
    );

    return NextResponse.json(
      {
        error:
          'Erreur serveur',
      },
      {
        status: 500,
      }
    );
  }
}