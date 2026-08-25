import {
  BACKFILL,
  BackfillRow,
} from '@/lib/solarBackfill';

import {
  DayTotals,
  forgetMonthTotals,
  importDayTotals,
  isConfigured,
  localSlot,
} from '@/lib/solar';
import { debugAllowed } from '@/lib/debugGate';

/*
 * =============================================================
 * IMPORT UNIQUE DE L'HISTORIQUE SOLAIRE
 *
 * À déclencher à la main, une fois, en ouvrant :
 *
 *   /api/solar/backfill?key=LA_CLE
 *
 * La clé est la même que celle de l'ingestion (SOLAR_INGEST_KEY)
 * : cette route écrit dans le même stockage, elle n'a aucune
 * raison d'être moins protégée.
 *
 * Trois interrupteurs :
 *   ?probe=1   n'écrit rien, dit seulement ce qui serait fait
 *   ?force=1   remplace les totaux déjà présents
 *   ?from=...&to=...  restreint la plage (AAAA-MM-JJ)
 *
 * Elle est faite pour être relancée sans danger : sans ?force,
 * elle ne touche pas à ce qui existe déjà, donc la rejouer
 * après avoir complété le fichier de données ne fait qu'ajouter
 * les jours manquants.
 * =============================================================
 */

export const dynamic = 'force-dynamic';

function unauthorized() {
  return Response.json(
    { error: 'cle invalide' },
    { status: 401 }
  );
}

/*
 * Lecture BRUTE d'un parametre, sans passer par URLSearchParams.
 *
 * Ce detour existe pour une raison precise : dans une chaine de
 * requete, le signe plus est l'ancienne notation de l'espace.
 * `searchParams.get()` applique fidelement cette regle, donc une
 * cle contenant un "+" arrive ici avec un espace a la place et
 * ne correspond plus jamais. Les cles engendrees en base64 en
 * contiennent tres souvent.
 */

