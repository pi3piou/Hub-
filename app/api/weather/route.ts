export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * =============================================================
 * MÉTÉO — Open-Meteo, gratuit et sans clé d'API, donc rien à
 * configurer ni à renouveler.
 *
 * On passe par une route serveur plutôt que d'appeler l'API
 * depuis le navigateur pour deux raisons : les coordonnées de
 * l'utilisateur ne transitent pas dans l'historique du
 * navigateur, et on peut mettre le résultat en cache 10
 * minutes côté serveur au lieu de refaire un appel à chaque
 * ouverture de l'accueil.
 * =============================================================
 */

const CACHE_SECONDS = 600;

/* Codes météo WMO — c'est la nomenclature qu'Open-Meteo
   renvoie. On ne garde que les regroupements utiles. */

const WMO: Record<number, { label: string; icon: string }> = {
  0: { label: 'Ciel dégagé', icon: '☀' },
  1: { label: 'Plutôt dégagé', icon: '🌤' },
  2: { label: 'Partiellement nuageux', icon: '⛅' },
  3: { label: 'Couvert', icon: '☁' },
  45: { label: 'Brouillard', icon: '🌫' },
  48: { label: 'Brouillard givrant', icon: '🌫' },
  51: { label: 'Bruine légère', icon: '🌦' },
  53: { label: 'Bruine', icon: '🌦' },
  55: { label: 'Bruine dense', icon: '🌦' },
  61: { label: 'Pluie faible', icon: '🌧' },
  63: { label: 'Pluie', icon: '🌧' },
  65: { label: 'Forte pluie', icon: '🌧' },
  71: { label: 'Neige faible', icon: '🌨' },
  73: { label: 'Neige', icon: '🌨' },
  75: { label: 'Forte neige', icon: '🌨' },
  80: { label: 'Averses', icon: '🌦' },
  81: { label: 'Averses', icon: '🌦' },
  82: { label: 'Fortes averses', icon: '⛈' },
  95: { label: 'Orage', icon: '⛈' },
  96: { label: 'Orage grêleux', icon: '⛈' },
  99: { label: 'Orage grêleux', icon: '⛈' },
};

function describe(code: number) {
  return (
    WMO[code] || { label: 'Météo indisponible', icon: '·' }
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const lat = Number(searchParams.get('lat'));
  const lon = Number(searchParams.get('lon'));

  /*
   * Coordonnées validées avant l'appel : sans ce garde-fou une
   * valeur absente devient NaN, part telle quelle dans l'URL,
   * et Open-Meteo répond une erreur qu'on afficherait comme
   * une panne alors que c'est nous qui avons mal demandé.
   */

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    return Response.json(
      { error: 'coordonnees invalides' },
      { status: 400 }
    );
  }

  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lat.toFixed(4)}` +
    `&longitude=${lon.toFixed(4)}` +
    '&current=temperature_2m,apparent_temperature,weather_code' +
    '&daily=temperature_2m_max,temperature_2m_min,weather_code' +
    '&timezone=auto&forecast_days=1';

  try {
    const res = await fetch(url, {
      next: { revalidate: CACHE_SECONDS },
    });

    if (!res.ok) {
      return Response.json(
        { error: 'meteo indisponible' },
        { status: 502 }
      );
    }

    const data = await res.json();

    const code = data?.current?.weather_code ?? -1;
    const info = describe(code);

    return Response.json({
      temperature: Math.round(
        data?.current?.temperature_2m ?? 0
      ),
      feltAs: Math.round(
        data?.current?.apparent_temperature ?? 0
      ),
      label: info.label,
      icon: info.icon,
      max: Math.round(
        data?.daily?.temperature_2m_max?.[0] ?? 0
      ),
      min: Math.round(
        data?.daily?.temperature_2m_min?.[0] ?? 0
      ),
    });
  } catch {
    return Response.json(
      { error: 'meteo indisponible' },
      { status: 502 }
    );
  }
}
