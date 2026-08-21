'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

/*
 * =============================================================
 * BARRE DES SOURCES — même verre et même physique que la barre
 * d'onglets d'Anime Stream : la pastille se colle sous le
 * doigt, se déforme comme de la gelée, et la navigation n'a
 * lieu qu'au relâchement.
 *
 * Une différence de fond avec celle d'Anime Stream : ici le
 * nombre d'onglets est variable et la barre DÉFILE
 * horizontalement. Tous les calculs de position se font donc
 * en coordonnées de CONTENU (offsetLeft), jamais en
 * coordonnées d'écran. C'est précisément ce qui n'allait pas
 * avant : les positions des onglets étaient mesurées à l'écran
 * au début du geste, puis la barre défilait toute seule quand
 * on approchait du bord — et la cible dérivait d'autant.
 * =============================================================
 */

/*
 * useLayoutEffect n'existe pas au rendu serveur et React
 * l'annonce bruyamment en console. On bascule sur useEffect
 * de ce côté-là : la mesure initiale ne concerne de toute
 * façon que le navigateur.
 */

const useIsoLayoutEffect =
  typeof window !== 'undefined'
    ? useLayoutEffect
    : useEffect;

const PILL_INSET = 4;

/* Ressort de position */
const STIFFNESS = 0.22;
const DAMPING = 0.68;
const PRESS_EASE = 0.26;

const SPEED_REF = 34;
const MAX_STRETCH = 0.22;
const MAX_SQUASH = 0.14;
const MAX_GROW = 0.4;

/* Gelée : grosse déformation, un seul rebond */
const WOBBLE_STIFFNESS = 0.2;
const WOBBLE_DAMPING = 0.64;
const WOBBLE_X = 0.38;
const WOBBLE_Y = 0.3;
const GRAB_IMPULSE = 1.2;
const LAND_IMPULSE = 0.95;

/* Défilement automatique quand le doigt approche d'un bord */
const EDGE = 56;
const EDGE_SPEED = 12;

