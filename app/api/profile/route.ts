import { NextResponse } from 'next/server';

/*
 * =========================================================
 * PROFIL — STOCKAGE UPSTASH REDIS
 *
 * Un seul blob JSON par code de profil. Pas de fusion,
 * pas d'historique de versions : chaque écriture remplace
 * entièrement la précédente.
 *
 * Nécessite UPSTASH_REDIS_REST_URL et
 * UPSTASH_REDIS_REST_TOKEN sur Vercel — copie-les tels
 * quels depuis l'onglet ".env" du tableau de bord Upstash,
 * ce sont exactement les noms attendus ici.
 * =========================================================
 */

const MAX_PAYLOAD_SIZE = 200_000; // 200 Ko, large marge

function isValidCode(
  code: string | null
): code is string {
  return Boolean(code && /^[A-Z0-9]{4,10}$/.test(code));
}

async function upstash(
  command: (string | number)[]
) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error('Upstash non configuré');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });

  if (!response.ok) {
    throw new Error('Erreur Upstash');
  }

  const json = await response.json();

  return json.result;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const code = searchParams.get('code');

  if (!isValidCode(code)) {
    return NextResponse.json(
      { error: 'Code invalide' },
      { status: 400 }
    );
  }

  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    return NextResponse.json(
      { error: 'Profil non configuré côté serveur' },
      { status: 200 }
    );
  }

  try {
    const raw = await upstash([
      'GET',
      `anime_profile:${code}`,
    ]);

    return NextResponse.json({
      data: raw ? JSON.parse(raw) : null,
    });
  } catch (error) {
    console.error('Profile GET error:', error);

    return NextResponse.json(
      { error: 'Erreur serveur' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();

    const code = body?.code;

    if (!isValidCode(code)) {
      return NextResponse.json(
        { error: 'Code invalide' },
        { status: 400 }
      );
    }

    if (
      !process.env.UPSTASH_REDIS_REST_URL ||
      !process.env.UPSTASH_REDIS_REST_TOKEN
    ) {
      return NextResponse.json(
        { error: 'Profil non configuré côté serveur' },
        { status: 200 }
      );
    }

    const payload = JSON.stringify(body.data || {});

    if (payload.length > MAX_PAYLOAD_SIZE) {
      return NextResponse.json(
        { error: 'Profil trop volumineux' },
        { status: 413 }
      );
    }

    await upstash([
      'SET',
      `anime_profile:${code}`,
      payload,
    ]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Profile PUT error:', error);

    return NextResponse.json(
      { error: 'Erreur serveur' },
      { status: 500 }
    );
  }
}
