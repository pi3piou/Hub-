/*
 * =============================================================
 * DONNÉES SOLAIRES — réception, stockage, relecture
 *
 * Le Datamanager Fronius pousse tout seul vers le hub. Deux
 * flux distincts, configurés séparément sur l'onduleur :
 *
 *   Powerflow (1 min)  — les trois puissances instantanées.
 *                        Sert aux cercles animés et à la
 *                        courbe de la journée.
 *
 *   Meter (5 min)      — les compteurs cumulés du Smart
 *                        Meter. Sert aux totaux en kWh.
 *
 * Pourquoi deux flux plutôt qu'un : entre deux lectures d'un
 * compteur cumulé, l'énergie est une soustraction exacte,
 * quelle que soit la fréquence. Intégrer des puissances
 * échantillonnées, au contraire, rate tout ce qui se passe
 * entre deux points — et la consommation d'une maison est en
 * dents de scie. Les totaux viennent donc des compteurs, pas
 * de la courbe.
 *
 * Stockage : Upstash Redis, via son API REST. Un simple
 * `fetch`, donc aucune dépendance ajoutée au projet.
 *
 * Variables d'environnement (réglages Vercel) :
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *   SOLAR_INGEST_KEY
 *   SOLAR_KEEP_RAW    (facultatif, "1" pour garder les
 *                      charges utiles brutes une heure)
 *   SOLAR_METER_SWAP  (facultatif, voir plus bas)
 * =============================================================
 */

const TZ = 'Europe/Paris';

/* Un point toutes les 5 minutes : 288 cases par journée. */
const SLOT_MINUTES = 5;
const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES;

const KEY_LAST = 'solar:last';
const KEY_METER = 'solar:meter';
const KEY_METER_START = 'solar:meterstart';
const KEY_RAW = 'solar:raw';

const RAW_TTL_SECONDS = 3600;

function dayKey(date: string) {
  return 'solar:day:' + date;
}

/*
 * =============================================================
 * TYPES
 * =============================================================
 */

export type SolarReading = {
  /* Watts. Production photovoltaïque instantanée. */
  production: number | null;
  /* Watts. Consommation de la maison, toujours positive. */
  consumption: number | null;
  /*
   * Watts. Positif = on soutire au réseau, négatif = on y
   * injecte. Convention Fronius, gardée telle quelle pour
   * éviter les erreurs de signe en cascade.
   */
  grid: number | null;
  /* Watts. Positif = la batterie se décharge. Null si absente. */
  battery: number | null;
  autonomy: number | null;
  selfConsumption: number | null;
  /* Wh produits depuis minuit, compteur de l'onduleur. */
  energyToday: number | null;
  receivedAt: number;
};

export type MeterSnapshot = {
  /*
   * Compteurs cumulés en Wh, repris VERBATIM des noms
   * Fronius. On ne les renomme pas ici volontairement : selon
   * l'endroit où le Smart Meter est posé dans le tableau,
   * "Consumed" désigne tantôt ce que voit le réseau, tantôt ce
   * que voit la maison. Tant qu'on n'a pas vérifié sur de
   * vraies données, leur donner un nom métier serait figer une
   * hypothèse dans le stockage.
   */
  consumed: number | null;
  produced: number | null;
  receivedAt: number;
};

export type DayPoint = {
  /* Minutes depuis minuit, heure locale. */
  minute: number;
  production: number | null;
  consumption: number | null;
  grid: number | null;
};

export type DayTotals = {
  /* Wh. Exact : compteur du jour de l'onduleur. */
  productionWh: number | null;
  /* Wh. Exacts : différences de compteurs du Smart Meter. */
  importWh: number | null;
  exportWh: number | null;
  /* Wh. Déduits des trois précédents, donc exacts aussi. */
  consumptionWh: number | null;
  selfConsumedWh: number | null;
  /*
   * Vrai quand un total a dû être reconstitué en intégrant la
   * courbe, faute de compteur. L'affichage doit le signaler :
   * un chiffre approché présenté comme exact est pire que pas
   * de chiffre du tout.
   */
  estimated: boolean;
};

/*
 * Intégration de secours : chaque point vaut pour la tranche
 * de 5 minutes qui le suit. Utilisée uniquement quand les
 * compteurs manquent — typiquement avant que le flux Meter
 * soit configuré sur l'onduleur.
 */

