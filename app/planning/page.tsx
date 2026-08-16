'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import {
  PlanningItem,
  formatPlanningDay,
  formatPlanningTime,
  getPlanningDayKey,
} from '@/lib/planning';

const CACHE_KEY = 'anime_planning_cache';
const CACHE_TTL = 24 * 60 * 60 * 1000;

interface CacheEntry {
  items: PlanningItem[];
  savedAt: number;
}

function readCache(): PlanningItem[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);

    if (!raw) return null;

    const entry = JSON.parse(raw) as CacheEntry;

    if (
      !entry?.savedAt ||
      Date.now() - entry.savedAt > CACHE_TTL ||
      !Array.isArray(entry.items)
    ) {
      return null;
    }

    return entry.items;
  } catch {
    return null;
  }
}

function writeCache(items: PlanningItem[]) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        items,
        savedAt: Date.now(),
      } as CacheEntry)
    );
  } catch {
    // Quota dépassé
  }
}

/* Slugs déjà suivis : favoris + historique */
function readFollowed(): Set<string> {
  const slugs = new Set<string>();

  for (const key of [
    'anime_favorites',
    'anime_history',
  ]) {
    try {
      const raw = localStorage.getItem(key);

      if (!raw) continue;

      const parsed = JSON.parse(raw);

      if (!Array.isArray(parsed)) continue;

      for (const item of parsed) {
        const slug =
          typeof item === 'string'
            ? item
            : item?.slug;

        if (slug) slugs.add(String(slug));
      }
    } catch {
      // Rien
    }
  }

  return slugs;
}

export default function PlanningPage() {
  const [items, setItems] = useState<
    PlanningItem[]
  >([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [followed, setFollowed] = useState<
    Set<string>
  >(new Set());

  const [onlyFollowed, setOnlyFollowed] =
    useState(false);

  useEffect(() => {
    setFollowed(readFollowed());

    let active = true;

    const cached = readCache();

    if (cached) {
      setItems(cached);
      setLoading(false);
      return;
    }

    fetch('/api/anime/planning')
      .then((response) => response.json())
      .then((data) => {
        if (!active) return;

        if (!Array.isArray(data.items)) {
          throw new Error('Réponse invalide');
        }

        setItems(data.items);
        writeCache(data.items);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  /*
   * Regroupement par jour, à partir de
   * l'horodatage de chaque sortie.
   */
  const days = useMemo(() => {
    const today = new Date()
      .toISOString()
      .slice(0, 10);

    const groups = new Map<
      string,
      PlanningItem[]
    >();

    for (const item of items) {
      if (
        onlyFollowed &&
        !followed.has(item.slug)
      ) {
        continue;
      }

      const key = getPlanningDayKey(
        item.releaseTs
      );

      /* On n'affiche pas les jours passés */
      if (key < today) continue;

      const list = groups.get(key) || [];

      list.push(item);

      groups.set(key, list);
    }

    return Array.from(groups.entries()).sort(
      (a, b) => (a[0] < b[0] ? -1 : 1)
    );
  }, [items, onlyFollowed, followed]);

  return (
    <main className="page">

      <header className="simple-header">

        <div className="title-row">

          <div>

            <span className="eyebrow">
              CETTE SEMAINE
            </span>

            <h1>Planning</h1>

          </div>

          {items.length > 0 && (
            <span className="count-badge">
              {items.length}
            </span>
          )}

        </div>

        {followed.size > 0 && (
          <button
            className={
              onlyFollowed
                ? 'filter-chip is-active'
                : 'filter-chip'
            }
            onClick={() =>
              setOnlyFollowed(!onlyFollowed)
            }
          >
            {onlyFollowed
              ? 'Tous les animes'
              : 'Uniquement mes animes'}
          </button>
        )}

      </header>

      {loading && (
        <div className="planning-day">

          <div className="skeleton skeleton-line short" />

          <div className="skeleton skeleton-block" />

        </div>
      )}

      {!loading && error && (
        <div className="empty-card">

          <div className="empty-icon">⚠️</div>

          <h3>Planning indisponible</h3>

          <p>
            La source n&apos;a pas répondu.
            Réessaie plus tard.
          </p>

        </div>
      )}

      {!loading && !error && days.length === 0 && (
        <div className="empty-card">

          <div className="empty-icon">◷</div>

          <h3>Aucune sortie</h3>

          <p>
            {onlyFollowed
              ? 'Aucun de tes animes ne sort cette semaine.'
              : 'Le planning est vide pour le moment.'}
          </p>

        </div>
      )}

      {days.map(([key, list]) => (
        <section
          className="planning-day"
          key={key}
        >

          <div className="planning-day-title">

            <h2>{formatPlanningDay(key)}</h2>

            <span>{list.length}</span>

          </div>

          <div className="planning-list">

            {list.map((item) => {

              const isFollowed = followed.has(
                item.slug
              );

              const isReleased =
                item.releaseTs * 1000 <=
                Date.now();

              return (
                <Link
                  key={`${item.slug}-${item.season}-${item.lang}-${item.releaseTs}`}
                  href={`/anime/${encodeURIComponent(
                    item.slug
                  )}/${item.season}`}
                  className={
                    isFollowed
                      ? 'planning-card is-followed'
                      : 'planning-card'
                  }
                >

                  <div className="planning-cover">

                    {item.image && (
                      <img
                        src={item.image}
                        alt={item.title}
                        loading="lazy"
                      />
                    )}

                  </div>

                  <div className="planning-info">

                    <strong>{item.title}</strong>

                    <span>
                      Saison {item.season}
                      {' · '}
                      {item.lang.toUpperCase()}
                    </span>

                  </div>

                  <div className="planning-time">

                    <strong>
                      {formatPlanningTime(
                        item.releaseTs
                      )}
                    </strong>

                    <small>
                      {isReleased
                        ? 'Sorti'
                        : 'À venir'}
                    </small>

                  </div>

                </Link>
              );
            })}

          </div>

        </section>
      ))}

    </main>
  );
}
