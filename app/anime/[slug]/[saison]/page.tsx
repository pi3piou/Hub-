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

function getWatchKey(
  slug: string,
  season: number,
  lang: string
) {
  return `anime_watched_${slug}_s${season}_${lang}`;
}

function getProgressKey(
  slug: string,
  lang: string
) {
  return `anime_progress_${slug}_${lang}`;
}

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
   *
   * Si une lecture est en cours sur cette saison,
   * on reprend la langue et l'épisode enregistrés.
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
   * FICHE (titre, saisons)
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
      /*
       * Déjà préchargé depuis la fiche :
       * aucun écran d'attente.
       */
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
   * BASCULE AUTOMATIQUE DE LANGUE
   *
   * Certains animes n'existent qu'en VF : l'API nous
   * renvoie alors la langue disponible.
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
   * PROGRESSION SAISON
   * =======================================================
   */

  const updateSeasonProgress = (
    episodeNumber: number,
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
        season,
        watched: watchedEpisodes.length,
        total: episodes.length,
        lastEpisode: episodeNumber,
        updatedAt: Date.now(),
      };

      const exists = progress.some(
        (item) => item.season === season
      );

      progress = exists
        ? progress.map((item) =>
            item.season === season
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

    updateSeasonProgress(episodeIndex, next);

    saveContinue(episodeIndex);
  };

  const markRef = useRef(markEpisodeAsWatched);

  useEffect(() => {
    markRef.current = markEpisodeAsWatched;
  });

  /*
   * =======================================================
   * ÉPISODES VUS
   * =======================================================
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
   * =======================================================
   * PROGRESSION STOCKÉE
   * =======================================================
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

      {/* ===================================================
          PROGRESSION
          =================================================== */}

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

      {/* ===================================================
          CONTRÔLES
          =================================================== */}

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

      {/* ===================================================
          ÉPISODES
          =================================================== */}

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
