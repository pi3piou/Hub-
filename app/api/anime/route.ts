import { NextResponse } from 'next/server';

const BASE_URL = 'https://anime-sama.to';

interface Player {
  name: string;
  urls: string[];
}

interface AnimeInfo {
  name: string;
  slug: string;
  image: string;
  synopsis: string;
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

function cleanText(value: string) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(
  value: string,
  base: string
) {
  try {
    return new URL(value, base).toString();
  } catch {
    return '';
  }
}

function slugToName(slug: string) {
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

function cleanImageUrl(
  value: string,
  base: string
) {
  let url = value
    .trim()
    .replace(/^['"`]/, '')
    .replace(/['"`;,]+$/, '');

  if (
    !url ||
    url.startsWith('data:') ||
    url.startsWith('javascript:')
  ) {
    return '';
  }

  return absoluteUrl(url, base);
}

/* =========================================================
   INFOS FICHE ANIME
   ========================================================= */

function extractAnimeInfo(
  html: string,
  slug: string,
  pageUrl: string
): AnimeInfo {
  const name =
    extractTitle(html) ||
    slugToName(slug);

  const image =
    extractMainImage(html, pageUrl) ||
    `https://cdn.statically.io/gh/anime-sama/assets/main/catalogue/${slug}/cover.jpg`;

  const synopsis =
    extractSynopsis(html);

  const genres =
    extractGenres(html);

  const status =
    extractField(
      html,
      [
        'Statut',
        'Status',
      ]
    ) || '';

  const year =
    extractField(
      html,
      [
        'Année',
        'Annee',
        'Year',
      ]
    ) || '';

  const type =
    extractField(
      html,
      [
        'Type',
      ]
    ) || 'Série';

  return {
    name,
    slug,
    image,
    synopsis,
    genres,
    status,
    year,
    type,
  };
}

function extractTitle(html: string) {
  const patterns = [
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,

    /<title[^>]*>([\s\S]*?)<\/title>/i,

    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,

    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
  ];

  for (const regex of patterns) {
    const match = html.match(regex);

    if (match?.[1]) {
      const value = cleanText(match[1]);

      if (
        value &&
        !value.toLowerCase().includes('anime-sama')
      ) {
        return value
          .replace(
            /\s*[-|]\s*Anime[- ]Sama.*$/i,
            ''
          )
          .trim();
      }
    }
  }

  return '';
}

function extractMainImage(
  html: string,
  pageUrl: string
) {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,

    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,

    /<img[^>]+class=["'][^"']*(?:cover|poster|image)[^"']*["'][^>]+src=["']([^"']+)["']/i,

    /<img[^>]+src=["']([^"']+)["'][^>]+class=["'][^"']*(?:cover|poster|image)[^"']*["']/i,

    /<img[^>]+src=["']([^"']+)["']/i,
  ];

  for (const regex of patterns) {
    const match = html.match(regex);

    if (match?.[1]) {
      const image = cleanImageUrl(
        match[1],
        pageUrl
      );

      if (image) {
        return image;
      }
    }
  }

  return '';
}

function extractSynopsis(html: string) {
  const patterns = [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,

    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,

    /<[^>]+class=["'][^"']*(?:synopsis|description|resume|résumé)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
  ];

  for (const regex of patterns) {
    const match = html.match(regex);

    if (match?.[1]) {
      const value = cleanText(match[1]);

      if (value.length > 20) {
        return value;
      }
    }
  }

  return '';
}

function extractGenres(html: string) {
  const genres = new Set<string>();

  const classPatterns = [
    /class=["'][^"']*genre[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi,

    /class=["'][^"']*genres[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi,
  ];

  for (const regex of classPatterns) {
    for (const match of html.matchAll(regex)) {
      const text = cleanText(match[1]);

      if (!text) continue;

      const parts = text
        .split(/[,|/]/)
        .map((item) => item.trim())
        .filter(Boolean);

      for (const genre of parts) {
        if (genre.length < 40) {
          genres.add(genre);
        }
      }
    }
  }

  return Array.from(genres).slice(0, 12);
}

function extractField(
  html: string,
  labels: string[]
) {
  for (const label of labels) {
    const escaped =
      label.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      );

    const patterns = [
      new RegExp(
        `${escaped}\\s*[:\\-]?\\s*([^<\\n]{1,100})`,
        'i'
      ),

      new RegExp(
        `${escaped}[\\s\\S]{0,150}?<[^>]+>([^<]{1,100})<`,
        'i'
      ),
    ];

    for (const regex of patterns) {
      const match = html.match(regex);

      if (match?.[1]) {
        const value = cleanText(match[1]);

        if (value) {
          return value;
        }
      }
    }
  }

  return '';
}

/* =========================================================
   LECTEURS
   ========================================================= */

function getPlayerName(
  urls: string[],
  index: number
) {
  const joined =
    urls.join(' ').toLowerCase();

  if (joined.includes('sibnet')) {
    return 'Sibnet';
  }

  if (joined.includes('vidmoly')) {
    return 'Vidmoly';
  }

  if (joined.includes('sendvid')) {
    return 'Sendvid';
  }

  if (joined.includes('vk.com')) {
    return 'VK';
  }

  return `Lecteur ${index + 1}`;
}

function parsePlayers(
  text: string
): Player[] {
  const players: Player[] = [];

  const regex =
    /(?:var|let|const)\s+(eps\d+)\s*=\s*\[([\s\S]*?)\]\s*;/gi;

  for (const match of text.matchAll(regex)) {
    const content = match[2];

    const matches =
      content.match(
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

/* =========================================================
   FETCH
   ========================================================= */

async function fetchText(
  url: string
) {
  const controller =
    new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 8000);

  try {
    const response = await fetch(
      url,
      {
        signal: controller.signal,
        cache: 'no-store',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',

          Accept:
            'text/html,application/xhtml+xml,application/javascript,*/*',

          Referer:
            `${BASE_URL}/`,
        },
      }
    );

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

/* =========================================================
   SAISONS
   ========================================================= */

function parseSeasons(
  html: string
) {
  const seasons =
    new Set<number>();

  const patterns = [
    /saison\s*(\d+)/gi,
    /saison(\d+)/gi,
  ];

  for (const regex of patterns) {
    for (const match of html.matchAll(regex)) {
      const number =
        Number(match[1]);

      if (
        Number.isInteger(number) &&
        number >= 1 &&
        number <= 100
      ) {
        seasons.add(number);
      }
    }
  }

  return Array.from(
    seasons
  ).sort(
    (a, b) => a - b
  );
}

/* =========================================================
   ÉPISODES
   ========================================================= */

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

/* =========================================================
   API
   ========================================================= */

export async function GET(
  request: Request
) {
  const {
    searchParams,
  } = new URL(request.url);

  const slug =
    searchParams
      .get('slug')
      ?.trim();

  const lang =
    searchParams.get('lang') ===
    'vf'
      ? 'vf'
      : 'vostfr';

  const requestedSeason =
    Math.max(
      1,
      Number(
        searchParams.get(
          'saison'
        )
      ) || 1
    );

  if (!slug) {
    return NextResponse.json(
      {
        error:
          'Slug manquant',
      },
      {
        status: 400,
      }
    );
  }

  try {
    /* =====================================================
       1. PAGE FICHE
       ===================================================== */

    const catalogueUrl =
      `${BASE_URL}/catalogue/` +
      `${encodeURIComponent(slug)}/`;

    const catalogueHtml =
      await fetchText(
        catalogueUrl
      );

    if (!catalogueHtml) {
      return NextResponse.json(
        {
          error:
            'Impossible de récupérer la page de l’anime',
        },
        {
          status: 502,
        }
      );
    }

    /* =====================================================
       2. INFORMATIONS
       ===================================================== */

    const animeInfo =
      extractAnimeInfo(
        catalogueHtml,
        slug,
        catalogueUrl
      );

    /* =====================================================
       3. SAISONS
       ===================================================== */

    let seasons =
      parseSeasons(
        catalogueHtml
      );

    if (!seasons.length) {
      seasons = [
        requestedSeason,
      ];
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

    /* =====================================================
       4. ÉPISODES
       ===================================================== */

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

          ...animeInfo,
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

    /* =====================================================
       5. VF
       ===================================================== */

    let hasVF = false;

    if (lang === 'vostfr') {
      const vfText =
        await fetchEpisodes(
          slug,
          requestedSeason,
          'vf'
        );

      hasVF =
        Boolean(vfText);
    } else {
      hasVF = true;
    }

    /* =====================================================
       6. LECTEUR PAR DÉFAUT
       ===================================================== */

    let defaultPlayerIndex =
      0;

    const sibnetIndex =
      players.findIndex(
        (player) =>
          player.name
            .toLowerCase()
            .includes(
              'sibnet'
            )
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

    /* =====================================================
       7. RÉPONSE
       ===================================================== */

    return NextResponse.json(
      {
        ...animeInfo,

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