'use client';

import Link from 'next/link';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

interface Player {
  name: string;
  urls: string[];
}

interface AnimeInfo {
  title: string;
  description: string;
  image: string;
  genres: string[];
  status: string;
  year: string;
  type: string;
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
  info: AnimeInfo;
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

/*
 * Délai avant de considérer un épisode
 * comme réellement regardé (60 secondes).
 */
const WATCH_DELAY = 60000;

function getWatchKey(
  slug: string,
  season: number,
  lang: string
) {
  return `anime_watched_${slug}_s${season}_${lang}`;
}

/*
 * La clé de progression inclut désormais
 * la langue, comme la clé des épisodes vus.
 */
function getProgressKey(
  slug: string,
  lang: string
) {
  return `anime_progress_${slug}_${lang}`;
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

/*
 * Normalise les favoris : l'ancien format
 * stockait des chaînes, le nouveau des objets.
 */
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

  /*
   * -------------------------------------------------------
   * ÉPISODES (dérivé — doit rester avant les effets
   * qui utilisent episodes.length en dépendance)
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
   * ÉCRITURES localStorage
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
        (entry) => entry.slug !== slug
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

  const updateSeasonProgress = (
    seasonNumber: number,
    episodeNumber: number,
    totalEpisodes: number,
    watchedEpisodes: number[]
  ) => {
    try {
      const key = getProgressKey(slug, lang);

      const raw = localStorage.getItem(key);

      let progress: SeasonProgress[] = raw
        ? JSON.parse(raw)
        : [];

      if (!Array.isArray(progress)) {
        progress = [];
      }

      const updated: SeasonProgress = {
        season: seasonNumber,
        watched: watchedEpisodes.length,
        total: totalEpisodes,
        lastEpisode: episodeNumber,
        updatedAt: Date.now(),
      };

      const exists = progress.some(
        (item) =>
          item.season === seasonNumber
      );

      progress = exists
        ? progress.map((item) =>
            item.season === seasonNumber
              ? updated
              : item
          )
        : [...progress, updated];

      progress.sort(
        (a, b) => a.season - b.season
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
   * Effets de bord sortis de l'updater :
   * on calcule d'abord, on écrit ensuite.
   */
  const markEpisodeAsWatched = (
    episodeIndex: number
  ) => {
    if (watched.includes(episodeIndex)) {
      saveContinue(episodeIndex);
      return;
    }

    const next = [
      ...watched,
      episodeIndex,
    ].sort((a, b) => a - b);

    setWatched(next);

    try {
      localStorage.setItem(
        getWatchKey(slug, season, lang),
        JSON.stringify(next)
      );
    } catch {
      // localStorage indisponible
    }

    updateSeasonProgress(
      season,
      episodeIndex,
      episodes.length,
      next
    );

    saveContinue(episodeIndex);
  };

  /*
   * Référence toujours à jour, pour que le
   * minuteur n'ait pas à dépendre de la fonction.
   */
  const markRef = useRef(markEpisodeAsWatched);

  useEffect(() => {
    markRef.current = markEpisodeAsWatched;
  });

  /*
   * -------------------------------------------------------
   * PROGRESSION STOCKÉE
   * -------------------------------------------------------
   */

  useEffect(() => {
    try {
      const raw = localStorage.getItem(
        getProgressKey(slug, lang)
      );

      if (!raw) {
        setSeasonProgress([]);
        return;
      }

      const parsed = JSON.parse(raw);

      setSeasonProgress(
        Array.isArray(parsed) ? parsed : []
      );
    } catch {
      setSeasonProgress([]);
    }
  }, [slug, lang]);

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
            (item: { slug?: string }) =>
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
    const favorites = readFavorites();

    const current = favorites.find(
      (item) => item.slug === slug
    );

    if (current?.image) {
      setPoster(current.image);
    }

    setFavorite(Boolean(current));
  }, [slug]);

  /*
   * -------------------------------------------------------
   * ÉPISODES VUS
   * -------------------------------------------------------
   */

  useEffect(() => {
    try {
      const raw = localStorage.getItem(
        getWatchKey(slug, season, lang)
      );

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

        setPlayer(
          Number.isInteger(
            json.defaultPlayerIndex
          )
            ? json.defaultPlayerIndex
            : 0
        );
      } catch (err) {
        if (
          (err as Error).name !== 'AbortError'
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
   * SYNCHRO DU TOTAL D'ÉPISODES
   * -------------------------------------------------------
   */

  useEffect(() => {
    if (!data || episodes.length === 0) return;

    const current = seasonProgress.find(
      (item) => item.season === season
    );

    if (
      !current ||
      current.total === episodes.length
    ) {
      return;
    }

    const progress = seasonProgress.map(
      (item) =>
        item.season === season
          ? { ...item, total: episodes.length }
          : item
    );

    try {
      localStorage.setItem(
        getProgressKey(slug, lang),
        JSON.stringify(progress)
      );
    } catch {
      // localStorage indisponible
    }

    setSeasonProgress(progress);
  }, [
    data,
    episodes.length,
    season,
    seasonProgress,
    slug,
    lang,
  ]);

  /*
   * -------------------------------------------------------
   * PROGRESSION GLOBALE
   * -------------------------------------------------------
   */

  useEffect(() => {
    let watchedTotal = 0;
    let knownTotal = 0;

    seasonProgress.forEach((item) => {
      watchedTotal += item.watched;
      knownTotal += item.total;
    });

    /*
     * La saison courante n'est pas encore
     * enregistrée : on ajoute son décompte local.
     */
    const currentTracked = seasonProgress.some(
      (item) => item.season === season
    );

    if (!currentTracked) {
      watchedTotal += watched.length;
      knownTotal += episodes.length;
    }

    /*
     * Le dénominateur vient de l'API quand
     * il est plus complet que ce qu'on connaît.
     */
    const total =
      data?.totalEpisodes &&
      data.totalEpisodes > knownTotal
        ? data.totalEpisodes
        : knownTotal;

    setGlobalProgress({
      watched: watchedTotal,
      total,
    });
  }, [
    seasonProgress,
    watched.length,
    episodes.length,
    season,
    data,
  ]);

  /*
   * -------------------------------------------------------
   * MARQUAGE APRÈS VISIONNAGE RÉEL
   * -------------------------------------------------------
   */

  useEffect(() => {
    if (!videoUrl) return;

    const timer = setTimeout(() => {
      markRef.current(episode);
    }, WATCH_DELAY);

    return () => clearTimeout(timer);
  }, [videoUrl, episode]);

  /*
   * -------------------------------------------------------
   * FAVORI
   * -------------------------------------------------------
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
              name: getAnimeName(slug),
              slug,
              image: poster || undefined,
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
          <p>Chargement des épisodes…</p>
        </div>
      </main>
    );
  }

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
            favorite ? 'is-favorite' : ''
          }`}
          onClick={toggleFavorite}
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
          />
        ) : (
          <div className="player-empty">
            <span>▶</span>
            <p>Lecteur indisponible</p>
          </div>
        )}

      </section>

{/* FICHE ANIME */}

<section className="anime-details">

  {data.info.image && (
    <div className="anime-details-poster">
      <img
        src={data.info.image}
        alt={data.info.title || title}
      />
    </div>
  )}

  <div className="anime-details-content">

    <span className="section-eyebrow">
      FICHE ANIME
    </span>

    <h2>
      {data.info.title || title}
    </h2>

    <div className="anime-meta">

      {data.info.year && (
        <span>
          {data.info.year}
        </span>
      )}

      {data.info.type && (
        <span>
          {data.info.type}
        </span>
      )}

      {data.info.status && (
        <span>
          {data.info.status}
        </span>
      )}

      <span>
        {data.totalSeasons}{' '}
        {data.totalSeasons > 1
          ? 'saisons'
          : 'saison'}
      </span>

    </div>

    {data.info.genres.length > 0 && (
      <div className="anime-genres">

        {data.info.genres.map(
          (genre) => (
            <span key={genre}>
              {genre}
            </span>
          )
        )}

      </div>
    )}

    {data.info.description && (
      <p className="anime-description">
        {data.info.description}
      </p>
    )}

  </div>

</section>

      {/* INFO PROGRESSION */}

      <section className="anime-progress">

        <div className="progress-title">

          <div>
            <span className="section-eyebrow">
              PROGRESSION
            </span>

            <strong>Saison {season}</strong>
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

          <span>Progression totale</span>

          <strong>
            {globalProgress.watched} /{' '}
            {globalProgress.total || '—'}
            {' épisodes'}
          </strong>

        </div>

        <div className="season-progress-list">

          {data.seasons.map((seasonNumber) => {

            const item = seasonProgress.find(
              (progress) =>
                progress.season === seasonNumber
            );

            const isCurrent =
              season === seasonNumber;

            const watchedCount = isCurrent
              ? watched.length
              : item?.watched || 0;

            const totalCount = isCurrent
              ? episodes.length
              : item?.total || 0;

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
                  isCurrent
                    ? 'season-progress active'
                    : 'season-progress'
                }
                onClick={() => {
                  setSeason(seasonNumber);
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
          })}

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
              setSeason(
                Number(event.target.value)
              );

              setEpisode(0);
            }}
          >

            {data.seasons.map((number) => (
              <option
                key={number}
                value={number}
              >
                Saison {number}
              </option>
            ))}

          </select>

        </div>

        {data.players.length > 1 && (
          <div className="players">

            <span>Lecteur</span>

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
  const currentEpisode =
    episode;

  setPlayer(index);

  const newPlayerEpisodes =
    data.players[index]?.urls || [];

  if (
    newPlayerEpisodes.length === 0
  ) {
    return;
  }

  if (
    currentEpisode >=
    newPlayerEpisodes.length
  ) {
    setEpisode(
      newPlayerEpisodes.length - 1
    );
  }
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

            <h2>Épisodes</h2>
          </div>

          <span className="episode-count">
            {episodes.length}
          </span>

        </div>

        <div className="episode-grid">

          {episodes.map((_, index) => {

            const isWatched =
              watched.includes(index);

            const isActive = episode === index;

            return (
              <button
                key={index}
                className={[
                  'episode',
                  isActive ? 'active' : '',
                  isWatched ? 'watched' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => {
                  setEpisode(index);

                  saveContinue(index);

                  window.scrollTo({
                    top: 0,
                    behavior: 'smooth',
                  });
                }}
              >
                {index + 1}
              </button>
            );
          })}

        </div>

        {episodes.length === 0 && (
          <div className="empty-card">
            Aucun épisode disponible pour
            cette sélection.
          </div>
        )}

      </section>

    </main>
  );
}