function integrate(
  values: Array<number | null>
): number | null {
  let total = 0;
  let seen = 0;

  for (const value of values) {
    if (value === null) continue;
    total += value * (SLOT_MINUTES / 60);
    seen += 1;
  }

  return seen > 0 ? Math.round(total) : null;
}

/*
 * =============================================================
 * ACCÈS UPSTASH
 * =============================================================
 */

function credentials() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  return { url: url.replace(/\/+$/, ''), token };
}

export function isConfigured() {
  return credentials() !== null;
}

/*
 * Une commande Redis s'envoie sous forme de tableau JSON posté
 * à la racine : ["SET", "cle", "valeur"]. C'est la forme la
 * plus sûre — passer la valeur dans l'URL casserait dès
 * qu'elle contient une barre oblique.
 */

async function command(parts: (string | number)[]) {
  const creds = credentials();

  if (!creds) throw new Error('upstash non configure');

  const res = await fetch(creds.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(parts),
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error('upstash a repondu ' + res.status);
  }

  const data = await res.json();

  return data?.result ?? null;
}

/*
 * =============================================================
 * DATE ET CRÉNEAU, EN HEURE LOCALE
 *
 * Le serveur Vercel tourne en UTC. Sans conversion explicite,
 * la journée solaire commencerait à 2h du matin l'été : la
 * production du soir se retrouverait rangée dans le lendemain.
 * =============================================================
 */

export function localSlot(when: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(when);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '00';

  const date = `${get('year')}-${get('month')}-${get('day')}`;

  const minutes =
    Number(get('hour')) * 60 + Number(get('minute'));

  return {
    date,
    slot: Math.floor(minutes / SLOT_MINUTES),
  };
}

/*
 * =============================================================
 * LECTURE TOLÉRANTE DES CHARGES UTILES
 *
 * L'emboîtement des objets diffère d'un format Fronius à
 * l'autre, et il change avec les versions de firmware. Plutôt
 * que de parier sur un chemin précis, on cherche les clés en
 * profondeur.
 * =============================================================
 */

function deepFind(
  input: unknown,
  keys: string[]
): number | null {
  if (input === null || typeof input !== 'object') {
    return null;
  }

  const record = input as Record<string, unknown>;

  for (const key of keys) {
    const value = record[key];

    if (
      typeof value === 'number' &&
      Number.isFinite(value)
    ) {
      return value;
    }
  }

  for (const value of Object.values(record)) {
    const found = deepFind(value, keys);
    if (found !== null) return found;
  }

  return null;
}

export function looksLikeMeter(payload: unknown) {
  return (
    deepFind(payload, ['EnergyReal_WAC_Sum_Consumed']) !==
      null ||
    deepFind(payload, ['EnergyReal_WAC_Sum_Produced']) !==
      null
  );
}

export function normalizePowerflow(
  payload: unknown
): SolarReading {
  const load = deepFind(payload, ['P_Load']);
  const grid = deepFind(payload, ['P_Grid']);
  const pv = deepFind(payload, ['P_PV']);

  /*
   * La nuit, l'onduleur dort et publie `P_PV: null` — pas
   * zéro, mais "pas de valeur". Tel quel, ça creuserait un
   * trou dans la courbe entre le coucher et le lever du
   * soleil, là où la bonne lecture est une ligne à zéro.
   *
   * On ne comble que si le reste de la charge utile est
   * exploitable : si ni la puissance réseau ni la charge ne
   * sont chiffrées, c'est que le relevé est vraiment vide, et
   * inventer un zéro masquerait une panne de collecte.
   */

  const production =
    pv === null && (grid !== null || load !== null) ? 0 : pv;

  return {
    production,
    /*
     * Fronius exprime la charge en négatif, puisque c'est une
     * consommation. On la retourne en positif : afficher
     * "-450 W consommés" n'a aucun sens pour un lecteur.
     */
    consumption: load === null ? null : Math.abs(load),
    grid,
    battery: deepFind(payload, ['P_Akku']),
    autonomy: deepFind(payload, ['rel_Autonomy']),
    selfConsumption: deepFind(payload, [
      'rel_SelfConsumption',
    ]),
    energyToday: deepFind(payload, ['E_Day']),
    receivedAt: Date.now(),
  };
}

