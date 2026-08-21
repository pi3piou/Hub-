'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import {
  getCachedInfo,
  loadAnimeInfo,
  loadEpisodes,
} from '@/lib/animeCache';

import {
  PlanningItem,
  formatPlanningDay,
  formatPlanningTime,
  loadPlanning,
} from '@/lib/planning';

import {
  getSeasonProgress,
  isSeasonComplete,
  readMergedProgress,
  readWatched,
  writeSeasonProgress,
} from '@/lib/watchState';

interface AnimeItem {
  name: string;
  slug: string;
  image?: string;
}

interface ContinueItem {
  slug: string;
  name: string;
  image?: string;
  season: number;
  episode: number;
  lang: 'vostfr' | 'vf';
  updatedAt: number;
}

/* Élément prêt à afficher, avec sa progression */
interface ResumeItem extends ContinueItem {
  targetSeason: number;
  targetEpisode: number;
  isNextSeason: boolean;
  watchedCount: number;
  totalCount: number;
}

interface HomeStats {
  totalWatched: number;
  seriesTracked: number;
  favoritesCount: number;
}

function readHistory(): ContinueItem[] {
  try {
    const raw = localStorage.getItem(
      'anime_history'
    );

    if (!raw) return [];

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (item) =>
          item &&
          item.slug &&
          Number.isInteger(item.season) &&
          Number.isInteger(item.episode)
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

/* Slugs seulement : suffisant pour les stats et l'exclusion */
function readFavoriteSlugs(): string[] {
  try {
    const raw = localStorage.getItem(
      'anime_favorites'
    );

    if (!raw) return [];

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) =>
        typeof item === 'string'
          ? item
          : item?.slug
      )
      .filter(Boolean) as string[];
  } catch {
    return [];
  }
}

/*
 * Stats calculées uniquement à partir du localStorage :
 * aucune requête réseau, donc disponibles instantanément
 * au chargement de la page.
 */
function computeStats(
  slugs: string[],
  favoritesCount: number
): HomeStats {
  let totalWatched = 0;
  let seriesTracked = 0;

  for (const slug of slugs) {
    const merged = readMergedProgress(slug);

    if (merged.size > 0) seriesTracked++;

    merged.forEach((item) => {
      totalWatched += item.watched;
    });
  }

  return { totalWatched, seriesTracked, favoritesCount };
}

/*
 * Un anime par carte : la sortie la plus proche parmi
 * celles à venir, en excluant ce que tu suis déjà.
 */
function buildDiscovery(
  planning: PlanningItem[],
  excludeSlugs: Set<string>
) {
  const now = Date.now();

  const bySlug = new Map<string, PlanningItem>();

  for (const item of planning) {
    if (excludeSlugs.has(item.slug)) continue;

    if (item.releaseTs * 1000 <= now) continue;

    const existing = bySlug.get(item.slug);

    if (
      !existing ||
      item.releaseTs < existing.releaseTs
    ) {
      bySlug.set(item.slug, item);
    }
  }

  return Array.from(bySlug.values())
    .sort((a, b) => a.releaseTs - b.releaseTs)
    .slice(0, 8);
}

/*
 * =========================================================
 * DÉCISION D'AFFICHAGE (Continuer la lecture)
 *
 * Un anime quitte la file d'attente quand sa saison
 * est terminée, sauf si une saison suivante existe
 * ou si un nouvel épisode vient de sortir.
 * =========================================================
 */
async function resolveResume(
  item: ContinueItem,
  planning: PlanningItem[]
): Promise<ResumeItem | null> {
  const progress = getSeasonProgress(
    item.slug,
    item.season,
    item.lang
  );

  if (!isSeasonComplete(progress)) {
    return {
      ...item,
      targetSeason: item.season,
      targetEpisode: item.episode,
      isNextSeason: false,
      watchedCount: progress?.watched ?? 0,
      totalCount: progress?.total ?? 0,
    };
  }

  const release = planning.find(
    (entry) =>
      entry.slug === item.slug &&
      entry.season === item.season &&
      entry.releaseTs * 1000 <= Date.now()
  );

  if (release && progress) {
    try {
      const fresh = await loadEpisodes(
        item.slug,
        item.season,
        item.lang
      );

      const total =
        fresh.players[fresh.defaultPlayerIndex]
          ?.urls.length || fresh.totalEpisodes;

      if (total > progress.total) {
        const watched = readWatched(
          item.slug,
          item.season,
          item.lang
        );

        writeSeasonProgress(
          item.slug,
          item.lang,
          {
            ...progress,
            total,
            updatedAt: Date.now(),
          }
        );

        return {
          ...item,
          targetSeason: item.season,
          targetEpisode: Math.min(
            watched.length,
            total - 1
          ),
          isNextSeason: false,
          watchedCount: watched.length,
          totalCount: total,
        };
      }
    } catch {
      // Comportement par défaut
    }
  }

  let info = getCachedInfo(item.slug);

  if (!info) {
    try {
      info = await loadAnimeInfo(item.slug);
    } catch {
      info = null;
    }
  }

  const nextSeason = info?.seasons
    ?.filter((number) => number > item.season)
    .sort((a, b) => a - b)[0];

  if (nextSeason) {
    const nextProgress = getSeasonProgress(
      item.slug,
      nextSeason,
      item.lang
    );

    if (isSeasonComplete(nextProgress)) {
      return null;
    }

    return {
      ...item,
      targetSeason: nextSeason,
      targetEpisode:
        nextProgress?.lastEpisode ?? 0,
      isNextSeason: !nextProgress,
      watchedCount: nextProgress?.watched ?? 0,
      totalCount: nextProgress?.total ?? 0,
    };
  }

  return null;
}

