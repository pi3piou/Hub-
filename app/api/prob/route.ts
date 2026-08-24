export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const token = process.env.QSTASH_TOKEN || '';

  const host =
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host');

  const etat = {
    origine: host ? `https://${host}` : null,
    jeton_present: Boolean(token),
    jeton_longueur: token.length,
    jeton_debut: token.slice(0, 4),
    redis: Boolean(process.env.UPSTASH_REDIS_REST_URL),
    vapid: Boolean(process.env.VAPID_PRIVATE_KEY),
  };

  if (!token) {
    return Response.json({ ...etat, qstash: 'jeton absent' });
  }

  const res = await fetch(
    'https://qstash.upstash.io/v2/publish/https://example.com/',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Upstash-Not-Before': String(
          Math.floor(Date.now() / 1000) + 3600
        ),
      },
      body: '{}',
    }
  );

  const texte = await res.text();

  if (res.ok) {
    const id = JSON.parse(texte).messageId;

    await fetch(
      `https://qstash.upstash.io/v2/messages/${id}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }
    );
  }

  return Response.json({
    ...etat,
    qstash_statut: res.status,
    qstash_reponse: texte.slice(0, 300),
  });
}
