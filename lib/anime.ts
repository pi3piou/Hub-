/*
 * =========================================================
 * OUTILS DE RÉCUPÉRATION ANIME-SAMA
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

/*
 * Une « partie » d'un anime sur Anime-Sama n'est pas toujours
 * une saison : il y a aussi les films et les hors-séries. Les
 * trois se lisent exactement pareil (un episodes.js, une liste
 * de lecteurs), seule l'adresse change — d'où ce champ `path`,
 * qui porte le segment réel du site au lieu de le reconstruire
 * à partir d'un numéro.
 */

export type SeasonKind = 'season' | 'film' | 'special';

export interface SeasonEntry {
  number: number;
  label: string;
  langs: string[];
  path: string;
  kind: SeasonKind;
}

/*
 * Les films et les hors-séries n'ont pas de numéro de saison,
 * mais TOUT le reste de l'application les identifie par un
 * nombre : la progression enregistrée, la reprise de lecture,
 * les clés de stockage. Plutôt que de tout convertir en
 * chaînes — un chantier qui toucherait le stockage déjà écrit
 * chez l'utilisateur — on leur attribue des numéros hors
 * d'atteinte des vraies saisons, qui sont bornées à 100.
 */

export const FILM_ID_BASE = 900;
export const SPECIAL_ID_BASE = 1000;

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

/*
 * Accepte soit un numéro de saison (comportement historique,
 * « saison3 »), soit directement le segment du site pour les
 * parties qui n'en sont pas une (« film », « oav »…).
 */

export function partSegment(part: string | number) {
  return typeof part === 'number'
    ? `saison${part}`
    : part;
}

export async function fetchEpisodes(
  slug: string,
  part: string | number,
  lang: string
) {
  const url =
    `${BASE_URL}/catalogue/` +
    `${encodeURIComponent(slug)}/` +
    `${encodeURIComponent(partSegment(part))}/` +
    `${lang}/episodes.js`;

  return fetchText(url);
}

export function fetchCatalogue(slug: string) {
  return fetchText(getCatalogueUrl(slug), 3600);
}

/*
 * La PAGE d'une partie, pas son episodes.js.
 *
 * episodes.js ne contient que des adresses de lecteurs, sous
 * forme de tableaux anonymes. Tout ce qui NOMME les entrees —
 * les titres des films, les libelles des hors-series — vit dans
 * la page HTML qui charge ce fichier.
 */

export function getPartPageUrl(
  slug: string,
  part: string | number,
  lang: string
) {
  return (
    `${BASE_URL}/catalogue/` +
    `${encodeURIComponent(slug)}/` +
    `${encodeURIComponent(partSegment(part))}/` +
    `${lang}/`
  );
}

