'use client';

import { useState, useEffect, useRef } from 'react';
import TabBar from './TabBar';
import Drawer from './Drawer';
import { loadCache, saveEntry } from '@/lib/techfeed/articleCache';
import {
  loadRead, saveRead, loadSources, applySourceColors, slug,
  loadAppName, loadTabMode, sourceIcon,
} from '@/lib/techfeed/prefs';

const PREFETCH_CONCURRENCY = 2;
const PULL_THRESHOLD = 70;
const REFRESH_MIN_INTERVAL = 60 * 1000;
const LIST_KEY = 'techfeed-list-cache';
const LIST_MAX = 300;

function loadListCache() {
  try {
    const raw = localStorage.getItem(LIST_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveListCache(list) {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(list.slice(0, LIST_MAX)));
  } catch (e) {}
}

export default function FeedList() {
  const [sources, setSources] = useState([]);
  const [articles, setArticles] = useState([]);
  const [pending, setPending] = useState([]);
  const [activeTab, setActiveTab] = useState('all');
  const [pageBySource, setPageBySource] = useState({});
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [selected, setSelected] = useState(null);
  const [fullContent, setFullContent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [contentCache, setContentCache] = useState({});
  const [imageCache, setImageCache] = useState({});
  const [readLinks, setReadLinks] = useState([]);
  const [appName, setAppName] = useState('TechFeed');
  const [tabMode, setTabMode] = useState('name');
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [navX, setNavX] = useState(0);
  const [navAnimating, setNavAnimating] = useState(false);

  const touchStartX = useRef(null);
  const touchStartY = useRef(null);
  const pullStartY = useRef(null);
  const storedCache = useRef({});
  const inFlight = useRef(new Set());
  const queue = useRef([]);
  const running = useRef(0);
  const ready = useRef(false);
  const lastRefresh = useRef(0);
  const refreshingRef = useRef(false);
  const articlesRef = useRef([]);
  const pendingRef = useRef([]);
  const swipeMode = useRef(null);
  const animating = useRef(false);
  const visibleRef = useRef([]);
  const indexRef = useRef(-1);

  useEffect(() => {
    const stored = loadCache();
    storedCache.current = stored;
    const asContent = {};
    const asImage = {};
    for (const key of Object.keys(stored)) {
      asContent[key] = stored[key].content;
      if (stored[key].image) asImage[key] = stored[key].image;
    }
    setContentCache(asContent);
    setImageCache(asImage);
    setReadLinks(loadRead());
    setAppName(loadAppName());
    setTabMode(loadTabMode());

    const list = loadSources();
    setSources(list);
    applySourceColors(list);

    const cached = loadListCache();
    if (cached.length > 0) {
      setArticles(cached);
      articlesRef.current = cached;
      setInitialLoad(false);
    }

    ready.current = true;
    fetchAllSources(list, true);
  }, []);

  useEffect(() => { articlesRef.current = articles; }, [articles]);
  useEffect(() => { pendingRef.current = pending; }, [pending]);

  function mergeArticles(prev, incoming) {
    const known = new Set(prev.map((a) => a.link));
    const fresh = incoming.filter((a) => a.link && !known.has(a.link));
    if (fresh.length === 0) return prev;
    const merged = [...fresh, ...prev].sort((a, b) => new Date(b.date) - new Date(a.date));
    saveListCache(merged);
    return merged;
  }

  async function fetchOneSource(source, page) {
    try {
      const url =
        '/api/feed?url=' + encodeURIComponent(source.url) +
        '&name=' + encodeURIComponent(source.name) +
        '&page=' + page;
      const res = await fetch(url);
      const data = await res.json();
      return data.articles || [];
    } catch (e) {
      return [];
    }
  }

  async function fetchAllSources(list, mergeNow) {
    const results = await Promise.all(list.map((s) => fetchOneSource(s, 1)));
    const incoming = results.flat();

    const known = new Set([
      ...articlesRef.current.map((a) => a.link),
      ...pendingRef.current.map((a) => a.link),
    ]);
    const fresh = incoming.filter((a) => a.link && !known.has(a.link));

    if (mergeNow || articlesRef.current.length === 0) {
      setArticles((prev) => mergeArticles(prev, fresh));
    } else if (fresh.length > 0) {
      setPending((prev) => [...prev, ...fresh]);
    }

    setPageBySource((prev) => {
      const next = { ...prev };
      for (const s of list) if (!next[s.id]) next[s.id] = 1;
      return next;
    });
    setInitialLoad(false);
    lastRefresh.current = Date.now();
  }

  function showPending() {
    if (pending.length === 0) return;
    const toAdd = pending;
    setPending([]);
    setArticles((prev) => mergeArticles(prev, toAdd));
    scrollTop();
  }

  function handleSourcesChange(list) {
    setSources(list);
    applySourceColors(list);
    const names = new Set(list.map((s) => s.name));
    setArticles((prev) => prev.filter((a) => names.has(a.source)));
    setPending((prev) => prev.filter((a) => names.has(a.source)));
    if (activeTab !== 'all' && !list.some((s) => s.id === activeTab)) {
      setActiveTab('all');
    }
    fetchAllSources(list, true);
  }

  function handlePrefsChange(name, mode) {
    setAppName(name);
    setTabMode(mode);
  }

  function scrollTop() {
    window.scrollTo(0, 0);
  }

  function changeTab(id) {
    if (id === activeTab) return;
    setActiveTab(id);
    scrollTop();
  }

  function openSource(id) {
    setActiveTab(id);
    scrollTop();
  }

  function openArticle(article) {
    setSelected(article);
    scrollTop();
    setReadLinks((prev) => {
      if (prev.includes(article.link)) return prev;
      return saveRead([...prev, article.link]);
    });
  }

  function closeArticle() {
    setSelected(null);
    setNavX(0);
    setNavAnimating(false);
    animating.current = false;
    scrollTop();
  }

  function goToArticle(index, dir) {
    const next = visibleRef.current[index];
    if (!next) {
      animating.current = false;
      setNavAnimating(false);
      setNavX(0);
      return;
    }
    setNavAnimating(false);
    setNavX(dir * -(window.innerWidth || 400));
    setSelected(next);
    setReadLinks((prev) => {
      if (prev.includes(next.link)) return prev;
      return saveRead([...prev, next.link]);
    });
    window.scrollTo(0, 0);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setNavAnimating(true);
        setNavX(0);
        setTimeout(() => {
          setNavAnimating(false);
          animating.current = false;
        }, 280);
      });
    });
  }

  async function refreshFeed() {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    await fetchAllSources(sources, false);
    refreshingRef.current = false;
    setRefreshing(false);
  }

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRefresh.current < REFRESH_MIN_INTERVAL) return;
      refreshFeed();
    }
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    /* Pas de tableau de dependances ici : `refreshFeed` capture
       `sources`, qui change quand on ajoute une source. Sans
       cette reinscription a chaque rendu, le rafraichissement au
       retour dans l'app continuerait d'interroger l'ancienne
       liste. */
  });

  useEffect(() => {
    if (!selected) return;

    function onStart(e) {
      if (e.touches.length > 1 || animating.current) return;
      const t = e.touches[0];
      touchStartX.current = t.clientX;
      touchStartY.current = t.clientY;
      swipeMode.current = t.clientX < 40 ? 'back' : 'nav';
      setDragging(true);
      setNavAnimating(false);
    }

    function onMove(e) {
      if (touchStartX.current === null || animating.current) return;
      const t = e.touches[0];
      const dx = t.clientX - touchStartX.current;
      const dy = Math.abs(t.clientY - touchStartY.current);

      if (dy > 60 && Math.abs(dx) < dy) {
        touchStartX.current = null;
        swipeMode.current = null;
        setDragging(false);
        setDragX(0);
        setNavX(0);
        return;
      }

      if (swipeMode.current === 'back') {
        setDragX(Math.max(dx, 0));
      } else if (swipeMode.current === 'nav') {
        const atFirst = indexRef.current <= 0 && dx > 0;
        const atLast = indexRef.current >= visibleRef.current.length - 1 && dx < 0;
        setNavX(dx * (atFirst || atLast ? 0.25 : 1));
      }
    }

    function onEnd() {
      if (touchStartX.current === null) return;
      const width = window.innerWidth || 400;
      const mode = swipeMode.current;
      touchStartX.current = null;
      swipeMode.current = null;
      setDragging(false);

      if (mode === 'back') {
        setDragX((current) => {
          if (current > width * 0.28 || current > 130) {
            setTimeout(() => {
              closeArticle();
              setDragX(0);
            }, 220);
            return width;
          }
          return 0;
        });
        return;
      }

      setNavAnimating(true);
      setNavX((current) => {
        const threshold = Math.min(width * 0.3, 140);
        const idx = indexRef.current;
        if (current < -threshold && idx < visibleRef.current.length - 1) {
          animating.current = true;
          setTimeout(() => goToArticle(idx + 1, -1), 200);
          return -width;
        }
        if (current > threshold && idx > 0) {
          animating.current = true;
          setTimeout(() => goToArticle(idx - 1, 1), 200);
          return width;
        }
        return 0;
      });
    }

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [selected]);

  function atTop() {
    const y = window.scrollY || document.documentElement.scrollTop || 0;
    return y <= 0;
  }

  function handlePullStart(e) {
    const target = e.target;
    if (target && target.closest && target.closest('.tab-bar')) {
      pullStartY.current = null;
      return;
    }
    if (!atTop()) {
      pullStartY.current = null;
      return;
    }
    pullStartY.current = e.touches[0].clientY;
  }

  function handlePullMove(e) {
    if (pullStartY.current === null) return;
    const dy = e.touches[0].clientY - pullStartY.current;
    if (dy <= 0) {
      setPullDistance(0);
      return;
    }
    if (!atTop()) {
      pullStartY.current = null;
      setPullDistance(0);
      return;
    }
    setPullDistance(Math.min(dy * 0.6, 100));
  }

  function handlePullEnd() {
    if (pullDistance >= PULL_THRESHOLD) refreshFeed();
    setPullDistance(0);
    pullStartY.current = null;
  }

  async function fetchArticleContent(article) {
    const key = article.link;
    if (inFlight.current.has(key)) return null;
    inFlight.current.add(key);
    try {
      const res = await fetch('/api/article?url=' + encodeURIComponent(article.link));
      const data = await res.json();
      const content = data.content;
      if (content) {
        storedCache.current = saveEntry(storedCache.current, key, content, data.image);
        setContentCache((prev) => ({ ...prev, [key]: content }));
        if (data.image) setImageCache((prev) => ({ ...prev, [key]: data.image }));
      }
      return content;
    } catch (e) {
      return null;
    } finally {
      inFlight.current.delete(key);
    }
  }

  function drainQueue() {
    while (running.current < PREFETCH_CONCURRENCY && queue.current.length > 0) {
      const article = queue.current.shift();
      running.current += 1;
      fetchArticleContent(article).then(() => {
        running.current -= 1;
        drainQueue();
      });
    }
  }

  useEffect(() => {
    if (!ready.current) return;
    const toPrefetch = [...articles, ...pendingRef.current].filter(
      (a) => storedCache.current[a.link] === undefined && !inFlight.current.has(a.link)
    );
    if (toPrefetch.length === 0) return;
    queue.current.push(...toPrefetch);
    drainQueue();
  }, [articles, pending, contentCache]);

  /*
   * L'observateur d'intersection qui posait/retirait la classe
   * `seen` a ete supprime : il RETIRAIT la classe des que la
   * carte quittait l'ecran, donc chaque vignette rejouait son
   * animation d'apparition a chaque passage. C'etait la cause
   * des images qui sautaient pendant le defilement. La vignette
   * apparait maintenant une seule fois, au chargement de
   * l'image.
   */

  useEffect(() => {
    if (!selected) return;
    if (contentCache[selected.link] !== undefined) {
      setFullContent(contentCache[selected.link]);
      setLoading(false);
      return;
    }
    setFullContent(null);
    setLoading(true);
    fetchArticleContent(selected)
      .then((content) => setFullContent(content))
      .finally(() => setLoading(false));
  }, [selected]);

  async function loadMore() {
    setLoadingMore(true);
    const targets =
      activeTab === 'all'
        ? sources.filter((s) => s.favorite)
        : sources.filter((s) => s.id === activeTab);

    const results = await Promise.all(
      targets.map(async (s) => {
        const nextPage = (pageBySource[s.id] || 1) + 1;
        const list = await fetchOneSource(s, nextPage);
        return { id: s.id, nextPage, list };
      })
    );

    setArticles((prev) => mergeArticles(prev, results.flatMap((r) => r.list)));
    setPageBySource((prev) => {
      const next = { ...prev };
      for (const r of results) next[r.id] = r.nextPage;
      return next;
    });
    setLoadingMore(false);
  }

  const favorites = sources.filter((s) => s.favorite);
  const activeIsGuest = activeTab !== 'all' && !favorites.some((s) => s.id === activeTab);
  const guest = activeIsGuest ? sources.find((s) => s.id === activeTab) : null;
  const tabs = [
    { id: 'all', label: 'Tous', icon: null },
    ...favorites.map((s) => ({ id: s.id, label: s.label || s.name, icon: sourceIcon(s) })),
    ...(guest ? [{ id: guest.id, label: guest.label || guest.name, icon: sourceIcon(guest) }] : []),
  ];

  const activeSource = sources.find((s) => s.id === activeTab);
  const visibleArticles =
    activeTab === 'all' || !activeSource
      ? articles
      : articles.filter((a) => a.source === activeSource.name);

  const currentIndex = selected
    ? visibleArticles.findIndex((a) => a.link === selected.link)
    : -1;

  visibleRef.current = visibleArticles;
  indexRef.current = currentIndex;

  if (selected) {
    return (
      <>
        <button className="float-btn" onClick={closeArticle} aria-label="Retour">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <h1 className="app-title">{selected.source}</h1>

        <div
          className={'reader-page' + (dragging ? ' dragging' : '') + (navAnimating ? ' nav-anim' : '')}
          style={{
            transform: `translateX(${dragX + navX}px)`,
            opacity: dragX > 0 ? Math.max(1 - dragX / 700, 0.4) : 1,
          }}
        >
          <div className="reader" style={{ '--tint': `var(--tint-${slug(selected.source)})` }}>
            <h2 className="reader-title">{selected.title}</h2>

            {loading && (
              <div style={{ marginTop: 16 }}>
                <div className="tf-skeleton-line" />
                <div className="tf-skeleton-line" />
                <div className="tf-skeleton-line" />
              </div>
            )}
            {!loading && fullContent && (
              <div className="reader-body reader-full" dangerouslySetInnerHTML={{ __html: fullContent }} />
            )}
            {!loading && !fullContent && (
              <p className="reader-body">{selected.excerpt || "Impossible de charger l'article complet."}</p>
            )}

            <a className="source-link" href={selected.link} target="_blank" rel="noopener noreferrer">
              Voir la page originale ↗
            </a>
          </div>
        </div>
      </>
    );
  }

  return (
    <div
      onTouchStart={handlePullStart}
      onTouchMove={handlePullMove}
      onTouchEnd={handlePullEnd}
    >
      <Drawer
        onSourcesChange={handleSourcesChange}
        onOpenSource={openSource}
        onPrefsChange={handlePrefsChange}
      />
      <h1 className="app-title">{appName}</h1>

      {pending.length > 0 && (
        <button className="new-articles-pill" onClick={showPending}>
          ↑ {pending.length} nouvel{pending.length > 1 ? 's' : ''} article{pending.length > 1 ? 's' : ''}
        </button>
      )}

      <div
        className={'pull-indicator' + (refreshing ? ' spinning' : '')}
        style={{
          height: refreshing ? 44 : Math.max(pullDistance, 0),
          opacity: refreshing || pullDistance > 4 ? 1 : 0,
        }}
      >
        <span className="pull-spinner" />
      </div>

      <div className="feed" style={{ transform: `translateY(${pullDistance * 0.3}px)` }}>
        {initialLoad && visibleArticles.length === 0 && (
          <>
            <div className="skeleton-card" />
            <div className="skeleton-card" />
            <div className="skeleton-card" />
          </>
        )}
        {!initialLoad && visibleArticles.length === 0 && (
          <p className="empty-state">Aucun article pour cette source pour l&apos;instant.</p>
        )}
        {visibleArticles.map((a) => (
          <div
            className={'card' + (readLinks.includes(a.link) ? ' read' : '')}
            key={a.link}
            style={{ '--tint': `var(--tint-${slug(a.source)})` }}
            onClick={() => openArticle(a)}
          >
            <span className="unread-bar" />
            <div className="card-row">
              {/*
                L'emplacement de la vignette est TOUJOURS rendu,
                meme sans image. Le cache d'images se remplit en
                differe (il vient du prechargement des articles) :
                si la carte n'avait pas de case reservee, elle en
                gagnait une soudainement et toute la liste se
                decalait sous le doigt.
              */}
              <div className="card-thumb-slot">
                {(a.thumbnail || imageCache[a.link]) && (
                  <img
                    className="card-thumb"
                    src={a.thumbnail || imageCache[a.link]}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    draggable={false}
                    onLoad={(e) => {
                      e.currentTarget.classList.add('is-loaded');
                    }}
                    onError={(e) => {
                      /* Image morte ou hotlink refuse : on la
                         retire au lieu de laisser l'icone de
                         document casse. */
                      e.currentTarget.remove();
                    }}
                  />
                )}
              </div>
              <div className="card-text">
                <div className="card-title">{a.title}</div>
                <div className="meta">{a.source}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <button className="load-more-btn" onClick={loadMore} disabled={loadingMore}>
        {loadingMore ? 'Chargement…' : 'Charger des articles plus anciens'}
      </button>
      <TabBar tabs={tabs} active={activeTab} onChange={changeTab} mode={tabMode} />
    </div>
  );
}
