'use client';

import Link from 'next/link';
import {
  usePathname,
  useRouter,
} from 'next/navigation';
import { useEffect, useState } from 'react';

import { loadSources } from '@/lib/techfeed/prefs';

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

type Source = {
  id: string;
  name: string;
  label?: string;
  color?: string;
  favorite?: boolean;
};

export default function HubMenu() {
  const pathname = usePathname();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [newsOpen, setNewsOpen] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);

  const [theme, setTheme] = useState<'dark' | 'light'>(
    'dark'
  );

  /* Fermeture automatique à chaque changement de page :
     sans ça le panneau resterait ouvert par-dessus la page
     qu'on vient d'ouvrir. */

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  /*
   * Les sources sont relues à chaque ouverture du panneau, et
   * pas une fois pour toutes au montage : le menu vit dans la
   * mise en page globale, il n'est jamais démonté. Sans cette
   * relecture, une source ajoutée depuis les réglages
   * n'apparaîtrait qu'après un rechargement complet.
   */

  useEffect(() => {
    if (!open) return;

    try {
      setSources(loadSources());
    } catch {
      setSources([]);
    }
  }, [open]);

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

            /*
             * News se déplie pour donner accès aux sources.
             * C'est la contrepartie du bouton retiré en haut à
             * droite de la page News : sans lui, il n'existait
             * plus aucun chemin vers la gestion des flux.
             */

            if (section.href === '/tech') {
              return (
                <div
                  key={section.href}
                  className="hub-menu-group"
                >

                  <div
                    className={
                      active
                        ? 'hub-menu-row is-active'
                        : 'hub-menu-row'
                    }
                  >

                    <Link
                      href={section.href}
                      className="hub-menu-row-main"
                    >

                      <span className="hub-menu-row-icon">
                        {section.icon}
                      </span>

                      <span className="hub-menu-row-text">

                        <strong>{section.label}</strong>

                        <small>{section.hint}</small>

                      </span>

                    </Link>

                    <button
                      type="button"
                      className={
                        newsOpen
                          ? 'hub-menu-expand is-open'
                          : 'hub-menu-expand'
                      }
                      onClick={() =>
                        setNewsOpen(!newsOpen)
                      }
                      aria-label={
                        newsOpen
                          ? 'Replier les sources'
                          : 'Déplier les sources'
                      }
                    >
                      ›
                    </button>

                  </div>

                  {newsOpen && (
                    <div className="hub-menu-sub">

                      <button
                        type="button"
                        className="hub-menu-sub-row"
                        onClick={() => {
                          router.push('/tech');
                          setOpen(false);
                        }}
                      >
                        <span className="hub-menu-dot is-all" />
                        Tous les articles
                      </button>

                      {sources.map((source) => (
                        <button
                          key={source.id}
                          type="button"
                          className="hub-menu-sub-row"
                          onClick={() => {
                            router.push(
                              '/tech?source=' +
                                encodeURIComponent(
                                  source.id
                                )
                            );
                            setOpen(false);
                          }}
                        >
                          <span
                            className="hub-menu-dot"
                            style={{
                              background:
                                source.color || undefined,
                            }}
                          />
                          {source.label || source.name}
                        </button>
                      ))}

                      <button
                        type="button"
                        className="hub-menu-sub-row is-settings"
                        onClick={() => {
                          /*
                           * Le tiroir des réglages vit dans la
                           * page News, hors de l'arbre React de
                           * ce menu. Un évènement du navigateur
                           * est le lien le plus simple entre
                           * les deux — pas d'état partagé à
                           * maintenir, et si la page News n'est
                           * pas montée, l'évènement se perd
                           * sans rien casser.
                           */
                          router.push('/tech');
                          setOpen(false);

                          window.setTimeout(() => {
                            window.dispatchEvent(
                              new CustomEvent(
                                'techfeed:open-drawer'
                              )
                            );
                          }, 260);
                        }}
                      >
                        <span className="hub-menu-dot is-settings" />
                        Gérer les sources
                      </button>

                    </div>
                  )}

                </div>
              );
            }

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
