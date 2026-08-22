'use client';

/*
 * =============================================================
 * FLUX SOLAIRE — les trois cercles et les billes animées
 *
 * Soleil, maison, réseau. Les billes circulent le long des
 * traits et changent de couleur au fil de leur trajet : orange
 * du côté du soleil, bleu du côté de la maison et du réseau.
 *
 * Le trajet est une simple translation horizontale plutôt
 * qu'un `offset-path` sur une courbe SVG. Les liaisons sont
 * droites, donc la courbe n'apporterait rien, et le
 * `translateX` est composé par le GPU sur toutes les versions
 * de Safari — y compris les plus anciennes, où offset-path est
 * absent ou partiel.
 *
 * La VITESSE porte l'information : plus il passe de puissance,
 * plus les billes filent. Multiplier leur nombre serait
 * illisible sur un trait de quarante pixels.
 * =============================================================
 */

const BEADS = [0, 1, 2, 3];

/* Bornes de vitesse, en secondes par traversée. Une bille qui
   met plus de 4 s semble immobile, une qui met moins de 0,7 s
   devient un trait. */

const SLOWEST = 4;
const FASTEST = 0.7;

/* Puissance à partir de laquelle les billes vont à fond. */
const FULL_SPEED_W = 4000;

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

type Props = {
  production: number | null;
  consumption: number | null;
  grid: number | null;
};

function Track({
  watts,
  reversed,
  label,
}: {
  watts: number;
  reversed: boolean;
  label: string;
}) {
  /*
   * En dessous de 20 W on ne fait rien circuler. Un onduleur
   * au repos affiche rarement zéro pile, et des billes qui
   * rampent pour 3 W donneraient l'impression d'un flux réel.
   */

  const active = Math.abs(watts) >= 20;

  const seconds = duration(watts);

  return (
    <div
      className={
        'flow-track' +
        (active ? ' is-active' : '') +
        (reversed ? ' is-reversed' : '')
      }
      aria-label={label}
    >
      <span className="flow-line" />

      {active &&
        BEADS.map((index) => (
          <span
            key={index}
            className="flow-bead"
            style={{
              animationDuration: seconds + 's',
              animationDelay:
                (seconds / BEADS.length) * index + 's',
            }}
          />
        ))}
    </div>
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

  /*
   * Ce que la maison prend directement au soleil : la plus
   * petite des deux valeurs. On ne peut pas autoconsommer plus
   * qu'on ne produit, ni plus qu'on ne consomme.
   */

  const selfUse = Math.min(pv, load);

  /* `net` positif = soutirage, négatif = injection. Le trait
     de droite change donc de sens selon le signe. */

  const importing = net > 0;

  return (
    <div className="flow">

      <div className="flow-node">

        <span className="flow-icon is-sun">☀</span>

        <strong>{formatWatts(production)}</strong>

        <small>Production</small>

      </div>

      <Track
        watts={selfUse}
        reversed={false}
        label="Du soleil vers la maison"
      />

      <div className="flow-node">

        <span className="flow-icon is-house">⌂</span>

        <strong>{formatWatts(consumption)}</strong>

        <small>Maison</small>

      </div>

      <Track
        watts={net}
        reversed={importing}
        label={
          importing
            ? 'Du réseau vers la maison'
            : 'De la maison vers le réseau'
        }
      />

      <div className="flow-node">

        <span className="flow-icon is-grid">⌁</span>

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
  );
}
