import crypto from 'crypto';
import { NextResponse } from 'next/server';

import { deliverySecret } from '@/lib/qstash';
import {
  redis,
  redisConfigured,
  redisGetJson,
  redisSetJson,
} from '@/lib/redis';
import {
  PushSubscription,
  pushConfigured,
  sendPush,
} from '@/lib/webpush';

import import { debugAllowed, debugDenied } from '@/lib/debugGate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * =========================================================
 * LIVRAISON D'UN RAPPEL
 *
 * Appelé par QStash à l'heure dite, jamais par le
 * navigateur. Trois vérifications avant d'envoyer quoi que
 * ce soit : le secret, l'existence de la fiche, et
 * l'existence d'au moins un appareil abonné.
 * =========================================================
 */

interface StoredReminder {
  todoId: string;
  code: string;
  text: string;
  dueAt: number;
  fireAt: number;
}

interface StoredSub extends PushSubscription {
  addedAt: number;
  label?: string;
}

/*
 * Comparaison à temps constant. La différence est
 * théorique à cette échelle, mais c'est une ligne et le
 * jour où ce point de livraison sert à autre chose, la
 * bonne habitude sera déjà là.
 */

function sameSecret(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) return false;

  return crypto.timingSafeEqual(bufA, bufB);
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: process.env.HUB_TIMEZONE || 'Europe/Paris',
  });
}

export async function POST(request: Request) {
  const secret = deliverySecret();
  /*
   * Cette sonde était ouverte à tous, et c'était une erreur :
   * elle dresse l'inventaire de la configuration serveur, et
   * `?probe=qstash` envoie un vrai message — de quoi vider un
   * quota depuis une barre d'adresse.
   */

  if (!debugAllowed(request)) return debugDenied();

  const provided =
    request.headers.get('x-hub-key') ||
    new URL(request.url).searchParams.get('key') ||
    '';

  if (!secret || !sameSecret(secret, provided)) {
    return NextResponse.json(
      { error: 'Non autorisé' },
      { status: 401 }
    );
  }

  if (!redisConfigured() || !pushConfigured()) {
    return NextResponse.json(
      { error: 'Non configuré' },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();

    const code = String(body?.code || '');
    const todoId = String(body?.todoId || '');

    if (!code || !todoId) {
      return NextResponse.json(
        { error: 'Requête incomplète' },
        { status: 400 }
      );
    }

    const reminder = await redisGetJson<StoredReminder>(
      `hub_reminder:${code}:${todoId}`
    );

    /*
     * Fiche absente : la tâche a été cochée ou supprimée
     * entre-temps. Ce n'est pas une erreur, c'est
     * exactement le mécanisme d'annulation qui fonctionne.
     * On répond 200 pour que QStash ne réessaie pas.
     */

    if (!reminder) {
      return NextResponse.json({
        ok: true,
        sent: 0,
        reason: 'annulé',
      });
    }

    const subs =
      (await redisGetJson<StoredSub[]>(
        `hub_push:${code}`
      )) || [];

    if (subs.length === 0) {
      await redis(['DEL', `hub_reminder:${code}:${todoId}`]);

      return NextResponse.json({
        ok: true,
        sent: 0,
        reason: 'aucun appareil',
      });
    }

    const heure = formatTime(reminder.dueAt);

    const payload = {
      title: reminder.text,
      body:
        reminder.fireAt < reminder.dueAt - 60_000
          ? `À ${heure}`
          : `C’est maintenant — ${heure}`,
      tag: `hub-todo-${todoId}`,
      url: '/',
      todoId,
    };

    const results = await Promise.all(
      subs.map((sub) => sendPush(sub, payload))
    );

    /*
     * Purge des abonnements morts. Sans elle, un iPhone
     * réinstallé laisse derrière lui une adresse qui
     * échouera à chaque rappel, indéfiniment.
     */

    const alive = subs.filter(
      (_, i) => !results[i].gone
    );

    if (alive.length !== subs.length) {
      await redisSetJson(`hub_push:${code}`, alive);
    }

    await redis(['DEL', `hub_reminder:${code}:${todoId}`]);

    const sent = results.filter((r) => r.ok).length;

    return NextResponse.json({
      ok: true,
      sent,
      devices: subs.length,
      purged: subs.length - alive.length,
      errors: results
        .filter((r) => !r.ok)
        .map((r) => `${r.status} ${r.detail || ''}`.trim()),
    });
  } catch (error) {
    console.error('Reminder deliver error:', error);

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

/*
 * Sonde de configuration. Répond sans rien envoyer, pour
 * vérifier depuis un navigateur que les clés sont en place
 * — un rappel qui ne sonne pas ne dit jamais lequel des
 * quatre réglages manque.
 */

export async function GET() {
  return NextResponse.json({
    redis: redisConfigured(),
    vapid: pushConfigured(),
    qstash: Boolean(process.env.QSTASH_TOKEN),
    secret: Boolean(deliverySecret()),
  });
}
