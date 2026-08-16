/*
 * =========================================================
 * OUTILS DE RÉCUPÉRATION ANIME-SAMA
 *
 * Fichier partagé par les routes API :
 *   /api/anime/info      → fiche + saisons
 *   /api/anime/episodes  → lecteurs + épisodes
 * =========================================================
 */

export const BASE_URL = 'https://anime-sama.to';

export interface Player {
  name: string;
  urls: string[];
}

export interface AnimeInfo {
  name: string;
  slug: string;
  image: string;
  synopsis: string;
  genres: string[];
  status: string;
  year: string;
  type: string;
}

/* =========================================================
   NETTOYAGE
   ========================================================= */

export function cleanUrl(value: string) {
  return value
    .trim()
    .replace(/^['"`]/, '')
    .replace(/['"`;,]+$/, '');
}

export function cleanText(value: string) {
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

export function absoluteUrl(
  value: string,
  base: string
) {
  try {
    return new URL(value, base).toString();
  } catch {
    return '';
  }
}

export function slugToName(slug: string) {
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

export function cleanImageUrl(
  value: string,
  base: string
) {
  const url = value
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
   FETCH
   ========================================================= */

export async function fetchText(
  url: string,
  revalidate = 1800
) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 8000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,

      /*
       * Cache de données Next : la même page
       * n'est re-scrapée qu'une fois par
       * intervalle, quel que soit le nombre
       * de visiteurs.
       */
      next: { revalidate },

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

export async function fetchEpisodes(
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

export function fetchCatalogue(slug: string) {
  const url =
    `${BASE_URL}/catalogue/` +
    `${encodeURIComponent(slug)}/`;

  return fetchText(url, 3600);
}

export function getCatalogueUrl(slug: string) {
  return (
    `${BASE_URL}/catalogue/` +
    `${encodeURIComponent(slug)}/`
  );
}

/* =========================================================
   FICHE
   ========================================================= */

export function extractTitle(html: string) {
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
        !value
          .toLowerCase()
          .includes('anime-sama')
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

export function extractMainImage(
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

export function extractSynopsis(html: string) {
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

export function extractGenres(html: string) {
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

export function extractField(
  html: string,
  labels: string[]
) {
  for (const label of labels) {
    const escaped = label.replace(
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

export function extractAnimeInfo(
  html: string,
  slug: string,
  pageUrl: string
): AnimeInfo {
  return {
    name: extractTitle(html) || slugToName(slug),

    image:
      extractMainImage(html, pageUrl) ||
      `https://cdn.statically.io/gh/anime-sama/assets/main/catalogue/${slug}/cover.jpg`,

    synopsis: extractSynopsis(html),

    genres: extractGenres(html),

    status:
      extractField(html, ['Statut', 'Status']) ||
      '',

    year:
      extractField(html, [
        'Année',
        'Annee',
        'Year',
      ]) || '',

    type: extractField(html, ['Type']) || 'Série',

    slug,
  };
}

/* =========================================================
   SAISONS
   ========================================================= */

export function parseSeasons(html: string) {
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

/* =========================================================
   LECTEURS
   ========================================================= */

export function getPlayerName(
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

export function parsePlayers(
  text: string
): Player[] {
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

export function getDefaultPlayerIndex(
  players: Player[]
) {
  const sibnetIndex = players.findIndex((player) =>
    player.name.toLowerCase().includes('sibnet')
  );

  return sibnetIndex >= 0 ? sibnetIndex : 0;
}
