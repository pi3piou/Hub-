'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
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
 * =============================================================
 * PASTILLE VIVANTE — la petite bulle de verre se colle sous le
 * doigt et le suit en continu sur toute la largeur de la barre
 * pendant l'appui (aucune transition, recopie 1:1 la position
 * du pointeur), puis "BAM" elle se règle en ressort sur
 * l'onglet relâché grâce à `--ease-spring`. Au repos, elle
 * reste simplement calée sous l'onglet actif.
 * =============================================================
 */

export default function Navbar() {
  const pathname = usePathname();
  const router = useRouter();

  const [theme, setTheme] = useState<'dark' | 'light'>(
    'dark'
  );

  const activeIndex = items.findIndex((item) =>
    item.href === '/'
      ? pathname === '/'
      : pathname.startsWith(item.href)
  );

  const trackRef = useRef<HTMLDivElement | null>(null);

  const itemRefs = useRef<
    Array<HTMLAnchorElement | null>
  >([]);

  const [restPill, setRestPill] = useState<{
    left: number;
    width: number;
  } | null>(null);

  const [dragPill, setDragPill] = useState<{
    left: number;
    width: number;
  } | null>(null);

  const [isDragging, setIsDragging] = useState(false);

  const dragIndexRef = useRef<number | null>(null);
  const trackWidthRef = useRef(0);

  /*
   * =======================================================
   * POSITION AU REPOS — mesurée après chaque changement de
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
        setRestPill({
          left: el.offsetLeft,
          width: el.offsetWidth,
        });
      } else {
        setRestPill(null);
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
   * SUIVI DU DOIGT — pointerdown/move/up capturés sur la
   * piste des 3 onglets. Tant que ça appuie, la pastille
   * recopie la position X du pointeur sans aucune animation
   * (suivi 1:1). Au relâchement, on navigue si besoin et la
   * pastille retombe en ressort sur sa position de repos.
   * =======================================================
   */

  const nearestIndexAt = (relativeX: number) => {
    let best = -1;
    let bestDist = Infinity;

    itemRefs.current.forEach((el, index) => {
      if (!el) return;

      const center = el.offsetLeft + el.offsetWidth / 2;
      const dist = Math.abs(relativeX - center);

      if (dist < bestDist) {
        bestDist = dist;
        best = index;
      }
    });

    return best;
  };

  const updateDragPosition = (relativeX: number) => {
    const index = nearestIndexAt(relativeX);

    if (index < 0) return;

    dragIndexRef.current = index;

    const el = itemRefs.current[index];

    if (!el) return;

    const width = el.offsetWidth;
    const maxLeft = Math.max(
      0,
      trackWidthRef.current - width
    );
    const left = Math.min(
      Math.max(relativeX - width / 2, 0),
      maxLeft
    );

    setDragPill({ left, width });
  };

  const handlePointerDown = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (!e.isPrimary) return;

    const track = trackRef.current;

    if (!track) return;

    track.setPointerCapture(e.pointerId);
    trackWidthRef.current = track.offsetWidth;

    const relativeX =
      e.clientX - track.getBoundingClientRect().left;

    setIsDragging(true);
    updateDragPosition(relativeX);
  };

  const handlePointerMove = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (!isDragging) return;

    const track = trackRef.current;

    if (!track) return;

    const relativeX =
      e.clientX - track.getBoundingClientRect().left;

    updateDragPosition(relativeX);
  };

  const endPress = () => {
    setIsDragging(false);

    const finalIndex = dragIndexRef.current;

    dragIndexRef.current = null;

    if (finalIndex !== null && finalIndex !== activeIndex) {
      router.push(items[finalIndex].href);
    }
  };

  const handlePointerUp = () => {
    endPress();
  };

  const handlePointerCancel = () => {
    endPress();
  };

  const handleItemClick = (
    e: React.MouseEvent<HTMLAnchorElement>
  ) => {
    /*
     * detail === 0 signale une activation clavier (Entrée /
     * Espace) : pas de pointerdown associé, donc on laisse
     * le lien naviguer normalement. Un vrai clic souris ou
     * tactile est déjà entièrement géré par les gestionnaires
     * de pointeur ci-dessus, donc on l'annule ici pour éviter
     * une double navigation.
     */
    if (e.detail === 0) return;

    e.preventDefault();
  };

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

  const shownPill = isDragging ? dragPill : restPill;

  return (
    <nav className="bottom-nav">
      <div className="bottom-nav-inner">

        <div
          className="nav-track"
          ref={trackRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        >

          {shownPill && (
            <span
              className={`nav-pill ${
                isDragging ? 'is-dragging' : ''
              }`}
              style={{
                left: shownPill.left,
                width: shownPill.width,
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
                onClick={handleItemClick}
                className={`nav-item ${active ? 'active' : ''}`}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">
                  {item.label}
                </span>
              </Link>
            );
          })}

        </div>

        <button
          type="button"
          className="nav-item nav-theme-button"
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
