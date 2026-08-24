import { NextResponse } from 'next/server';


import {
  redis,
  redisConfigured,
  redisGetJson,
  redisSetJson,
} from '@/lib/redis';
import {
  PushSubscription,
  pushConfigured,
} from '@/lib/webpush';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * =========================================================
 * ABONNEMENTS PUSH
 *
 * Un abonnement n'appartient pas à une personne mais à un
 * navigateur : le même profil sur l'iPhone et sur le Mac en
 * produit deux, distincts, et les deux doivent sonner. D'où
 * une liste par profil et non une valeur unique.
 *
 * La clé de dédoublonnage est l'`endpoint`, que le
 * navigateur régénère quand il renouvelle l'abonnement.
 * =========================================================
 */

const MAX_SUBS = 10;

interface StoredSub extends PushSubscription {
  addedAt: number;
  label?: string;
}

function subsKey(code: string) {
  return `hub_push:${code}`;
}

function isValidCode(
  code: unknown
): code is string {
  return (
    typeof code === 'string' &&
    /^[a-zA-Z0-9_-]{3,24}$/.test(code)
  );
}

function isValidSub(
  sub: unknown
): sub is PushSubscription {
  if (!sub || typeof sub !== 'object') return false;

  const s = sub as PushSubscription;

  return (
    typeof s.endpoint === 'string' &&
    /^https:\/\//.test(s.endpoint) &&
    Boolean(s.keys) &&
    typeof s.keys.p256dh === 'string' &&
    typeof s.keys.auth === 'string'
  );
}

/*
 * La clé publique VAPID n'est pas un secret — le navigateur
 * doit l'avoir pour s'abonner. La servir depuis ici plutôt
 * que par une variable NEXT_PUBLIC_ évite d'avoir deux
 * variables à tenir synchronisées, dont l'une casserait
 * silencieusement les abonnements si elle divergeait.
 */

export async function GET() {
  return NextResponse.json({
    configured: pushConfigured() && redisConfigured(),
    publicKey: process.env.VAPID_PUBLIC_KEY || null,
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const code = body?.code;
    const subscription = body?.subscription;

    if (!isValidCode(code)) {
      return NextResponse.json(
        { error: 'Identifiant de profil invalide' },
        { status: 400 }
      );
    }

    if (!isValidSub(subscription)) {
      return NextResponse.json(
        { error: 'Abonnement invalide' },
        { status: 400 }
      );
    }

    if (!redisConfigured()) {
      return NextResponse.json(
        { error: 'Stockage non configuré' },
        { status: 503 }
      );
    }

    const existing =
      (await redisGetJson<StoredSub[]>(
        subsKey(code)
      )) || [];

    const kept = existing.filter(
      (s) => s.endpoint !== subscription.endpoint
    );

    kept.push({
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      addedAt: Date.now(),
      label:
        typeof body?.label === 'string'
          ? body.label.slice(0, 40)
          : undefined,
    });

    /*
     * On garde les plus récents. Un vieil abonnement qui
     * traîne au-delà de dix appareils est de toute façon
     * mort depuis longtemps.
     */

    const trimmed = kept
      .sort((a, b) => b.addedAt - a.addedAt)
      .slice(0, MAX_SUBS);

    await redisSetJson(subsKey(code), trimmed);

    return NextResponse.json({
      ok: true,
      devices: trimmed.length,
    });
  } catch (error) {
    console.error('Push subscribe error:', error);

    return NextResponse.json(
      {
        error: 'Erreur serveur',
        detail:
          error instanceof Error
            ? error.message
            : String(error),
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const code = searchParams.get('code');
    const endpoint = searchParams.get('endpoint');

    if (!isValidCode(code)) {
      return NextResponse.json(
        { error: 'Identifiant de profil invalide' },
        { status: 400 }
      );
    }

    if (!redisConfigured()) {
      return NextResponse.json({ ok: true });
    }

    if (!endpoint) {
      await redis(['DEL', subsKey(code)]);

      return NextResponse.json({ ok: true, devices: 0 });
    }

    const existing =
      (await redisGetJson<StoredSub[]>(
        subsKey(code)
      )) || [];

    const kept = existing.filter(
      (s) => s.endpoint !== endpoint
    );

    await redisSetJson(subsKey(code), kept);

    return NextResponse.json({
      ok: true,
      devices: kept.length,
    });
  } catch (error) {
    console.error('Push unsubscribe error:', error);

    return NextResponse.json(
      { error: 'Erreur serveur' },
      { status: 500 }
    );
  }
}
