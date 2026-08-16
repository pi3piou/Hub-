'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import {
  AnimeInfoData,
  getAnimeName,
  getCachedInfo,
  loadAnimeInfo,
  prefetchEpisodes,
} from '@/lib/animeCache';

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

/*
 * La progression est stockée par langue.
 * Sur la fiche on affiche le meilleur des deux.
 */
function readMergedProgress(slug: string) {
  const merged = new Map<number, SeasonProgress>();

  for (const lang of ['vostfr', 'vf']) {
    try {
      const raw = localStorage.getItem(
        `anime_progress_${slug}_${lang}`
      );

      if (!raw) continue;

      const parsed = JSON.parse(raw);

      if (!Array.isArray(parsed)) continue;

      for (const item of parsed as SeasonProgress[]) {
        const existing = merged.get(item.season);

        if (
          !existing ||
          item.watched > existing.watched
        ) {
          merged.set(item.season, item);
        }
      }
    } catch {
      // Rien
    }
  }

  return merged;
}

export default function AnimeInfoPage({
  params,
}: {
  params: { slug: string };
}) {
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

      if (raw) {
        setContinueItem(JSON.parse(raw));
      }
    } catch {
      setContinueItem(null);
    }
  }, [slug]);

  /*
   * =======================================================
   * PRÉCHARGEMENT
   *
   * Pendant que l'utilisateur lit le synopsis,
   * la saison la plus probable arrive en fond.
   * =======================================================
   */

  useEffect(() => {
    if (!info) return;

    const target =
      continueItem?.season ||
      info.seasons[0] ||
      1;

    const lang = continueItem?.lang || 'vostfr';

    prefetchEpisodes(slug, target, lang);
  }, [info, continueItem, slug]);

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

        <section className="anime-info">

          <div className="anime-info-main">

            <div className="skeleton skeleton-cover" />

            <div className="anime-info-content">
              <div className="skeleton skeleton-line" />
              <div className="skeleton skeleton-line short" />
            </div>

          </div>

          <div className="skeleton skeleton-block" />

        </section>

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
          FICHE
          =================================================== */}

      <section className="anime-info">

        <div className="anime-info-main">

          {info.image && (
            <img
              src={info.image}
              alt={title}
              className="anime-info-cover"
            />
          )}

          <div className="anime-info-content">

            <span className="section-eyebrow">
              FICHE ANIME
            </span>

            <h2>{title}</h2>

            <div className="anime-meta">

              {info.year && (
                <span>{info.year}</span>
              )}

              {info.type && (
                <span>{info.type}</span>
              )}

              {info.status && (
                <span>{info.status}</span>
              )}

            </div>

          </div>

        </div>

        {info.synopsis && (
          <div className="anime-synopsis">

            <h3>Synopsis</h3>

            <p>{info.synopsis}</p>

          </div>
        )}

        {info.genres?.length > 0 && (
          <div className="anime-genres">

            {info.genres.map((genre) => (
              <span key={genre}>{genre}</span>
            ))}

          </div>
        )}

      </section>

      {/* ===================================================
          REPRENDRE
          =================================================== */}

      {continueItem && (
        <Link
          href={`/anime/${encodeURIComponent(
            slug
          )}/${continueItem.season}`}
          className="primary-button resume-button"
          onMouseEnter={() =>
            prefetchEpisodes(
              slug,
              continueItem.season,
              continueItem.lang
            )
          }
        >
          Reprendre — Saison{' '}
          {continueItem.season}, épisode{' '}
          {continueItem.episode + 1}
        </Link>
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
            {info.seasons.length}
          </span>

        </div>

        <div className="season-cards">

          {info.seasons.map((seasonNumber) => {

            const item = progress.get(seasonNumber);

            const watchedCount = item?.watched || 0;

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

            return (
              <Link
                key={seasonNumber}
                href={`/anime/${encodeURIComponent(
                  slug
                )}/${seasonNumber}`}
                className={
                  isDone
                    ? 'season-card is-done'
                    : 'season-card'
                }
                onMouseEnter={() =>
                  prefetchEpisodes(
                    slug,
                    seasonNumber
                  )
                }
                onTouchStart={() =>
                  prefetchEpisodes(
                    slug,
                    seasonNumber
                  )
                }
              >

                <div className="season-card-top">

                  <strong>
                    Saison {seasonNumber}
                  </strong>

                  <span>
                    {totalCount > 0
                      ? `${watchedCount}/${totalCount}`
                      : '—'}
                  </span>

                </div>

                <div className="season-progress-track">

                  <span
                    style={{
                      width: `${percentage}%`,
                    }}
                  />

                </div>

              </Link>
            );
          })}

        </div>

      </section>

    </main>
  );
}
