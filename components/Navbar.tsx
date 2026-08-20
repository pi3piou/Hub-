'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const items = [
  {
    href: '/',
    label: 'Accueil',
    icon: '⌂',
  },
  {
    href: '/planning',
    label: 'Planning',
    icon: '◷',
  },
  {
    href: '/favorites',
    label: 'Biblio',
    icon: '★',
  },
];

const THEME_KEY = 'anime_theme';

/*
 * La pilule elle-même ne bouge pas au défilement, comme la
 * barre d'onglets d'Apple TV+. Ce qui glisse, c'est le petit
 * repère en verre DERRIÈRE l'onglet actif — mesuré en JS
 * (offsetLeft/offsetWidth du lien actif) puis animé en CSS
 * pur avec le ressort `--ease-spring`, façon Liquid Glass.
 */

export default function Navbar() {
  const pathname = usePathname();

  const [theme, setTheme] = useState<'dark' | 'light'>(
    'dark'
  );

  const activeIndex = items.findIndex((item) =>
    item.href === '/'
      ? pathname === '/'
      : pathname.startsWith(item.href)
  );

  const itemRefs = useRef<
    Array<HTMLAnchorElement | null>
  >([]);

  const [pill, setPill] = useState<{
    left: number;
    width: number;
  } | null>(null);

  /*
   * =======================================================
   * REPÈRE GLISSANT — mesuré après chaque changement de
   * page et à chaque redimensionnement (rotation d'écran).
   * =======================================================
   */

  useEffect(() => {
    const measure = () => {
      const el =
        activeIndex >= 0
          ? itemRefs.current[activeIndex]
          : null;

      if (el) {
        setPill({
          left: el.offsetLeft,
          width: el.offsetWidth,
        });
      } else {
        setPill(null);
      }
    };

    measure();

    window.addEventListener('resize', measure);

    return () => {
      window.removeEventListener('resize', measure);
    };
  }, [activeIndex]);

  /*
   * =======================================================
   * THÈME CLAIR / SOMBRE
   * =======================================================
   */

  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);

      if (stored === 'light') {
        setTheme('light');
      }
    } catch {
      // localStorage indisponible
    }
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';

    setTheme(next);

    document.documentElement.setAttribute(
      'data-theme',
      next
    );

    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // localStorage indisponible
    }
  };

  return (
    <nav className="bottom-nav">
      <div className="bottom-nav-inner">

        {pill && (
          <span
            className="nav-pill"
            style={{
              transform: `translateX(${pill.left}px)`,
              width: pill.width,
            }}
          />
        )}

        {items.map((item, index) => {
          const active = index === activeIndex;

          return (
            <Link
              key={item.href}
              href={item.href}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              className={`nav-item ${active ? 'active' : ''}`}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">
                {item.label}
              </span>
            </Link>
          );
        })}

        <button
          type="button"
          className="nav-item"
          onClick={toggleTheme}
          aria-label="Changer de thème"
        >
          <span className="nav-icon">
            {theme === 'dark' ? '☾' : '☀'}
          </span>
          <span className="nav-label">Thème</span>
        </button>

      </div>
    </nav>
  );
}
