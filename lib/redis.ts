/*
 * =========================================================
 * UPSTASH REDIS — ACCÈS PARTAGÉ
 *
 * L'application parlait déjà à Upstash depuis trois
 * endroits, chacun avec sa propre copie de la même
 * fonction. Les rappels en auraient ajouté une quatrième :
 * autant la sortir une bonne fois.
 *
 * Rien n'est réécrit dans les fichiers existants — ils
 * fonctionnent, et une migration cosmétique sur du code
 * éprouvé se paye toujours plus cher qu'elle ne rapporte.
 * =========================================================
 */

export function redisConfigured() {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL &&
      process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

export async function redis(
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
    cache: 'no-store',
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');

    throw new Error(
      `Upstash a répondu ${response.status} : ${text.slice(
        0,
        200
      )}`
    );
  }

  const json = await response.json();

  return json.result;
}

export async function redisGetJson<T>(
  key: string
): Promise<T | null> {
  const raw = await redis(['GET', key]);

  if (!raw || typeof raw !== 'string') return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function redisSetJson(
  key: string,
  value: unknown,
  ttlSeconds?: number
) {
  const payload = JSON.stringify(value);

  if (ttlSeconds && ttlSeconds > 0) {
    return redis(['SET', key, payload, 'EX', ttlSeconds]);
  }

  return redis(['SET', key, payload]);
}
