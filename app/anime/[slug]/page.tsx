'use client';

import Link from 'next/link';
import {
  Component,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

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
  getWatchKey,
  markEpisodesUpTo,
  readMergedProgress,
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
const WATCH_DELAY = 60000;

/* Distance de défilement au-delà de laquelle l'affiche
   plein écran cède la place au titre compact en haut. */
const COMPACT_THRESHOLD = 220;

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
 * =========================================================
 * FILETS DE SÉCURITÉ
 *
 * Deux niveaux : un autour du seul bloc épisodes (n'affecte
 * pas le reste de la fiche si ça casse), et un autour de
 * TOUTE la page (sinon une erreur ailleurs — sélecteur de
 * langue, lecteur, menu de saison — fait planter toute
 * l'appli avec un écran blanc). Les deux affichent un
 * message récupérable au lieu d'un vide silencieux.
 * =========================================================
 */

class EpisodesBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown) {
    return {
      error:
        error instanceof Error
          ? error.message
          : String(error),
    };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="empty-card">
          Erreur d’affichage des épisodes :{' '}
          {this.state.error}
        </div>
      );
    }

    return this.props.children;
  }
}

class PageBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown) {
    return {
      error:
        error instanceof Error
          ? error.message
          : String(error),
    };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="page">
          <div className="error-card">

            <span>⚠️</span>

            <h2>Un problème est survenu</h2>

            <p>{this.state.error}</p>

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

    return this.props.children;
  }
}

