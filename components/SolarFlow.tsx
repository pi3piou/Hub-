'use client';

/*
 * =============================================================
 * FLUX SOLAIRE — trois nœuds, des billes qui remontent
 *
 * Les icônes sont DESSINÉES ici, en SVG. La version
 * précédente utilisait trois caractères de police (☀ ⌂ ⌁) :
 * on héritait alors du dessin de la police du système, sans
 * aucun contrôle sur l'épaisseur, le cadrage ou le style — et
 * ça se voyait, les trois n'appartenaient visiblement pas à
 * la même famille.
 *
 * Les billes descendent du nœud de départ, longent le bas, et
 * REMONTENT dans le nœud d'arrivée. Ce détour par le bas rend
 * le sens du courant lisible d'un coup d'œil, là où un trait
 * droit entre deux cercles ne dit rien de la direction.
 *
 * Tout est dans un seul SVG à viewBox fixe : le dessin
 * s'adapte à la largeur sans qu'aucune coordonnée n'ait à
 * être recalculée en JavaScript.
 * =============================================================
 */

const VW = 320;
const VH = 138;

const NODE_R = 27;
const NODE_Y = 40;

const SUN_X = 42;
const HOUSE_X = 160;
const GRID_X = 278;

/* Hauteur du couloir où circulent les billes. */
const LANE_Y = 108;

const BEADS = [0, 1, 2, 3];

/*
 * Vitesse des billes, en secondes par traversée complète.
 *
 * Le trajet fait le tour par le bas : il est bien plus long
 * qu'il n'en a l'air, presque deux cents unités. Une traversée
 * en une seconde donnait donc des billes filantes, illisibles.
 *
 * Le palier de pleine vitesse est calé à 6 kW pour qu'une
 * production ordinaire tombe au MILIEU de la plage : si le
 * palier était au niveau habituel, tout se passerait à fond
 * toute la journée et la vitesse ne dirait plus rien.
 */

const SLOWEST = 9;
const FASTEST = 3;
const FULL_SPEED_W = 6000;

function duration(watts: number) {
  const ratio = Math.min(Math.abs(watts) / FULL_SPEED_W, 1);

  return SLOWEST - (SLOWEST - FASTEST) * ratio;
}

function formatWatts(value: number | null) {
  if (value === null) return '—';

  const watts = Math.round(value);

  if (Math.abs(watts) >= 1000) {
    return (
      (watts / 1000).toFixed(1).replace('.', ',') + ' kW'
    );
  }

  return watts + ' W';
}

/* Trajet en U : on descend, on longe, on remonte. */

function lanePath(fromX: number, toX: number) {
  return (
    `M${fromX} ${NODE_Y + NODE_R}` +
    ` V${LANE_Y}` +
    ` H${toX}` +
    ` V${NODE_Y + NODE_R}`
  );
}

type Props = {
  production: number | null;
  consumption: number | null;
  grid: number | null;
};

function Beads({
  id,
  watts,
}: {
  id: string;
  watts: number;
}) {
  /*
   * En dessous de 20 W, rien ne circule. Un onduleur au repos
   * n'affiche jamais zéro pile, et des billes rampant pour
   * 3 W laisseraient croire à un flux réel.
   */

  if (Math.abs(watts) < 20) return null;

  const seconds = duration(watts);

  return (
    <>
      {BEADS.map((index) => (
        <circle
          key={index}
          className="flow-bead"
          r={3.5}
          style={{
            animationDuration: seconds + 's',
            animationDelay:
              -(seconds / BEADS.length) * index + 's',
          }}
        >
          {/*
            `begin` négatif décale la PHASE : la bille démarre
            comme si l'animation tournait déjà depuis ce
            temps-là. C'est ce qui les répartit le long du
            trajet dès la première image, au lieu de les faire
            apparaître les unes après les autres.
          */}
          <animateMotion
            dur={seconds + 's'}
            begin={
              -(seconds / BEADS.length) * index + 's'
            }
            repeatCount="indefinite"
            rotate="0"
          >
            <mpath href={'#' + id} />
          </animateMotion>

          {/*
            La COULEUR est animée en CSS, pas ici. SMIL
            n'interpole pas les variables CSS : il aurait fallu
            écrire les teintes en dur et perdre le thème clair.
            Le CSS, lui, les résout — d'où ce partage des
            rôles, le mouvement à SMIL, la couleur au CSS, avec
            la même durée et le même décalage de phase.
          */}

          <animate
            attributeName="opacity"
            values="0;1;1;0"
            keyTimes="0;0.14;0.86;1"
            dur={seconds + 's'}
            begin={
              -(seconds / BEADS.length) * index + 's'
            }
            repeatCount="indefinite"
          />
        </circle>
      ))}
    </>
  );
}

