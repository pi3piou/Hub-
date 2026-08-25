import crypto from 'crypto';

/*
 * =========================================================
 * LES SONDES DE DIAGNOSTIC, DERRIÈRE UNE PORTE
 *
 * L'application avait accumulé dix points d'entrée de
 * débogage, ajoutés un par un au fil des pannes qu'ils ont
 * servi à résoudre. Chacun se justifiait sur le moment ;
 * ensemble, ils exposaient à qui connaissait l'adresse le
 * HTML brut d'Anime-Sama, les relevés de l'onduleur, l'état
 * de la configuration serveur, et de quoi vider un quota
 * QStash.
 *
 * Plutôt que de les supprimer — ils sont réellement utiles,
 * et les rouvrir un par un dans l'urgence de la prochaine
 * panne serait pénible — ils passent tous par ici.
 *
 * DEUX PRINCIPES
 *
 * Fermé par défaut. Sans `DEBUG_KEY` dans l'environnement,
 * aucune sonde ne répond. C'est le sens de la sécurité qui
 * ne demande aucune action : le déploiement d'aujourd'hui
 * est protégé sans qu'on ait rien à faire, et il faut un
 * geste délibéré pour ouvrir.
 *
 * Répondre 404, jamais 403. Un « accès refusé » confirme que
 * la sonde existe et invite à insister. Un « page
 * introuvable » est indiscernable d'une adresse inventée.
 * =========================================================
 */

function timingSafe(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) return false;

  return crypto.timingSafeEqual(bufA, bufB);
}

export function debugAllowed(request: Request) {
  const expected = process.env.DEBUG_KEY;

  if (!expected) return false;

  const url = new URL(request.url);

  /*
   * La clé est acceptée dans l'adresse ou dans un en-tête.
   * L'adresse est ce qui rend une sonde utilisable depuis la
   * barre d'un navigateur de téléphone — c'était tout
   * l'intérêt de ces points d'entrée, et le perdre les
   * rendrait inutiles.
   */

  const provided =
    url.searchParams.get('key') ||
    request.headers.get('x-hub-debug') ||
    '';

  if (!provided) return false;

  /*
   * Une clé en base64 contient des `+`, que le navigateur
   * transforme en espaces dans un paramètre d'adresse. On
   * compare donc aussi la version où l'espace est rendu au
   * `+`, sans quoi une clé parfaitement correcte serait
   * refusée — panne déjà vécue avec la clé d'import solaire.
   */

  return (
    timingSafe(expected, provided) ||
    timingSafe(expected, provided.replace(/ /g, '+')) ||
    timingSafe(expected, provided.trim())
  );
}

/*
 * La réponse à servir quand la porte est fermée. Volontairement
 * identique à ce que rendrait une adresse qui n'existe pas.
 */

export function debugDenied() {
  return new Response('Not Found', { status: 404 });
}
