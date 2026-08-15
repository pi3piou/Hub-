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

interface ContinueItem {
  slug: string;
  name: string;
  image?: string;
  season: number;
  episode: number;
  lang: 'vostfr' | 'vf';
  updatedAt: number;
}

function getWatchKey(
  slug: string,
  season: number,
  lang: string
) {
  return `anime_watched_${slug}_s${season}_${lang}`;
}

function getContinueKey(slug: string) {
  return `anime_continue_${slug}`;
}

function getHistoryKey() {
  return 'anime_history';
}

function getAnimeName(slug: string) {
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

function getProgressKey(slug: string) {
  return `anime_progress_${slug}`;
}

interface SeasonProgress {
  season: number;
  watched: number;
  total: number;
  lastEpisode: number;
  updatedAt: number;
}


export default function AnimePage({
  params,
}: {
  params: { slug: string };
}) {
  const slug = decodeURIComponent(params.slug);

  const [lang, setLang] =
    useState<'vostfr' | 'vf'>('vostfr');

  const [season, setSeason] = useState(1);
  const [player, setPlayer] = useState(0);
  const [episode, setEpisode] = useState(0);

  const [data, setData] =
    useState<AnimeData | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [favorite, setFavorite] = useState(false);
  const [poster, setPoster] = useState('');

  const [watched, setWatched] =
    useState<number[]>([]);

const [seasonProgress, setSeasonProgress] =
  useState<SeasonProgress[]>([]);

const [globalProgress, setGlobalProgress] =
  useState({
    watched: 0,
    total: 0,
  });

useEffect(() => {
  try {
    const raw = localStorage.getItem(
      getProgressKey(slug)
    );

    if (!raw) {
      setSeasonProgress([]);
      return;
    }

    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      setSeasonProgress(parsed);
    }
  } catch {
    setSeasonProgress([]);
  }
}, [slug]);


const updateSeasonProgress = (
  seasonNumber: number,
  episodeNumber: number,
  totalEpisodes: number,
  watchedEpisodes: number[]
) => {
  try {
    const key = getProgressKey(slug);

    const raw =
      localStorage.getItem(key);

    let progress: SeasonProgress[] =
      raw ? JSON.parse(raw) : [];

    if (!Array.isArray(progress)) {
      progress = [];
    }

    const existing =
      progress.find(
        (item) =>
          item.season ===
          seasonNumber
      );

    const updated: SeasonProgress = {
      season: seasonNumber,
      watched:
        watchedEpisodes.length,
      total: totalEpisodes,
      lastEpisode:
        episodeNumber,
      updatedAt: Date.now(),
    };

    if (existing) {
      progress =
        progress.map((item) =>
          item.season ===
          seasonNumber
            ? updated
            : item
        );
    } else {
      progress.push(updated);
    }

    progress.sort(
      (a, b) =>
        a.season - b.season
    );

    localStorage.setItem(
      key,
      JSON.stringify(progress)
    );

    setSeasonProgress(progress);

  } catch {
    // localStorage indisponible
  }
};

  /*
   * -------------------------------------------------------
   * AFFICHE
   * -------------------------------------------------------
   */

  useEffect(() => {
    const controller = new AbortController();

    async function loadPoster() {
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(
            slug.replace(/-/g, ' ')
          )}`,
          {
            signal: controller.signal,
            cache: 'no-store',
          }
        );

        if (!response.ok) return;

        const json = await response.json();

        if (Array.isArray(json.results)) {
          const exact = json.results.find(
            (item: any) =>
              item.slug === slug
          );

          if (exact?.image) {
            setPoster(exact.image);
          }
        }
      } catch {
        // Rien
      }
    }

    loadPoster();

    return () => controller.abort();
  }, [slug]);

  /*
   * -------------------------------------------------------
   * FAVORIS
   * -------------------------------------------------------
   */

  useEffect(() => {
    try {
      const raw = localStorage.getItem(
        'anime_favorites'
      );

      if (!raw) return;

      const favorites = JSON.parse(raw);

      if (!Array.isArray(favorites)) return;

      const current = favorites.find(
        (item) =>
          typeof item === 'string'
            ? item === slug
            : item?.slug === slug
      );

      if (
        current &&
        typeof current === 'object' &&
        current.image
      ) {
        setPoster(current.image);
      }

      setFavorite(Boolean(current));
    } catch {
      setFavorite(false);
    }
  }, [slug]);

  /*
   * -------------------------------------------------------
   * ÉPISODES VUS
   * -------------------------------------------------------
   */

  useEffect(() => {
    try {
      const key = getWatchKey(
        slug,
        season,
        lang
      );

      const raw = localStorage.getItem(key);

      if (!raw) {
        setWatched([]);
        return;
      }

      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        setWatched(
          parsed
            .map(Number)
            .filter(
              (number) =>
                Number.isInteger(number) &&
                number >= 0
            )
        );
      } else {
        setWatched([]);
      }
    } catch {
      setWatched([]);
    }
  }, [slug, season, lang]);





  /*
   * -------------------------------------------------------
   * CHARGEMENT ANIME
   * -------------------------------------------------------
   */

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(false);

      try {
        const response = await fetch(
          `/api/anime?slug=${encodeURIComponent(
            slug
          )}&saison=${season}&lang=${lang}`,
          {
            signal: controller.signal,
            cache: 'no-store',
          }
        );

        if (!response.ok) {
          throw new Error(
            'Impossible de charger l’anime'
          );
        }

        const json = await response.json();

        if (json.error) {
          throw new Error(json.error);
        }

        setData(json);

        const defaultPlayer =
          Number.isInteger(
            json.defaultPlayerIndex
          )
            ? json.defaultPlayerIndex
            : 0;

        setPlayer(defaultPlayer);
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
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    load();

    return () => controller.abort();
  }, [slug, season, lang]);

  /*
   * -------------------------------------------------------
   * ÉPISODES
   * -------------------------------------------------------
   */

  const episodes = useMemo(() => {
    if (!data?.players?.[player]) {
      return [];
    }

    return data.players[player].urls || [];
  }, [data, player]);

  const videoUrl = episodes[episode] || '';

  /*
   * -------------------------------------------------------
   * CONTINUER LA LECTURE
   * -------------------------------------------------------
   */

  const saveContinue = (
    episodeIndex: number
  ) => {
    try {
      const item: ContinueItem = {
        slug,
        name: getAnimeName(slug),
        image: poster || undefined,
        season,
        episode: episodeIndex,
        lang,
        updatedAt: Date.now(),
      };

      localStorage.setItem(
        getContinueKey(slug),
        JSON.stringify(item)
      );

      const historyRaw =
        localStorage.getItem(
          getHistoryKey()
        );

      let history: ContinueItem[] =
        historyRaw
          ? JSON.parse(historyRaw)
          : [];

      if (!Array.isArray(history)) {
        history = [];
      }

      history = history.filter(
        (item) =>
          item.slug !== slug
      );

      history.unshift(item);

      localStorage.setItem(
        getHistoryKey(),
        JSON.stringify(
          history.slice(0, 20)
        )
      );
    } catch {
      // localStorage indisponible
    }
  };

  /*
   * -------------------------------------------------------
   * MARQUER COMME VU
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

      updateSeasonProgress(
        season,
        episodeIndex,
        episodes.length,
        next
      );

      saveContinue(
        episodeIndex
      );

      return next;
    });

  } catch {
    // Rien
  }
};

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
              (typeof item === 'string'
                ? item
                : item?.slug) !== slug
          );
      } else {
        favorites.push({
          name: getAnimeName(slug),
          slug,
          image: poster || undefined,
        });
      }

      localStorage.setItem(
        'anime_favorites',
        JSON.stringify(favorites)
      );

      setFavorite(!favorite);
    } catch (err) {
      console.error(err);
    }
  };

  const title = getAnimeName(slug);

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
            Chargement des épisodes…
          </p>
        </div>
      </main>
    );
  }

useEffect(() => {
  if (!data) return;

  try {
    const progress: SeasonProgress[] =
      seasonProgress.map(
        (item) => ({
          ...item,
        })
      );

    const current =
      progress.find(
        (item) =>
          item.season === season
      );

    if (
      current &&
      current.total !==
        episodes.length
    ) {
      current.total =
        episodes.length;

      localStorage.setItem(
        getProgressKey(slug),
        JSON.stringify(progress)
      );

      setSeasonProgress(progress);
    }
  } catch {
    // Rien
  }
}, [
  data,
  episodes.length,
  season,
]);

useEffect(() => {
  let watchedTotal = 0;
  let episodeTotal = 0;

  seasonProgress.forEach(
    (item) => {
      watchedTotal += item.watched;
      episodeTotal += item.total;
    }
  );

  if (
    seasonProgress.length === 0 &&
    episodes.length > 0
  ) {
    episodeTotal =
      episodes.length;
    watchedTotal =
      watched.length;
  }

  setGlobalProgress({
    watched: watchedTotal,
    total: episodeTotal,
  });
}, [
  seasonProgress,
  episodes.length,
  watched.length,
]);


  /*
   * -------------------------------------------------------
   * ERREUR
   * -------------------------------------------------------
   */

  if (error || !data) {
    return (
      <main className="page">
        <div className="error-card">
          <span>⚠️</span>

          <h2>
            Impossible de charger
            cet anime
          </h2>

          <p>
            La source n'a pas répondu
            correctement.
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
          <span>ANIME</span>

          <h1>{title}</h1>
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
          {favorite ? '★' : '☆'}
        </button>

      </header>

      {/* LECTEUR */}

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
              markEpisodeAsWatched(
                episode
              );
            }}
          />
        ) : (
          <div className="player-empty">
            <span>▶</span>
            <p>
              Lecteur indisponible
            </p>
          </div>
        )}

      </section>

      {/* INFO PROGRESSION */}

 <section className="anime-progress">

  <div className="progress-title">

    <div>
      <span className="section-eyebrow">
        PROGRESSION
      </span>

      <strong>
        Saison {season}
      </strong>
    </div>

    <strong>
      {watched.length} / {episodes.length}
    </strong>

  </div>

  <div className="progress-track">

    <div
      className="progress-value"
      style={{
        width: `${
          episodes.length
            ? Math.min(
                100,
                (watched.length /
                  episodes.length) *
                  100
              )
            : 0
        }%`,
      }}
    />

  </div>

  <div className="global-progress">

    <span>
      Progression totale
    </span>

    <strong>
      {globalProgress.watched} /{' '}
      {globalProgress.total}
      {' épisodes'}
    </strong>

  </div>

  <div className="season-progress-list">

    {data.seasons.map(
      (seasonNumber) => {

        const item =
          seasonProgress.find(
            (progress) =>
              progress.season ===
              seasonNumber
          );

        const watchedCount =
          item?.watched || 0;

        const totalCount =
          item?.total || 0;

        const percentage =
          totalCount > 0
            ? Math.min(
                100,
                (watchedCount /
                  totalCount) *
                  100
              )
            : 0;

        return (
          <button
            key={seasonNumber}
            className={
              season ===
              seasonNumber
                ? 'season-progress active'
                : 'season-progress'
            }
            onClick={() => {
              setSeason(
                seasonNumber
              );

              setEpisode(0);
            }}
          >

            <div className="season-progress-top">

              <span>
                Saison {seasonNumber}
              </span>

              <strong>
                {watchedCount}/
                {totalCount || '—'}
              </strong>

            </div>

            <div className="season-progress-track">

              <span
                style={{
                  width: `${percentage}%`,
                }}
              />

            </div>

          </button>
        );
      }
    )}

  </div>

</section>

      {/* CONTRÔLES */}

      <section className="episode-controls">

        <div className="control-row">

          <div className="segmented">

            <button
              className={
                lang === 'vostfr'
                  ? 'selected'
                  : ''
              }
              onClick={() => {
                setLang('vostfr');
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
            onChange={(event) => {
              const value =
                Number(
                  event.target.value
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

        {data.players.length > 1 && (
          <div className="players">

            <span>
              Lecteur
            </span>

            <div className="player-list">

              {data.players.map(
                (item, index) => (
                  <button
                    key={`${item.name}-${index}`}
                    className={
                      player === index
                        ? 'player-selected'
                        : ''
                    }
                    onClick={() => {
                      setPlayer(index);
                      setEpisode(0);
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

      {/* ÉPISODES */}

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
                episode === index;

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
                    setEpisode(index);

                    saveContinue(index);

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

        {episodes.length === 0 && (
          <div className="empty-card">
            Aucun épisode disponible
            pour cette sélection.
          </div>
        )}

      </section>

    </main>
  );
}