export default function Home() {
  const [query, setQuery] = useState('');

  const [results, setResults] = useState<
    AnimeItem[]
  >([]);

  const [resume, setResume] = useState<
    ResumeItem[]
  >([]);

  const [discovery, setDiscovery] = useState<
    PlanningItem[]
  >([]);

  const [stats, setStats] =
    useState<HomeStats | null>(null);

  const [searching, setSearching] =
    useState(false);

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const entries = readHistory();

    const favoriteSlugs = readFavoriteSlugs();

    setMounted(true);

    /* Stats : synchrone, aucun réseau */
    const allSlugs = Array.from(
      new Set([
        ...favoriteSlugs,
        ...entries.map((item) => item.slug),
      ])
    );

    setStats(
      computeStats(allSlugs, favoriteSlugs.length)
    );

    let active = true;

    (async () => {
      let planning: PlanningItem[] = [];

      try {
        planning = await loadPlanning();
      } catch {
        planning = [];
      }

      const resolved = await Promise.all(
        entries
          .slice(0, 8)
          .map((item) =>
            resolveResume(item, planning).catch(
              () => null
            )
          )
      );

      if (!active) return;

      setResume(
        resolved.filter(
          (item): item is ResumeItem =>
            item !== null
        )
      );

      setDiscovery(
        buildDiscovery(
          planning,
          new Set(allSlugs)
        )
      );
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const value = query.trim();

    if (value.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    const controller = new AbortController();

    const timer = window.setTimeout(async () => {
      setSearching(true);

      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(
            value
          )}`,
          {
            signal: controller.signal,
            cache: 'no-store',
          }
        );

        if (!response.ok) {
          setResults([]);
          return;
        }

        const data = await response.json();

        setResults(
          Array.isArray(data.results)
            ? data.results
            : []
        );
      } catch (error) {
        if (
          (error as Error).name !== 'AbortError'
        ) {
          console.error(error);
        }
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const heroItem = resume[0] || null;

  const restOfResume = resume.slice(1, 5);

  const showStats = Boolean(
    stats &&
      (stats.favoritesCount > 0 ||
        stats.seriesTracked > 0)
  );

  const nothingAtAll =
    mounted &&
    resume.length === 0 &&
    discovery.length === 0;

  return (
    <main className="page">

      <header className="hero-mini">
        <span className="eyebrow">
          ANIME STREAM
        </span>
      </header>

      {/* RECHERCHE */}

      <section className="search-section">

        <div className="search-box">

          <span className="search-icon">⌕</span>

          <input
            value={query}
            onChange={(event) =>
              setQuery(event.target.value)
            }
            placeholder="Rechercher un anime..."
            autoComplete="off"
            spellCheck={false}
          />

          {query && (
            <button
              className="clear-button"
              onClick={() => setQuery('')}
              aria-label="Effacer"
            >
              ×
            </button>
          )}

        </div>

        {query.trim().length >= 2 && (
          <div className="search-results">

            {searching ? (
              <div className="search-state">
                <span className="loader" />
                Recherche…
              </div>
            ) : results.length === 0 ? (
              <div className="search-state">
                Aucun résultat
              </div>
            ) : (
              results.map((item) => (
                <Link
                  key={item.slug}
                  href={`/anime/${encodeURIComponent(
                    item.slug
                  )}`}
                  className="search-result"
                  onClick={() => setQuery('')}
                >

                  <div className="search-cover">
                    {item.image && (
                      <img
                        src={item.image}
                        alt={item.name}
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.style.display =
                            'none';
                        }}
                      />
                    )}
                  </div>

                  <div className="search-result-info">
                    <strong>{item.name}</strong>
                    <span>{item.slug}</span>
                  </div>

                  <span className="arrow">›</span>

                </Link>
              ))
            )}

          </div>
        )}

      </section>

      {/* HERO */}

      {mounted && heroItem ? (
        <section className="home-hero">

          <div
            className="home-hero-visual"
            style={
              heroItem.image
                ? {
                    backgroundImage: `url(${heroItem.image})`,
                  }
                : undefined
            }
          >

            <div className="home-hero-overlay" />

            <div className="home-hero-content">

              <span className="section-eyebrow">
                REPRENDRE
              </span>

              <h2>{heroItem.name}</h2>

              <p>
                Saison {heroItem.targetSeason}
                {' · '}
                Épisode{' '}
                {heroItem.targetEpisode + 1}
                {heroItem.totalCount > 0 && (
                  <>
                    {' sur '}
                    {heroItem.totalCount}
                  </>
                )}
              </p>

              <Link
                href={`/anime/${encodeURIComponent(
                  heroItem.slug
                )}?season=${
                  heroItem.targetSeason
                }&episode=${heroItem.targetEpisode}`}
                className="primary-button hero-cta"
              >
                {heroItem.isNextSeason
                  ? '▶ Nouvelle saison'
                  : '▶ Continuer'}
              </Link>

            </div>

          </div>

        </section>
      ) : (
        mounted && (
          <section className="home-hero">

            <div className="home-hero-empty">

              <span className="eyebrow">
                BIENVENUE
              </span>

              <h1>Regarde ton anime.</h1>

              <p>
                Cherche un titre pour commencer à
                le suivre.
              </p>

            </div>

          </section>
        )
      )}

      {/* STATS */}

      {mounted && showStats && stats && (
        <div className="home-stats">

          <div className="home-stat">
            <strong>{stats.totalWatched}</strong>
            <span>épisodes vus</span>
          </div>

          <div className="home-stat">
            <strong>
              {stats.seriesTracked}
            </strong>
            <span>séries suivies</span>
          </div>

          <div className="home-stat">
            <strong>
              {stats.favoritesCount}
            </strong>
            <span>favoris</span>
          </div>

        </div>
      )}

      {/* SUITE DE LA LISTE CONTINUER */}

      {mounted && restOfResume.length > 0 && (
        <section className="section">

          <div className="section-header">

            <div>

              <span className="section-eyebrow">
                REPRENDRE
              </span>

              <h2>Aussi en cours</h2>

            </div>

          </div>

          <div className="continue-list">

            {restOfResume.map((item) => {

              const percentage =
                item.totalCount > 0
                  ? Math.min(
                      100,
                      (item.watchedCount /
                        item.totalCount) *
                        100
                    )
                  : 0;

              return (
                <Link
                  key={`${item.slug}-${item.targetSeason}-${item.lang}`}
                  href={`/anime/${encodeURIComponent(
                    item.slug
                  )}?season=${
                    item.targetSeason
                  }&episode=${item.targetEpisode}`}
                  className="continue-card"
                >

                  <div className="continue-cover">
                    {item.image && (
                      <img
                        src={item.image}
                        alt={item.name}
                        loading="lazy"
                      />
                    )}
                  </div>

                  <div className="continue-info">

                    <strong>{item.name}</strong>

                    <span>
                      Saison {item.targetSeason}
                      {' • '}
                      Épisode{' '}
                      {item.targetEpisode + 1}
                      {item.totalCount > 0 && (
                        <>
                          {' sur '}
                          {item.totalCount}
                        </>
                      )}
                    </span>

                    <div className="continue-progress">
                      <span
                        style={{
                          width: `${percentage}%`,
                        }}
                      />
                    </div>

                    <small>
                      {item.isNextSeason
                        ? '▶ Nouvelle saison'
                        : '▶ Reprendre'}
                    </small>

                  </div>

                  <span className="arrow">›</span>

                </Link>
              );
            })}

          </div>

        </section>
      )}

      {/* DÉCOUVERTE */}

      {mounted && discovery.length > 0 && (
        <section className="section">

          <div className="section-header">

            <div>

              <span className="section-eyebrow">
                DÉCOUVRIR
              </span>

              <h2>Prochaines sorties</h2>

            </div>

            <Link
              href="/planning"
              className="see-all"
            >
              Tout voir
            </Link>

          </div>

          <div className="discovery-scroll">

            {discovery.map((item) => (
              <Link
                key={`${item.slug}-${item.season}-${item.lang}-${item.releaseTs}`}
                href={`/anime/${encodeURIComponent(
                  item.slug
                )}?season=${item.season}`}
                className="discovery-card"
              >

                <div className="discovery-cover">
                  {item.image && (
                    <img
                      src={item.image}
                      alt={item.title}
                      loading="lazy"
                    />
                  )}
                </div>

                <strong>{item.title}</strong>

                <span>
                  {formatPlanningDay(
                    new Date(
                      item.releaseTs * 1000
                    )
                      .toISOString()
                      .slice(0, 10)
                  )}
                  {' · '}
                  {formatPlanningTime(
                    item.releaseTs
                  )}
                </span>

              </Link>
            ))}

          </div>

        </section>
      )}

      {/* ULTIME FILET DE SÉCURITÉ */}

      {nothingAtAll && (
        <div className="empty-card">

          <div className="empty-icon">▶</div>

          <h3>Rien à afficher</h3>

          <p>
            Recherche un anime pour commencer à
            le suivre.
          </p>

        </div>
      )}

    </main>
  );
}
