import {
  ensureDayTotals,
  isConfigured,
  loadDay,
  loadMonth,
  loadYear,
  localSlot,
} from '@/lib/solar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * Historique, à trois échelles.
 *
 *   /api/solar/history?scope=day&date=2026-08-23
 *   /api/solar/history?scope=month&date=2026-08
 *   /api/solar/history?scope=year&date=2026
 *
 * Le jour renvoie la courbe au pas de 5 minutes ; le mois une
 * barre par journée ; l'année une barre par mois. Les deux
 * dernières échelles s'appuient sur des cumuls mis en cache,
 * pas sur une relecture des relevés bruts.
 *
 * Les dates par défaut sont calculées en heure locale : le
 * serveur tourne en UTC, et à 1h du matin l'été "aujourd'hui"
 * renverrait encore la veille.
 */

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const YEAR_PATTERN = /^\d{4}$/;

export async function GET(request: Request) {
  if (!isConfigured()) {
    return Response.json({
      configured: false,
      points: [],
      rows: [],
    });
  }

  const { searchParams } = new URL(request.url);

  const scope = searchParams.get('scope') || 'day';
  const asked = searchParams.get('date');

  const today = localSlot(new Date()).date;

  try {
    if (scope === 'month') {
      const month =
        asked && MONTH_PATTERN.test(asked)
          ? asked
          : today.slice(0, 7);

      const rows = await loadMonth(month);

      return Response.json({
        configured: true,
        scope: 'month',
        date: month,
        rows,
      });
    }

    if (scope === 'year') {
      const year =
        asked && YEAR_PATTERN.test(asked)
          ? asked
          : today.slice(0, 4);

      const { rows, pending } = await loadYear(year);

      return Response.json({
        configured: true,
        scope: 'year',
        date: year,
        rows,
        /* Nombre de mois pas encore reconstitués. La page
           relance une requête tant qu'il en reste, pour
           éviter de faire dépasser la fonction serveur. */
        pending,
      });
    }

    const date =
      asked && DAY_PATTERN.test(asked) ? asked : today;

    const points = await loadDay(date);
    const totals = await ensureDayTotals(date);

    return Response.json({
      configured: true,
      scope: 'day',
      date,
      /* Le compteur du jour de l'onduleur ne sert qu'au calcul
         des totaux : inutile de l'envoyer 288 fois au
         navigateur. */
      points: points.map((point) => ({
        minute: point.minute,
        production: point.production,
        consumption: point.consumption,
        grid: point.grid,
      })),
      totals,
    });
  } catch {
    return Response.json(
      {
        configured: true,
        scope,
        points: [],
        rows: [],
        error: true,
      },
      { status: 502 }
    );
  }
}
