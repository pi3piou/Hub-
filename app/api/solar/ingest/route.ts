import {
  isConfigured,
  looksLikeMeter,
  normalizeMeter,
  normalizePowerflow,
  saveMeter,
  savePowerflow,
} from '@/lib/solar';
import { debugAllowed } from '@/lib/debugGate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * =============================================================
 * RÉCEPTION DES RELEVÉS DE L'ONDULEUR
 *
 * C'est le Datamanager Fronius qui appelle cette route, tout
 * seul, à intervalle régulier. Rien ne tourne à la maison.
 *
 * Une seule route pour les deux flux (Powerflow et Meter) :
 * on reconnaît le format à son contenu plutôt que de demander
 * deux adresses différentes. Un réglage de moins à saisir sur
 * l'écran de l'onduleur, donc une occasion de moins de se
 * tromper.
 * =============================================================
 */

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

  if (searchParams.get('key') === expected) return true;

  /*
   * Repli sur l'authentification HTTP classique, au cas où le
   * champ "nom du fichier" du Datamanager refuserait une
   * chaîne de requête. N'importe quel identifiant convient,
   * c'est le mot de passe qui fait office de clé.
   */

  const auth = request.headers.get('authorization') || '';

  if (auth.toLowerCase().startsWith('basic ')) {
    try {
      const decoded = atob(auth.slice(6).trim());
      return (
        decoded.slice(decoded.indexOf(':') + 1) === expected
      );
    } catch {
      return false;
    }
  }

  return false;
}

async function handle(request: Request) {
  if (!process.env.SOLAR_INGEST_KEY) {
    return Response.json(
      { error: 'SOLAR_INGEST_KEY absent' },
      { status: 500 }
    );
  }

  if (!checkKey(request)) return unauthorized();

  if (!isConfigured()) {
    return Response.json(
      { error: 'upstash non configure' },
      { status: 500 }
    );
  }

  /*
   * On lit le corps en TEXTE avant de le décoder. Le
   * Datamanager n'annonce pas toujours un Content-Type
   * application/json, et request.json() échouerait alors sur
   * une charge utile pourtant parfaitement valide.
   */

  const raw = await request.text();

  if (!raw) {
    return Response.json(
      { error: 'corps vide' },
      { status: 400 }
    );
  }

  let payload: unknown;

  try {
    payload = JSON.parse(raw);
  } catch {
    return Response.json(
      { error: 'json illisible' },
      { status: 400 }
    );
  }

  if (looksLikeMeter(payload)) {
    const snapshot = normalizeMeter(payload);

    await saveMeter(snapshot, raw);

    return Response.json({
      ok: true,
      kind: 'meter',
      snapshot,
    });
  }

  const reading = normalizePowerflow(payload);

  await savePowerflow(reading, raw);

  return Response.json({
    ok: true,
    kind: 'powerflow',
    reading,
  });
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  /*
   * ?probe=1 — joignable depuis un navigateur, sans clé. Sert
   * uniquement à confirmer que la route est déployée et
   * qu'Upstash est configuré, avant même de toucher à
   * l'onduleur.
   */

  if (
    searchParams.get('probe') === '1' &&
    debugAllowed(request)
  ) {
    return Response.json({
      ok: true,
      message: 'route joignable',
      upstash: isConfigured(),
    });
  }

  /*
   * ?demo=1&key=... — écrit un relevé fictif des deux types.
   * Permet de valider toute la chaîne depuis la barre
   * d'adresse du téléphone. Sans ça, le premier essai réel
   * mélangerait trop de causes possibles en cas d'échec :
   * mauvaise clé, Upstash mal réglé, mauvais format choisi sur
   * l'onduleur.
   */

  if (searchParams.get('demo') === '1') {
    if (!checkKey(request)) return unauthorized();

    const powerflow = {
      Body: {
        Data: {
          Site: {
            P_PV: 3910,
            P_Load: -652,
            P_Grid: -3258,
            P_Akku: null,
            rel_Autonomy: 100,
            rel_SelfConsumption: 16.7,
            E_Day: 12400,
          },
        },
      },
    };

    const meter = {
      Body: {
        Data: {
          EnergyReal_WAC_Sum_Consumed: 4210000,
          EnergyReal_WAC_Sum_Produced: 1875000,
        },
      },
    };

    const reading = normalizePowerflow(powerflow);
    const snapshot = normalizeMeter(meter);

    await savePowerflow(
      reading,
      JSON.stringify(powerflow)
    );

    await saveMeter(snapshot, JSON.stringify(meter));

    return Response.json({
      ok: true,
      demo: true,
      reading,
      snapshot,
    });
  }

  return handle(request);
}