export function normalizeMeter(
  payload: unknown
): MeterSnapshot {
  return {
    consumed: deepFind(payload, [
      'EnergyReal_WAC_Sum_Consumed',
    ]),
    produced: deepFind(payload, [
      'EnergyReal_WAC_Sum_Produced',
    ]),
    receivedAt: Date.now(),
  };
}

/*
 * =============================================================
 * ÉCRITURE
 * =============================================================
 */

function encodePoint(reading: SolarReading) {
  /*
   * Format compact "prod,conso,reseau,compteurJour". Sur une
   * année de conservation, du JSON par point pèserait dix fois
   * plus lourd pour la même information.
   */
  const n = (v: number | null) =>
    v === null ? '' : String(Math.round(v));

  return [
    n(reading.production),
    n(reading.consumption),
    n(reading.grid),
    n(reading.energyToday),
  ].join(',');
}

export async function savePowerflow(
  reading: SolarReading,
  raw: string
) {
  const { date, slot } = localSlot(
    new Date(reading.receivedAt)
  );

  await command([
    'SET',
    KEY_LAST,
    JSON.stringify(reading),
  ]);

  /*
   * Le dernier relevé de la tranche de 5 minutes écrase les
   * précédents. Une moyenne serait plus juste, mais elle
   * imposerait de relire la case avant chaque écriture, donc
   * de doubler le nombre de commandes — pour un gain
   * imperceptible sur une courbe solaire, qui varie lentement.
   * Les totaux, eux, ne dépendent pas de cette courbe : ils
   * viennent des compteurs.
   */

  await command([
    'HSET',
    dayKey(date),
    String(slot),
    encodePoint(reading),
  ]);

  if (process.env.SOLAR_KEEP_RAW === '1') {
    await command([
      'SET',
      KEY_RAW + ':powerflow',
      raw.slice(0, 20000),
      'EX',
      RAW_TTL_SECONDS,
    ]);
  }
}

export async function saveMeter(
  snapshot: MeterSnapshot,
  raw: string
) {
  const { date } = localSlot(
    new Date(snapshot.receivedAt)
  );

  await command([
    'SET',
    KEY_METER,
    JSON.stringify(snapshot),
  ]);

  /*
   * HSETNX n'écrit que si la case est vide : on fige ainsi la
   * PREMIÈRE valeur du compteur de chaque journée, et elle ne
   * bouge plus. L'énergie d'un jour devient alors une simple
   * soustraction entre deux relevés de compteur — exacte, sans
   * dépendre du nombre de mesures prises entre les deux.
   */

  await command([
    'HSETNX',
    KEY_METER_START,
    date,
    JSON.stringify(snapshot),
  ]);

  if (process.env.SOLAR_KEEP_RAW === '1') {
    await command([
      'SET',
      KEY_RAW + ':meter',
      raw.slice(0, 20000),
      'EX',
      RAW_TTL_SECONDS,
    ]);
  }
}

/*
 * =============================================================
 * LECTURE
 * =============================================================
 */

export async function loadReading(): Promise<SolarReading | null> {
  const stored = await command(['GET', KEY_LAST]);

  if (typeof stored !== 'string') return null;

  try {
    return JSON.parse(stored) as SolarReading;
  } catch {
    return null;
  }
}

export async function loadMeter(): Promise<MeterSnapshot | null> {
  const stored = await command(['GET', KEY_METER]);

  if (typeof stored !== 'string') return null;

  try {
    return JSON.parse(stored) as MeterSnapshot;
  } catch {
    return null;
  }
}

export async function loadRaw(kind: string) {
  const stored = await command([
    'GET',
    KEY_RAW + ':' + kind,
  ]);

  return typeof stored === 'string' ? stored : null;
}

function decodePoint(
  slot: number,
  encoded: string
): DayPoint & { energyToday: number | null } {
  const [p, c, g, e] = encoded.split(',');

  const num = (v: string) =>
    v === '' || v === undefined ? null : Number(v);

  return {
    minute: slot * SLOT_MINUTES,
    production: num(p),
    consumption: num(c),
    grid: num(g),
    energyToday: num(e),
  };
}

