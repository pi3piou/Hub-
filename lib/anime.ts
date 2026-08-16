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

/*
 * Les balises <script> et <style> contiennent des
 * sélecteurs comme « .genre-pill { padding: 4px } »
 * qui piègent les extractions par libellé.
 */
function stripScripts(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
}

/* Un genre plausible : lettres, espaces, tirets */
const GENRE_SHAPE =
  /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' -]{1,24}$/;


export interface Player {
  name: string;
  urls: string[];
}

export interface SeasonEntry {
  number: number;
  label: string;
  langs: string[];
}

export interface AnimeInfo {
  name: string;
  altTitles: string[];
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
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&#x27;/gi, "'")
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
  return fetchText(getCatalogueUrl(slug), 3600);
}

export function getCatalogueUrl(slug: string) {
  return (
    `${BASE_URL}/catalogue/` +
    `${encodeURIComponent(slug)}/`
  );
}

/* =========================================================
   TITRE
   ========================================================= */

export function extractTitle(html: string) {
  const patterns = [
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i,
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

/*
 * Titres alternatifs : Anime-Sama les place dans
 * un conteneur dédié, en général séparés par des
 * virgules. On retombe sur une recherche par
 * libellé si la structure change.
 */
export function extractAltTitles(
  html: string,
  mainTitle: string
) {
  const patterns = [
    /id=["']titreAlter["'][^>]*>([\s\S]*?)<\//i,
    /class=["'][^"']*titreAlter[^"']*["'][^>]*>([\s\S]*?)<\//i,
    /Titres?\s+alternatifs?\s*[:\-]?\s*<[^>]*>([\s\S]{1,300}?)<\//i,
    /Titres?\s+alternatifs?\s*[:\-]\s*([^<\n]{1,300})/i,
  ];

  for (const regex of patterns) {
    const match = html.match(regex);

    if (!match?.[1]) continue;

    const text = cleanText(match[1]);

    if (!text) continue;

    const titles = text
      .split(/[,;/]|\s+\|\s+/)
      .map((item) => item.trim())
      .filter(
        (item) =>
          item.length > 1 &&
          item.length < 120 &&
          item.toLowerCase() !==
            mainTitle.toLowerCase()
      );

    if (titles.length) {
      return Array.from(new Set(titles)).slice(
        0,
        6
      );
    }
  }

  return [];
}

/* =========================================================
   IMAGE
   ========================================================= */

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

/* =========================================================
   SYNOPSIS
   ========================================================= */

export function extractSynopsis(html: string) {
  const patterns = [
    /Synopsis\s*<\/h[1-6]>([\s\S]{20,4000}?)<\/(?:p|div|section)>/i,
    /class=["'][^"']*(?:synopsis|description|resume|résumé)[^"']*["'][^>]*>([\s\S]{20,4000}?)<\/(?:p|div|section)>/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
  ];

  for (const regex of patterns) {
    const match = html.match(regex);

    if (match?.[1]) {
      const value = cleanText(match[1]);

      if (
        value.length > 40 &&
        !value
          .toLowerCase()
          .startsWith('anime-sama')
      ) {
        return value;
      }
    }
  }

  return '';
}

/* =========================================================
   GENRES
   ========================================================= */

export function extractGenres(raw: string) {
  const html = stripScripts(raw);

  const genres = new Set<string>();

  /*
   * Les lookbehind/lookahead évitent de matcher
   * « genre-pill » ou « sous-genres ».
   */
  const patterns = [
    /(?<![\w-])Genres?(?![\w-])\s*<\/h[1-6]>([\s\S]{1,600}?)<\/(?:p|div|section|ul)>/i,
    /(?<![\w-])Genres?(?![\w-])\s*:\s*([^<\n]{1,300})/i,
  ];

  for (const regex of patterns) {
    const match = html.match(regex);

    if (!match?.[1]) continue;

    const text = cleanText(match[1]);

    for (const part of text.split(/[,;|]/)) {
      const genre = part.trim();

      if (GENRE_SHAPE.test(genre)) {
        genres.add(genre);
      }
    }

    if (genres.size) break;
  }

  return Array.from(genres).slice(0, 12);
}


/* =========================================================
   CHAMPS LIBRES
   ========================================================= */

export function extractField(
  raw: string,
  labels: string[]
) {
  const html = stripScripts(raw);

  for (const label of labels) {
    const escaped = label.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    );

    const patterns = [
      new RegExp(
        `(?<![\\w-])${escaped}(?![\\w-])\\s*<\\/h[1-6]>\\s*<[^>]*>([^<]{1,60})<`,
        'i'
      ),

      new RegExp(
        `(?<![\\w-])${escaped}(?![\\w-])\\s*:\\s*([^<\\n]{1,60})`,
        'i'
      ),
    ];

    for (const regex of patterns) {
      const match = html.match(regex);

      if (!match?.[1]) continue;

      const value = cleanText(match[1]);

      /* Un vrai champ ne contient pas de HTML ni de CSS */
      if (
        value &&
        value.length > 1 &&
        !/[{}<>="]/.test(value)
      ) {
        return value;
      }
    }
  }

  return '';
}


/*
 * L'année n'est pas toujours étiquetée : à défaut,
 * on cherche une année plausible dans la page.
 */
export function extractYear(html: string) {
  const labelled = extractField(html, [
    'Année',
    'Annee',
    'Year',
    'Date de sortie',
  ]);

  const match = labelled.match(/(19|20)\d{2}/);

  /*
   * Pas de balayage aveugle : mieux vaut aucune
   * année qu'une année tirée au hasard dans la page.
   */
  return match ? match[0] : '';
}


export function extractType(html: string) {
  const value = extractField(html, [
    'Type',
    'Format',
  ]);

  if (!value) return '';

  const upper = value.toUpperCase();

  for (const known of [
    'OVA',
    'ONA',
    'FILM',
    'MOVIE',
    'SPECIAL',
    'TV',
  ]) {
    if (upper.includes(known)) {
      return known === 'MOVIE' ? 'Film' : known;
    }
  }

  return value;
}


  return 'Série';
}

/* =========================================================
   FICHE COMPLÈTE
   ========================================================= */

export function extractAnimeInfo(
  html: string,
  slug: string,
  pageUrl: string
): AnimeInfo {
  const name =
    extractTitle(html) || slugToName(slug);

  return {
    name,

    altTitles: extractAltTitles(html, name),

    image:
      extractMainImage(html, pageUrl) ||
      `https://cdn.statically.io/gh/anime-sama/assets/main/catalogue/${slug}/cover.jpg`,

    synopsis: extractSynopsis(html),

    genres: extractGenres(html),

    status:
      extractField(html, [
        'Statut',
        'Status',
        'État',
      ]) || '',

    year: extractYear(html),


    slug,
  };
}

/* =========================================================
   SAISONS
   *
   * Anime-Sama déclare ses saisons via des appels
   * panneauAnime("Saison 1", "saison1/vostfr").
   * C'est bien plus fiable que de scanner le HTML,
   * qui contient aussi les recommandations.
   ========================================================= */

export function parseSeasons(
  html: string
): SeasonEntry[] {
  const found = new Map<number, SeasonEntry>();

  const regex =
    /panneauAnime\(\s*["'`]([^"'`]*)["'`]\s*,\s*["'`]([^"'`]*)["'`]\s*\)/gi;

  for (const match of html.matchAll(regex)) {
    const label = match[1].trim();
    const path = match[2].trim();

    /* Modèle laissé en commentaire par le site */
    if (
      !label ||
      !path ||
      label.toLowerCase() === 'nom' ||
      path.toLowerCase() === 'url'
    ) {
      continue;
    }

    const seasonMatch = path.match(
      /saison\s*(\d+)/i
    );

    if (!seasonMatch) continue;

    const number = Number(seasonMatch[1]);

    if (
      !Number.isInteger(number) ||
      number < 1 ||
      number > 100
    ) {
      continue;
    }

    const lang = /\bvf\b/i.test(path)
      ? 'vf'
      : 'vostfr';

    const existing = found.get(number);

    if (existing) {
      if (!existing.langs.includes(lang)) {
        existing.langs.push(lang);
      }
    } else {
      found.set(number, {
        number,
        label: label || `Saison ${number}`,
        langs: [lang],
      });
    }
  }

  if (found.size) {
    return Array.from(found.values()).sort(
      (a, b) => a.number - b.number
    );
  }

  /* Repli : ancienne méthode par balayage */
  const fallback = new Set<number>();

  for (const match of html.matchAll(
    /saison\s*(\d+)/gi
  )) {
    const number = Number(match[1]);

    if (
      Number.isInteger(number) &&
      number >= 1 &&
      number <= 100
    ) {
      fallback.add(number);
    }
  }

  return Array.from(fallback)
    .sort((a, b) => a - b)
    .map((number) => ({
      number,
      label: `Saison ${number}`,
      langs: [],
    }));
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