function AnimeInfoPageContent({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: { season?: string; episode?: string };
}) {
  const slug = decodeURIComponent(params.slug);

  /*
   * Une carte "Continuer" ou "Prochaines sorties" sur
   * l'accueil peut suggérer une saison précise via
   * ?season=N — utile ici puisqu'on ne navigue plus vers
   * une page dédiée par saison. Le bouton "Reprendre" de
   * l'accueil ajoute aussi ?episode=N : dans ce cas, on
   * ouvre directement le lecteur sur ce numéro d'épisode
   * au lieu de simplement révéler la liste de la saison.
   */
  const requestedSeason = searchParams?.season
    ? Number(searchParams.season)
    : null;

  const requestedEpisode = searchParams?.episode
    ? Number(searchParams.episode)
    : null;

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

  /* Appui long sur une ligne du menu de saison */
  const [markingSeason, setMarkingSeason] =
    useState<number | null>(null);

  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

  /*
   * =======================================================
   * SAISON ACTIVE — une seule à la fois, choisie via le
   * petit menu déroulant "Saison X ›", comme sur Apple TV+.
   * Jamais de liste de cartes empilées : la fiche montre
   * toujours exactement une saison, ses épisodes en dessous.
   * =======================================================
   */

  const [activeSeason, setActiveSeason] =
    useState<number | null>(null);

  const [seasonMenuOpen, setSeasonMenuOpen] =
    useState(false);

  const seasonPickerRef =
    useRef<HTMLDivElement | null>(null);

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

  /*
   * =======================================================
   * LECTEUR — reste sur la même page, jamais de
   * navigation vers une autre route pour lire un épisode
   * =======================================================
   */

  const [selectedEpisode, setSelectedEpisode] =
    useState<number | null>(null);

  const [playerIndex, setPlayerIndex] = useState(0);

  const playerSectionRef =
    useRef<HTMLDivElement | null>(null);

  /*
   * =======================================================
   * AFFICHE PLEIN ÉCRAN — étirement élastique quand on
   * tire vers le bas en haut de page, léger rétrécissement
   * en parallaxe en scrollant, titre qui glisse dans une
   * barre compacte une fois l'affiche quittée.
   * =======================================================
   */

  const heroFrameRef = useRef<HTMLDivElement | null>(
    null
  );

  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    let ticking = false;

    const update = () => {
      ticking = false;

      const y = window.scrollY;
      const frame = heroFrameRef.current;

      if (frame) {
        if (y < 0) {
          const scale =
            1 + (Math.min(-y, 260) / 260) * 0.35;

          frame.style.transform = `scale(${scale})`;
        } else {
          const shift = Math.min(y * 0.25, 90);
          const scale = Math.max(1 - y / 1600, 0.94);

          frame.style.transform = `translateY(${-shift}px) scale(${scale})`;
        }
      }

      setIsCompact((prev) => {
        if (y > COMPACT_THRESHOLD && !prev) return true;

        if (y < COMPACT_THRESHOLD - 40 && prev) {
          return false;
        }

        return prev;
      });
    };

    const handleScroll = () => {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    };

    window.addEventListener('scroll', handleScroll, {
      passive: true,
    });

    update();

    return () => {
      window.removeEventListener(
        'scroll',
        handleScroll
      );
    };
  }, []);

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

  const activeEntry = useMemo(() => {
    return seasonEntries.find(
      (entry) => entry.number === activeSeason
    );
  }, [seasonEntries, activeSeason]);

  /*
   * =======================================================
   * SAISON ACTIVE PAR DÉFAUT
   *
   * Priorité : la saison demandée par l'URL (?season=,
   * utilisée par les cartes de l'accueil), sinon la saison
   * de "Continuer la lecture" si elle existe encore parmi
   * les saisons connues, sinon la première saison — la
   * fiche montre toujours une saison, jamais un choix vide.
   * =======================================================
   */

  const didAutoOpen = useRef(false);

  useEffect(() => {
    if (!info) return;
    if (didAutoOpen.current) return;
    if (seasonEntries.length === 0) return;

    didAutoOpen.current = true;

    const hasRequestedSeason =
      requestedSeason !== null &&
      seasonEntries.some(
        (entry) => entry.number === requestedSeason
      );

    if (hasRequestedSeason && requestedSeason !== null) {
      setLang(
        continueItem?.season === requestedSeason
          ? continueItem.lang || 'vostfr'
          : 'vostfr'
      );
      setActiveSeason(requestedSeason);

      /*
       * "Reprendre" depuis l'accueil ajoute ?episode=N :
       * on ouvre directement le lecteur sur cet épisode
       * au lieu de simplement montrer le rail.
       */
      if (
        requestedEpisode !== null &&
        requestedEpisode >= 0
      ) {
        setSelectedEpisode(requestedEpisode);
      }

      return;
    }

    const hasContinueSeason =
      continueItem &&
      seasonEntries.some(
        (entry) => entry.number === continueItem.season
      );

    if (hasContinueSeason && continueItem) {
      setLang(continueItem.lang || 'vostfr');
      setActiveSeason(continueItem.season);
      return;
    }

    setLang('vostfr');
    setActiveSeason(firstSeason);
  }, [
    info,
    continueItem,
    seasonEntries,
    requestedSeason,
    requestedEpisode,
    firstSeason,
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

      if (activeSeason === seasonNumber) {
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
   * APPUI LONG — LIGNE DU MENU DE SAISON
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

    setSeasonMenuOpen(false);

    if (activeSeason === seasonNumber) return;

    const initialLang =
      continueItem?.season === seasonNumber
        ? continueItem.lang || 'vostfr'
        : 'vostfr';

    setLang(initialLang);
    setActiveSeason(seasonNumber);

    /* Nouvelle saison : le lecteur en cours se referme,
       il faut choisir un épisode de cette saison-ci. */
    setSelectedEpisode(null);
  };

  /* Ferme le menu de saison au clic extérieur ou à Échap */
  useEffect(() => {
    if (!seasonMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        seasonPickerRef.current &&
        !seasonPickerRef.current.contains(
          event.target as Node
        )
      ) {
        setSeasonMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSeasonMenuOpen(false);
      }
    };

    window.addEventListener(
      'pointerdown',
      handlePointerDown
    );
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener(
        'pointerdown',
        handlePointerDown
      );
      window.removeEventListener(
        'keydown',
        handleKeyDown
      );
    };
  }, [seasonMenuOpen]);

  /*
   * =======================================================
   * CHARGEMENT DES ÉPISODES DE LA SAISON ACTIVE
   *
   * Tout est protégé par try/catch : basculer sur une
   * langue qui n'existe pas vraiment pour cette saison ne
   * doit jamais planter la page.
   * =======================================================
   */

  useEffect(() => {
    if (activeSeason === null) return;

    let active = true;

    let cached: EpisodesData | null = null;

    try {
      cached = getCachedEpisodes(
        slug,
        activeSeason,
        lang
      );
    } catch {
      cached = null;
    }

    if (cached) {
      setData(cached);
      setEpisodesLoading(false);
      setEpisodesError(false);
    } else {
      setData(null);
      setEpisodesLoading(true);
      setEpisodesError(false);
    }

    Promise.resolve()
      .then(() =>
        loadEpisodes(slug, activeSeason, lang)
      )
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
  }, [slug, activeSeason, lang]);

  /* Épisodes déjà vus, pour la saison/langue active */
  useEffect(() => {
    if (activeSeason === null) {
      setWatched([]);
      return;
    }

    setWatched(readWatched(slug, activeSeason, lang));
  }, [slug, activeSeason, lang]);

  /* Lecteur (mirroir) par défaut à chaque nouveau chargement */
  useEffect(() => {
    setPlayerIndex(data?.defaultPlayerIndex || 0);
  }, [data]);

  const episodeCount = useMemo(() => {
    if (!data) return 0;

    const list =
      data.players?.[data.defaultPlayerIndex || 0]
        ?.urls;

    return list?.length || data.totalEpisodes || 0;
  }, [data]);

  const currentEpisodes = useMemo(() => {
    if (!data?.players?.[playerIndex]) return [];

    return data.players[playerIndex].urls || [];
  }, [data, playerIndex]);

  const videoUrl =
    selectedEpisode !== null
      ? currentEpisodes[selectedEpisode] || ''
      : '';

  /*
   * =======================================================
   * CONTINUER LA LECTURE
   * =======================================================
   */

  const saveContinue = (episodeIndex: number) => {
    if (activeSeason === null) return;

    try {
      const item: ContinueItem = {
        slug,
        name: info?.name || getAnimeName(slug),
        image: info?.image,
        season: activeSeason,
        episode: episodeIndex,
        lang,
        updatedAt: Date.now(),
      };

      localStorage.setItem(
        `anime_continue_${slug}`,
        JSON.stringify(item)
      );

      setContinueItem(item);

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
  };

  /*
   * =======================================================
   * APPUI SUR UN ÉPISODE → LE LECTEUR S'OUVRE ICI
   * =======================================================
   */

  const openEpisode = (episodeIndex: number) => {
    if (episodeLongPressed.current) {
      episodeLongPressed.current = false;
      return;
    }

    if (activeSeason === null) return;

    setSelectedEpisode(episodeIndex);
    saveContinue(episodeIndex);

    window.requestAnimationFrame(() => {
      playerSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  };

  const jumpToContinue = () => {
    const targetSeason =
      continueItem?.season || firstSeason;

    const targetLang: 'vostfr' | 'vf' =
      continueItem?.lang || 'vostfr';

    const targetEpisode = continueItem?.episode || 0;

    setLang(targetLang);
    setActiveSeason(targetSeason);
    setSelectedEpisode(targetEpisode);

    window.requestAnimationFrame(() => {
      playerSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  };

  /*
   * =======================================================
   * MARQUAGE AUTOMATIQUE APRÈS 60 SECONDES DE LECTURE
   * =======================================================
   */

  const markEpisodeWatched = (
    episodeIndex: number
  ) => {
    if (activeSeason === null) return;

    if (watched.includes(episodeIndex)) return;

    const next = [...watched, episodeIndex].sort(
      (a, b) => a - b
    );

    setWatched(next);

    try {
      localStorage.setItem(
        getWatchKey(slug, activeSeason, lang),
        JSON.stringify(next)
      );
    } catch {
      // localStorage indisponible
    }

    writeSeasonProgress(slug, lang, {
      season: activeSeason,
      watched: next.length,
      total: episodeCount,
      lastEpisode: episodeIndex,
      updatedAt: Date.now(),
    });

    setProgress(readMergedProgress(slug));
  };

  const markRef = useRef(markEpisodeWatched);

  useEffect(() => {
    markRef.current = markEpisodeWatched;
  });

  useEffect(() => {
    if (!videoUrl || selectedEpisode === null) {
      return;
    }

    const timer = setTimeout(() => {
      markRef.current(selectedEpisode);
    }, WATCH_DELAY);

    return () => clearTimeout(timer);
  }, [videoUrl, selectedEpisode]);

  /*
   * =======================================================
   * MARQUAGE DEPUIS LE RAIL D'ÉPISODES
   * =======================================================
   */

  const markUpTo = (episodeIndex: number) => {
    if (activeSeason === null || episodeCount === 0) {
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
      activeSeason,
      lang,
      episodeIndex,
      episodeCount
    );

    setWatched(next);
    setProgress(readMergedProgress(slug));
  };

  const toggleWholeActiveSeason = () => {
    if (activeSeason === null || episodeCount === 0) {
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

      clearSeason(slug, activeSeason, lang);

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
      activeSeason,
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

        <div className="hero-float-buttons">

          <Link
            href="/"
            className="hero-round-button"
            aria-label="Retour"
          >
            ‹
          </Link>

        </div>

        <div className="skeleton skeleton-hero" />

        <div className="skeleton skeleton-line" />
        <div className="skeleton skeleton-line short" />

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

      {/* ===================================================
          BOUTONS FLOTTANTS — restent fixes à l'écran quel
          que soit le défilement, comme sur Apple TV+
          =================================================== */}

      <div className="hero-float-buttons">

        <Link
          href="/"
          className="hero-round-button"
          aria-label="Retour"
        >
          ‹
        </Link>

        <button
          type="button"
          className={`hero-round-button ${
            favorite ? 'is-favorite' : ''
          }`}
          onClick={toggleFavorite}
          aria-label="Favori"
        >
          {favorite ? '★' : '☆'}
        </button>

      </div>

      <div
        className={`hero-compact-title ${
          isCompact ? 'is-visible' : ''
        }`}
      >
        {title}
      </div>

      {/* ===================================================
          AFFICHE PLEIN ÉCRAN — titre et informations écrits
          par-dessus l'image, comme une fiche Apple TV+
          =================================================== */}

      <section className="hero-banner">

        <div
          className="hero-banner-frame"
          ref={heroFrameRef}
        >

          {info.image ? (
            <img
              src={info.image}
              alt={title}
              className="hero-banner-img"
            />
          ) : (
            <div className="hero-banner-img hero-banner-img-empty" />
          )}

        </div>

        <div className="hero-banner-scrim" />

        <div className="hero-banner-content">

          <h1>{title}</h1>

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
          BOUTON PRINCIPAL — reste sur la page, ouvre le
          lecteur ici et y défile au lieu de naviguer
          =================================================== */}

      <button
        type="button"
        className="primary-button hero-action"
        onClick={jumpToContinue}
        onMouseEnter={() =>
          prefetchEpisodes(
            slug,
            continueItem?.season || firstSeason,
            continueItem?.lang || 'vostfr'
          )
        }
      >
        {continueItem
          ? `▶ Continuer · S${
              continueItem.season
            } É${continueItem.episode + 1}`
          : '▶ Commencer'}
      </button>

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
          SAISON ACTIVE — petit sélecteur "Saison X ›" qui
          ouvre un menu déroulant, puis langue, lecteur et
          rail d'épisodes de la saison choisie
          =================================================== */}

      <section className="section">

        <div
          className="season-picker"
          ref={seasonPickerRef}
        >

          <button
            type="button"
            className="season-picker-trigger"
            onClick={() =>
              setSeasonMenuOpen((open) => !open)
            }
          >
            {activeEntry?.label ||
              (activeSeason
                ? `Saison ${activeSeason}`
                : 'Saisons')}

            <span className="season-chevron">
              ›
            </span>

          </button>

          <div
            className={`season-menu ${
              seasonMenuOpen ? 'is-open' : ''
            }`}
          >

            {seasonEntries.map((entry) => {

              const item = progress.get(
                entry.number
              );

              const watchedCount =
                item?.watched || 0;

              const totalCount = item?.total || 0;

              const isDone =
                totalCount > 0 &&
                watchedCount >= totalCount;

              const isMarking =
                markingSeason === entry.number;

              const isActive =
                activeSeason === entry.number;

              return (
                <button
                  key={entry.number}
                  type="button"
                  className={`season-menu-row ${
                    isActive ? 'is-active' : ''
                  }`}
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

                  <span className="season-menu-row-label">

                    <strong>{entry.label}</strong>

                    <span>
                      {totalCount > 0
                        ? `${watchedCount} / ${totalCount} épisodes`
                        : 'Non commencée'}
                    </span>

                  </span>

                  <span className="season-menu-row-icons">

                    {isMarking ? (
                      <span className="loader" />
                    ) : (
                      isDone && (
                        <span className="season-done">
                          ✓
                        </span>
                      )
                    )}

                  </span>

                </button>
              );
            })}

          </div>

        </div>

        <div className="season-panel-head">

          <div className="segmented">

            {data?.hasVOSTFR !== false && (
              <button
                className={
                  lang === 'vostfr' ? 'selected' : ''
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

          {episodeCount > 0 && (
            <button
              className="mark-button"
              onClick={toggleWholeActiveSeason}
            >
              {watched.length >= episodeCount
                ? 'Tout décocher'
                : 'Tout marquer'}
            </button>
          )}

        </div>

        {data?.fallback &&
          data.requestedLang !== data.lang && (
            <p className="episode-hint">
              Pas de{' '}
              {data.requestedLang === 'vf'
                ? 'VF'
                : 'VOSTFR'}{' '}
              disponible pour cette saison — lecture
              en{' '}
              {data.lang === 'vf' ? 'VF' : 'VOSTFR'}
              .
            </p>
          )}

        <EpisodesBoundary>

          {/* LECTEUR — apparaît ici dès qu'un
              épisode est choisi, jamais de
              changement de page. */}

          {selectedEpisode !== null && (
            <div
              ref={playerSectionRef}
              className="season-player"
            >

              <div className="season-player-head">

                <span className="section-eyebrow">
                  ÉPISODE {selectedEpisode + 1}
                </span>

                <button
                  className="text-button"
                  onClick={() =>
                    setSelectedEpisode(null)
                  }
                >
                  Réduire
                </button>

              </div>

              <section className="player-container">

                {videoUrl ? (
                  <iframe
                    key={videoUrl}
                    src={videoUrl}
                    title={`${title} épisode ${
                      selectedEpisode + 1
                    }`}
                    allowFullScreen
                    className="video-frame"
                  />
                ) : (
                  <div className="player-empty">

                    {episodesLoading ? (
                      <>
                        <span className="loader large" />
                        <p>Chargement…</p>
                      </>
                    ) : (
                      <>
                        <span>▶</span>
                        <p>
                          Lecteur indisponible
                        </p>
                      </>
                    )}

                  </div>
                )}

              </section>

              {(data?.players?.length || 0) > 1 && (
                <div className="players">

                  <span>Lecteur</span>

                  <div className="player-list">

                    {data?.players.map(
                      (item, index) => (
                        <button
                          key={`${item.name}-${index}`}
                          className={
                            playerIndex === index
                              ? 'player-selected'
                              : ''
                          }
                          onClick={() =>
                            setPlayerIndex(index)
                          }
                        >
                          {item.name}
                        </button>
                      )
                    )}

                  </div>

                </div>
              )}

            </div>
          )}

          <p className="episode-hint">
            Appui long sur un épisode pour marquer
            tous les précédents comme vus.
          </p>

          {episodesLoading && episodeCount === 0 ? (
            <div className="loading-row">
              <span className="loader" />
              <span>Chargement…</span>
            </div>
          ) : episodeCount > 0 ? (
            <div className="ep-rail">

              {Array.from({
                length: episodeCount,
              }).map((_, index) => {

                const isWatched =
                  watched.includes(index);

                const isActive =
                  selectedEpisode === index;

                return (
                  <button
                    key={index}
                    type="button"
                    className={`ep-card ${
                      isActive ? 'is-active' : ''
                    }`}
                    onPointerDown={() =>
                      startEpisodePress(index)
                    }
                    onPointerUp={cancelEpisodePress}
                    onPointerLeave={
                      cancelEpisodePress
                    }
                    onPointerCancel={
                      cancelEpisodePress
                    }
                    onContextMenu={(event) =>
                      event.preventDefault()
                    }
                    onClick={() => openEpisode(index)}
                  >

                    <span
                      className="ep-card-thumb"
                      style={
                        info.image
                          ? {
                              backgroundImage: `url(${info.image})`,
                            }
                          : undefined
                      }
                    >

                      {isWatched && (
                        <span className="ep-card-check">
                          ✓
                        </span>
                      )}

                    </span>

                    <span className="ep-card-text">

                      <span className="ep-card-title">
                        Épisode {index + 1}
                      </span>

                      <span className="ep-card-sub">
                        {isWatched ? 'Vu' : 'Non vu'}
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

        </EpisodesBoundary>

      </section>

    </main>
  );
}

export default function AnimeInfoPage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: { season?: string; episode?: string };
}) {
  return (
    <PageBoundary>
      <AnimeInfoPageContent
        params={params}
        searchParams={searchParams}
      />
    </PageBoundary>
  );
}
