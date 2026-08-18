'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  AnimeInfoData,
  getAnimeName,
  getCachedAniList,
  getCachedInfo,
  getCachedTMDB,
  loadAniList,
  loadAnimeInfo,
  loadEpisodes,
  loadTMDB,
  prefetchEpisodes,
} from '@/lib/animeCache';

import {
  markEpisodesUpTo,
  readMergedProgress,
} from '@/lib/watchState';

interface ContinueItem {
  slug: string;
  name: string;
  image?: string;
  season: number;
  episode: number;
  lang: 'vostfr' | 'vf';
  updatedAt: number;
}

interface FavoriteItem {
  name: string;
  slug: string;
  image?: string;
}

interface SeasonProgress {
  season: number;
  watched: number;
  total: number;
  lastEpisode: number;
  updatedAt: number;
}

const SYNOPSIS_LIMIT = 260;
const LONG_PRESS = 550;

function readFavorites(): FavoriteItem[] {
  try {
    const raw = localStorage.getItem(
      'anime_favorites'
    );

    if (!raw) return [];

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item: unknown): FavoriteItem | null => {
        if (typeof item === 'string') {
          return {
            name: getAnimeName(item),
            slug: item,
          };
        }

        if (
          item &&
          typeof item === 'object' &&
          typeof (item as FavoriteItem).slug ===
            'string'
        ) {
          const favorite = item as FavoriteItem;

          return {
            name:
              favorite.name ||
              getAnimeName(favorite.slug),
            slug: favorite.slug,
            image: favorite.image,
          };
        }

        return null;
      })
      .filter(
        (item): item is FavoriteItem =>
          item !== null
      );
  } catch {
    return [];
  }
}

