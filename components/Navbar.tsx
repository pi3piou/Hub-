'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

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
 * La pilule ne bouge plus au défilement — comme la barre
 * d'onglets d'Apple TV+, elle reste immobile. Le soin est
 * mis dans le verre lui-même (voir .bottom-nav-inner dans
 * globals.css) plutôt que dans un effet de rétrécissement.
 */

export default function Navbar() {
  const pathname = usePathname();

  const [theme, setTheme] = useState<'dark' | 'light'>(
    'dark'
  );

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