export default function SolarFlow({
  production,
  consumption,
  grid,
}: Props) {
  const pv = production ?? 0;
  const load = consumption ?? 0;
  const net = grid ?? 0;

  /* Ce que la maison prend directement au soleil : on ne peut
     autoconsommer ni plus qu'on ne produit, ni plus qu'on ne
     consomme. */

  const selfUse = Math.min(pv, load);

  /* `net` positif = soutirage. Le trajet de droite change donc
     de sens selon le signe. */

  const importing = net > 0;

  return (
    <div className="flow">

      <svg
        className="flow-svg"
        viewBox={`0 0 ${VW} ${VH}`}
        role="img"
        aria-label="Circulation de l'énergie entre le soleil, la maison et le réseau"
      >

        <defs>
          <path
            id="flow-sun-house"
            d={lanePath(SUN_X, HOUSE_X)}
          />
          <path
            id="flow-house-grid"
            d={lanePath(HOUSE_X, GRID_X)}
          />
          <path
            id="flow-grid-house"
            d={lanePath(GRID_X, HOUSE_X)}
          />
        </defs>

        {/* --- les couloirs, en trait fin --- */}

        <path
          className="flow-lane"
          d={lanePath(SUN_X, HOUSE_X)}
        />

        <path
          className="flow-lane"
          d={lanePath(HOUSE_X, GRID_X)}
        />

        {/* --- SOLEIL --- */}

        <g transform={`translate(${SUN_X} ${NODE_Y})`}>

          <circle
            className="flow-ring is-sun"
            r={NODE_R}
          />

          <circle className="flow-glyph is-sun" r={7} />

          {[0, 45, 90, 135, 180, 225, 270, 315].map(
            (angle) => (
              <line
                key={angle}
                className="flow-glyph-line is-sun"
                x1={0}
                y1={-11}
                x2={0}
                y2={-15}
                transform={`rotate(${angle})`}
              />
            )
          )}

        </g>

        {/* --- MAISON --- */}

        <g transform={`translate(${HOUSE_X} ${NODE_Y})`}>

          <circle
            className="flow-ring is-house"
            r={NODE_R}
          />

          {/* Toit et corps en un seul tracé continu : deux
              formes séparées se désalignaient d'un demi-pixel
              selon la mise à l'échelle. */}
          <path
            className="flow-glyph-line is-house"
            d="M-11 -1 L0 -10 L11 -1 M-8 -1 L-8 11 L8 11 L8 -1"
          />

          <path
            className="flow-glyph-line is-house"
            d="M-2.5 11 L-2.5 3.5 L2.5 3.5 L2.5 11"
          />

        </g>

        {/* --- RÉSEAU : un pylône, pas un éclair --- */}

        <g transform={`translate(${GRID_X} ${NODE_Y})`}>

          <circle
            className="flow-ring is-grid"
            r={NODE_R}
          />

          <path
            className="flow-glyph-line is-grid"
            d="M-9 12 L-3.5 -11 L3.5 -11 L9 12 M-6.6 -2 L6.6 -2 M-7.8 5 L7.8 5 M-3.5 -11 L3.5 -11"
          />

          <path
            className="flow-glyph-line is-grid"
            d="M-12 -8 L-3.9 -8 M12 -8 L3.9 -8"
          />

        </g>

        {/* --- les billes --- */}

        <Beads id="flow-sun-house" watts={selfUse} />

        <Beads
          id={
            importing
              ? 'flow-grid-house'
              : 'flow-house-grid'
          }
          watts={net}
        />

      </svg>

      <div className="flow-values">

        <div className="flow-value">
          <strong>{formatWatts(production)}</strong>
          <small>Production</small>
        </div>

        <div className="flow-value">
          <strong>{formatWatts(consumption)}</strong>
          <small>Maison</small>
        </div>

        <div className="flow-value">
          <strong>
            {formatWatts(
              grid === null ? null : Math.abs(grid)
            )}
          </strong>
          <small>
            {grid === null
              ? 'Réseau'
              : importing
                ? 'Soutiré'
                : 'Injecté'}
          </small>
        </div>

      </div>

    </div>
  );
}
