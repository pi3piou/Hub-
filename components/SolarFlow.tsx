'use client';

/*
 * =============================================================
 * FLUX SOLAIRE — TROIS SEGMENTS, UN TRONC COMMUN
 *
 * Les icônes sont DESSINÉES ici, en SVG. La version d'origine
 * utilisait trois caractères de police (☀ ⌂ ⌁) : on héritait
 * alors du dessin de la police du système, sans aucun contrôle
 * sur l'épaisseur, le cadrage ou le style.
 *
 * Les billes descendent, longent le bas, et REMONTENT dans le
 * nœud d'arrivée. Ce détour rend le sens du courant lisible
 * d'un coup d'œil.
 *
 * ------------------------------------------------------------
 * CE QUI A CHANGÉ, ET POURQUOI
 *
 * Le dessin était fait de TRAJETS complets — soleil→maison,
 * soleil→réseau — qui se recouvraient sur une partie de leur
 * longueur. Deux conséquences :
 *
 *   1. Les traits restaient affichés la nuit. On ne peut pas
 *      effacer un morceau partagé sans effacer les deux
 *      trajets qui le traversent.
 *
 *   2. Le départ des deux trajets s'empilait sous le soleil,
 *      ce qui déséquilibrait le dessin vers la gauche.
 *
 * Il est maintenant fait de trois SEGMENTS qui se rejoignent
 * sous la maison, et chacun transporte exactement une
 * grandeur :
 *
 *      gauche  → la production
 *      montant → ce que consomme la maison
 *      droit   → l'échange avec le réseau
 *
 * Chacun peut donc s'effacer indépendamment. La nuit, le
 * segment gauche disparaît. À l'équilibre parfait entre
 * production et consommation, c'est le segment droit qui s'en
 * va. C'est vrai physiquement, et c'est ce qui rend le schéma
 * honnête : un trait affiché veut dire qu'il y passe du
 * courant.
 * =============================================================
 */

const VW = 320;

/*
 * Un seul niveau de couloir au lieu de deux, donc 26 unités de
 * hauteur gagnées sur l'accueil — où chaque ligne compte.
 */
const VH = 128;

const NODE_R = 27;
const NODE_Y = 40;

const SUN_X = 42;
const HOUSE_X = 160;
const GRID_X = 278;

/* Le point de partage, sous la maison. */
const LANE_Y = 112;

const NODE_BOTTOM = NODE_Y + NODE_R;

/*
 * En dessous de ce seuil, ni trait ni bille. Un onduleur au
 * repos n'affiche jamais zéro pile, et des billes rampant pour
 * 3 W laisseraient croire à un flux réel.
 */
const MIN_WATTS = 20;

/*
 * Vitesse, en secondes pour parcourir un segment de référence.
 *
 * Le palier de pleine vitesse est calé à 6 kW pour qu'une
 * production ordinaire tombe au MILIEU de la plage : au niveau
 * habituel, tout se passerait à fond toute la journée et la
 * vitesse ne dirait plus rien.
 */
const SLOWEST = 14;
const FASTEST = 5;
const FULL_SPEED_W = 6000;

/*
 * Longueurs réelles des tracés, en unités de la viewBox. Le
 * montant est presque quatre fois plus court que les deux
 * autres : à durée égale ses billes ramperaient pendant que
 * celles du bas fileraient. La durée est donc proportionnelle
 * à la longueur, ce qui donne la même vitesse partout.
 */
const DROP = LANE_Y - NODE_BOTTOM;          /* 45 */
const RUN = HOUSE_X - SUN_X;                /* 118 */
const LONG_LEN = DROP + RUN;                /* 163 */
const SHORT_LEN = DROP;                     /* 45  */
const REF_LEN = LONG_LEN;

/* Une bille toutes les 45 unités environ : le montant en
   reçoit une seule, les deux longs segments quatre. Quatre
   billes sur 45 unités s'empileraient. */
const SPACING = 45;

function beadCount(length: number) {
  return Math.max(1, Math.round(length / SPACING));
}

