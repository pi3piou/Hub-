'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  AnimeInfoData,
  EpisodesData,
  getAnimeName,
  getCachedEpisodes,
  getCachedInfo,
  loadAnimeInfo,
  loadEpisodes,
  prefetchEpisodes,
} from '@/lib/animeCache';

import {
  clearSeason,
  getWatchKey,
  markEpisodesUpTo,
  readProgress,
  readWatched,
  writeSeasonProgress,
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

interface SeasonProgress {
  season: number;
  watched: number;
  total: number;
  lastEpisode: number;
  updatedAt: number;
}

const WATCH_DELAY = 60000;
const LONG_PRESS = 550;

function getContinueKey(slug: string) {
  return `anime_continue_${slug}`;
}

function readContinue(
  slug: string
): ContinueItem | null {
  try {
    const raw = localStorage.getItem(
      getContinueKey(slug)
    );

    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function AnimeSeasonPage({
  params,
}: {
  params: { slug: string; saison: string };
}) {
  const router = useRouter();

  const slug = decodeURIComponent(params.slug);

  const season = Math.max(
    1,
    Number(params.saison) || 1
  );

  const [lang, setLang] =
    useState<'vostfr' | 'vf'>('vostfr');

  const [player, setPlayer] = useState(0);
  const [episode, setEpisode] = useState(0);

  const [data, setData] =
    useState<EpisodesData | null>(null);

  const [info, setInfo] =
    useState<AnimeInfoData | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [watched, setWatched] =
    useState<number[]>([]);

  const [seasonProgress, setSeasonProgress] =
    useState<SeasonProgress[]>([]);

  const [globalProgress, setGlobalProgress] =
    useState({ watched: 0, total: 0 });

  /* Appui long */
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

  /*
   * =======================================================
   * ÉPISODES
   * =======================================================
   */

  const episodes = useMemo(() => {
    if (!data?.players?.[player]) {
      return [];
    }

    return data.players[player].urls || [];
  }, [data, player]);

  const videoUrl = episodes[episode] || '';

  /*
   * =======================================================
   * LANGUE ET ÉPISODE DE DÉPART
   * =======================================================
   */

  useEffect(() => {
    const item = readContinue(slug);

    if (item && item.season === season) {
      setLang(item.lang || 'vostfr');
      setEpisode(item.episode || 0);
    } else {
      setEpisode(0);
    }
  }, [slug, season]);

  /*
   * =======================================================
   * FICHE
   * =======================================================
   */

  useEffect(() => {
    let active = true;

    const cached = getCachedInfo(slug);

    if (cached) setInfo(cached);

    loadAnimeInfo(slug)
      .then((result) => {
        if (active) setInfo(result);
      })
      .catch(() => {
        // La page reste utilisable sans la fiche
      });

    return () => {
      active = false;
    };
  }, [slug]);

  /*
   * =======================================================
   * CHARGEMENT DES ÉPISODES
   * =======================================================
   */

  useEffect(() => {
    let active = true;

    const cached = getCachedEpisodes(
      slug,
      season,
      lang
    );

    if (cached) {
      setData(cached);
      setPlayer(cached.defaultPlayerIndex || 0);
      setLoading(false);
      setError(false);
    } else {
      setLoading(true);
      setError(false);
    }

    loadEpisodes(slug, season, lang)
      .then((result) => {
        if (!active) return;

        setData(result);
        setPlayer(result.defaultPlayerIndex || 0);
        setError(false);
      })
      .catch(() => {
        if (!active) return;

        if (!cached) {
          setError(true);
          setData(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [slug, season, lang]);

  /*
   * =======================================================
   * BASCULE AUTOMATIQUE DE LANGUE
   * =======================================================
   */

  useEffect(() => {
    if (!data) return;

    if (data.lang && data.lang !== lang) {
      setLang(data.lang);
    }
  }, [data, lang]);

  /*
   * =======================================================
   * PRÉCHARGEMENT DES VOISINS
   * =======================================================
   */

  useEffect(() => {
    if (!data) return;

    if (data.hasVF) {
      prefetchEpisodes(
        slug,
        season,
        lang === 'vostfr' ? 'vf' : 'vostfr'
      );
    }

    if (info?.seasons?.includes(season + 1)) {
      prefetchEpisodes(slug, season + 1, lang);
    }
  }, [data, info, slug, season, lang]);

  /*
   * =======================================================
   * BORNAGE DE L'ÉPISODE
   * =======================================================
   */

  useEffect(() => {
    if (episodes.length === 0) return;

    if (episode >= episodes.length) {
      setEpisode(episodes.length - 1);
    }
  }, [episodes.length, episode]);

  /*
   * =======================================================
   * CONTINUER LA LECTURE
   * =======================================================
   */

  const saveContinue = (
    episodeIndex: number
  ) => {
    try {
      const item: ContinueItem = {
        slug,
        name: info?.name || getAnimeName(slug),
        image: info?.image,
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
        localStorage.getItem('anime_history');

      let history: ContinueItem[] = historyRaw
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
        'anime_history',
        JSON.stringify(history.slice(0, 20))
      );
    } catch {
      // localStorage indisponible
    }
  };

  /*
   * =======================================================
   * MARQUER VU
   * =======================================================
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

    writeSeasonProgress(slug, lang, {
      season,
      watched: next.length,
      total: episodes.length,
      lastEpisode: episodeIndex,
      updatedAt: Date.now(),
    });

    setSeasonProgress(readProgress(slug, lang));

    saveContinue(episodeIndex);
  };

  const markRef = useRef(markEpisodeAsWatched);

  useEffect(() => {
    markRef.current = markEpisodeAsWatched;
  });

  /*
   * =======================================================
   * MARQUAGE MANUEL
   * =======================================================
   */

  const markUpTo = (index: number) => {
    if (episodes.length === 0) return;

    const confirmed = window.confirm(
      `Marquer les épisodes 1 à ${
        index + 1
      } comme vus ?`
    );

    if (!confirmed) return;

    const next = markEpisodesUpTo(
      slug,
      season,
      lang,
      index,
      episodes.length
    );

    setWatched(next);
    setSeasonProgress(readProgress(slug, lang));
  };

  const toggleWholeSeason = () => {
    if (episodes.length === 0) return;

    const isComplete =
      watched.length >= episodes.length;

    if (isComplete) {
      if (
        !window.confirm(
          'Retirer la progression de cette saison ?'
        )
      ) {
        return;
      }

      clearSeason(slug, season, lang);

      setWatched([]);
      setSeasonProgress(readProgress(slug, lang));

      return;
    }

    if (
      !window.confirm(
        `Marquer les ${episodes.length} épisodes comme vus ?`
      )
    ) {
      return;
    }

    const next = markEpisodesUpTo(
      slug,
      season,
      lang,
      episodes.length - 1,
      episodes.length
    );

    setWatched(next);
    setSeasonProgress(readProgress(slug, lang));
  };

  const startPress = (index: number) => {
    longPressed.current = false;

    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;

      markUpTo(index);
    }, LONG_PRESS);
  };

  const cancelPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  useEffect(() => {
    return () => cancelPress();
  }, []);

  /*
   * =======================================================
   * ÉPISODES VUS
   * =======================================================
   */

  useEffect(() => {
    setWatched(readWatched(slug, season, lang));
  }, [slug, season, lang]);

  /*
   * =======================================================
   * PROGRESSION STOCKÉE
   * =======================================================
   */

  useEffect(() => {
    setSeasonProgress(readProgress(slug, lang));
  }, [slug, lang]);

  /*
   * =======================================================
   * PROGRESSION GLOBALE
   * =======================================================
   */

  useEffect(() => {
    let watchedTotal = 0;
    let knownTotal = 0;

    seasonProgress.forEach((item) => {
      watchedTotal += item.watched;
      knownTotal += item.total;
    });

    const currentTracked = seasonProgress.some(
      (item) => item.season === season
    );

    if (!currentTracked) {
      watchedTotal += watched.length;
      knownTotal += episodes.length;
    }

    setGlobalProgress({
      watched: watchedTotal,
      total: knownTotal,
    });
  }, [
    seasonProgress,
    watched.length,
    episodes.length,
    season,
  ]);

  /*
   * =======================================================
   * MARQUAGE APRÈS 60 SECONDES
   * =======================================================
   */

  useEffect(() => {
    if (!videoUrl) return;

    const timer = setTimeout(() => {
      markRef.current(episode);
    }, WATCH_DELAY);

    return () => clearTimeout(timer);
  }, [videoUrl, episode]);

  const title = info?.name || getAnimeName(slug);

  const seasons = info?.seasons?.length
    ? info.seasons
    : [season];

  const isSeasonComplete =
    episodes.length > 0 &&
    watched.length >= episodes.length;

  /*
   * =======================================================
   * ERREUR
   * =======================================================
   */

  if (error && !data) {
    return (
      <main className="page">
        <div className="error-card">

          <span>⚠️</span>

          <h2>Saison indisponible</h2>

          <p>
            Cette saison n&apos;existe pas dans
            cette langue.
          </p>

          <Link
            href={`/anime/${encodeURIComponent(
              slug
            )}`}
            className="primary-button"
          >
            Retour à la fiche
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
          href={`/anime/${encodeURIComponent(
            slug
          )}`}
          className="back-button"
        >
          ‹
        </Link>

        <div className="anime-title">

          <span>SAISON {season}</span>

          <h1>{title}</h1>

        </div>

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

            {loading ? (
              <>
                <span className="loader large" />
                <p>Chargement…</p>
              </>
            ) : (
              <>
                <span>▶</span>
                <p>Lecteur indisponible</p>
              </>
            )}

          </div>
        )}

      </section>

      {/* PROGRESSION */}

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
            {globalProgress.total || '—'}{' '}
            épisodes
          </strong>

        </div>

      </section>

      {/* CONTRÔLES */}

      <section className="episode-controls">

        <div className="control-row">

          <div className="segmented">

            {data?.hasVOSTFR !== false && (
              <button
                className={
                  lang === 'vostfr'
                    ? 'selected'
                    : ''
                }
                onClick={() => setLang('vostfr')}
              >
                VOSTFR
              </button>
            )}

            {data?.hasVF && (
              <button
                className={
                  lang === 'vf' ? 'selected' : ''
                }
                onClick={() => setLang('vf')}
              >
                VF
              </button>
            )}

          </div>

          <select
            value={season}
            onChange={(event) => {
              router.push(
                `/anime/${encodeURIComponent(
                  slug
                )}/${event.target.value}`
              );
            }}
          >

            {seasons.map((number) => (
              <option
                key={number}
                value={number}
              >
                Saison {number}
              </option>
            ))}

          </select>

        </div>

        {(data?.players?.length || 0) > 1 && (
          <div className="players">

            <span>Lecteur</span>

            <div className="player-list">

              {data?.players.map(
                (item, index) => (
                  <button
                    key={`${item.name}-${index}`}
                    className={
                      player === index
                        ? 'player-selected'
                        : ''
                    }
                    onClick={() =>
                      setPlayer(index)
                    }
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

          {episodes.length > 0 && (
            <button
              className="mark-button"
              onClick={toggleWholeSeason}
            >
              {isSeasonComplete
                ? 'Tout décocher'
                : 'Tout marquer'}
            </button>
          )}

        </div>

        <p className="episode-hint">
          Appui long sur un épisode pour marquer
          tous les précédents comme vus.
        </p>

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
                onPointerDown={() =>
                  startPress(index)
                }
                onPointerUp={cancelPress}
                onPointerLeave={cancelPress}
                onPointerCancel={cancelPress}
                onContextMenu={(event) =>
                  event.preventDefault()
                }
                onClick={() => {
                  /* Un appui long ne lance pas la lecture */
                  if (longPressed.current) {
                    longPressed.current = false;
                    return;
                  }

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

        {!loading && episodes.length === 0 && (
          <div className="empty-card">
            Aucun épisode disponible pour cette
            sélection.
          </div>
        )}

      </section>

    </main>
  );
}
