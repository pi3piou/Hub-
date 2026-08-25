/*
 * =========================================================
 * PRÉVISION DE PRODUCTION
 *
 * Traduit un rayonnement annoncé par la météo en kilowatt-
 * heures attendus. Les coefficients ne sortent pas d'un
 * manuel : ils ont été ajustés sur 341 journées réelles de
 * CETTE installation, croisées avec le rayonnement observé
 * au-dessus de cette maison.
 *
 * CE QUE VALENT CES CHIFFRES
 *
 * Mesuré en validation croisée — un mois entier retiré de
 * l'ajustement à chaque fois, puis prédit :
 *
 *   « comme hier »                        11,0 kWh d'erreur
 *   rayonnement × facteur                  8,3
 *   + plafond de l'onduleur                7,3
 *   + perte à la chaleur                   6,6
 *   + courbure                             5,6
 *
 * Et avec une vraie prévision météo, qui se trompe elle-même
 * d'environ 18 % sur le rayonnement à un jour : 7,0 kWh
 * d'erreur moyenne, 5,6 de médiane. Un tiers de mieux que de
 * répondre « comme hier », ce qui justifie d'exister.
 *
 * CE QU'ILS NE VALENT PAS
 *
 * Environ 3 % des journées sont hors d'atteinte : le soleil
 * était là et la production non. Nuages très localisés que
 * la maille météo ne voit pas, onduleur qui décroche,
 * ombrage ponctuel. Aucun modèle n'y peut rien, et c'est
 * pour cette raison que la recalibration ci-dessous prend la
 * médiane et non la moyenne.
 * =========================================================
 */

export interface Calibration {
  /*
   * Facteur d'échelle appliqué au modèle. Vaut 1 à
   * l'installation, et dérive lentement avec
   * l'encrassement, le vieillissement des panneaux et la
   * végétation qui pousse.
   */
  scale: number;

  /* Nombre de journées ayant servi au dernier ajustement. */
  samples: number;

  updatedAt: number;
}

export const DEFAULT_CALIBRATION: Calibration = {
  scale: 1,
  samples: 0,
  updatedAt: 0,
};

/* --- Coefficients du modèle -------------------------------
 *
 * production = min(PLAFOND, A·x + C·x²)   avec
 * x = rayonnement × (1 − CHALEUR × (Tmax − 25))
 *
 * Le terme en x² est négatif : la courbe s'aplatit quand le
 * rayonnement monte. Sans lui, une droite devait passer par
 * une ordonnée à l'origine de +7 kWh pour compenser, ce qui
 * revenait à prédire 7 kWh un jour sans aucun soleil.
 */

const A = 3.61;
const C = -0.04312;

/*
 * Le plafond n'est pas météorologique, il est matériel :
 * l'onduleur sature. C'est ce qui explique que les belles
 * journées de mai à juillet se rangent toutes autour de
 * 69 kWh à 2 % près.
 */
const PLAFOND = 69.5;

/*
 * Perte de rendement par degré au-dessus de 25 °C. La valeur
 * ajustée, 1,3 %/°C, tombe pile dans la plage physique du
 * silicium — ce qui est rassurant : le modèle a retrouvé
 * tout seul un phénomène connu, au lieu d'épouser du bruit.
 *
 * L'effet est loin d'être théorique ici : à 38 °C, une
 * journée d'août perd 17 % par rapport au même soleil à
 * 25 °C. C'est ce qui fait que juillet produit moins que
 * juin malgré un ensoleillement comparable.
 */
const CHALEUR = 0.013;

/* --- Plafond saisonnier -----------------------------------
 *
 * Ce que donne une belle journée, mois par mois. Sert à
 * situer une prévision : 35 kWh est une mauvaise journée en
 * juin et une excellente en décembre.
 *
 * Valeurs relevées au milieu de chaque mois sur l'historique
 * réel. Une sinusoïde aurait été plus élégante mais se
 * trompait de 6 kWh en plein hiver — le creux de décembre
 * est plus marqué et plus plat qu'un cosinus.
 */

const CEILING = [
  38.2, 47.4, 63.7, 66.1, 70.6, 70.1,
  67.3, 64.8, 58.8, 56.0, 43.2, 36.8,
];

const MID = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];

function dayOfYear(date: Date) {
  const start = Date.UTC(date.getFullYear(), 0, 0);

  const here = Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );

  return Math.floor((here - start) / 86_400_000);
}

/*
 * Interpolation entre deux milieux de mois, en refermant
 * l'année sur elle-même : sans ce bouclage, le 20 décembre
 * et le 10 janvier tomberaient tous deux hors de la table.
 */

export function seasonalCeiling(date: Date) {
  const d = dayOfYear(date);

  let i = 0;
  while (i < 12 && MID[i] < d) i += 1;

  const a = (i - 1 + 12) % 12;
  const b = i % 12;

  let da = MID[a];
  let db = MID[b];

  if (i === 12) db = MID[0] + 365;
  if (i === 0) da = MID[11] - 365;

  const t = (d - da) / (db - da);

  return CEILING[a] * (1 - t) + CEILING[b] * t;
}

/* --- La prévision elle-même ------------------------------- */

export type ForecastTone = 'belle' | 'faible' | 'neutre';

export interface ProductionForecast {
  /* kWh attendus, arrondis à 5 près — voir plus bas. */
  kwh: number;

  /* Part du plafond de saison, de 0 à 1. */
  share: number;

  tone: ForecastTone;

  /* Le mot à afficher, ou null quand il vaut mieux se taire. */
  label: string | null;
}

