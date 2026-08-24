export function decodeEntities(str) {
  const entities = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&#8217;': '’', '&#8216;': '‘', '&#8220;': '“', '&#8221;': '”',
    '&#8211;': '–', '&#8212;': '—', '&#039;': "'", '&apos;': "'",
    '&nbsp;': ' ', '&hellip;': '…',
  };
  return str
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&\w+;/g, (m) => entities[m] || m);
}

export function cleanText(str) {
  return str.replace('<![CDATA[', '').replace(']]>', '').trim();
}

export function stripHtml(str) {
  return str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractTag(str, tag) {
  const match = str.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? match[1] : '';
}

/*
 * Images à écarter. L'ancienne liste ne connaissait que trois
 * motifs (favicon, apple-touch, site-icon), ce qui laissait
 * passer tout le bestiaire habituel des flux WordPress :
 * pixels de suivi, émojis servis par s.w.org, avatars
 * Gravatar, images de partage Feedburner. Le premier <img>
 * d'un article étant souvent l'un de ceux-là, c'est lui qui
 * finissait en miniature.
 */

const JUNK_PATTERNS = [
  'favicon',
  'apple-touch',
  'site-icon',
  'gravatar',
  's.w.org',
  '/emoji/',
  'feedburner',
  'feedburner.com',
  'pixel.',
  '/pixel',
  'spacer.',
  'blank.',
  'transparent.',
  'doubleclick',
  '/avatar',
  '/badge',
  'tracking',
];

function isIconLike(url) {
  if (!url) return true;

  const s = url.toLowerCase();

  if (JUNK_PATTERNS.some((j) => s.includes(j))) return true;

  /* Vignettes minuscules : WordPress suffixe la taille dans
     le nom (-150x150.jpg). En dessous de 200px de côté c'est
     une puce, pas une illustration. */

  const sized = s.match(/-(\d{1,4})x(\d{1,4})\.(jpg|jpeg|png|webp|gif)/);

  if (sized) {
    const w = parseInt(sized[1], 10);
    const h = parseInt(sized[2], 10);
    if (w < 200 || h < 200) return true;
  }

  /* Un GIF d'une poignée d'octets est presque toujours un
     mouchard, jamais une photo d'article. */

  if (/1x1|\bspacer\b/.test(s)) return true;

  return false;
}

/*
 * Les URL d'un flux sont encodées en XML : une adresse avec
 * des paramètres arrive sous la forme `?a=1&amp;b=2`. Passée
 * telle quelle dans un attribut src, elle pointe vers une
 * ressource inexistante et l'image reste cassée.
 */

function cleanUrl(url) {
  if (!url) return null;

  const cleaned = decodeEntities(String(url).trim());

  if (!/^https?:\/\//i.test(cleaned)) return null;

  return cleaned;
}

/*
 * Sonde de reconnaissance. Renvoie TOUTES les adresses
 * envisagees pour un article et celle qui l'emporte, sans
 * rien filtrer. Elle existe parce qu'une miniature fausse est
 * indiscernable d'une miniature absente vue de l'exterieur :
 * dans les deux cas on voit quelque chose s'afficher, et rien
 * ne dit lequel des dix motifs de rejet a laisse passer quoi.
 */

export function inspectThumbnail(chunk, rawDescHtml) {
  const candidates = collectCandidates(chunk, rawDescHtml);

  return {
    brutes: candidates,
    retenues: candidates
      .map(cleanUrl)
      .filter((c) => c && !isIconLike(c)),
    choisie: extractThumbnail(chunk, rawDescHtml),
  };
}

function collectCandidates(chunk, rawDescHtml) {
  const candidates = [];

  const enclosure = chunk.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']image[^"']*["']/i)
    || chunk.match(/<enclosure[^>]+type=["']image[^"']*["'][^>]*url=["']([^"']+)["']/i);
  if (enclosure) candidates.push(enclosure[1]);

  const mediaContent = chunk.match(/<media:content[^>]+url=["']([^"']+)["']/i);
  if (mediaContent) candidates.push(mediaContent[1]);

  const mediaThumb = chunk.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
  if (mediaThumb) candidates.push(mediaThumb[1]);

  /*
   * On regarde content:encoded ET la description. iPhoneAddict
   * par exemple ne publie aucune balise media et n'a pas de
   * content:encoded : sa seule image est dans la description.
   * L'ancienne version n'ouvrait la description qu'à défaut de
   * content:encoded, ce qui suffisait ici mais ratait les flux
   * qui rangent l'illustration dans l'une et le texte dans
   * l'autre.
   */

  const sources = [
    extractTag(chunk, 'content:encoded'),
    rawDescHtml || '',
  ];

  for (const source of sources) {
    if (!source) continue;

    const imgMatches = [
      ...source.matchAll(/<img[^>]+src=["']([^"']+)["']/gi),
    ];

    for (const m of imgMatches) candidates.push(m[1]);
  }

  return candidates;
}

function extractThumbnail(chunk, rawDescHtml) {
  const candidates = collectCandidates(chunk, rawDescHtml);

  const usable = candidates
    .map(cleanUrl)
    .filter((c) => c && !isIconLike(c));

  const uploadsMatch = usable.find((c) =>
    /\/wp-content\/uploads\//i.test(c)
  );
  if (uploadsMatch) return uploadsMatch;

  const safeMatch = usable.find(
    (c) => !/\/wp-content\/(themes|plugins)\//i.test(c)
  );
  if (safeMatch) return safeMatch;

  return null;
}

function parseRssItems(xml, sourceName, page) {
  const blocks = xml.split(/<item[\s>]/).slice(1);
  return blocks.map((block, i) => {
    const chunk = block.split('</item>')[0];
    const rawDesc = cleanText(extractTag(chunk, 'description'));
    const link = cleanText(extractTag(chunk, 'link'));
    const thumbnail = extractThumbnail(chunk, extractTag(chunk, 'description'));
    return {
      id: sourceName + '-' + page + '-' + i,
      title: decodeEntities(cleanText(extractTag(chunk, 'title'))),
      link,
      date: new Date(
        extractTag(chunk, 'pubDate') || extractTag(chunk, 'dc:date') || Date.now()
      ),
      source: sourceName,
      excerpt: decodeEntities(stripHtml(rawDesc)),
      thumbnail,
    };
  });
}


function parseAtomEntries(xml, sourceName, page) {
  const blocks = xml.split(/<entry[\s>]/).slice(1);
  return blocks.map((block, i) => {
    const chunk = block.split('</entry>')[0];

    let link = '';
    const altLink = chunk.match(/<link[^>]+rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)
      || chunk.match(/<link[^>]+href=["']([^"']+)["']/i);
    if (altLink) link = altLink[1];

    const rawContent = extractTag(chunk, 'content') || extractTag(chunk, 'summary');
    const dateStr = extractTag(chunk, 'published') || extractTag(chunk, 'updated');

    return {
      id: sourceName + '-' + page + '-' + i,
      title: decodeEntities(cleanText(extractTag(chunk, 'title'))),
      link: cleanText(link),
      date: new Date(dateStr || Date.now()),
      source: sourceName,
      excerpt: decodeEntities(stripHtml(cleanText(rawContent))),
      thumbnail: extractThumbnail(chunk, rawContent),
    };
  });
}

export function parseFeed(xml, sourceName, page) {
  const rss = parseRssItems(xml, sourceName, page);
  if (rss.length > 0) return rss;
  return parseAtomEntries(xml, sourceName, page);
}

export const FEEDS = [
  { name: 'iPhoneAddict', base: 'https://iphoneaddict.fr/feed' },
  { name: 'KultureGeek', base: 'https://kulturegeek.fr/feed' },
  { name: 'Numerama', base: 'https://www.numerama.com/feed' },
];

export async function fetchFeedPage(baseUrl, sourceName, page) {
  const url = page > 1 ? `${baseUrl}/?paged=${page}` : baseUrl;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseFeed(xml, sourceName, page);
  } catch (e) {
    return [];
  }
}
