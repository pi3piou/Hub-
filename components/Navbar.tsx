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
 * La bulle ne remplit pas tout l'onglet bord à bord : elle
 * se resserre de quelques pixels de chaque côté, sinon elle
 * touche ses voisines et fait un gros bloc au lieu d'une
 * pastille.
 */

const PILL_INSET = 4;

/*
 * =============================================================
 * RESSORT — la pastille n'est plus repositionnée "au pixel"
 * à chaque pointermove (ce qui donnait ce rendu saccadé) :
 * le doigt ne fait que déplacer une CIBLE, et une boucle
 * requestAnimationFrame fait courir la bulle vers cette cible
 * avec un vrai ressort amorti. Elle a donc de l'inertie, elle
 * dépasse légèrement puis revient, et surtout elle S'ÉCRASE :
 * sa vitesse instantanée étire la bulle dans le sens du
 * mouvement et l'aplatit en hauteur (squash & stretch), comme
 * une goutte de verre. Tout passe par `transform` uniquement,
 * jamais par `left`, donc c'est composité par le GPU et
 * parfaitement fluide.
 * =============================================================
 */

const STIFFNESS = 0.22;
const DAMPING = 0.68;
const PRESS_EASE = 0.26;

/* Vitesse (px/frame) à partir de laquelle la déformation
   est à son maximum. */
const SPEED_REF = 34;

const MAX_STRETCH = 0.22;
const MAX_SQUASH = 0.14;

/*
 * -------------------------------------------------------------
 * GELÉE — un second oscillateur, indépendant du ressort de
 * position. Le ressort de position est amorti (il arrive et
 * s'arrête) ; celui-ci est volontairement SOUS-amorti : on lui
 * donne une pichenette et il rebondit plusieurs fois avant de
 * s'éteindre. C'est ce qui fait le "bouing".
 *
 * `d` est le taux de déformation : positif = aplatie et large,
 * négatif = étirée et étroite. On l'injecte quand on attrape la
 * bulle et quand elle arrive sur un onglet.
 *
 * WOBBLE_STIFFNESS donne la vitesse du rebond, WOBBLE_DAMPING
 * sa persistance. Ces valeurs-ci donnent 3 oscillations sur
 * ~0,6 s, avec une déformation qui va de -14% à +14% en largeur.
 * ATTENTION en les touchant : monter WOBBLE_DAMPING vers 0.9
 * fait passer la gelée à une douzaine d'oscillations sur 1,5 s,
 * ce qui ne ressemble plus à de la gelée mais à un bug.
 * -------------------------------------------------------------
 */

const WOBBLE_STIFFNESS = 0.3;
const WOBBLE_DAMPING = 0.76;

const WOBBLE_X = 0.24;
const WOBBLE_Y = 0.18;

/* Pichenettes : à la prise en main, et à l'arrivée sur
   l'onglet. */

const GRAB_IMPULSE = 0.5;
const LAND_IMPULSE = 0.4;

/* Sous le doigt la bulle DÉBORDE de la barre. La piste fait
   la hauteur des onglets et la barre y ajoute son padding :
   il faut donc dépasser ce padding pour que le débordement
   se voie vraiment — d'autant que la barre gonfle elle aussi
   au toucher. +40% la fait sortir franchement en haut et en
   bas, et elle reprend sa taille exacte une fois posée. */

