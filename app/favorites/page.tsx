'use client';

import ProfileCard from '@/components/ProfileCard';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import {
  AniListData,
  TMDBData,
  getAnimeName,
  getCachedAniList,
  getCachedInfo,
  getCachedTMDB,
  loadAniList,
  loadAnimeInfo,
  loadTMDB,
} from '@/lib/animeCache';

import {
  PlanningItem,
  formatPlanningDay,
  formatPlanningTime,
  getPlanningDayKey,
  loadPlanning,
} from '@/lib/planning';

import { readMergedProgress } from '@/lib/watchState';

/*
 * watching   → il reste des épisodes disponibles à voir
 * upToDate   → tout ce qui est sorti a été vu, mais rien
 *              ne confirme que la série est terminée
 * done       → TMDB ou AniList confirme la fin, et tu
 *              es à jour
 * todo       → jamais commencé
 */
type Status = 'watching' | 'todo' | 'upToDate' | 'done';

type Filter = Status | 'all';

interface HistoryItem {
  slug: string;
  name: string;
  image?: string;
  season: number;
  episode: number;
  lang: 'vostfr' | 'vf';
  updatedAt: number;
}

interface LibraryItem {
  slug: string;
  name: string;
  image?: string;
  status: Status;
  watched: number;
  total: number;
  seasons: number;
  lastActivity: number;
  nextRelease: PlanningItem | null;
  anilistEpisodes: number | null;
}

function readFavorites() {
  try {
    const raw = localStorage.getItem(
      'anime_favorites'
    );

    if (!raw) return [];

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => {
        if (typeof item === 'string') {
          return {
            slug: item,
            name: getAnimeName(item),
            image: undefined as
              | string
              | undefined,
          };
        }

        if (item && typeof item === 'object') {
          const slug = String(item.slug || '');

          if (!slug) return null;

          return {
            slug,
            name: String(
              item.name || getAnimeName(slug)
            ),
            image: item.image
              ? String(item.image)
              : undefined,
          };
        }

        return null;
      })
      .filter(Boolean) as {
      slug: string;
      name: string;
      image?: string;
    }[];
  } catch {
    return [];
  }
}