function duration(watts: number, length: number) {
  const ratio = Math.min(
    Math.abs(watts) / FULL_SPEED_W,
    1
  );

  const base =
    SLOWEST - (SLOWEST - FASTEST) * ratio;

  return base * (length / REF_LEN);
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

/* =========================================================
   LES TROIS TRACÉS

   Le trait dessiné est le même quel que soit le sens du
   courant ; seul le TRAJET des billes s'inverse. D'où deux
   familles distinctes : `LANE_*` pour ce qu'on voit, `BEAD_*`
   pour ce que suivent les billes.
   ========================================================= */

const LANE_SUN = `M${SUN_X} ${NODE_BOTTOM} V${LANE_Y} H${HOUSE_X}`;
const LANE_HOUSE = `M${HOUSE_X} ${LANE_Y} V${NODE_BOTTOM}`;
const LANE_GRID = `M${HOUSE_X} ${LANE_Y} H${GRID_X} V${NODE_BOTTOM}`;

const BEAD_SUN = LANE_SUN;
const BEAD_HOUSE = LANE_HOUSE;
const BEAD_GRID_OUT = LANE_GRID;
const BEAD_GRID_IN = `M${GRID_X} ${NODE_BOTTOM} V${LANE_Y} H${HOUSE_X}`;

type Props = {
  production: number | null;
  consumption: number | null;
  grid: number | null;
};

/* =========================================================
   UN SEGMENT
   ========================================================= */

function Segment({
  id,
  lane,
  bead,
  watts,
  length,
  fromGrid,
}: {
  id: string;
  lane: string;
  bead: string;
  watts: number;
  length: number;
  fromGrid: boolean;
}) {
  const active = Math.abs(watts) >= MIN_WATTS;

  const seconds = duration(watts, length);
  const count = beadCount(length);

  return (
    <>
      <defs>
        <path id={id} d={bead} />
      </defs>

      {/*
        Le trait reste monté et s'efface en opacité plutôt que
        d'être retiré du DOM : un segment qui disparaît d'un
        coup au coucher du soleil se remarque à peine, un
        segment qui s'estompe se lit.
      */}
      <path
        className={
          active ? 'flow-lane' : 'flow-lane is-off'
        }
        d={lane}
      />

      {active &&
        Array.from({ length: count }).map((_, index) => (
          <circle
            key={index}
            className={
              fromGrid
                ? 'flow-bead is-from-grid'
                : 'flow-bead'
            }
            r={3.5}
            style={{
              animationDuration: seconds + 's',
              animationDelay:
                -(seconds / count) * index + 's',
            }}
          >
            {/*
              `begin` négatif décale la PHASE : la bille démarre
              comme si l'animation tournait déjà depuis ce
              temps-là. C'est ce qui les répartit le long du
              trajet dès la première image.
            */}
            <animateMotion
              dur={seconds + 's'}
              begin={-(seconds / count) * index + 's'}
              repeatCount="indefinite"
              rotate="0"
            >
              <mpath href={'#' + id} />
            </animateMotion>

            {/*
              La COULEUR est animée en CSS, pas ici. SMIL
              n'interpole pas les variables CSS : il aurait
              fallu écrire les teintes en dur et perdre le
              thème clair.
            */}
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              keyTimes="0;0.14;0.86;1"
              dur={seconds + 's'}
              begin={-(seconds / count) * index + 's'}
              repeatCount="indefinite"
            />
          </circle>
        ))}
    </>
  );
}

/* =========================================================
   LE SCHÉMA
   ========================================================= */

export default function SolarFlow({
  production,
  consumption,
  grid,
}: Props) {
  const pv = production ?? 0;
  const load = consumption ?? 0;
  const net = grid ?? 0;

  /* `net` positif = soutirage. Le trajet de droite change donc
     de sens selon le signe. */
  const importing = net > 0;

  const exchange = Math.abs(net);

  const sunOn = pv >= MIN_WATTS;
  const houseOn = load >= MIN_WATTS;
  const gridOn = exchange >= MIN_WATTS;

  /*
   * Le montant prend la couleur du réseau uniquement quand le
   * soleil ne donne rien du tout : c'est alors bien du courant
   * réseau qui monte à la maison. Dès qu'il y a de la
   * production, même partielle, elle est prioritaire dans
   * l'autoconsommation — la teinte solaire reste juste.
   */
  const houseFedByGrid = !sunOn;

  const label = sunOn
    ? importing
      ? 'Le soleil et le réseau alimentent la maison'
      : 'Le soleil alimente la maison et injecte le surplus au réseau'
    : 'Le réseau alimente la maison, le soleil ne produit pas';

  return (
    <div className="flow">

      <svg
        className="flow-svg"
        viewBox={`0 0 ${VW} ${VH}`}
        role="img"
        aria-label={label}
      >

        {/* --- SEGMENT GAUCHE : la production --- */}

        <Segment
          id="flow-seg-sun"
          lane={LANE_SUN}
          bead={BEAD_SUN}
          watts={pv}
          length={LONG_LEN}
          fromGrid={false}
        />

        {/* --- MONTANT : ce que consomme la maison --- */}

        <Segment
          id="flow-seg-house"
          lane={LANE_HOUSE}
          bead={BEAD_HOUSE}
          watts={load}
          length={SHORT_LEN}
          fromGrid={houseFedByGrid}
        />

        {/* --- SEGMENT DROIT : l'échange avec le réseau --- */}

        <Segment
          id="flow-seg-grid"
          lane={LANE_GRID}
          bead={importing ? BEAD_GRID_IN : BEAD_GRID_OUT}
          watts={exchange}
          length={LONG_LEN}
          fromGrid={importing}
        />

        {/*
          Un nœud dont plus rien ne part ni n'arrive s'estompe
          avec son segment. La nuit, un soleil en pleine
          couleur relié à rien raconterait encore quelque chose
          de faux.
        */}

        {/* --- SOLEIL --- */}

        <g
          className={
            sunOn ? 'flow-node' : 'flow-node is-dim'
          }
          transform={`translate(${SUN_X} ${NODE_Y})`}
        >

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

        <g
          className={
            houseOn ? 'flow-node' : 'flow-node is-dim'
          }
          transform={`translate(${HOUSE_X} ${NODE_Y})`}
        >

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

        <g
          className={
            gridOn ? 'flow-node' : 'flow-node is-dim'
          }
          transform={`translate(${GRID_X} ${NODE_Y})`}
        >

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

      </svg>

      <div className="flow-values">

        <div className="flow-value">
          <strong className={sunOn ? undefined : 'is-idle'}>
            {formatWatts(production)}
          </strong>
          <small>Production</small>
        </div>

        <div className="flow-value">
          <strong className={houseOn ? undefined : 'is-idle'}>
            {formatWatts(consumption)}
          </strong>
          <small>Maison</small>
        </div>

        <div className="flow-value">
          <strong className={gridOn ? undefined : 'is-idle'}>
            {formatWatts(
              grid === null ? null : exchange
            )}
          </strong>
          <small>
            {grid === null || !gridOn
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