export function fetchPartPage(
  slug: string,
  part: string | number,
  lang: string
) {
  return fetchText(getPartPageUrl(slug, part, lang), 1800);
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
    /id=["']imgOeuvre["'][^>]+src=["']([^"']+)["']/i,
    /<img[^>]+class=["'][^"']*(?:cover|poster|image)[^"']*["'][^>]+src=["']([^"']+)["']/i,
    /<img[^>]+src=["']([^"']+)["'][^>]+class=["'][^"']*(?:cover|poster|image)[^"']*["']/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
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
    /class=["'][^"']*synopsis-text[^"']*["'][^>]*>([\s\S]{20,4000}?)<\/(?:p|div|section)>/i,
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
   MÉTADONNÉES
   ========================================================= */

/*
 * Anime-Sama présente ses métadonnées en paires
 * .info-lbl (libellé) / .info-val (valeur).
 */
export function extractInfoPairs(raw: string) {
  const html = stripScripts(raw);

  const pairs = new Map<string, string>();

  const regex =
    /class=["'][^"']*info-(lbl|val)[^"']*["'][^>]*>([\s\S]{0,300}?)<\/(?:div|span|p|li|dt|dd)>/gi;

  let label = '';

  for (const match of html.matchAll(regex)) {
    const kind = match[1].toLowerCase();
    const text = cleanText(match[2]);

    if (kind === 'lbl') {
      label = text;
    } else if (label && text) {
      if (!pairs.has(label.toLowerCase())) {
        pairs.set(label.toLowerCase(), text);
      }

      label = '';
    }
  }

  return pairs;
}

export function extractGenres(raw: string) {
  const html = stripScripts(raw);

  const genres = new Set<string>();

  const add = (value: string) => {
    const genre = cleanText(value).trim();

    if (GENRE_SHAPE.test(genre)) {
      genres.add(genre);
    }
  };

  /* 1. Chaque badge .genre-pill */
  for (const match of html.matchAll(
    /class=["'][^"']*genre-pill[^"']*["'][^>]*>([^<]{1,40})</gi
  )) {
    add(match[1]);
  }

  if (genres.size) {
    return Array.from(genres).slice(0, 12);
  }

  /* 2. Contenu du conteneur .genres-wrap */
  const wrap = html.match(
    /class=["'][^"']*genres?-wrap[^"']*["'][^>]*>([\s\S]{1,1500}?)<\/(?:div|section|ul|p)>/i
  );

  if (wrap?.[1]) {
    for (const match of wrap[1].matchAll(
      />([^<>]{2,40})</g
    )) {
      add(match[1]);
    }

    if (!genres.size) {
      for (const part of cleanText(
        wrap[1]
      ).split(/[,;|]/)) {
        add(part);
      }
    }

    if (genres.size) {
      return Array.from(genres).slice(0, 12);
    }
  }

  /* 3. Paire libellé / valeur */
  const fromPairs = extractInfoPairs(html).get(
    'genres'
  );

  if (fromPairs) {
    for (const part of fromPairs.split(/[,;|]/)) {
      add(part);
    }
  }

  /* 4. Titre de section */
  if (!genres.size) {
    const heading = html.match(
      /(?<![\w-])Genres?(?![\w-])\s*<\/h[1-6]>([\s\S]{1,600}?)<\/(?:p|div|section|ul)>/i
    );

    if (heading?.[1]) {
      for (const match of heading[1].matchAll(
        />([^<>]{2,40})</g
      )) {
        add(match[1]);
      }

      if (!genres.size) {
        for (const part of cleanText(
          heading[1]
        ).split(/[,;|]/)) {
          add(part);
        }
      }
    }
  }

  return Array.from(genres).slice(0, 12);
}

export function extractField(
  raw: string,
  labels: string[]
) {
  const html = stripScripts(raw);

  /* 1. Paires .info-lbl / .info-val */
  const pairs = extractInfoPairs(html);

  for (const label of labels) {
    const direct = pairs.get(label.toLowerCase());

    if (direct && !/[{}<>="]/.test(direct)) {
      return direct;
    }
  }

  /* 2. Motifs génériques */
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

export function extractYear(html: string) {
  const labelled = extractField(html, [
    'Année',
    'Annee',
    'Year',
    'Date de sortie',
    'Sortie',
  ]);

  const match = labelled.match(/(19|20)\d{2}/);

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

    type: extractType(html),

    slug,
  };
}

/* =========================================================
   SAISONS
   ========================================================= */

/*
 * Un chemin de type ".../catalogue/AUTRE-SLUG/saison2/vf"
 * appartient à un autre anime (widget « oeuvres similaires »
 * réutilisant parfois le même appel panneauAnime). On ne le
 * rejette que si un slug DIFFÉRENT est explicitement présent
 * dans le chemin : un chemin relatif classique du type
 * "saison1/vostfr" (sans référence de catalogue) reste
 * accepté comme avant, pour ne jamais casser les pages qui
 * fonctionnaient déjà.
 */
function belongsToOtherAnime(
  path: string,
  normalizedSlug: string
): boolean {
  if (!normalizedSlug) return false;

  const catalogueMatch = path.match(
    /catalogue\/([^/]+)\//i
  );

  if (!catalogueMatch) return false;

  const referencedSlug = catalogueMatch[1]
    .trim()
    .toLowerCase();

  return referencedSlug !== normalizedSlug;
}

/*
 * Segments de langue. On les reconnaît pour pouvoir isoler le
 * segment de CONTENU, qui est toujours celui juste avant.
 */

function isLangSegment(segment: string) {
  return /^(vostfr|vf|va|vj|vkr|vcn|vqc)\d*$/i.test(
    segment
  );
}

/*
 * Les scans du manga apparaissent parfois dans la même liste
 * de panneaux. Ils n'ont pas de episodes.js et ne se lisent
 * pas dans un lecteur vidéo : les inclure ajouterait une
 * ligne qui échouerait systématiquement.
 */

const NOT_VIDEO_SEGMENT =
  /^(scan|scans|manga|lecture|nouveaux)\d*$/i;

const SEASON_SEGMENT = /^saison[\s_-]*(\d+)$/i;

const FILM_SEGMENT =
  /^(film|films|movie|movies)[\s_-]*\d*$/i;

/*
 * Découpe un chemin de panneau en (segment de contenu, langue).
 *
 * Les chemins prennent plusieurs formes selon les fiches :
 * "saison1/vostfr", "film/vf", ou la version longue
 * "catalogue/mon-anime/oav/vostfr". Chercher le segment de
 * langue et prendre celui d'avant les couvre toutes, là où
 * une position fixe n'en couvrirait qu'une.
 */

function readPathParts(
  path: string,
  normalizedSlug: string
) {
  const segments = path
    .split(/[/\\]/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (!segments.length) return null;

  const langIndex = segments.findIndex(isLangSegment);

  /* Un chemin qui COMMENCE par la langue n'a pas de segment
     de contenu à offrir. */
  if (langIndex === 0) return null;

  const contentIndex =
    langIndex > 0 ? langIndex - 1 : segments.length - 1;

  const segment = (
    segments[contentIndex] || ''
  ).toLowerCase();

  if (!segment) return null;

  /* Reste du chemin long quand la langue manque : ni le mot
     "catalogue" ni le slug ne sont des parties. */
  if (
    segment === 'catalogue' ||
    (normalizedSlug && segment === normalizedSlug)
  ) {
    return null;
  }

  const langSegment =
    langIndex >= 0 ? segments[langIndex] : '';

  return {
    segment,
    lang: /^vf/i.test(langSegment) ? 'vf' : 'vostfr',
  };
}

function defaultLabel(
  kind: SeasonKind,
  number: number
) {
  if (kind === 'season') return `Saison ${number}`;
  if (kind === 'film') return 'Film';

  return 'Épisodes spéciaux';
}

interface RawPart {
  segment: string;
  label: string;
  langs: string[];
  kind: SeasonKind;
  number: number;
  order: number;
}

export function parseSeasons(
  html: string,
  slug?: string
): SeasonEntry[] {
  /*
   * La clé est le SEGMENT, pas le numéro : c'est lui qui
   * identifie vraiment une partie. Un même film listé en VF
   * puis en VOSTFR doit fusionner en une seule ligne à deux
   * langues, et un numéro ne le permettrait pas puisque les
   * films n'en ont pas.
   */

  const found = new Map<string, RawPart>();

  const normalizedSlug = slug
    ? slug.trim().toLowerCase()
    : '';

  const regex =
    /panneauAnime\(\s*["'`]([^"'`]*)["'`]\s*,\s*["'`]([^"'`]*)["'`]\s*\)/gi;

  let order = 0;

  for (const match of html.matchAll(regex)) {
    const label = match[1].trim();
    const path = match[2].trim();

    if (
      !label ||
      !path ||
      label.toLowerCase() === 'nom' ||
      path.toLowerCase() === 'url'
    ) {
      continue;
    }

    if (belongsToOtherAnime(path, normalizedSlug)) {
      continue;
    }

    const parts = readPathParts(path, normalizedSlug);

    if (!parts) continue;

    if (NOT_VIDEO_SEGMENT.test(parts.segment)) {
      continue;
    }

    const existing = found.get(parts.segment);

    if (existing) {
      if (!existing.langs.includes(parts.lang)) {
        existing.langs.push(parts.lang);
      }

      continue;
    }

    const seasonMatch =
      parts.segment.match(SEASON_SEGMENT);

    let kind: SeasonKind = 'special';
    let number = 0;

    if (seasonMatch) {
      const value = Number(seasonMatch[1]);

      if (
        !Number.isInteger(value) ||
        value < 1 ||
        value > 100
      ) {
        continue;
      }

      kind = 'season';
      number = value;
    } else if (FILM_SEGMENT.test(parts.segment)) {
      kind = 'film';
    }

    found.set(parts.segment, {
      segment: parts.segment,
      label: label || defaultLabel(kind, number),
      langs: [parts.lang],
      kind,
      number,
      order: order += 1,
    });
  }

  if (found.size) {
    const raw = Array.from(found.values());

    const build = (item: RawPart, number: number) => ({
      number,
      label: item.label,
      langs: item.langs,
      path: item.segment,
      kind: item.kind,
    });

    /*
     * Les saisons se rangent par numéro, les films et les
     * hors-séries dans l'ordre où la fiche les présente :
     * c'est celui que l'auteur de la page a choisi, et il
     * vaut mieux que n'importe quel tri alphabétique.
     */

    const seasons = raw
      .filter((item) => item.kind === 'season')
      .sort((a, b) => a.number - b.number)
      .map((item) => build(item, item.number));

    const films = raw
      .filter((item) => item.kind === 'film')
      .sort((a, b) => a.order - b.order)
      .map((item, index) =>
        build(item, FILM_ID_BASE + index)
      );

    const specials = raw
      .filter((item) => item.kind === 'special')
      .sort((a, b) => a.order - b.order)
      .map((item, index) =>
        build(item, SPECIAL_ID_BASE + index)
      );

    return [...seasons, ...films, ...specials];
  }

  /*
   * Aucun panneau exploitable : on retombe sur la recherche
   * brute de « saisonN » dans la page. Ce repli ne cherche
   * pas les films — sans panneau, rien ne dit sous quel
   * segment ils vivraient.
   */

  const fallback = new Set<number>();

  for (const match of html.matchAll(
    /(?:^|[/_-])saison[\s_-]*(\d+)(?:$|[/_-])/gi
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
      path: `saison${number}`,
      kind: 'season' as SeasonKind,
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
