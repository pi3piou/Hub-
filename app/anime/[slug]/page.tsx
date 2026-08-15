'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

interface Player {
  name: string;
  urls: string[];
}

interface AnimeData {
  slug: string;
  saison: number;
  seasons: number[];
  totalSeasons: number;
  hasVF: boolean;
  players: Player[];
  defaultPlayerIndex: number;
  totalEpisodes: number;
}

function getWatchKey(
  slug: string,
  season: number,
  lang: string
) {
  return `anime_watched_${slug}_s${season}_${lang}`;
}

export default function AnimePage({
  params,
}: {
  params: { slug: string };
}) {
  const slug =
    decodeURIComponent(params.slug);

  const [lang, setLang] =
    useState<'vostfr' | 'vf'>(
      'vostfr'
    );

  const [season, setSeason] =
    useState(1);

  const [player, setPlayer] =
    useState(0);

  const [episode, setEpisode] =
    useState(0);

  const [data, setData] =
    useState<AnimeData | null>(
      null
    );

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState(false);

  const [favorite, setFavorite] =
    useState(false);

  const [poster, setPoster] =
    useState('');

  /*
   * ÉPISODES VUS
   *
   * On stocke uniquement les numéros
   * d'épisodes dans le navigateur.
   */

  const [watched, setWatched] =
    useState<number[]>([]);

  /*
   * -------------------------------------------------------
   * CHARGEMENT DES ÉPISODES VUS
   * -------------------------------------------------------
   */

  useEffect(() => {
    try {
      const key = getWatchKey(
        slug,
        season,
        lang
      );

      const raw =
        localStorage.getItem(key);

      if (!raw) {
        setWatched([]);
        return;
      }

      const parsed =
        JSON.parse(raw);

      if (Array.isArray(parsed)) {
        setWatched(
          parsed
            .map(Number)
            .filter(
              (number) =>
                Number.isInteger(
                  number
                ) &&
                number >= 0
            )
        );
      } else {
        setWatched([]);
      }
    } catch {
      setWatched([]);
    }
  }, [
    slug,
    season,
    lang,
  ]);

  /*
   * -------------------------------------------------------
   * MARQUER UN ÉPISODE COMME VU
   * -------------------------------------------------------
   */

  const markEpisodeAsWatched = (
    episodeIndex: number
  ) => {
    try {
      const key = getWatchKey(
        slug,
        season,
        lang
      );

      setWatched((current) => {
        if (
          current.includes(
            episodeIndex
          )
        ) {
          return current;
        }

        const next = [
          ...current,
          episodeIndex,
        ].sort(
          (a, b) => a - b
        );

        localStorage.setItem(
          key,
          JSON.stringify(next)
        );

        return next;
      });
    } catch {
      // localStorage indisponible
    }
  };

  /*
   * -------------------------------------------------------
   * AFFICHES
   * -------------------------------------------------------
   */

  useEffect(() => {
    const controller =
      new AbortController();

    async function loadPoster() {
      try {
        const response =
          await fetch(
            `/api/search?q=${encodeURIComponent(
              slug.replace(
                /-/g,
                ' '
              )
            )}`,
            {
              signal:
                controller.signal,
              cache: 'no-store',
            }
          );

        if (!response.ok) {
          return;
        }

        const json =
          await response.json();

        if (
          Array.isArray(
            json.results
          )
        ) {
          const exact =
            json.results.find(
              (item: any) =>
                item.slug ===
                slug
            );

          if (exact?.image) {
            setPoster(
              exact.image
            );
          }
        }
      } catch {
        // Rien
      }
    }

    loadPoster();

    return () =>
      controller.abort();
  }, [slug]);

  /*
   * -------------------------------------------------------
   * FAVORIS
   * -------------------------------------------------------
   */

  useEffect(() => {
    try {
      const raw =
        localStorage.getItem(
          'anime_favorites'
        );

      if (!raw) return;

      const favorites =
        JSON.parse(raw);

      if (Array.isArray(favorites)) {
        const current =
          favorites.find(
            (item) =>
              typeof item ===
                'string'
                ? item === slug
                : item?.slug === slug
          );

        if (
          current &&
          typeof current ===
            'object' &&
          current.image
        ) {
          setPoster(
            current.image
          );
        }

        setFavorite(
          Boolean(current)
        );
      }
    } catch {
      setFavorite(false);
    }
  }, [slug]);

  /*
   * -------------------------------------------------------
   * CHARGEMENT ANIME
   * -------------------------------------------------------
   */

  useEffect(() => {
    const controller =
      new AbortController();

    async function load() {
      setLoading(true);
      setError(false);
      setEpisode(0);

      try {
        const response =
          await fetch(
            `/api/anime?slug=${encodeURIComponent(
              slug
            )}&saison=${season}&lang=${lang}`,
            {
              signal:
                controller.signal,
              cache: 'no-store',
            }
          );

        if (!response.ok) {
          throw new Error(
            'Impossible de charger l’anime'
          );
        }

        const json =
          await response.json();

        if (json.error) {
          throw new Error(
            json.error
          );
        }

        setData(json);

        const defaultPlayer =
          Number.isInteger(
            json.defaultPlayerIndex
          )
            ? json.defaultPlayerIndex
            : 0;

        setPlayer(
          defaultPlayer
        );
      } catch (err) {
        if (
          (err as Error).name !==
          'AbortError'
        ) {
          console.error(err);

          setError(true);
          setData(null);
        }
      } finally {
        if (
          !controller.signal.aborted
        ) {
          setLoading(false);
        }
      }
    }

    load();

    return () =>
      controller.abort();
  }, [
    slug,
    season,
    lang,
  ]);

  /*
   * -------------------------------------------------------
   * ÉPISODES
   * -------------------------------------------------------
   */

  const episodes = useMemo(() => {
    if (
      !data?.players?.[player]
    ) {
      return [];
    }

    return (
      data.players[player]
        .urls || []
    );
  }, [
    data,
    player,
  ]);

  const videoUrl =
    episodes[episode] || '';

  /*
   * -------------------------------------------------------
   * FAVORI
   * -------------------------------------------------------
   */

  const toggleFavorite = () => {
    try {
      const raw =
        localStorage.getItem(
          'anime_favorites'
        );

      let favorites = raw
        ? JSON.parse(raw)
        : [];

      if (!Array.isArray(favorites)) {
        favorites = [];
      }

      if (favorite) {
        favorites =
          favorites.filter(
            (item: any) =>
              (typeof item ===
              'string'
                ? item
                : item?.slug) !==
              slug
          );
      } else {
        const name = slug
          .split('-')
          .filter(Boolean)
          .map(
            (word) =>
              word
                .charAt(0)
                .toUpperCase() +
              word.slice(1)
          )
          .join(' ');

        favorites.push({
          name,
          slug,
          image:
            poster || undefined,
        });
      }

      localStorage.setItem(
        'anime_favorites',
        JSON.stringify(
          favorites
        )
      );

      setFavorite(
        !favorite
      );
    } catch (err) {
      console.error(err);
    }
  };

  const title = slug
    .split('-')
    .filter(Boolean)
    .map(
      (word) =>
        word
          .charAt(0)
          .toUpperCase() +
        word.slice(1)
    )
    .join(' ');

  /*
   * -------------------------------------------------------
   * LOADING
   * -------------------------------------------------------
   */

  if (loading) {
    return (
      <main className="page">
        <div className="loading-page">
          <span className="loader large" />

          <p>
            Chargement des
            épisodes…
          </p>
        </div>
      </main>
    );
  }

  /*
   * -------------------------------------------------------
   * ERREUR
   * -------------------------------------------------------
   */

  if (
    error ||
    !data
  ) {
    return (
      <main className="page">
        <div className="error-card">

          <span>
            ⚠️
          </span>

          <h2>
            Impossible de
            charger cet anime
          </h2>

          <p>
            La source n'a pas
            répondu correctement.
          </p>

          <Link
            href="/"
            className="primary-button"
          >
            Retour à l'accueil
          </Link>

        </div>
      </main>
    );
  }

  /*
   * -------------------------------------------------------
   * PAGE
   * -------------------------------------------------------
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

          {poster && (
            <img
              src={poster}
              alt=""
              style={{
                position:
                  'absolute',
                width: 1,
                height: 1,
                opacity: 0,
                pointerEvents:
                  'none',
              }}
            />
          )}

          <span>
            ANIME
          </span>

          <h1>
            {title}
          </h1>

        </div>

        <button
          className={`favorite-button ${
            favorite
              ? 'is-favorite'
              : ''
          }`}
          onClick={
            toggleFavorite
          }
          aria-label="Favori"
        >
          {favorite
            ? '★'
            : '☆'}
        </button>

      </header>

      {/* ===================================================
          LECTEUR
          =================================================== */}

      <section className="player-container">

        {videoUrl ? (
          <iframe
            key={videoUrl}
            src={videoUrl}
            title={`${title} épisode ${
              episode + 1
            }`}
            allowFullScreen
            className="video-frame"
            onLoad={() => {
              /*
               * L'épisode est considéré comme vu
               * dès que son lecteur a correctement
               * été chargé.
               */
              markEpisodeAsWatched(
                episode
              );
            }}
          />
        ) : (
          <div className="player-empty">

            <span>
              ▶
            </span>

            <p>
              Lecteur indisponible
            </p>

          </div>
        )}

      </section>

      {/* ===================================================
          CONTRÔLES
          =================================================== */}

      <section className="episode-controls">

        <div className="control-row">

          <div className="segmented">

            <button
              className={
                lang ===
                'vostfr'
                  ? 'selected'
                  : ''
              }
              onClick={() => {
                setLang(
                  'vostfr'
                );
                setEpisode(0);
              }}
            >
              VOSTFR
            </button>

            {data.hasVF && (
              <button
                className={
                  lang === 'vf'
                    ? 'selected'
                    : ''
                }
                onClick={() => {
                  setLang('vf');
                  setEpisode(0);
                }}
              >
                VF
              </button>
            )}

          </div>

          <select
            value={season}
            onChange={(
              event
            ) => {
              const value =
                Number(
                  event.target
                    .value
                );

              setSeason(value);
              setEpisode(0);
            }}
          >

            {data.seasons.map(
              (number) => (
                <option
                  key={number}
                  value={number}
                >
                  Saison {number}
                </option>
              )
            )}

          </select>

        </div>

        {data.players.length >
          1 && (
          <div className="players">

            <span>
              Lecteur
            </span>

            <div className="player-list">

              {data.players.map(
                (
                  item,
                  index
                ) => (
                  <button
                    key={`${item.name}-${index}`}
                    className={
                      player ===
                      index
                        ? 'player-selected'
                        : ''
                    }
                    onClick={() => {
                      setPlayer(
                        index
                      );
                      setEpisode(
                        0
                      );
                    }}
                  >
                    {item.name}
                  </button>
                )
              )}

            </div>

          </div>
        )}

      </section>

      {/* ===================================================
          ÉPISODES
          =================================================== */}

      <section className="episodes-section">

        <div className="section-header">

          <div>

            <span className="section-eyebrow">
              SAISON {season}
            </span>

            <h2>
              Épisodes
            </h2>

          </div>

          <span className="episode-count">
            {episodes.length}
          </span>

        </div>

        <div className="episode-grid">

          {episodes.map(
            (_, index) => {

              const isWatched =
                watched.includes(
                  index
                );

              const isActive =
                episode ===
                index;

              return (
                <button
                  key={index}
                  className={[
                    'episode',
                    isActive
                      ? 'active'
                      : '',
                    isWatched
                      ? 'watched'
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => {
                    setEpisode(
                      index
                    );

                    window.scrollTo({
                      top: 0,
                      behavior:
                        'smooth',
                    });
                  }}
                >
                  {index + 1}
                </button>
              );
            }
          )}

        </div>

        {episodes.length ===
          0 && (
          <div className="empty-card">
            Aucun épisode
            disponible pour
            cette sélection.
          </div>
        )}

      </section>

    </main>
  );
}