function readHistory(): HistoryItem[] {
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
          Number.isInteger(item.season)
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function formatDate(timestamp: number) {
  const diff = Date.now() - timestamp;

  const minutes = Math.floor(diff / 60000);

  if (minutes < 60) {
    return `Il y a ${Math.max(1, minutes)} min`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) return `Il y a ${hours} h`;

  const days = Math.floor(hours / 24);

  if (days === 1) return 'Hier';

  if (days < 7) return `Il y a ${days} jours`;

  return new Date(timestamp).toLocaleDateString(
    'fr-FR',
    { day: 'numeric', month: 'short' }
  );
}

const STATUS_LABEL: Record<Status, string> = {
  watching: 'En cours',
  todo: 'À voir',
  upToDate: 'À jour',
  done: 'Terminé',
};

/*
 * En dessous de ce seuil, la correspondance externe
 * (TMDB ou AniList) est trop incertaine pour qu'on
 * s'y fie.
 */
const CONFIDENCE_MIN = 0.5;

function trustAniList(anilist: AniListData | null) {
  return Boolean(
    anilist?.matched &&
      (anilist.confidence ?? 0) >= CONFIDENCE_MIN
  );
}

function trustTMDB(tmdb: TMDBData | null) {
  return Boolean(
    tmdb?.matched &&
      (tmdb.confidence ?? 0) >= CONFIDENCE_MIN
  );
}

export default function LibraryPage() {
  const [items, setItems] = useState<
    LibraryItem[]
  >([]);

  const [history, setHistory] = useState<
    HistoryItem[]
  >([]);

  const [filter, setFilter] =
    useState<Filter>('watching');

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    (async () => {
      const favorites = readFavorites();

      const historyItems = readHistory();

      setHistory(historyItems);

      /* Favoris + animes déjà regardés */
      const known = new Map<
        string,
        { name: string; image?: string }
      >();

      for (const item of favorites) {
        known.set(item.slug, {
          name: item.name,
          image: item.image,
        });
      }

      for (const item of historyItems) {
        if (!known.has(item.slug)) {
          known.set(item.slug, {
            name: item.name,
            image: item.image,
          });
        }
      }

      let planning: PlanningItem[] = [];

      try {
        planning = await loadPlanning();
      } catch {
        planning = [];
      }

      const entries = await Promise.all(
        Array.from(known.entries())
          .slice(0, 40)
          .map(async ([slug, meta]) => {
            let info = getCachedInfo(slug);

            if (!info) {
              try {
                info = await loadAnimeInfo(slug);
              } catch {
                info = null;
              }
            }

            /*
             * TMDB en priorité : donne le statut et
             * le détail par saison. AniList en repli
             * si TMDB ne matche pas. Simple
             * enrichissement, jamais bloquant.
             */
            let tmdb = getCachedTMDB(slug);

            if (!tmdb) {
              try {
                tmdb = await loadTMDB(
                  slug,
                  info?.name || meta.name,
                  info?.altTitles || [],
                  info?.seasons?.length || 0
                );
              } catch {
                tmdb = null;
              }
            }

            let anilist = getCachedAniList(slug);

            if (!anilist) {
              try {
                anilist = await loadAniList(
                  slug,
                  info?.name || meta.name,
                  info?.altTitles || []
                );
              } catch {
                anilist = null;
              }
            }

            const merged =
              readMergedProgress(slug);

            let watched = 0;
            let total = 0;

            /*
             * Une saison compte comme suivie dès
             * qu'elle a un total connu, même
             * partiellement vue.
             */
            merged.forEach((entry) => {
              watched += entry.watched;
              total += entry.total;
            });

            const seasons =
              info?.seasons?.length || 0;

            const nextRelease =
              planning
                .filter(
                  (entry) =>
                    entry.slug === slug &&
                    entry.releaseTs * 1000 >
                      Date.now()
                )
                .sort(
                  (a, b) =>
                    a.releaseTs - b.releaseTs
                )[0] || null;

            /*
             * A-t-on vu tout ce qui est
             * actuellement disponible ?
             */
            const hasKnownTotal = total > 0;

            const caughtUp =
              hasKnownTotal &&
              watched >= total;

            /*
             * La fin de série est confirmée si TMDB
             * dit "Ended", ou à défaut si AniList dit
             * "FINISHED" — les deux avec une
             * confiance suffisante.
             */
            const isFinished =
              (trustTMDB(tmdb) &&
                tmdb!.status === 'Ended') ||
              (trustAniList(anilist) &&
                anilist!.status === 'FINISHED');

            let status: Status = 'watching';

            if (merged.size === 0) {
              status = 'todo';
            } else if (isFinished && caughtUp) {
              status = 'done';
            } else if (caughtUp) {
              /*
               * Tout vu, mais rien ne confirme
               * une fin : on ne prétend pas savoir.
               */
              status = 'upToDate';
            }

            const lastActivity =
              historyItems.find(
                (entry) => entry.slug === slug
              )?.updatedAt || 0;

            return {
              slug,
              name: info?.name || meta.name,
              image: info?.image || meta.image,
              status,
              watched,
              total,
              seasons,
              lastActivity,
              nextRelease,
              anilistEpisodes:
                tmdb?.episodes ??
                anilist?.episodes ??
                null,
            } as LibraryItem;
          })
      );

      if (!active) return;

      entries.sort(
        (a, b) => b.lastActivity - a.lastActivity
      );

      setItems(entries);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, []);

  const counts = useMemo(() => {
    return {
      watching: items.filter(
        (item) => item.status === 'watching'
      ).length,
      todo: items.filter(
        (item) => item.status === 'todo'
      ).length,
      upToDate: items.filter(
        (item) => item.status === 'upToDate'
      ).length,
      done: items.filter(
        (item) => item.status === 'done'
      ).length,
      all: items.length,
    };
  }, [items]);

  const visible = useMemo(() => {
    if (filter === 'all') return items;

    return items.filter(
      (item) => item.status === filter
    );
  }, [items, filter]);

  return (
    <main className="page">

      <header className="simple-header">

        <div className="title-row">

          <div>

            <span className="eyebrow">
              MES ANIMES
            </span>

            <h1>Bibliothèque</h1>

          </div>

          {items.length > 0 && (
            <span className="count-badge">
              {items.length}
            </span>
          )}

        </div>

      </header>

      {/* FILTRES */}

      <div className="library-filters">

        {(
          [
            ['watching', 'En cours'],
            ['upToDate', 'À jour'],
            ['todo', 'À voir'],
            ['done', 'Terminés'],
            ['all', 'Tous'],
          ] as [Filter, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            className={
              filter === key
                ? 'filter-chip is-active'
                : 'filter-chip'
            }
            onClick={() => setFilter(key)}
          >
            {label}
            <span>{counts[key]}</span>
          </button>
        ))}

      </div>

      {loading && (
        <div className="library-list">

          <div className="skeleton skeleton-block" />

        </div>
      )}

      {!loading && visible.length === 0 && (
        <div className="empty-card">

          <div className="empty-icon">★</div>

          <h3>Rien ici</h3>

          <p>
            {filter === 'todo'
              ? 'Ajoute un anime en favori pour le retrouver ici.'
              : 'Commence un anime pour le voir apparaître.'}
          </p>

        </div>
      )}

      {/* LISTE */}

      {!loading && visible.length > 0 && (
        <div className="library-list">

          {visible.map((item) => {

            const percentage =
              item.total > 0
                ? Math.min(
                    100,
                    (item.watched / item.total) *
                      100
                  )
                : 0;

            return (
              <Link
                key={item.slug}
                href={`/anime/${encodeURIComponent(
                  item.slug
                )}`}
                className="library-card"
              >

                <div className="library-cover">
                  {item.image && (
                    <img
                      src={item.image}
                      alt={item.name}
                      loading="lazy"
                    />
                  )}
                </div>

                <div className="library-info">

                  <div className="library-top">

                    <strong>{item.name}</strong>

                    <span
                      className={`library-status is-${item.status}`}
                    >
                      {STATUS_LABEL[item.status]}
                    </span>

                  </div>

                  <span className="library-meta">
                    {item.total > 0
                      ? `${item.watched} / ${item.total} épisodes`
                      : item.anilistEpisodes
                      ? `${item.anilistEpisodes} épisodes au total`
                      : 'Pas encore commencé'}

                    {item.seasons > 1 && (
                      <>
                        {' · '}
                        {item.seasons} saisons
                      </>
                    )}
                  </span>

                  {item.total > 0 && (
                    <div className="library-track">
                      <span
                        style={{
                          width: `${percentage}%`,
                        }}
                      />
                    </div>
                  )}

                  {item.nextRelease ? (
                    <small className="library-next">
                      Épisode{' '}
                      {formatPlanningDay(
                        getPlanningDayKey(
                          item.nextRelease
                            .releaseTs
                        )
                      )}
                      {' · '}
                      {formatPlanningTime(
                        item.nextRelease.releaseTs
                      )}
                    </small>
                  ) : item.status === 'done' ? (
                    <small className="library-next">
                      Série terminée
                    </small>
                  ) : item.status ===
                    'upToDate' ? (
                    <small className="library-next">
                      À jour, prochaine sortie
                      inconnue
                    </small>
                  ) : null}

                </div>

                <span className="arrow">›</span>

              </Link>
            );
          })}

        </div>
      )}

      {/* HISTORIQUE */}

      {history.length > 0 && (
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
              }}
            >
              Effacer
            </button>

          </div>

          <div className="history-list">

            {history.slice(0, 12).map((item) => (
              <div
                className="history-card"
                key={`${item.slug}-${item.season}-${item.lang}`}
              >

                <Link
                  href={`/anime/${encodeURIComponent(
                    item.slug
                  )}?season=${item.season}&episode=${
                    item.episode
                  }`}
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
                      {formatDate(item.updatedAt)}
                    </small>

                  </div>

                </Link>

                <button
                  className="history-delete"
                  aria-label={`Supprimer ${item.name}`}
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
                  }}
                >
                  ×
                </button>

              </div>
            ))}

          </div>

        </section>
      )}
      <ProfileCard />

    </main>
  );
}