const MAX_GROW = 0.4;

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
  const pillRef = useRef<HTMLSpanElement | null>(null);

  const itemRefs = useRef<
    Array<HTMLAnchorElement | null>
  >([]);

  const [pillWidth, setPillWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverIndex, setHoverIndex] = useState<
    number | null
  >(null);

  /* Valeurs mutables lues dans la boucle d'animation : elles
     ne doivent JAMAIS passer par un state React, sinon on
     re-rend le composant 60 fois par seconde. */

  const motion = useRef({
    x: 0,
    v: 0,
    target: 0,
    press: 0,
    pressTarget: 0,
    /* déformation "gelée" et sa vitesse */
    d: 0,
    dv: 0,
    /* évite de redéclencher le rebond d'arrivée en boucle
       tant qu'on n'a pas redonné une nouvelle destination */
    landed: true,
    raf: 0,
    ready: false,
  });

  const pillWidthRef = useRef(0);
  const trackWidthRef = useRef(0);
  const trackLeftRef = useRef(0);
  const draggingRef = useRef(false);
  const dragIndexRef = useRef<number | null>(null);

  /*
   * =======================================================
   * BOUCLE DE RESSORT
   * =======================================================
   */

  const frame = () => {
    const m = motion.current;
    const el = pillRef.current;

    if (!el) {
      m.raf = 0;
      return;
    }

    const dx = m.target - m.x;

    m.v = (m.v + dx * STIFFNESS) * DAMPING;
    m.x += m.v;

    m.press += (m.pressTarget - m.press) * PRESS_EASE;

    /* Arrivée sur l'onglet : la bulle a fini sa course, on lui
       donne la pichenette qui la fait trembloter. */

    if (
      !m.landed &&
      !draggingRef.current &&
      Math.abs(dx) < 3
    ) {
      m.dv += LAND_IMPULSE;
      m.landed = true;
    }

    /* Oscillateur sous-amorti de la gelée */

    m.dv += -m.d * WOBBLE_STIFFNESS;
    m.dv *= WOBBLE_DAMPING;
    m.d += m.dv;

    const speed = Math.min(
      Math.abs(m.v) / SPEED_REF,
      1
    );

    const grow = 1 + m.press * MAX_GROW;

    const scaleX =
      grow *
      (1 + speed * MAX_STRETCH + m.d * WOBBLE_X);

    const scaleY =
      grow *
      (1 - speed * MAX_SQUASH - m.d * WOBBLE_Y);

    el.style.transform =
      `translate3d(${m.x}px, 0, 0)` +
      ` scale(${scaleX}, ${scaleY})`;

    const settled =
      Math.abs(dx) < 0.15 &&
      Math.abs(m.v) < 0.15 &&
      Math.abs(m.pressTarget - m.press) < 0.005 &&
      Math.abs(m.d) < 0.002 &&
      Math.abs(m.dv) < 0.002;

    if (settled) {
      m.x = m.target;
      m.v = 0;
      m.press = m.pressTarget;
      m.d = 0;
      m.dv = 0;

      const rest = 1 + m.press * MAX_GROW;

      el.style.transform =
        `translate3d(${m.x}px, 0, 0) scale(${rest})`;

      m.raf = 0;

      return;
    }

    m.raf = window.requestAnimationFrame(frame);
  };

  const kick = () => {
    const m = motion.current;

    if (m.raf === 0) {
      m.raf = window.requestAnimationFrame(frame);
    }
  };

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

      if (!el) return;

      const width = Math.max(
        0,
        el.offsetWidth - PILL_INSET * 2
      );

      pillWidthRef.current = width;
      setPillWidth(width);

      const m = motion.current;

      const nextTarget = el.offsetLeft + PILL_INSET;

      if (Math.abs(nextTarget - m.target) > 1) {
        m.landed = false;
      }

      m.target = nextTarget;

      if (!m.ready) {
        m.x = m.target;
        m.ready = true;
        m.landed = true;
      }

      kick();
    };

    measure();

    window.addEventListener('resize', measure);

    return () => {
      window.removeEventListener('resize', measure);
    };
  }, [activeIndex]);

  useEffect(() => {
    return () => {
      if (motion.current.raf) {
        window.cancelAnimationFrame(motion.current.raf);
      }
    };
  }, []);

  /*
   * =======================================================
   * SUIVI DU DOIGT — le doigt déplace la cible du ressort,
   * et l'onglet survolé s'allume au passage. La navigation
   * n'a lieu qu'au relâchement, pour que la page ne saute
   * pas pendant qu'on balaie la barre.
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

  const tick = () => {
    try {
      const nav = navigator as any;

      if (nav && typeof nav.vibrate === 'function') {
        nav.vibrate(8);
      }
    } catch {
      // vibration non supportee (iOS)
    }
  };

  const scrub = (clientX: number) => {
    const relativeX = clientX - trackLeftRef.current;

    const index = nearestIndexAt(relativeX);

    if (index >= 0 && index !== dragIndexRef.current) {
      dragIndexRef.current = index;
      setHoverIndex(index);
      tick();
    }

    const width = pillWidthRef.current;

    const maxLeft = Math.max(
      PILL_INSET,
      trackWidthRef.current - width - PILL_INSET
    );

    motion.current.target = Math.min(
      Math.max(relativeX - width / 2, PILL_INSET),
      maxLeft
    );

    kick();
  };

  const handlePointerDown = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (!e.isPrimary) return;

    const track = trackRef.current;

    if (!track) return;

    track.setPointerCapture(e.pointerId);

    trackWidthRef.current = track.offsetWidth;
    trackLeftRef.current =
      track.getBoundingClientRect().left;

    draggingRef.current = true;
    setIsDragging(true);

    /* On l'attrape : elle se boudine sous le doigt. */

    motion.current.pressTarget = 1;
    motion.current.dv += GRAB_IMPULSE;

    scrub(e.clientX);
  };

  const handlePointerMove = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (!draggingRef.current) return;

    scrub(e.clientX);
  };

  const endPress = () => {
    if (!draggingRef.current) return;

    draggingRef.current = false;

    setIsDragging(false);
    setHoverIndex(null);

    motion.current.pressTarget = 0;

    const finalIndex = dragIndexRef.current;

    dragIndexRef.current = null;

    if (finalIndex !== null && finalIndex >= 0) {
      const el = itemRefs.current[finalIndex];

      if (el) {
        motion.current.target =
          el.offsetLeft + PILL_INSET;

        /* Nouvelle destination : on réarme le rebond
           d'arrivée. */
        motion.current.landed = false;
      }

      if (finalIndex !== activeIndex) {
        router.push(items[finalIndex].href);
      }
    }

    kick();
  };

  const handleItemClick = (
    e: React.MouseEvent<HTMLAnchorElement>
  ) => {
    /*
     * detail === 0 signale une activation clavier (Entree /
     * Espace) : pas de pointerdown associe, donc on laisse
     * le lien naviguer normalement. Un vrai clic souris ou
     * tactile est deja entierement gere par les gestionnaires
     * de pointeur ci-dessus, donc on l'annule ici pour eviter
     * une double navigation.
     */
    if (e.detail === 0) return;

    e.preventDefault();
  };

  /*
   * Appui long : iOS ouvre sinon l'aperçu de lien (la page
   * apparaît en popover par-dessus l'app) dès qu'on garde le
   * doigt posé sur un onglet — exactement le geste qu'on
   * utilise pour balayer la barre. On coupe donc le menu
   * contextuel, en plus du `-webkit-touch-callout: none`
   * côté CSS qui, seul, ne suffit pas sur toutes les
   * versions.
   */

  const blockLongPress = (e: React.MouseEvent<HTMLElement>) => {
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

  return (
    <nav className="bottom-nav">
      <div
        className={`bottom-nav-inner ${
          isDragging ? 'is-pressed' : ''
        }`}
      >

        <div
          className="nav-track"
          ref={trackRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endPress}
          onPointerCancel={endPress}
          onContextMenu={blockLongPress}
        >

          <span
            className={`nav-pill ${
              isDragging ? 'is-dragging' : ''
            }`}
            ref={pillRef}
            style={{
              width: pillWidth,
              opacity: pillWidth ? 1 : 0,
            }}
          />

          {items.map((item, index) => {
            const active = index === activeIndex;
            const hovered = index === hoverIndex;

            return (
              <Link
                key={item.href}
                href={item.href}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                onClick={handleItemClick}
                onContextMenu={blockLongPress}
                draggable={false}
                className={
                  'nav-item' +
                  (active ? ' active' : '') +
                  (hovered ? ' is-hover' : '')
                }
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