export async function loadDay(date: string) {
  const stored = await command(['HGETALL', dayKey(date)]);

  const points: Array<
    DayPoint & { energyToday: number | null }
  > = [];

  /*
   * HGETALL renvoie une liste plate : cle, valeur, cle,
   * valeur... d'où le pas de deux.
   */

  if (Array.isArray(stored)) {
    for (let i = 0; i < stored.length; i += 2) {
      const slot = Number(stored[i]);
      const value = stored[i + 1];

      if (
        !Number.isFinite(slot) ||
        slot < 0 ||
        slot >= SLOTS_PER_DAY ||
        typeof value !== 'string'
      ) {
        continue;
      }

      points.push(decodePoint(slot, value));
    }
  }

  points.sort((a, b) => a.minute - b.minute);

  return points;
}

function nextDay(date: string) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function meterStart(date: string) {
  const stored = await command([
    'HGET',
    KEY_METER_START,
    date,
  ]);

  if (typeof stored !== 'string') return null;

  try {
    return JSON.parse(stored) as MeterSnapshot;
  } catch {
    return null;
  }
}

export async function loadTotals(
  date: string,
  series: Array<{
    energyToday: number | null;
    production: number | null;
    consumption: number | null;
    grid: number | null;
  }>
): Promise<DayTotals> {
  /*
   * Production : le compteur du jour de l'onduleur, dont on
   * garde la DERNIÈRE valeur connue de la journée.
   *
   * Prendre le maximum serait un piège. Fronius remet ce
   * compteur à zéro au réveil de l'onduleur, pas à minuit :
   * entre minuit et le lever du soleil, les relevés portent
   * encore le total de la VEILLE. Avec un maximum, une journée
   * moins productive que la précédente hériterait
   * définitivement du total de la veille — une erreur
   * silencieuse, impossible à repérer à l'œil.
   *
   * La dernière valeur, elle, se corrige d'elle-même dès que
   * le compteur repart de zéro, et vaut le total complet une
   * fois la journée finie.
   */

  let productionWh: number | null = null;

  for (const point of series) {
    if (point.energyToday === null) continue;
    productionWh = point.energyToday;
  }

  /*
   * Réseau : différence entre le compteur au début du jour et
   * celui au début du lendemain. Pour aujourd'hui, le
   * lendemain n'existe pas encore, on prend donc le compteur
   * courant.
   */

  const start = await meterStart(date);

  let end: MeterSnapshot | null = await meterStart(
    nextDay(date)
  );

  if (!end) end = await loadMeter();

  let rawImport: number | null = null;
  let rawExport: number | null = null;

  if (
    start &&
    end &&
    start.consumed !== null &&
    end.consumed !== null &&
    start.produced !== null &&
    end.produced !== null &&
    end.receivedAt >= start.receivedAt
  ) {
    rawImport = Math.max(0, end.consumed - start.consumed);
    rawExport = Math.max(0, end.produced - start.produced);
  }

  /*
   * Les noms Fronius "Consumed" et "Produced" ne disent pas de
   * quel point de vue ils parlent, et ça dépend de la pose du
   * compteur. Plutôt que de figer une hypothèse dans les
   * données stockées, on l'inverse ici à la lecture, via une
   * variable d'environnement. Corriger le sens ne demandera
   * donc aucune migration ni aucune perte d'historique.
   */

  const swap = process.env.SOLAR_METER_SWAP === '1';

  const importWh = swap ? rawExport : rawImport;
  const exportWh = swap ? rawImport : rawExport;

  let estimated = false;

  /*
   * Sans compteur du jour de l'onduleur — certains firmwares
   * ne le publient pas dans le Powerflow — on retombe sur
   * l'intégration de la courbe de production.
   */

  if (productionWh === null) {
    productionWh = integrate(
      series.map((point) => point.production)
    );

    if (productionWh !== null) estimated = true;
  }

  const known =
    productionWh !== null &&
    importWh !== null &&
    exportWh !== null;

  if (known) {
    return {
      productionWh,
      importWh,
      exportWh,
      /* Ce que la maison a consommé = ce qu'on a produit,
         plus ce qu'on a pris au réseau, moins ce qu'on lui a
         rendu. */
      consumptionWh: productionWh! + importWh! - exportWh!,
      /* Ce qu'on a produit et gardé pour soi. */
      selfConsumedWh: Math.max(
        0,
        productionWh! - exportWh!
      ),
      estimated,
    };
  }

  /*
   * Pas de compteurs : on reconstitue tout depuis les
   * courbes. C'est ce qui se passe tant que le flux Meter
   * n'est pas configuré sur l'onduleur — mieux vaut un ordre
   * de grandeur signalé comme tel qu'une légende vide.
   */

  const consumptionWh = integrate(
    series.map((point) => point.consumption)
  );

  /* Réseau : le signe sépare soutirage et injection. */

  const fallbackImport = integrate(
    series.map((point) =>
      point.grid === null ? null : Math.max(point.grid, 0)
    )
  );

  const fallbackExport = integrate(
    series.map((point) =>
      point.grid === null ? null : Math.max(-point.grid, 0)
    )
  );

  return {
    productionWh,
    importWh: fallbackImport,
    exportWh: fallbackExport,
    consumptionWh,
    selfConsumedWh:
      productionWh !== null && fallbackExport !== null
        ? Math.max(0, productionWh - fallbackExport)
        : null,
    estimated: true,
  };
}

