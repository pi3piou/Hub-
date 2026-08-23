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

function checkKey(request: Request) {
  const expected = process.env.SOLAR_INGEST_KEY;

  if (!expected) return false;

  const { searchParams } = new URL(request.url);

  return searchParams.get('key') === expected;
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
  if (!checkKey(request)) return unauthorized();

  if (!isConfigured()) {
    return Response.json(
      { error: 'upstash non configure' },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);

  const probe = searchParams.get('probe') === '1';
  const force = searchParams.get('force') === '1';

  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';

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
