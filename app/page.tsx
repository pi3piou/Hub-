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
  loadPlanning,
} from '@/lib/planning';

import {
  getSeasonProgress,
  isSeasonComplete,
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

function formatHistoryDate(timestamp: number) {
  const date = new Date(timestamp);

  const diff = Date.now() - date.getTime();

  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return 'À l’instant';

  if (minutes < 60) return `Il y a ${minutes} min`;

  const hours = Math.floor(minutes / 60);

  if (hours < 24) return `Il y a ${hours} h`;

  const days = Math.floor(hours / 24);

  if (days === 1) return 'Hier';

  if (days < 7) return `Il y a ${days} jours`;

  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
  });
}

/*
 * =========================================================
 * DÉCISION D'AFFICHAGE
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

  /* Saison en cours */
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

  /*
   * Une sortie a eu lieu : le total stocké
   * est peut-être périmé.
   */
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

  /* Saison suivante ? */
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

  /* À jour */
  return null;
}

export default function Home() {
  const [query, setQuery] = useState('');

  const [results, setResults] = useState<
    AnimeItem[]
  >([]);

  const [history, setHistory] = useState<
    ContinueItem[]
  >([]);

  const [resume, setResume] = useState<
    ResumeItem[]
  >([]);

  const [searching, setSearching] =
    useState(false);

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const entries = readHistory();

    setHistory(entries);
    setMounted(true);

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

  return (
    <main className="page">

      <header className="hero">

        <div>
          <div className="eyebrow">
            ANIME STREAM
          </div>

          <h1>Regarde ton anime.</h1>

          <p>
            Reprends là où tu t’es arrêté, ou
            cherche un nouveau titre.
          </p>
        </div>

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

      {/* CONTINUER */}

      {mounted && resume.length > 0 && (
        <section className="section">

          <div className="section-header">

            <div>

              <span className="section-eyebrow">
                REPRENDRE
              </span>

              <h2>Continuer la lecture</h2>

            </div>

          </div>

          <div className="continue-list">

            {resume.slice(0, 5).map((item) => {

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
                  )}/${item.targetSeason}`}
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

      {/* HISTORIQUE */}

      {mounted && history.length > 0 && (
        <section className="section">

          <div className="section-header">

            <div>
              <span className="section-eyebrow">
                HISTORIQUE
              </span>

              <h2>Récemment regardés</h2>
            </div>

            <button
              className="clear-history"
              onClick={() => {
                if (
                  !window.confirm(
                    'Effacer tout l’historique ?'
                  )
                ) {
                  return;
                }

                localStorage.removeItem(
                  'anime_history'
                );

                setHistory([]);
                setResume([]);
              }}
            >
              Effacer
            </button>

          </div>

          <div className="history-list">

            {history.slice(0, 10).map((item) => (
              <div
                className="history-card"
                key={`${item.slug}-${item.season}-${item.lang}`}
              >

                <Link
                  href={`/anime/${encodeURIComponent(
                    item.slug
                  )}/${item.season}`}
                  className="history-main"
                >

                  <div className="history-cover">
                    {item.image && (
                      <img
                        src={item.image}
                        alt={item.name}
                        loading="lazy"
                      />
                    )}
                  </div>

                  <div className="history-info">

                    <strong>{item.name}</strong>

                    <span>
                      Saison {item.season}
                      {' • '}
                      Épisode {item.episode + 1}
                    </span>

                    <small>
                      {formatHistoryDate(
                        item.updatedAt
                      )}
                    </small>

                  </div>

                </Link>

                <button
                  className="history-delete"
                  aria-label={`Supprimer ${item.name} de l’historique`}
                  onClick={() => {
                    const next = history.filter(
                      (entry) =>
                        !(
                          entry.slug ===
                            item.slug &&
                          entry.season ===
                            item.season &&
                          entry.lang === item.lang
                        )
                    );

                    localStorage.setItem(
                      'anime_history',
                      JSON.stringify(next)
                    );

                    setHistory(next);

                    setResume((current) =>
                      current.filter(
                        (entry) =>
                          entry.slug !== item.slug
                      )
                    );
                  }}
                >
                  ×
                </button>

              </div>
            ))}

          </div>

        </section>
      )}

      {/* AUCUNE ACTIVITÉ */}

      {mounted &&
        resume.length === 0 &&
        history.length === 0 && (
          <div className="empty-card">

            <div className="empty-icon">▶</div>

            <h3>Rien en cours</h3>

            <p>
              Recherche un anime pour commencer à
              le suivre.
            </p>

          </div>
        )}

    </main>
  );
}
