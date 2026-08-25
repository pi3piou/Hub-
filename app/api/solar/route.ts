import {
  isConfigured,
  loadMeter,
  loadRaw,
  loadReading,
} from '@/lib/solar';
import { debugAllowed } from '@/lib/debugGate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * Dernier relevé instantané, pour les cercles de l'accueil.
 *
 * `ageSeconds` est calculé ici et non côté navigateur : la
 * fraîcheur est l'information la plus importante de cette
 * tuile. Un relevé vieux de trois heures affiché sans mention
 * ferait croire que la maison consomme encore 2 kW en pleine
 * nuit.
 *
 * `?debug=powerflow` ou `?debug=meter` renvoie la dernière
 * charge utile brute reçue, à condition d'avoir activé
 * SOLAR_KEEP_RAW. C'est ce qui permettra de trancher le sens
 * des compteurs du Smart Meter sur de vraies données.
 */

export async function GET(request: Request) {
  if (!isConfigured()) {
    return Response.json({
      configured: false,
      reading: null,
    });
  }

  const { searchParams } = new URL(request.url);

  try {
    const debug = searchParams.get('debug');

    if (
      (debug === 'powerflow' || debug === 'meter') &&
      debugAllowed(request)
    ) {
      return Response.json({
        configured: true,
        kind: debug,
        raw: await loadRaw(debug),
      });
    }

    const reading = await loadReading();

    if (!reading) {
      return Response.json({
        configured: true,
        reading: null,
        meter: await loadMeter(),
      });
    }

    return Response.json({
      configured: true,
      reading,
      meter: await loadMeter(),
      ageSeconds: Math.round(
        (Date.now() - reading.receivedAt) / 1000
      ),
    });
  } catch {
    return Response.json(
      { configured: true, reading: null, error: true },
      { status: 502 }
    );
  }
}
