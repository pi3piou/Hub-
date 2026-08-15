'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface AnimeItem {
  name: string;
  slug: string;
  image?: string;
}

function readFavorites(): AnimeItem[] {
  try {
    const raw =
      localStorage.getItem(
        'anime_favorites'
      );

    if (!raw) return [];

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => {
        if (typeof item === 'string') {
          return {
            name: item,
            slug: item,
          };
        }

        if (
          item &&
          typeof item === 'object'
        ) {
          const slug = String(
            item.slug || ''
          );

          if (!slug) return null;

          return {
            name: String(
              item.name || slug
            ),
            slug,
            image: item.image
              ? String(item.image)
              : undefined,
          };
        }

        return null;
      })
      .filter(Boolean) as AnimeItem[];
  } catch {
    return [];
  }
}

export default function Home() {
  const [query, setQuery] =
    useState('');

  const [results, setResults] =
    useState<AnimeItem[]>([]);

  const [favorites, setFavorites] =
    useState<AnimeItem[]>([]);

  const [searching, setSearching] =
    useState(false);

  const [mounted, setMounted] =
    useState(false);

  useEffect(() => {
    setFavorites(
      readFavorites()
    );

    setMounted(true);
  }, []);

  useEffect(() => {
    const value =
      query.trim();

    if (value.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    const controller =
      new AbortController();

    const timer =
      window.setTimeout(
        async () => {
          setSearching(true);

          try {
            const response =
              await fetch(
                `/api/search?q=${encodeURIComponent(
                  value
                )}`,
                {
                  signal:
                    controller.signal,
                  cache: 'no-store',
                }
              );

            if (!response.ok) {
              setResults([]);
              return;
            }

            const data =
              await response.json();

            setResults(
              Array.isArray(
                data.results
              )
                ? data.results
                : []
            );
          } catch (error) {
            if (
              (error as Error)
                .name !==
              'AbortError'
            ) {
              console.error(error);
            }
          } finally {
            setSearching(false);
          }
        },
        350
      );

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <main className="page">

      <header className="hero">

        <div>
          <div className="eyebrow">
            ANIME STREAM
          </div>

          <h1>
            Regarde ton anime.
          </h1>

          <p>
            Recherche un titre et
            retrouve rapidement tes
            favoris.
          </p>
        </div>

      </header>

      <section className="search-section">

        <div className="search-box">

          <span className="search-icon">
            ⌕
          </span>

          <input
            value={query}
            onChange={(event) =>
              setQuery(
                event.target.value
              )
            }
            placeholder="Rechercher un anime..."
            autoComplete="off"
            spellCheck={false}
          />

          {query && (
            <button
              className="clear-button"
              onClick={() =>
                setQuery('')
              }
              aria-label="Effacer"
            >
              ×
            </button>
          )}

        </div>

        {query.trim().length >= 2 && (
          <div className="search-results">

            {searching ? (
              <div className="search-state">

                <span className="loader" />

                Recherche…

              </div>
            ) : results.length === 0 ? (
              <div className="search-state">
                Aucun résultat
              </div>
            ) : (
              results.map(
                (item) => (
                  <Link
                    key={item.slug}
                    href={`/anime/${encodeURIComponent(
                      item.slug
                    )}`}
                    className="search-result"
                    onClick={() =>
                      setQuery('')
                    }
                  >

               <div className="search-cover">
  {item.image && (
    <img
      src={item.image}
      alt={item.name}
      loading="lazy"
      onError={(event) => {
        event.currentTarget.style.display =
          'none';
      }}
    />
  )}
</div>

                    <div className="search-result-info">

                      <strong>
                        {item.name}
                      </strong>

                      <span>
                        {item.slug}
                      </span>

                    </div>

                    <span className="arrow">
                      ›
                    </span>

                  </Link>
                )
              )
            )}

          </div>
        )}

      </section>

      <section className="featured-card">

        <div className="featured-glow" />

        <div className="featured-content">

          <span className="badge">
            CATALOGUE
          </span>

          <h2>
            Découvre ton prochain anime
          </h2>

          <p>
            Recherche un titre pour
            accéder à ses saisons et
            épisodes.
          </p>

          <div className="featured-icon">
            ▶
          </div>

        </div>

      </section>

      <section className="section">

        <div className="section-header">

          <div>

            <span className="section-eyebrow">
              BIBLIOTHÈQUE
            </span>

            <h2>
              Vos favoris
            </h2>

          </div>

          {mounted &&
            favorites.length > 0 && (
              <Link
                href="/favorites"
                className="see-all"
              >
                Tout voir
              </Link>
            )}

        </div>

        {!mounted ? (
          <div className="empty-card">
            <span className="loader" />
          </div>
        ) : favorites.length === 0 ? (
          <div className="empty-card">

            <div className="empty-icon">
              ★
            </div>

            <h3>
              Aucun favori
            </h3>

            <p>
              Recherche un anime puis
              ajoute-le à ta bibliothèque.
            </p>

          </div>
        ) : (
          <div className="anime-grid">

            {favorites
              .slice(0, 4)
              .map((item) => (
                <Link
                  href={`/anime/${encodeURIComponent(
                    item.slug
                  )}`}
                  key={item.slug}
                  className="anime-card"
                >

                  <div className="anime-cover">

                    {item.image ? (
                      <img
                        src={item.image}
                        alt={item.name}
                        loading="lazy"
                        onError={(
                          event
                        ) => {
                          event.currentTarget.style.display =
                            'none';
                        }}
                      />
                    ) : null}

                  </div>

                  <span>
                    {item.name}
                  </span>

                </Link>
              ))}

          </div>
        )}

      </section>

    </main>
  );
}