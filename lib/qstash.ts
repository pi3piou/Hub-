import crypto from 'crypto';

/*
 * =========================================================
 * QSTASH — PLANIFICATION À L'HEURE PRÉCISE
 *
 * Le problème que ça résout : personne ne tourne quand le
 * rappel doit partir. Le téléphone est verrouillé, aucune
 * page n'est ouverte, et une fonction serverless ne vit que
 * le temps d'une requête. Il faut donc quelqu'un d'extérieur
 * qui rappelle l'application au bon moment.
 *
 * Une tâche périodique (« toutes les cinq minutes, regarde
 * s'il y a quelque chose à envoyer ») ferait le même
 * travail, mais Vercel n'en autorise qu'une par jour sur le
 * plan gratuit — ce qui donnerait des rappels à une journée
 * près. QStash prend l'approche inverse : un message, une
 * heure de livraison. Rien ne tourne entre-temps.
 * =========================================================
 */

/*
 * Upstash publie aussi des adresses par région
 * (qstash-eu-central-1, qstash-us-east-1). Celle-ci sert
 * tout le monde et reste la valeur par défaut de leurs
 * propres bibliothèques ; QSTASH_URL est là pour le jour
 * où viser une région précise deviendrait utile.
 */

const QSTASH_BASE = `${(
  process.env.QSTASH_URL || 'https://qstash.upstash.io'
).replace(/\/+$/, '')}/v2`;

export function qstashConfigured() {
  return Boolean(process.env.QSTASH_TOKEN);
}

/*
 * Le point de livraison est ouvert sur l'internet : il faut
 * bien que QStash puisse l'appeler. Un secret partagé
 * l'accompagne donc, sans quoi n'importe qui pourrait
 * déclencher des notifications sur le téléphone.
 *
 * À défaut de variable dédiée, il est dérivé de la clé
 * privée VAPID — déjà présente, déjà secrète. Une variable
 * d'environnement de moins à créer, et surtout une de moins
 * à oublier, ce qui aurait laissé le point de livraison
 * ouvert à tous.
 */

export function deliverySecret() {
  const explicit = process.env.REMINDER_SECRET;

  if (explicit) return explicit;

  const seed = process.env.VAPID_PRIVATE_KEY;

  if (!seed) return null;

  return crypto
    .createHash('sha256')
    .update(`${seed}:hub-rappels`)
    .digest('hex')
    .slice(0, 32);
}

/*
 * L'adresse publique de l'application, déduite des en-têtes
 * de la requête en cours. Vercel la fournit aussi dans
 * VERCEL_URL, mais celle-là pointe vers le déploiement
 * précis plutôt que vers le domaine stable : un rappel
 * planifié aujourd'hui appellerait dans trois jours une URL
 * de déploiement peut-être expirée.
 */

export function publicOrigin(request: Request) {
  const explicit = process.env.APP_URL;

  if (explicit) return explicit.replace(/\/+$/, '');

  const headers = request.headers;

  const host =
    headers.get('x-forwarded-host') ||
    headers.get('host');

  const proto =
    headers.get('x-forwarded-proto') ||
    (host && host.startsWith('localhost')
      ? 'http'
      : 'https');

  if (!host) return null;

  return `${proto}://${host}`;
}

export async function scheduleMessage(
  destination: string,
  fireAt: number,
  body: unknown,
  secret: string
): Promise<string> {
  const token = process.env.QSTASH_TOKEN;

  if (!token) throw new Error('QSTASH_TOKEN absent');

  const response = await fetch(
    `${QSTASH_BASE}/publish/${destination}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',

        /* Livraison à l'heure dite, en secondes Unix. */
        'Upstash-Not-Before': String(
          Math.floor(fireAt / 1000)
        ),

        /*
         * Trois tentatives. Au-delà, le rendez-vous est
         * probablement passé et une notification en retard
         * vaut moins que pas de notification du tout.
         */
        'Upstash-Retries': '3',

        /*
         * `Upstash-Forward-` retire le préfixe et transmet
         * l'en-tête tel quel au destinataire. C'est ainsi
         * que le secret voyage sans apparaître dans l'URL.
         */
        'Upstash-Forward-X-Hub-Key': secret,
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');

    throw new Error(
      `QStash a répondu ${response.status} : ${text.slice(
        0,
        200
      )}`
    );
  }

  const json = await response.json();

  const messageId = Array.isArray(json)
    ? json[0]?.messageId
    : json?.messageId;

  if (!messageId) {
    throw new Error('QStash n’a pas renvoyé de messageId');
  }

  return String(messageId);
}

/*
 * L'annulation peut échouer sans que ce soit un problème :
 * le message a pu déjà partir, ou avoir été purgé. Le
 * verrou qui compte est ailleurs — la fiche du rappel est
 * effacée du stockage, et le point de livraison refuse
 * d'envoyer quoi que ce soit sans elle.
 */

export async function cancelMessage(messageId: string) {
  const token = process.env.QSTASH_TOKEN;

  if (!token) return false;

  try {
    const response = await fetch(
      `${QSTASH_BASE}/messages/${encodeURIComponent(
        messageId
      )}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}