export default function AnimeInfoPage({
  params,
}: {
  params: { slug: string };
}) {
  const router = useRouter();

  const slug = decodeURIComponent(params.slug);

  const [info, setInfo] =
    useState<AnimeInfoData | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [favorite, setFavorite] = useState(false);

  const [continueItem, setContinueItem] =
    useState<ContinueItem | null>(null);

  const [progress, setProgress] = useState<
    Map<number, SeasonProgress>
  >(new Map());

  const [expanded, setExpanded] = useState(false);
  const [showAlt, setShowAlt] = useState(false);

  /* Appui long sur une carte de saison */
  const [markingSeason, setMarkingSeason] =
    useState<number | null>(null);

  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

  /*
   * =======================================================
   * FICHE
   * =======================================================
   */

  useEffect(() => {
    let active = true;

    const cached = getCachedInfo(slug);

    if (cached) {
      setInfo(cached);
      setLoading(false);
    }

    loadAnimeInfo(slug)
      .then((data) => {
        if (!active) return;

        setInfo(data);
        setError(false);
      })
      .catch(() => {
        if (!active) return;

        if (!cached) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [slug]);

  /*
   * =======================================================
   * DONNÉES LOCALES
   * =======================================================
   */

  useEffect(() => {
    const favorites = readFavorites();

    setFavorite(
      favorites.some((item) => item.slug === slug)
    );

    setProgress(readMergedProgress(slug));

    try {
      const raw = localStorage.getItem(
        `anime_continue_${slug}`
      );

      setContinueItem(
        raw ? JSON.parse(raw) : null
      );
    } catch {
      setContinueItem(null);
    }
  }, [slug]);

  /*
   * =======================================================
   * PRÉCHARGEMENT
   * =======================================================
   */

  useEffect(() => {
    if (!info) return;

    const target =
      continueItem?.season ||
      info.seasons?.[0] ||
      1;

    prefetchEpisodes(
      slug,
      target,
      continueItem?.lang || 'vostfr'
    );

    /*
     * TMDB en priorité (statut + détail par saison),
     * AniList en repli si TMDB ne matche pas.
     */
    if (!getCachedTMDB(slug)) {
      loadTMDB(
        slug,
        info.name,
        info.altTitles || [],
        info.seasons?.length || 0
      ).catch(() => {
        // Simple enrichissement, pas bloquant
      });
    }

    if (!getCachedAniList(slug)) {
      loadAniList(
        slug,
        info.name,
        info.altTitles || []
      ).catch(() => {
        // Simple enrichissement, pas bloquant
      });
    }
  }, [info, continueItem, slug]);

  /*
   * =======================================================
   * TOTAUX CONNUS
   * =======================================================
   */

  const totals = useMemo(() => {
    let watched = 0;
    let episodes = 0;

    progress.forEach((item) => {
      watched += item.watched;
      episodes += item.total;
    });

    return { watched, episodes };
  }, [progress]);

  /*
   * =======================================================
   * MARQUAGE MANUEL D'UNE SAISON
   *
   * Ordre de résolution du total :
   *   1. déjà connu localement (progression existante)
   *   2. TMDB, si son découpage en saisons correspond
   *      exactement à celui d'Anime-Sama
   *   3. AniList, si la série ne fait qu'une saison
   *   4. en dernier recours, chargement du episodes.js
   *      réel de cette saison
   * =======================================================
   */

  const resolveSeasonTotal = async (
    seasonNumber: number
  ): Promise<number | null> => {
    const existing = progress.get(seasonNumber);

    if (existing?.total) {
      return existing.total;
    }

    const tmdb = getCachedTMDB(slug);

    if (tmdb?.matched && tmdb.seasons) {
      const match = tmdb.seasons.find(
        (season) =>
          season.seasonNumber === seasonNumber
      );

      if (match?.episodeCount) {
        return match.episodeCount;
      }
    }

    const isSingleSeason =
      (info?.seasons?.length || 0) <= 1;

    if (isSingleSeason) {
      const anilist = getCachedAniList(slug);

      if (anilist?.matched && anilist.episodes) {
        return anilist.episodes;
      }
    }

    try {
      const data = await loadEpisodes(
        slug,
        seasonNumber,
        'vostfr'
      );

      const total =
        data.players[data.defaultPlayerIndex]
          ?.urls.length || data.totalEpisodes;

      return total || null;
    } catch {
      return null;
    }
  };

  const markSeasonAsWatched = async (
    seasonNumber: number
  ) => {
    setMarkingSeason(seasonNumber);

    try {
      const total = await resolveSeasonTotal(
        seasonNumber
      );

      if (!total) {
        window.alert(
          'Nombre d’épisodes introuvable pour cette saison.'
        );

        return;
      }

      const confirmed = window.confirm(
        `Marquer les ${total} épisodes de cette saison comme vus ?`
      );

      if (!confirmed) return;

      markEpisodesUpTo(
        slug,
        seasonNumber,
        'vostfr',
        total - 1,
        total
      );

      setProgress(readMergedProgress(slug));
    } finally {
      setMarkingSeason(null);
    }
  };

  /*
   * =======================================================
   * APPUI LONG
   *
   * Les cartes de saison sont des <div>, pas des <Link>,
   * pour éviter le menu d'aperçu natif iOS ("Peek & Pop")
   * qui se déclenche sur l'appui long d'un lien et coupe
   * court à la détection du geste.
   * =======================================================
   */

  const startPress = (seasonNumber: number) => {
    longPressed.current = false;

    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;

      markSeasonAsWatched(seasonNumber);
    }, LONG_PRESS);
  };

  const cancelPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const handleSeasonClick = (
    seasonNumber: number
  ) => {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }

    router.push(
      `/anime/${encodeURIComponent(
        slug
      )}/${seasonNumber}`
    );
  };

  useEffect(() => {
    return () => cancelPress();
  }, []);

  /*
   * =======================================================
   * FAVORI
   * =======================================================
   */

  const toggleFavorite = () => {
    try {
      const favorites = readFavorites();

      const next = favorite
        ? favorites.filter(
            (item) => item.slug !== slug
          )
        : [
            ...favorites,
            {
              name:
                info?.name || getAnimeName(slug),
              slug,
              image: info?.image,
            },
          ];

      localStorage.setItem(
        'anime_favorites',
        JSON.stringify(next)
      );

      setFavorite(!favorite);
    } catch (err) {
      console.error(err);
    }
  };

  const title = info?.name || getAnimeName(slug);

  const seasonEntries =
    info?.seasonEntries?.length
      ? info.seasonEntries
      : (info?.seasons || []).map((number) => ({
          number,
          label: `Saison ${number}`,
          langs: [] as string[],
        }));

  const firstSeason =
    seasonEntries[0]?.number || 1;

  const synopsis = info?.synopsis || '';

  const isLongSynopsis =
    synopsis.length > SYNOPSIS_LIMIT;

  /*
   * =======================================================
   * SQUELETTE
   * =======================================================
   */

  if (loading && !info) {
    return (
      <main className="page anime-page">

        <header className="anime-header">

          <Link
            href="/"
            className="back-button"
          >
            ‹
          </Link>

          <div className="anime-title">
            <span>ANIME</span>
            <h1>{title}</h1>
          </div>

        </header>

        <section className="anime-hero">

          <div className="skeleton skeleton-cover" />

          <div className="anime-hero-content">
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line short" />
            <div className="skeleton skeleton-line short" />
          </div>

        </section>

        <div className="skeleton skeleton-block" />

      </main>
    );
  }

  /*
   * =======================================================
   * ERREUR
   * =======================================================
   */

  if (error || !info) {
    return (
      <main className="page">
        <div className="error-card">

          <span>⚠️</span>

          <h2>
            Impossible de charger cet anime
          </h2>

          <p>
            La source n&apos;a pas répondu
            correctement.
          </p>

          <Link
            href="/"
            className="primary-button"
          >
            Retour à l&apos;accueil
          </Link>

        </div>
      </main>
    );
  }

  /*
   * =======================================================
   * PAGE
   * =======================================================
   */

  return (
    <main className="page anime-page">

      <header className="anime-header">

        <Link
          href="/"
          className="back-button"
        >
          ‹
        </Link>

        <div className="anime-title">

          <span>ANIME</span>

          <h1>{title}</h1>

        </div>

        <button
          className={`favorite-button ${
            favorite ? 'is-favorite' : ''
          }`}
          onClick={toggleFavorite}
          aria-label="Favori"
        >
          {favorite ? '★' : '☆'}
        </button>

      </header>

      {/* ===================================================
          EN-TÊTE
          =================================================== */}

      <section className="anime-hero">

        {info.image && (
          <div className="anime-hero-cover">
            <img
              src={info.image}
              alt={title}
            />
          </div>
        )}

        <div className="anime-hero-content">

          <h2>{title}</h2>

          {info.altTitles?.length > 0 && (
            <div className="alt-titles">

              <p
                className={
                  showAlt ? 'is-open' : ''
                }
              >
                {info.altTitles.join(' · ')}
              </p>

              {info.altTitles.length > 2 && (
                <button
                  className="text-button"
                  onClick={() =>
                    setShowAlt(!showAlt)
                  }
                >
                  {showAlt
                    ? 'Réduire'
                    : 'Voir tous les titres'}
                </button>
              )}

            </div>
          )}

          <div className="meta-pills">

            {info.year && (
              <span>{info.year}</span>
            )}

            {info.type && (
              <span>{info.type}</span>
            )}

            {info.status && (
              <span className="is-status">
                {info.status}
              </span>
            )}

            <span>
              {seasonEntries.length}{' '}
              {seasonEntries.length > 1
                ? 'saisons'
                : 'saison'}
            </span>

            {totals.episodes > 0 && (
              <span>
                {totals.episodes} épisodes
              </span>
            )}

          </div>

        </div>

      </section>

      {/* ===================================================
          BOUTON PRINCIPAL
          =================================================== */}

      <Link
        href={`/anime/${encodeURIComponent(
          slug
        )}/${continueItem?.season || firstSeason}`}
        className="primary-button hero-action"
        onTouchStart={() =>
          prefetchEpisodes(
            slug,
            continueItem?.season || firstSeason,
            continueItem?.lang || 'vostfr'
          )
        }
      >
        {continueItem
          ? `Continuer · S${
              continueItem.season
            } É${continueItem.episode + 1}`
          : 'Commencer'}
      </Link>

      {/* ===================================================
          GENRES
          =================================================== */}

      {info.genres?.length > 0 && (
        <div className="genre-badges">

          {info.genres.map((genre) => (
            <span key={genre}>{genre}</span>
          ))}

        </div>
      )}

      {/* ===================================================
          SYNOPSIS
          =================================================== */}

      {synopsis && (
        <section className="anime-synopsis">

          <span className="section-eyebrow">
            SYNOPSIS
          </span>

          <p
            className={
              !expanded && isLongSynopsis
                ? 'is-clamped'
                : ''
            }
          >
            {synopsis}
          </p>

          {isLongSynopsis && (
            <button
              className="text-button"
              onClick={() =>
                setExpanded(!expanded)
              }
            >
              {expanded
                ? 'Réduire'
                : 'Lire plus'}
            </button>
          )}

        </section>
      )}

      {/* ===================================================
          SAISONS
          =================================================== */}

      <section className="section">

        <div className="section-header">

          <div>

            <span className="section-eyebrow">
              CHOISIR
            </span>

            <h2>Saisons</h2>

          </div>

          <span className="episode-count">
            {seasonEntries.length}
          </span>

        </div>

        <p className="episode-hint">
          Appui long sur une saison pour la marquer
          entièrement comme vue.
        </p>

        <div className="season-cards">

          {seasonEntries.map((entry) => {

            const item = progress.get(
              entry.number
            );

            const watchedCount =
              item?.watched || 0;

            const totalCount = item?.total || 0;

            const percentage =
              totalCount > 0
                ? Math.min(
                    100,
                    (watchedCount / totalCount) *
                      100
                  )
                : 0;

            const isDone =
              totalCount > 0 &&
              watchedCount >= totalCount;

            const isMarking =
              markingSeason === entry.number;

            return (
              <div
                key={entry.number}
                role="button"
                tabIndex={0}
                className={
                  isDone
                    ? 'season-card is-done'
                    : 'season-card'
                }
                onMouseEnter={() =>
                  prefetchEpisodes(
                    slug,
                    entry.number
                  )
                }
                onPointerDown={() =>
                  startPress(entry.number)
                }
                onPointerUp={cancelPress}
                onPointerLeave={cancelPress}
                onPointerCancel={cancelPress}
                onContextMenu={(event) =>
                  event.preventDefault()
                }
                onClick={() =>
                  handleSeasonClick(entry.number)
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    handleSeasonClick(entry.number);
                  }
                }}
              >

                <div className="season-card-top">

                  <strong>{entry.label}</strong>

                  {isMarking ? (
                    <span className="loader" />
                  ) : (
                    isDone && (
                      <span className="season-done">
                        ✓
                      </span>
                    )
                  )}

                </div>

                <div className="season-card-meta">

                  <span>
                    {totalCount > 0
                      ? `${watchedCount} / ${totalCount} épisodes`
                      : 'Non commencée'}
                  </span>

                  {entry.langs?.length > 0 && (
                    <span className="season-langs">
                      {entry.langs
                        .map((lang) =>
                          lang.toUpperCase()
                        )
                        .join(' · ')}
                    </span>
                  )}

                </div>

                <div className="season-progress-track">

                  <span
                    style={{
                      width: `${percentage}%`,
                    }}
                  />

                </div>

              </div>
            );
          })}

        </div>

      </section>

    </main>
  );
}
