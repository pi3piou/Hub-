'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Favorite {
  name: string;
  slug: string;
  image?: string;
}

export default function FavoritesPage() {
  const [favorites, setFavorites] =
    useState<Favorite[]>([]);

  const [mounted, setMounted] =
    useState(false);

  useEffect(() => {
    try {
      const raw =
        localStorage.getItem(
          'anime_favorites'
        );

      if (raw) {
        const parsed =
          JSON.parse(raw);

        if (Array.isArray(parsed)) {
          setFavorites(
            parsed
              .map((item) => {
                if (
                  typeof item ===
                  'string'
                ) {
                  return {
                    name: item,
                    slug: item,
                  };
                }

                if (
                  item &&
                  typeof item ===
                    'object' &&
                  item.slug
                ) {
                  return {
                    name: String(
                      item.name ||
                        item.slug
                    ),
                    slug: String(
                      item.slug
                    ),
                    image: item.image
                      ? String(
                          item.image
                        )
                      : undefined,
                  };
                }

                return null;
              })
              .filter(
                Boolean
              ) as Favorite[]
          );
        }
      }
    } catch {
      setFavorites([]);
    }

    setMounted(true);
  }, []);

  const removeFavorite = (
    slug: string
  ) => {
    const next =
      favorites.filter(
        (item) =>
          item.slug !== slug
      );

    setFavorites(next);

    localStorage.setItem(
      'anime_favorites',
      JSON.stringify(next)
    );
  };

  return (
    <main className="page">

      <header className="simple-header">

        <span className="section-eyebrow">
          BIBLIOTHÈQUE
        </span>

        <div className="title-row">

          <h1>
            Favoris
          </h1>

          {mounted && (
            <span className="count-badge">
              {favorites.length}
            </span>
          )}

        </div>

      </header>

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
            Ta bibliothèque est vide
          </h3>

          <p>
            Les animes que tu ajoutes
            en favoris apparaîtront ici.
          </p>

          <Link
            href="/"
            className="primary-button"
          >
            Rechercher un anime
          </Link>

        </div>
      ) : (
        <div className="favorite-grid">

          {favorites.map(
            (item) => (
              <div
                className="favorite-card"
                key={item.slug}
              >

                <Link
                  href={`/anime/${encodeURIComponent(
                    item.slug
                  )}`}
                >

                  <div className="favorite-cover">

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

                </Link>

                <div className="favorite-info">

                  <Link
                    href={`/anime/${encodeURIComponent(
                      item.slug
                    )}`}
                  >
                    <strong>
                      {item.name}
                    </strong>
                  </Link>

                  <button
                    onClick={() =>
                      removeFavorite(
                        item.slug
                      )
                    }
                    className="remove-button"
                  >
                    Retirer
                  </button>

                </div>

              </div>
            )
          )}

        </div>
      )}

    </main>
  );
}