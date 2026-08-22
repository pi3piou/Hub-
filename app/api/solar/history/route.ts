import {
  isConfigured,
  loadDay,
  loadTotals,
  localSlot,
} from '@/lib/solar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * Historique d'une journée, au pas de 5 minutes.
 *
 *   /api/solar/history            -> aujourd'hui
 *   /api/solar/history?date=...   -> une journée précise
 *
 * La date par défaut est calculée en heure locale, pas en UTC.
 * Le serveur Vercel tourne en UTC : sans ça, à 1h du matin
 * l'été, "aujourd'hui" renverrait encore la veille.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  if (!isConfigured()) {
    return Response.json({
      configured: false,
      points: [],
    });
  }

  const { searchParams } = new URL(request.url);

  const asked = searchParams.get('date');

  const date =
    asked && DATE_PATTERN.test(asked)
      ? asked
      : localSlot(new Date()).date;

  try {
    const points = await loadDay(date);
    const totals = await loadTotals(date, points);

    return Response.json({
      configured: true,
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
      { configured: true, date, points: [], error: true },
      { status: 502 }
    );
  }
}