export default function TabBar({
  tabs,
  active,
  onChange,
  mode,
}) {
  const trackRef = useRef(null);
  const pillRef = useRef(null);
  const btnRefs = useRef({});

  const [pillWidth, setPillWidth] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [hoverId, setHoverId] = useState(null);

  const motion = useRef({
    x: 0,
    v: 0,
    target: 0,
    press: 0,
    pressTarget: 0,
    d: 0,
    dv: 0,
    landed: true,
    raf: 0,
    ready: false,
  });

  const pillWidthRef = useRef(0);
  const draggingRef = useRef(false);
  const dragIdRef = useRef(null);
  const pointerXRef = useRef(0);

  /*
   * =======================================================
   * BOUCLE — ressort de position, gelée, et défilement de
   * bord. Tout est fait ici pour n'avoir qu'une seule
   * lecture du DOM par image.
   * =======================================================
   */

  const frame = () => {
    const m = motion.current;
    const el = pillRef.current;
    const track = trackRef.current;

    if (!el || !track) {
      m.raf = 0;
      return;
    }

    /* Défilement automatique près des bords, uniquement
       pendant le glissement. */

    if (draggingRef.current) {
      const box = track.getBoundingClientRect();
      const maxScroll =
        track.scrollWidth - track.clientWidth;

      if (maxScroll > 0) {
        const fromLeft = pointerXRef.current - box.left;
        const fromRight = box.right - pointerXRef.current;

        if (fromLeft < EDGE && track.scrollLeft > 0) {
          track.scrollLeft -=
            EDGE_SPEED *
            (1 - Math.max(fromLeft, 0) / EDGE);
        } else if (
          fromRight < EDGE &&
          track.scrollLeft < maxScroll
        ) {
          track.scrollLeft +=
            EDGE_SPEED *
            (1 - Math.max(fromRight, 0) / EDGE);
        }
      }

      /* La cible est recalculée à CHAQUE image à partir du
         scrollLeft courant : c'est ce qui empêche la dérive
         pendant que la barre défile. */

      aimAt(pointerXRef.current);
    }

    const dx = m.target - m.x;

    m.v = (m.v + dx * STIFFNESS) * DAMPING;
    m.x += m.v;

    m.press += (m.pressTarget - m.press) * PRESS_EASE;

    if (
      !m.landed &&
      !draggingRef.current &&
      Math.abs(dx) < 3
    ) {
      m.dv += LAND_IMPULSE;
      m.landed = true;
    }

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
      !draggingRef.current &&
      Math.abs(dx) < 0.15 &&
      Math.abs(m.v) < 0.15 &&
      Math.abs(m.pressTarget - m.press) < 0.005 &&
      Math.abs(m.d) < 0.004 &&
      Math.abs(m.dv) < 0.004;

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
   * Convertit une position de doigt (coordonnée d'écran) en
   * position dans le contenu de la barre, puis en déduit
   * l'onglet survolé et la cible du ressort.
   */

  function aimAt(clientX) {
    const track = trackRef.current;

    if (!track) return;

    const box = track.getBoundingClientRect();
    const contentX =
      clientX - box.left + track.scrollLeft;

    let bestId = null;
    let bestDist = Infinity;

    for (const tab of tabs) {
      const el = btnRefs.current[tab.id];

      if (!el) continue;

      const center = el.offsetLeft + el.offsetWidth / 2;
      const dist = Math.abs(contentX - center);

      if (dist < bestDist) {
        bestDist = dist;
        bestId = tab.id;
      }
    }

    if (bestId !== null && bestId !== dragIdRef.current) {
      dragIdRef.current = bestId;
      setHoverId(bestId);

      try {
        if (navigator.vibrate) navigator.vibrate(8);
      } catch (e) {
        // vibration non supportee (iOS)
      }
    }

    const width = pillWidthRef.current;

    const maxLeft = Math.max(
      PILL_INSET,
      track.scrollWidth - width - PILL_INSET
    );

    motion.current.target = Math.min(
      Math.max(contentX - width / 2, PILL_INSET),
      maxLeft
    );
  }

  /*
   * =======================================================
   * POSITION AU REPOS — recalculée quand l'onglet actif ou
   * la liste des sources change, et à chaque
   * redimensionnement.
   * =======================================================
   */

  useIsoLayoutEffect(() => {
    const measure = () => {
      const el = btnRefs.current[active];

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

    /* On amène l'onglet actif dans le champ de vision, mais
       seulement quand le doigt n'est pas en train de tenir la
       barre — sinon on lutterait contre le geste. */

    if (!draggingRef.current) {
      const el = btnRefs.current[active];

      if (el && el.scrollIntoView) {
        el.scrollIntoView({
          block: 'nearest',
          inline: 'center',
          behavior: 'smooth',
        });
      }
    }

    window.addEventListener('resize', measure);
    window.addEventListener(
      'orientationchange',
      measure
    );

    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener(
        'orientationchange',
        measure
      );
    };
  }, [active, tabs]);

  useEffect(() => {
    return () => {
      if (motion.current.raf) {
        window.cancelAnimationFrame(motion.current.raf);
      }
    };
  }, []);

  /*
   * =======================================================
   * GESTES — évènements POINTER, donc doigt, souris et
   * trackpad indifféremment. L'ancienne version n'écoutait
   * que `touch` : au trackpad de l'iPad, la barre était
   * inerte.
   * =======================================================
   */

  const onPointerDown = (e) => {
    if (!e.isPrimary) return;

    const track = trackRef.current;

    if (!track) return;

    try {
      track.setPointerCapture(e.pointerId);
    } catch (err) {
      // capture non supportee
    }

    draggingRef.current = true;
    setIsDragging(true);

    pointerXRef.current = e.clientX;

    motion.current.pressTarget = 1;
    motion.current.dv += GRAB_IMPULSE;

    aimAt(e.clientX);
    kick();
  };

  const onPointerMove = (e) => {
    if (!draggingRef.current) return;

    pointerXRef.current = e.clientX;
  };

  const endPress = () => {
    if (!draggingRef.current) return;

    draggingRef.current = false;

    setIsDragging(false);
    setHoverId(null);

    motion.current.pressTarget = 0;

    const id = dragIdRef.current;

    dragIdRef.current = null;

    if (id !== null) {
      const el = btnRefs.current[id];

      if (el) {
        motion.current.target =
          el.offsetLeft + PILL_INSET;
        motion.current.landed = false;
      }

      if (id !== active) onChange(id);
    }

    kick();
  };

  return (
    <nav
      className={
        isDragging
          ? 'tab-bar is-pressed'
          : 'tab-bar'
      }
    >

      {/*
        Le defilement horizontal vit dans cette piste, pas sur
        la barre elle-meme. Raison : `overflow-x: auto` rogne
        AUSSI verticalement (des qu'un axe est rogne, l'autre
        cesse d'etre visible), et la pastille ne pouvait donc
        jamais depasser de la barre en gonflant. La piste
        deborde volontairement de 14px en haut et en bas grace
        a une marge negative, ce qui repousse la frontiere de
        rognage hors du verre.
      */}

      <div
        className="tab-scroll"
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPress}
        onPointerCancel={endPress}
        onContextMenu={(e) => e.preventDefault()}
      >

      <span
        className={
          isDragging
            ? 'tab-thumb is-dragging'
            : 'tab-thumb'
        }
        ref={pillRef}
        style={{
          width: pillWidth,
          opacity: pillWidth ? 1 : 0,
        }}
      />

      {tabs.map((tab) => {
        const isActive = tab.id === active;
        const isHover = tab.id === hoverId;

        /* Mode icône : réglé dans le tiroir. L'onglet
           "Tous" garde toujours son libellé, il n'a pas
           d'icône de source. */

        const asIcon =
          mode === 'icon' && tab.id !== 'all';

        return (
          <button
            key={tab.id}
            type="button"
            ref={(el) => {
              btnRefs.current[tab.id] = el;
            }}
            className={
              'tab-btn' +
              (isActive ? ' active' : '') +
              (isHover ? ' is-hover' : '') +
              (asIcon ? ' icon-mode' : '')
            }
            onClick={(e) => {
              /*
               * Le geste de pointeur gère déjà la sélection.
               * On n'accepte ici que l'activation clavier
               * (detail === 0), sinon un tap déclencherait
               * deux changements d'onglet.
               */
              if (e.detail === 0) onChange(tab.id);
            }}
          >
            {asIcon ? (
              tab.icon ? (
                <img
                  src={tab.icon}
                  alt={tab.label}
                  className="tab-icon"
                  referrerPolicy="no-referrer"
                  draggable={false}
                />
              ) : (
                <span className="tab-initial">
                  {tab.label.slice(0, 2)}
                </span>
              )
            ) : (
              tab.label
            )}
          </button>
        );
      })}

      </div>

    </nav>
  );
}
