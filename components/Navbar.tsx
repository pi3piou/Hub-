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

/* Combien de temps sans défilement avant que la pilule
   reprenne sa taille normale, comme la barre de Safari. */
const SCROLL_IDLE_DELAY = 650;

export default function Navbar() {
  const pathname = usePathname();

  const [shrunk, setShrunk] = useState(false);

  const [theme, setTheme] = useState<'dark' | 'light'>(
    'dark'
  );

  const scrollTimer = useRef<number | null>(null);

  /*
   * =======================================================
   * PILULE QUI RÉTRÉCIT PENDANT LE DÉFILEMENT
   * =======================================================
   */

  useEffect(() => {
    const handleScroll = () => {
      setShrunk(true);

      if (scrollTimer.current !== null) {
        window.clearTimeout(scrollTimer.current);
      }

      scrollTimer.current = window.setTimeout(() => {
        setShrunk(false);
      }, SCROLL_IDLE_DELAY);
    };

    window.addEventListener('scroll', handleScroll, {
      passive: true,
    });

    return () => {
      window.removeEventListener(
        'scroll',
        handleScroll
      );

      if (scrollTimer.current !== null) {
        window.clearTimeout(scrollTimer.current);
      }
    };
  }, []);

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
      <div
        className={`bottom-nav-inner ${
          shrunk ? 'is-shrunk' : ''
        }`}
      >
        {items.map((item) => {
          const active =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
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