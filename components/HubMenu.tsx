'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

/*
 * =============================================================
 * MENU LATÉRAL DU HUB — navigation de premier niveau entre les
 * grandes sections. Chaque section garde ensuite sa propre
 * barre du bas (les onglets pour Anime Stream, les sources
 * pour Techfeed) : ce menu ne sert qu'à passer de l'une à
 * l'autre.
 * =============================================================
 */

const sections = [
  {
    href: '/',
    label: 'Accueil',
    icon: '⌂',
    hint: 'Météo, solaire et tâches',
  },
  {
    href: '/tech',
    label: 'News',
    icon: '◈',
    hint: 'Actualité tech',
  },
  {
    href: '/anime',
    label: 'Anime Stream',
    icon: '▶',
    hint: 'Séries et planning',
  },
];

/*
 * Sur la fiche d'un anime, un bouton de retour occupe déjà le
 * coin haut-gauche en position fixe. Y superposer le bouton du
 * menu les rendrait tous les deux inutilisables, donc on
 * l'efface sur ces pages : le menu reste accessible depuis
 * l'accueil de la section, juste derrière.
 */

function hidesMenu(pathname: string) {
  return /^\/anime\/[^/]+/.test(pathname);
}

/*
 * Même clé que la barre d'Anime Stream et que le tiroir de
 * Techfeed : les trois commandes de thème doivent écrire au
 * même endroit, sinon le choix fait dans une section serait
 * oublié dans les autres.
 */

const THEME_KEY = 'anime_theme';

export default function HubMenu() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const [theme, setTheme] = useState<'dark' | 'light'>(
    'dark'
  );

  /* Fermeture automatique à chaque changement de page :
     sans ça le panneau resterait ouvert par-dessus la page
     qu'on vient d'ouvrir. */

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  /* Échap pour fermer, et on bloque le défilement de la page
     derrière le panneau tant qu'il est ouvert. */

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    const previous = document.body.style.overflow;

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);

    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    try {
      if (localStorage.getItem(THEME_KEY) === 'light') {
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

  if (hidesMenu(pathname)) return null;

  return (
    <>

      <button
        type="button"
        className="hub-menu-button"
        onClick={() => setOpen(true)}
        aria-label="Ouvrir le menu"
      >
        <span className="hub-menu-button-icon">☰</span>
      </button>

      <div
        className={
          open
            ? 'hub-menu-scrim is-open'
            : 'hub-menu-scrim'
        }
        onClick={() => setOpen(false)}
        aria-hidden={!open}
      />

      <aside
        className={
          open ? 'hub-menu is-open' : 'hub-menu'
        }
      >

        <div className="hub-menu-head">

          <span className="hub-menu-title">Hub</span>

          <button
            type="button"
            className="hub-menu-close"
            onClick={() => setOpen(false)}
            aria-label="Fermer le menu"
          >
            ✕
          </button>

        </div>

        <nav className="hub-menu-list">

          {sections.map((section) => {
            const active =
              section.href === '/'
                ? pathname === '/'
                : pathname.startsWith(section.href);

            return (
              <Link
                key={section.href}
                href={section.href}
                className={
                  active
                    ? 'hub-menu-row is-active'
                    : 'hub-menu-row'
                }
              >

                <span className="hub-menu-row-icon">
                  {section.icon}
                </span>

                <span className="hub-menu-row-text">

                  <strong>{section.label}</strong>

                  <small>{section.hint}</small>

                </span>

              </Link>
            );
          })}

        </nav>

        {/*
          Le thème se règle aussi depuis la barre d'Anime
          Stream et depuis le tiroir des News, mais l'accueil
          du hub n'a ni l'une ni l'autre : sans cette entrée,
          il serait impossible de basculer depuis la page
          d'accueil.
        */}

        <button
          type="button"
          className="hub-menu-theme"
          onClick={toggleTheme}
        >

          <span className="hub-menu-row-icon">
            {theme === 'dark' ? '☾' : '☀'}
          </span>

          <span className="hub-menu-row-text">

            <strong>
              Thème {theme === 'dark' ? 'sombre' : 'clair'}
            </strong>

            <small>Toucher pour basculer</small>

          </span>

        </button>

      </aside>

    </>
  );
}