export function forecastProduction(
  radiationMJ: number | null,
  tmaxC: number | null,
  date: Date,
  calibration: Calibration = DEFAULT_CALIBRATION
): ProductionForecast | null {
  if (
    radiationMJ === null ||
    !Number.isFinite(radiationMJ) ||
    radiationMJ < 0
  ) {
    return null;
  }

  const t = Number.isFinite(tmaxC as number)
    ? (tmaxC as number)
    : 20;

  const x = radiationMJ * (1 - CHALEUR * Math.max(0, t - 25));

  const raw = A * x + C * x * x;

  /*
   * Le facteur d'échelle s'applique AVANT le plafond :
   * l'encrassement réduit ce que les panneaux envoient, et
   * l'onduleur écrête ensuite ce qui lui arrive. Dans
   * l'autre ordre, des panneaux sales continueraient de
   * saturer l'onduleur, ce qui n'a pas de sens.
   */

  const kwhExact = Math.max(
    0,
    Math.min(PLAFOND, raw * calibration.scale)
  );

  const ceiling = seasonalCeiling(date);
  const share = ceiling > 0 ? kwhExact / ceiling : 0;

  /*
   * ARRONDI À 5 kWh, ET C'EST UN CHOIX D'HONNÊTETÉ.
   *
   * L'erreur médiane est de 5,6 kWh. Afficher « 38,4 kWh »
   * annoncerait une précision au dixième que le modèle n'a
   * pas, et la première fois que la réalité tomberait à 31
   * la prévision perdrait toute crédibilité. « ≈ 40 »
   * promet ce qu'on peut tenir.
   */

  const kwh = Math.round(kwhExact / 5) * 5;

  /*
   * ON NE MET UN MOT QUE QUAND ON EN EST SÛR.
   *
   * Un classement en quatre niveaux ne tombe juste que 49 %
   * du temps, trois niveaux 65 %, deux niveaux 86 % — mais
   * comme trois journées sur quatre sont belles ici, « dire
   * toujours belle » en obtiendrait déjà 74. Le libellé
   * n'apportait donc presque rien tout en ayant l'air
   * péremptoire.
   *
   * En ne parlant qu'aux extrêmes, la justesse monte à 93 %
   * pour « belle journée » et 92 % pour « journée faible ».
   * Le mot ne sort qu'une fois sur trois, et il est juste.
   * Le reste du temps le chiffre parle seul.
   */

  let tone: ForecastTone = 'neutre';
  let label: string | null = null;

  if (share >= 0.9) {
    tone = 'belle';
    label = 'Belle journée';
  } else if (share <= 0.4) {
    tone = 'faible';
    label = 'Journée faible';
  }

  return { kwh, share: Math.min(1, share), tone, label };
}

/* --- Recalibration ----------------------------------------
 *
 * Les panneaux s'encrassent, vieillissent, et la végétation
 * pousse. Sans réajustement, la prévision dériverait de
 * quelques pour cent par an sans que rien ne le signale.
 *
 * UN SEUL PARAMÈTRE est réajusté, un facteur d'échelle.
 * Réajuster toute la courbe sur quelques dizaines de
 * journées reviendrait à épouser le bruit d'une saison ; la
 * forme, elle, tient de la physique et n'a aucune raison de
 * bouger.
 */

export interface Sample {
  date: string;
  /* Rayonnement annoncé ce jour-là, MJ/m². */
  rad: number;
  tmax: number;
  /* Production réellement mesurée, kWh. */
  prod: number;
}

const MIN_SAMPLES = 30;
const SCALE_FLOOR = 0.75;
const SCALE_CEIL = 1.15;

export function calibrate(
  samples: Sample[]
): Calibration | null {
  const usable: number[] = [];

  for (const s of samples) {
    const x =
      s.rad * (1 - CHALEUR * Math.max(0, s.tmax - 25));

    const raw = A * x + C * x * x;

    /*
     * Deux exclusions.
     *
     * Les journées écrêtées ne disent rien du rendement des
     * panneaux : l'onduleur y masque tout ce qui dépasse.
     * Les journées trop faibles sont dominées par le bruit,
     * où quelques centaines de watts pèsent un pourcentage
     * énorme.
     */

    if (raw >= PLAFOND * 0.95) continue;
    if (raw < 15) continue;

    usable.push(s.prod / raw);
  }

  if (usable.length < MIN_SAMPLES) return null;

  /*
   * LA MÉDIANE, PAS LA MOYENNE.
   *
   * Trois pour cent des journées voient le soleil sans que
   * la production suive — onduleur en défaut, nuage very
   * localisé, ombre imprévue. Une moyenne les absorberait et
   * ferait dériver la prévision vers le bas de façon
   * permanente à cause d'une poignée d'incidents. La médiane
   * les ignore.
   */

  usable.sort((a, b) => a - b);

  const mid = Math.floor(usable.length / 2);

  const median =
    usable.length % 2
      ? usable[mid]
      : (usable[mid - 1] + usable[mid]) / 2;

  /*
   * Bornes de sécurité. Une série de journées aberrantes —
   * onduleur en panne une semaine, capteur qui déraille — ne
   * doit pas pouvoir détruire la prévision. Au-delà de ces
   * bornes, ce n'est plus de l'encrassement, c'est une panne
   * qui mérite un regard humain.
   */

  const scale = Math.max(
    SCALE_FLOOR,
    Math.min(SCALE_CEIL, median)
  );

  return {
    scale,
    samples: usable.length,
    updatedAt: Date.now(),
  };
}
