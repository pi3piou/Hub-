'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  AnimeInfoData,
  EpisodesData,
  getAnimeName,
  getCachedAniList,
  getCachedEpisodes,
  getCachedInfo,
  getCachedTMDB,
  loadAniList,
  loadAnimeInfo,
  loadEpisodes,
  loadTMDB,
  prefetchEpisodes,
} from '@/lib/animeCache';

import {
  clearSeason,
  markEpisodesUpTo,
  readMergedProgress,
  readWatched,
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

  /* Appui long sur un onglet de saison */
  const [markingSeason, setMarkingSeason] =
    useState<number | null>(null);

  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

  /*
   * =======================================================
   * SÉLECTEUR DE SAISON (pastille glissante) + LANGUE
   *
   * Une seule saison sélectionnée à la fois, comme un vrai
   * segmented control. Dès qu'on choisit une saison, ses
   * épisodes se chargent et s'affichent juste en dessous
   * dans un rail horizontal — pas de navigation.
   * =======================================================
   */

  const [selectedSeason, setSelectedSeason] =
    useState<number | null>(null);

  const [lang, setLang] =
    useState<'vostfr' | 'vf'>('vostfr');

  const [data, setData] =
    useState<EpisodesData | null>(null);

  const [episodesLoading, setEpisodesLoading] =
    useState(false);

  const [episodesError, setEpisodesError] =
    useState(false);

  const [watched, setWatched] =
    useState<number[]>([]);

  const episodePressTimer = useRef<number | null>(
    null
  );
  const episodeLongPressed = useRef(false);

  /* Pastille glissante du sélecteur de saison */
  const segRefs = useRef<
    Record<number, HTMLButtonElement | null>
  >({});

  const [pillStyle, setPillStyle] = useState({
    left: 0,
    width: 0,
  });

  const [pillReady, setPillReady] = useState(false);

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

  const seasonEntries = useMemo(() => {
    return info?.seasonEntries?.length
      ? info.seasonEntries
      : (info?.seasons || []).map((number) => ({
          number,
          label: `Saison ${number}`,
          langs: [] as string[],
        }));
  }, [info]);

  const firstSeason =
    seasonEntries[0]?.number || 1;

  /*
   * =======================================================
   * SAISON SÉLECTIONNÉE PAR DÉFAUT
   *
   * On reprend la saison de "Continuer la lecture" si elle
   * existe encore parmi les saisons connues, sinon la
   * première saison disponible.
   * =======================================================
   */

  useEffect(() => {
    if (!info) return;
    if (selectedSeason !== null) return;

    const hasContinueSeason =
      continueItem &&
      seasonEntries.some(
        (entry) => entry.number === continueItem.season
      );

    if (hasContinueSeason && continueItem) {
      setLang(continueItem.lang || 'vostfr');
      setSelectedSeason(continueItem.season);
    } else {
      setSelectedSeason(firstSeason);
    }
  }, [
    info,
    continueItem,
    seasonEntries,
    firstSeason,
    selectedSeason,
  ]);

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

      if (selectedSeason === seasonNumber) {
        setWatched(
          readWatched(slug, seasonNumber, lang)
        );
      }
    } finally {
      setMarkingSeason(null);
    }
  };

  /*
   * =======================================================
   * APPUI LONG — ONGLET DE SAISON
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

  const selectSeason = (seasonNumber: number) => {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }

    if (selectedSeason === seasonNumber) return;

    const initialLang =
      continueItem?.season === seasonNumber
        ? continueItem.lang || 'vostfr'
        : 'vostfr';

    setLang(initialLang);
    setSelectedSeason(seasonNumber);
  };

  /*
   * =======================================================
   * CHARGEMENT DES ÉPISODES DE LA SAISON SÉLECTIONNÉE
   * =======================================================
   */

  useEffect(() => {
    if (selectedSeason === null) return;

    let active = true;

    const cached = getCachedEpisodes(
      slug,
      selectedSeason,
      lang
    );

    if (cached) {
      setData(cached);
      setEpisodesLoading(false);
      setEpisodesError(false);
    } else {
      setData(null);
      setEpisodesLoading(true);
      setEpisodesError(false);
    }

    loadEpisodes(slug, selectedSeason, lang)
      .then((result) => {
        if (!active) return;

        setData(result);
        setEpisodesError(false);
      })
      .catch(() => {
        if (!active) return;

        if (!cached) {
          setEpisodesError(true);
          setData(null);
        }
      })
      .finally(() => {
        if (active) setEpisodesLoading(false);
      });

    return () => {
      active = false;
    };
  }, [slug, selectedSeason, lang]);

  /* Bascule automatique de langue si la source impose l'autre */
  useEffect(() => {
    if (!data) return;

    if (data.lang && data.lang !== lang) {
      setLang(data.lang);
    }
  }, [data, lang]);

  /* Épisodes déjà vus, pour la saison/langue sélectionnée */
  useEffect(() => {
    if (selectedSeason === null) {
      setWatched([]);
      return;
    }

    setWatched(
      readWatched(slug, selectedSeason, lang)
    );
  }, [slug, selectedSeason, lang]);

  const episodeCount = useMemo(() => {
    if (!data) return 0;

    const list =
      data.players?.[data.defaultPlayerIndex || 0]
        ?.urls;

    return list?.length || data.totalEpisodes || 0;
  }, [data]);

  /*
   * =======================================================
   * PASTILLE GLISSANTE DU SÉLECTEUR DE SAISON
   * =======================================================
   */

  useEffect(() => {
    if (selectedSeason === null) return;

    const measure = () => {
      const button = segRefs.current[selectedSeason];

      if (!button) return;

      setPillStyle({
        left: button.offsetLeft,
        width: button.offsetWidth,
      });

      if (!pillReady) {
        window.requestAnimationFrame(() => {
          setPillReady(true);
        });
      }
    };

    measure();

    window.addEventListener('resize', measure);

    return () => {
      window.removeEventListener('resize', measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSeason, seasonEntries.length]);

  /*
   * =======================================================
   * APPUI SUR UN ÉPISODE → LECTEUR
   *
   * On réutilise le mécanisme "continuer la lecture" déjà
   * lu par la page /anime/[slug]/[saison] au montage :
   * il suffit d'écrire la même entrée localStorage avant
   * de naviguer, sans toucher à cette page-là.
   * =======================================================
   */

  const openEpisode = (episodeIndex: number) => {
    if (episodeLongPressed.current) {
      episodeLongPressed.current = false;
      return;
    }

    if (selectedSeason === null) return;

    try {
      const item: ContinueItem = {
        slug,
        name: info?.name || getAnimeName(slug),
        image: info?.image,
        season: selectedSeason,
        episode: episodeIndex,
        lang,
        updatedAt: Date.now(),
      };

      localStorage.setItem(
        `anime_continue_${slug}`,
        JSON.stringify(item)
      );

      const historyRaw = localStorage.getItem(
        'anime_history'
      );

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

    router.push(
      `/anime/${encodeURIComponent(
        slug
      )}/${selectedSeason}`
    );
  };

  /*
   * =======================================================
   * MARQUAGE DEPUIS LE RAIL D'ÉPISODES
   * =======================================================
   */

  const markUpTo = (episodeIndex: number) => {
    if (
      selectedSeason === null ||
      episodeCount === 0
    ) {
      return;
    }

    const confirmed = window.confirm(
      `Marquer les épisodes 1 à ${
        episodeIndex + 1
      } comme vus ?`
    );

    if (!confirmed) return;

    const next = markEpisodesUpTo(
      slug,
      selectedSeason,
      lang,
      episodeIndex,
      episodeCount
    );

    setWatched(next);
    setProgress(readMergedProgress(slug));
  };

  const toggleWholeSeason = () => {
    if (
      selectedSeason === null ||
      episodeCount === 0
    ) {
      return;
    }

    const isComplete =
      watched.length >= episodeCount;

    if (isComplete) {
      if (
        !window.confirm(
          'Retirer la progression de cette saison ?'
        )
      ) {
        return;
      }

      clearSeason(slug, selectedSeason, lang);

      setWatched([]);
      setProgress(readMergedProgress(slug));

      return;
    }

    if (
      !window.confirm(
        `Marquer les ${episodeCount} épisodes comme vus ?`
      )
    ) {
      return;
    }

    const next = markEpisodesUpTo(
      slug,
      selectedSeason,
      lang,
      episodeCount - 1,
      episodeCount
    );

    setWatched(next);
    setProgress(readMergedProgress(slug));
  };

  const startEpisodePress = (
    episodeIndex: number
  ) => {
    episodeLongPressed.current = false;

    episodePressTimer.current = window.setTimeout(
      () => {
        episodeLongPressed.current = true;

        markUpTo(episodeIndex);
      },
      LONG_PRESS
    );
  };

  const cancelEpisodePress = () => {
    if (episodePressTimer.current !== null) {
      window.clearTimeout(
        episodePressTimer.current
      );
      episodePressTimer.current = null;
    }
  };

  useEffect(() => {
    return () => {
      cancelPress();
      cancelEpisodePress();
    };
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
          SAISON + LANGUE — pastille glissante,
          exactement le même composant que la tab bar
          =================================================== */}

      <section className="section">

        <div className="section-header">

          <div>

            <span className="section-eyebrow">
              SAISON {selectedSeason ?? ''}
            </span>

            <h2>Épisodes</h2>

          </div>

          {episodeCount > 0 && (
            <button
              className="mark-button"
              onClick={toggleWholeSeason}
            >
              {watched.length >= episodeCount
                ? 'Tout décocher'
                : 'Tout marquer'}
            </button>
          )}

        </div>

        <div
          className="seg"
          role="tablist"
          aria-label="Saison"
        >

          <span
            className="pill"
            style={{
              left: pillStyle.left,
              width: pillStyle.width,
              transition: pillReady
                ? 'left 0.32s cubic-bezier(0.4, 0, 0.2, 1), width 0.32s cubic-bezier(0.4, 0, 0.2, 1)'
                : 'none',
            }}
          />

          {seasonEntries.map((entry) => {

            const item = progress.get(entry.number);

            const isDone =
              (item?.total || 0) > 0 &&
              (item?.watched || 0) >= (item?.total || 0);

            return (
              <button
                key={entry.number}
                ref={(el) => {
                  segRefs.current[entry.number] = el;
                }}
                role="tab"
                aria-selected={
                  selectedSeason === entry.number
                }
                className={[
                  'segtab',
                  isDone ? 'is-done' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
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
                  selectSeason(entry.number)
                }
              >
                {markingSeason === entry.number
                  ? '…'
                  : entry.label}
              </button>
            );
          })}

        </div>

        {(data?.hasVOSTFR !== false ||
          data?.hasVF) && (
          <div className="segmented season-lang-row">

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
        )}

        <p className="episode-hint">
          Appui long sur un épisode pour marquer
          tous les précédents comme vus, appui long
          sur une saison pour la marquer entièrement
          comme vue.
        </p>

        {episodesLoading && episodeCount === 0 ? (
          <div className="loading-row">
            <span className="loader" />
            <span>Chargement…</span>
          </div>
        ) : episodeCount > 0 ? (
          <div className="rail">

            {Array.from({
              length: episodeCount,
            }).map((_, index) => {

              const isWatched =
                watched.includes(index);

              const isActive =
                continueItem?.season ===
                  selectedSeason &&
                continueItem?.lang === lang &&
                continueItem?.episode === index;

              return (
                <button
                  key={index}
                  className={[
                    'tile',
                    'tile--wide',
                    isActive ? 'tile--active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onPointerDown={() =>
                    startEpisodePress(index)
                  }
                  onPointerUp={cancelEpisodePress}
                  onPointerLeave={cancelEpisodePress}
                  onPointerCancel={cancelEpisodePress}
                  onContextMenu={(event) =>
                    event.preventDefault()
                  }
                  onClick={() => openEpisode(index)}
                >

                  <span
                    className="tile__art"
                    style={
                      info.image
                        ? {
                            backgroundImage: `url(${info.image})`,
                          }
                        : undefined
                    }
                  >

                    <span className="tile__over">

                      <span className="tile__ep">
                        Ép. {index + 1}
                      </span>

                      {isWatched && (
                        <span className="tile__check">
                          ✓
                        </span>
                      )}

                    </span>

                    <span className="tile__prog">
                      <i
                        style={{
                          width: isWatched
                            ? '100%'
                            : '0%',
                        }}
                      />
                    </span>

                  </span>

                </button>
              );
            })}

          </div>
        ) : (
          !episodesLoading && (
            <div className="empty-card">
              {episodesError
                ? 'Impossible de charger les épisodes.'
                : 'Aucun épisode disponible pour cette sélection.'}
            </div>
          )
        )}

      </section>

    </main>
  );
}