function rawParam(url: string, name: string) {
  const start = url.indexOf('?');

  if (start < 0) return null;

  const query = url.slice(start + 1).split('#')[0];

  for (const part of query.split('&')) {
    const equals = part.indexOf('=');

    if (equals < 0) continue;
    if (part.slice(0, equals) !== name) continue;

    return part.slice(equals + 1);
  }

  return null;
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/*
 * Toutes les formes plausibles de la cle envoyee. On compare
 * l'attendu a chacune plutot que de parier sur une seule :
 * l'echec silencieux d'une comparaison de chaines est
 * indiscernable d'une mauvaise cle, et coute une redecouverte
 * complete a chaque fois.
 */

function candidateKeys(request: Request) {
  const { searchParams } = new URL(request.url);

  const values: string[] = [];

  const decoded = searchParams.get('key');

  if (decoded !== null) values.push(decoded);

  const raw = rawParam(request.url, 'key');

  if (raw !== null) {
    values.push(raw);
    values.push(safeDecode(raw));
  }

  return values;
}

function keyState(request: Request) {
  /*
   * Le `trim` n'est pas cosmetique : une variable d'environnement
   * collee dans un tableau de bord emporte tres facilement un
   * retour a la ligne invisible, et la comparaison echoue alors
   * sur une valeur qui parait pourtant identique a l'oeil.
   */

  const rawExpected = process.env.SOLAR_INGEST_KEY || '';
  const expected = rawExpected.trim();

  const candidates = candidateKeys(request);

  const exact = candidates.some(
    (value) => value === rawExpected
  );

  const trimmed = candidates.some(
    (value) => value.trim() === expected
  );

  return {
    definie: rawExpected.length > 0,
    longueurAttendue: rawExpected.length,
    longueurApresNettoyage: expected.length,
    longueursRecues: candidates.map(
      (value) => value.length
    ),
    correspondanceExacte: exact,
    correspondanceApresNettoyage: trimmed,
    ok: Boolean(expected) && trimmed,
  };
}

function checkKey(request: Request) {
  return keyState(request).ok;
}

/*
 * Une ligne du fichier de données est un quadruplet en Wh :
 * production, consommation, soutirage, injection. On en déduit
 * l'autoconsommation — ce que la maison a pris directement au
 * soleil, c'est-à-dire tout ce qui n'est pas reparti au réseau.
 */

function toTotals(row: BackfillRow): DayTotals {
  const [production, consumption, imported, exported] = row;

  return {
    productionWh: production,
    importWh: imported,
    exportWh: exported,
    consumptionWh: consumption,
    selfConsumedWh: Math.max(production - exported, 0),

    /*
     * Rien d'estimé ici : ces chiffres viennent des compteurs
     * de l'onduleur et du Smart Meter, pas d'une intégration
     * de courbe.
     */
    estimated: false,
  };
}

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const { searchParams: query } = new URL(request.url);

  /*
   * ?diag=1 — le seul point d'entree qui ne demande pas la cle.
   *
   * Il ne revele jamais aucune valeur : uniquement des longueurs
   * et des oui/non. C'est assez pour distinguer les trois causes
   * qui se ressemblent toutes de l'exterieur — variable absente,
   * variable avec un retour a la ligne colle par megarde, ou cle
   * reellement differente — et ce n'est pas assez pour aider qui
   * que ce soit a deviner la cle.
   */

  if (query.get('diag') === '1' && debugAllowed(request)) {
    const state = keyState(request);

    return Response.json({
      diag: true,

      variableDefinie: state.definie,

      longueurDeLaVariable: state.longueurAttendue,
      longueurUneFoisNettoyee: state.longueurApresNettoyage,

      espacesInvisiblesDansLaVariable:
        state.longueurAttendue !==
        state.longueurApresNettoyage,

      longueursDeLaCleRecue: state.longueursRecues,

      correspondanceExacte: state.correspondanceExacte,
      correspondanceApresNettoyage:
        state.correspondanceApresNettoyage,

      joursDansLeFichier: Object.keys(BACKFILL).length,

      upstashConfigure: isConfigured(),
    });
  }

  if (!checkKey(request)) return unauthorized();

  if (!isConfigured()) {
    return Response.json(
      { error: 'upstash non configure' },
      { status: 500 }
    );
  }

  const probe = query.get('probe') === '1';
  const force = query.get('force') === '1';

  const from = query.get('from') || '';
  const to = query.get('to') || '';

  /*
   * La journée en cours n'est jamais importée : elle n'est pas
   * finie, et son total est de toute façon recalculé à chaque
   * lecture plutôt que lu dans le cache.
   */

  const today = localSlot(new Date()).date;

  const dates = Object.keys(BACKFILL)
    .filter((date) => DATE_SHAPE.test(date))
    .filter((date) => date < today)
    .filter((date) => (from ? date >= from : true))
    .filter((date) => (to ? date <= to : true))
    .sort();

  const months = Array.from(
    new Set(dates.map((date) => date.slice(0, 7)))
  ).sort();

  if (probe) {
    return Response.json({
      probe: true,
      jours: dates.length,
      premier: dates[0] || null,
      dernier: dates[dates.length - 1] || null,
      mois: months,
      ignoresCarAujourdhuiOuFutur:
        Object.keys(BACKFILL).length - dates.length,
    });
  }

  let ecrits = 0;
  let existants = 0;

  const erreurs: string[] = [];

  for (const date of dates) {
    try {
      const resultat = await importDayTotals(
        date,
        toTotals(BACKFILL[date]),
        force
      );

      if (resultat === 'ecrit') ecrits += 1;
      else existants += 1;
    } catch (error) {
      erreurs.push(
        date +
          ' : ' +
          (error instanceof Error
            ? error.message
            : String(error))
      );

      /*
       * Dix échecs d'affilée veulent dire que le stockage ne
       * répond plus : continuer les trois cents jours suivants
       * ne ferait qu'épuiser le temps de la fonction pour
       * accumuler la même erreur.
       */
      if (erreurs.length >= 10) break;
    }
  }

  /*
   * Les mois ne sont vidés que si quelque chose a bougé. Sans
   * cette condition, une relance à blanc jetterait un cache
   * parfaitement valable et forcerait un recalcul complet.
   */

  if (ecrits > 0) {
    try {
      await forgetMonthTotals(months);
    } catch (error) {
      erreurs.push(
        'purge des mois : ' +
          (error instanceof Error
            ? error.message
            : String(error))
      );
    }
  }

  return Response.json({
    ok: erreurs.length === 0,
    ecrits,
    existants,
    moisPurges: ecrits > 0 ? months : [],
    erreurs,
  });
}
