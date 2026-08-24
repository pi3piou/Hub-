import { NextResponse } from 'next/server';

import {
  cancelMessage,
  deliverySecret,
  publicOrigin,
  qstashConfigured,
  scheduleMessage,
} from '@/lib/qstash';
import {
  redis,
  redisConfigured,
  redisSetJson,
} from '@/lib/redis';
import { pushConfigured } from '@/lib/webpush';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * =========================================================
 * RAPPELS — PLANIFICATION ET ANNULATION
 *
 * La fiche du rappel est enregistrée ici, et c'est elle qui
 * fait autorité au moment de l'envoi. Le message planifié
 * chez QStash ne transporte que deux identifiants ; tout le
 * reste est relu depuis le stockage.
 *
 * Ce détour a une raison : quand une tâche est cochée ou
 * supprimée, l'annulation du message peut échouer (message
 * déjà en cours de distribution, réseau capricieux). En
 * effaçant la fiche, on rend l'envoi impossible même si le
 * message part quand même. L'inverse — tout mettre dans le
 * message — laisserait sonner des rappels pour des tâches
 * qui n'existent plus.
 * =========================================================
 */

const MAX_HORIZON = 365 * 24 * 60 * 60 * 1000;

interface StoredReminder {
  todoId: string;
  code: string;
  text: string;
  dueAt: number;
  fireAt: number;
}

function reminderKey(code: string, todoId: string) {
  return `hub_reminder:${code}:${todoId}`;
}

function isValidCode(code: unknown): code is string {
  return (
    typeof code === 'string' &&
    /^[a-zA-Z0-9_-]{3,24}$/.test(code)
  );
}

function isValidId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    /^[a-zA-Z0-9_-]{1,64}$/.test(id)
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const code = body?.code;
    const todoId = body?.todoId;
    const text = body?.text;
    const dueAt = Number(body?.dueAt);
    const fireAt = Number(body?.fireAt);

    if (!isValidCode(code) || !isValidId(todoId)) {
      return NextResponse.json(
        { error: 'Identifiants invalides' },
        { status: 400 }
      );
    }

    if (
      typeof text !== 'string' ||
      !text.trim() ||
      !Number.isFinite(dueAt) ||
      !Number.isFinite(fireAt)
    ) {
      return NextResponse.json(
        { error: 'Rappel incomplet' },
        { status: 400 }
      );
    }

    if (fireAt > Date.now() + MAX_HORIZON) {
      return NextResponse.json(
        { error: 'Échéance trop lointaine' },
        { status: 400 }
      );
    }

    if (
      !qstashConfigured() ||
      !pushConfigured() ||
      !redisConfigured()
    ) {
      /*
       * Pas une erreur : l'application doit rester
       * utilisable sans notifications. La tâche et sa date
       * existent quand même, et l'export calendrier reste
       * disponible côté navigateur.
       */
      return NextResponse.json({
        ok: false,
        scheduled: false,
        reason: 'not_configured',
      });
    }

    const secret = deliverySecret();
    const origin = publicOrigin(request);

    if (!secret || !origin) {
      return NextResponse.json({
        ok: false,
        scheduled: false,
        reason: 'not_configured',
      });
    }

    /*
     * Une heure d'envoi déjà passée arrive plus souvent
     * qu'on ne croit : « rappelle-moi une heure avant » sur
     * un rendez-vous dans quarante minutes. Plutôt que de
     * refuser, on décale à tout de suite — c'est ce que la
     * personne voulait dire.
     */

    const when = Math.max(fireAt, Date.now() + 15_000);

    const reminder: StoredReminder = {
      todoId,
      code,
      text: text.trim().slice(0, 200),
      dueAt,
      fireAt: when,
    };

    /*
     * La fiche expire une semaine après l'envoi : passé ce
     * délai elle n'a plus aucune utilité, et le stockage
     * n'a pas à garder trace de tous les rendez-vous
     * passés.
     */

    const ttl = Math.ceil(
      (when - Date.now()) / 1000 + 7 * 24 * 60 * 60
    );

    await redisSetJson(
      reminderKey(code, todoId),
      reminder,
      ttl
    );

    const destination = `${origin}/api/reminders/deliver`;

    const scheduleId = await scheduleMessage(
      destination,
      when,
      { code, todoId },
      secret
    );

    return NextResponse.json({
      ok: true,
      scheduled: true,
      scheduleId,
      fireAt: when,
    });
  } catch (error) {
    console.error('Reminder POST error:', error);

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
    const todoId = searchParams.get('todoId');
    const scheduleId = searchParams.get('scheduleId');

    if (!isValidCode(code) || !isValidId(todoId)) {
      return NextResponse.json(
        { error: 'Identifiants invalides' },
        { status: 400 }
      );
    }

    /*
     * L'ordre compte. On efface d'abord la fiche — le seul
     * geste qui garantit le silence — puis on tente
     * l'annulation du message, qui n'est qu'une économie.
     */

    if (redisConfigured()) {
      await redis([
        'DEL',
        reminderKey(code, todoId),
      ]).catch(() => null);
    }

    if (scheduleId) {
      await cancelMessage(scheduleId);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Reminder DELETE error:', error);

    return NextResponse.json(
      { error: 'Erreur serveur' },
      { status: 500 }
    );
  }
}
