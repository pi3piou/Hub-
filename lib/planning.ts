/*
 * =========================================================
 * PLANNING ANIME-SAMA
 *
 * Chaque carte du planning porte un attribut
 * data-release-ts : l'horodatage de sortie.
 * On regroupe donc par date sans avoir à lire
 * les en-têtes de jour du site.
 * =========================================================
 */

export const PLANNING_URL =
  'https://anime-sama.to/planning/';

export interface PlanningItem {
  slug: string;
  season: number;
  lang: 'vostfr' | 'vf';
  title: string;
  image: string;
  releaseTs: number;
}

function titleCase(value: string) {
  return value
    .split(' ')
    .filter(Boolean)
    .map(
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1)
    )
    .join(' ');
}

export function parsePlanning(
  html: string
): PlanningItem[] {
  const items: PlanningItem[] = [];

  const seen = new Set<string>();

  const cardRegex =
    /<div class="([^"]*planning-card[^"]*)"([^>]*)>/gi;

  for (const match of html.matchAll(cardRegex)) {
    const attrs = match[2];

    const start = match.index ?? 0;

    /* Fenêtre suffisante pour couvrir le lien et l'image */
    const chunk = html.slice(start, start + 2200);

    const href = chunk.match(
      /<a href="([^"]+)"/i
    )?.[1];

    if (!href) continue;

    const parts = href.match(
      /\/catalogue\/([^/]+)\/saison(\d+)\/(vostfr|vf)/i
    );

    if (!parts) continue;

    const releaseTs = Number(
      attrs.match(
        /data-release-ts="(\d+)"/i
      )?.[1] || 0
    );

    if (!releaseTs) continue;

    const slug = parts[1];
    const season = Number(parts[2]);
    const lang = parts[3].toLowerCase() as
      | 'vostfr'
      | 'vf';

    const key = `${slug}_${season}_${lang}_${releaseTs}`;

    if (seen.has(key)) continue;

    seen.add(key);

    /* L'attribut alt conserve la casse d'origine */
    const alt = chunk.match(
      /<img[\s\S]{0,400}?alt="([^"]+)"/i
    )?.[1];

    const dataTitle = attrs.match(
      /data-title="([^"]*)"/i
    )?.[1];

    const image =
      chunk.match(
        /class="card-image"[\s\S]{0,200}?src="([^"]+)"/i
      )?.[1] ||
      chunk.match(
        /src="(https:\/\/cdn[^"]+)"/i
      )?.[1] ||
      '';

    items.push({
      slug,
      season,
      lang,
      title:
        alt ||
        titleCase((dataTitle || slug).trim()),
      image,
      releaseTs,
    });
  }

  return items.sort(
    (a, b) => a.releaseTs - b.releaseTs
  );
}

/*
 * Anime-Sama présente ses horaires tels quels :
 * l'horodatage correspond à l'heure affichée sur
 * le site, on le formate donc en UTC pour rester
 * cohérent avec la source.
 */
export function formatPlanningTime(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString(
    'fr-FR',
    {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    }
  );
}

export function getPlanningDayKey(ts: number) {
  return new Date(ts * 1000)
    .toISOString()
    .slice(0, 10);
}

export function formatPlanningDay(key: string) {
  const today = new Date()
    .toISOString()
    .slice(0, 10);

  const tomorrow = new Date(
    Date.now() + 86400000
  )
    .toISOString()
    .slice(0, 10);

  if (key === today) return 'Aujourd’hui';
  if (key === tomorrow) return 'Demain';

  return new Date(
    `${key}T12:00:00Z`
  ).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

/* =========================================================
   CACHE CLIENT DU PLANNING
   ========================================================= */

const PLANNING_CACHE_KEY = 'anime_planning_cache';
const PLANNING_TTL = 24 * 60 * 60 * 1000;

interface PlanningCache {
  items: PlanningItem[];
  savedAt: number;
}

export function readPlanningCache():
  | PlanningItem[]
  | null {
  try {
    const raw = localStorage.getItem(
      PLANNING_CACHE_KEY
    );

    if (!raw) return null;

    const entry = JSON.parse(raw) as PlanningCache;

    if (
      !entry?.savedAt ||
      Date.now() - entry.savedAt > PLANNING_TTL ||
      !Array.isArray(entry.items)
    ) {
      return null;
    }

    return entry.items;
  } catch {
    return null;
  }
}

function writePlanningCache(
  items: PlanningItem[]
) {
  try {
    localStorage.setItem(
      PLANNING_CACHE_KEY,
      JSON.stringify({
        items,
        savedAt: Date.now(),
      } as PlanningCache)
    );
  } catch {
    // Quota dépassé
  }
}

/*
 * Un seul appel réseau par 24 h, quel que soit
 * le nombre de visites.
 */
export async function loadPlanning(): Promise<
  PlanningItem[]
> {
  const cached = readPlanningCache();

  if (cached) return cached;

  const response = await fetch(
    '/api/anime/planning'
  );

  const data = await response.json();

  if (!Array.isArray(data.items)) {
    throw new Error('Planning invalide');
  }

  writePlanningCache(data.items);

  return data.items as PlanningItem[];
}

/* Prochaine sortie connue pour une saison */
export function findNextRelease(
  items: PlanningItem[],
  slug: string,
  season?: number
) {
  const now = Date.now();

  return (
    items
      .filter(
        (item) =>
          item.slug === slug &&
          (season === undefined ||
            item.season === season) &&
          item.releaseTs * 1000 > now
      )
      .sort(
        (a, b) => a.releaseTs - b.releaseTs
      )[0] || null
  );
}

