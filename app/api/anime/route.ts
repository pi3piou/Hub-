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

/**
 * Récupère les saisons directement depuis la page catalogue.
 *
 * Exemple de contenu Anime-Sama :
 *
 * saison1
 * saison2
 * saison3
 * saison4
 *
 * On ne fait donc plus 20 requêtes pour essayer de deviner
 * combien de saisons existent.
 */
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

  return Array.from(seasons).sort((a, b) => a - b);
}

async function fetchEpisodes(
  slug: string,
  season: number,
  lang: string
) {
  const url = `${BASE_URL}/catalogue/${encodeURIComponent(
    slug
  )}/saison${season}/${lang}/episodes.js`;

  return fetchText(url);
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
     * -------------------------------------------------------
     * 1. PAGE CATALOGUE
     * -------------------------------------------------------
     */

    const catalogueUrl = `${BASE_URL}/catalogue/${encodeURIComponent(
      slug
    )}/`;

    const catalogueHtml =
      await fetchText(catalogueUrl);

    if (!catalogueHtml) {
      return NextResponse.json(
        {
          error: 'Impossible de récupérer la page de l’anime',
        },
        {
          status: 502,
        }
      );
    }

    /*
     * -------------------------------------------------------
     * 2. SAISONS
     * -------------------------------------------------------
     */

    let seasons = parseSeasons(catalogueHtml);

    /*
     * Si Anime-Sama ne met pas les saisons dans le HTML
     * récupéré, on garde au minimum la saison demandée.
     */
    if (!seasons.length) {
      seasons = [requestedSeason];
    }

    if (!seasons.includes(requestedSeason)) {
      seasons.push(requestedSeason);
      seasons.sort((a, b) => a - b);
    }

    /*
     * -------------------------------------------------------
     * 3. ÉPISODES DE LA SAISON DEMANDÉE
     * -------------------------------------------------------
     */

    const episodesText = await fetchEpisodes(
      slug,
      requestedSeason,
      lang
    );

    if (!episodesText) {
      return NextResponse.json(
        {
          error: 'Saison indisponible',
          slug,
          saison: requestedSeason,
          lang,
          seasons,
        },
        {
          status: 404,
        }
      );
    }

    const players = parsePlayers(episodesText);

    /*
     * -------------------------------------------------------
     * 4. VF DISPONIBLE ?
     * -------------------------------------------------------
     */

    let hasVF = false;

    if (lang === 'vostfr') {
      const vfText = await fetchEpisodes(
        slug,
        requestedSeason,
        'vf'
      );

      hasVF = Boolean(vfText);
    } else {
      hasVF = true;
    }

    /*
     * -------------------------------------------------------
     * 5. LECTEUR PAR DÉFAUT
     * -------------------------------------------------------
     */

    let defaultPlayerIndex = 0;

    const sibnetIndex = players.findIndex((player) =>
      player.name.toLowerCase().includes('sibnet')
    );

    if (sibnetIndex >= 0) {
      defaultPlayerIndex = sibnetIndex;
    }

    const totalEpisodes =
      players[defaultPlayerIndex]?.urls.length ||
      players[0]?.urls.length ||
      0;

    /*
     * -------------------------------------------------------
     * 6. RÉPONSE
     * -------------------------------------------------------
     */

    return NextResponse.json(
      {
        slug,
        saison: requestedSeason,

        /*
         * Exemple :
         * [1, 2, 3, 4]
         */
        seasons,

        totalSeasons: seasons.length,

        hasVF,

        players,

        defaultPlayerIndex,

        totalEpisodes,
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
        error: 'Erreur serveur',
      },
      {
        status: 500,
      }
    );
  }
}