/*
 * =============================================================
 * AGRÉGATION — LA PYRAMIDE JOUR / MOIS / ANNÉE
 *
 * Relire une année en repartant des relevés de 5 minutes
 * demanderait plus de mille commandes Redis par ouverture de
 * page. On empile donc trois niveaux, chacun calculé depuis
 * celui du dessous et mis en cache :
 *
 *   288 relevés  ->  1 total de jour  ->  1 total de mois
 *
 * Ce qui rend le cache sûr, c'est qu'une journée révolue ne
 * change PLUS jamais : ses compteurs sont figés. On ne met
 * donc en cache que le passé, et la journée en cours est
 * recalculée à chaque fois.
 * =============================================================
 */

const KEY_DAY_TOTALS = 'solar:totals';
const KEY_MONTH_TOTALS = 'solar:months';

/*
 * Nombre maximum de mois manquants reconstitués par requête.
 *
 * Sans cette borne, une première ouverture de la vue annuelle
 * sur un historique déjà rempli relirait 365 journées d'un
 * coup : la fonction Vercel dépasserait son temps imparti et
 * la page ne s'afficherait jamais. Avec la borne, elle
 * s'affiche partiellement et se complète d'elle-même.
 */

const MAX_MONTHS_PER_REQUEST = 3;

function todayLocal() {
  return localSlot(new Date()).date;
}

function monthOf(date: string) {
  return date.slice(0, 7);
}

function daysInMonth(month: string) {
  const [year, mon] = month.split('-').map(Number);

  /* Le jour 0 du mois suivant, c'est le dernier du mois
     courant — la façon la plus sûre de gérer février. */
  const count = new Date(
    Date.UTC(year, mon, 0)
  ).getUTCDate();

  const days: string[] = [];

  for (let day = 1; day <= count; day++) {
    days.push(
      month + '-' + String(day).padStart(2, '0')
    );
  }

  return days;
}

function emptyTotals(): DayTotals {
  return {
    productionWh: null,
    importWh: null,
    exportWh: null,
    consumptionWh: null,
    selfConsumedWh: null,
    estimated: false,
  };
}

function addTotals(a: DayTotals, b: DayTotals): DayTotals {
  const sum = (
    x: number | null,
    y: number | null
  ): number | null => {
    if (x === null && y === null) return null;
    return (x ?? 0) + (y ?? 0);
  };

  return {
    productionWh: sum(a.productionWh, b.productionWh),
    importWh: sum(a.importWh, b.importWh),
    exportWh: sum(a.exportWh, b.exportWh),
    consumptionWh: sum(a.consumptionWh, b.consumptionWh),
    selfConsumedWh: sum(a.selfConsumedWh, b.selfConsumedWh),
    estimated: a.estimated || b.estimated,
  };
}

/*
 * Totaux d'une journée, depuis le cache si elle est révolue.
 */

export async function ensureDayTotals(
  date: string
): Promise<DayTotals> {
  const complete = date < todayLocal();

  if (complete) {
    const cached = await command([
      'HGET',
      KEY_DAY_TOTALS,
      date,
    ]);

    if (typeof cached === 'string') {
      try {
        return JSON.parse(cached) as DayTotals;
      } catch {
        /* Cache illisible : on recalcule plutôt que de
           propager une valeur douteuse. */
      }
    }
  }

  const points = await loadDay(date);
  const totals = await loadTotals(date, points);

  if (complete) {
    await command([
      'HSET',
      KEY_DAY_TOTALS,
      date,
      JSON.stringify(totals),
    ]);
  }

  return totals;
}

/*
 * =============================================================
 * IMPORT DE L'HISTORIQUE
 *
 * L'onduleur garde des années d'archives, mais il n'est
 * joignable que depuis le réseau de la maison : l'application
 * déployée ne pourra jamais aller les chercher elle-même. On
 * les injecte donc une fois pour toutes, directement au niveau
 * des totaux journaliers.
 *
 * Écrire à CE niveau-là, et pas au niveau des relevés de 5
 * minutes, est délibéré : l'archive journalière de l'onduleur
 * donne exactement les mêmes grandeurs que celles qu'on
 * calculerait, en un millième du volume. Les journées ainsi
 * importées n'auront pas de courbe détaillée — seulement leurs
 * totaux — ce qui est précisément ce dont les vues mois et
 * année ont besoin.
 * =============================================================
 */

export async function importDayTotals(
  date: string,
  totals: DayTotals,
  overwrite: boolean
): Promise<'ecrit' | 'existant'> {
  /*
   * Par défaut on n'écrase rien. Un total déjà en cache a été
   * calculé à partir des relevés réels de la journée ; le
   * remplacer à l'aveugle par une valeur importée ferait
   * perdre l'information la plus fine sans prévenir.
   */

  if (!overwrite) {
    const existing = await command([
      'HGET',
      KEY_DAY_TOTALS,
      date,
    ]);

    if (typeof existing === 'string' && existing) {
      return 'existant';
    }
  }

  await command([
    'HSET',
    KEY_DAY_TOTALS,
    date,
    JSON.stringify(totals),
  ]);

  return 'ecrit';
}

/*
 * Les totaux mensuels sont un cache du niveau du dessous. Après
 * un import, ceux des mois touchés sont périmés : s'ils restent
 * en place, la vue annuelle continuera d'afficher les anciennes
 * valeurs — souvent zéro — alors que les journées, elles, sont
 * bien là. Les effacer suffit, ils se recalculent tout seuls.
 */

export async function forgetMonthTotals(
  months: string[]
) {
  if (!months.length) return;

  await command(['HDEL', KEY_MONTH_TOTALS, ...months]);
}

export async function loadMonth(month: string) {
  const days = daysInMonth(month);
  const today = todayLocal();

  const rows: Array<{
    key: string;
    label: string;
    totals: DayTotals;
  }> = [];

  for (const date of days) {
    /* Inutile d'interroger l'avenir. */
    if (date > today) continue;

    rows.push({
      key: date,
      label: String(Number(date.slice(8, 10))),
      totals: await ensureDayTotals(date),
    });
  }

  return rows;
}

async function ensureMonthTotals(
  month: string,
  allowCompute: boolean
): Promise<DayTotals | null> {
  const complete = month < monthOf(todayLocal());

  if (complete) {
    const cached = await command([
      'HGET',
      KEY_MONTH_TOTALS,
      month,
    ]);

    if (typeof cached === 'string') {
      try {
        return JSON.parse(cached) as DayTotals;
      } catch {
        // on recalcule
      }
    }
  }

  if (!allowCompute) return null;

  const rows = await loadMonth(month);

  let totals = emptyTotals();

  for (const row of rows) {
    totals = addTotals(totals, row.totals);
  }

  if (complete) {
    await command([
      'HSET',
      KEY_MONTH_TOTALS,
      month,
      JSON.stringify(totals),
    ]);
  }

  return totals;
}

export async function loadYear(year: string) {
  const today = todayLocal();
  const currentMonth = monthOf(today);

  const rows: Array<{
    key: string;
    label: string;
    totals: DayTotals | null;
  }> = [];

  const labels = [
    'Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin',
    'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc',
  ];

  let computed = 0;

  for (let index = 0; index < 12; index++) {
    const month =
      year + '-' + String(index + 1).padStart(2, '0');

    if (month > currentMonth) continue;

    /* Le mois en cours doit toujours être recalculé, il
       change encore. Les mois manquants sont reconstitués
       dans la limite du budget. */
    const mustCompute = month === currentMonth;

    const allowed =
      mustCompute || computed < MAX_MONTHS_PER_REQUEST;

    const totals = await ensureMonthTotals(month, allowed);

    if (totals !== null && !mustCompute) {
      computed += 1;
    }

    rows.push({
      key: month,
      label: labels[index],
      totals,
    });
  }

  const pending = rows.filter(
    (row) => row.totals === null
  ).length;

  return { rows, pending };
}
