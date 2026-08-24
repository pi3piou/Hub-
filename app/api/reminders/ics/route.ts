import { buildIcs } from '@/lib/reminders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * =========================================================
 * EXPORT CALENDRIER
 *
 * Le fichier pourrait être fabriqué entièrement dans le
 * navigateur — il l'était d'ailleurs. Le problème est
 * ailleurs : dans une application installée sur l'écran
 * d'accueil, iOS ignore les téléchargements déclenchés par
 * un lien `download` pointant sur un blob. Le bouton ne
 * faisait donc rien, précisément dans le mode où il servait
 * de solution de repli.
 *
 * Servi par une vraie adresse avec le bon type de contenu,
 * le fichier est reconnu par iOS, qui propose de l'ajouter
 * au Calendrier.
 *
 * Aucune donnée n'est enregistrée ici : tout est dans
 * l'adresse, et la réponse est fabriquée à la volée.
 * =========================================================
 */

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const text = (searchParams.get('text') || '').slice(
    0,
    200
  );

  const dueAt = Number(searchParams.get('due'));

  /*
   * L'heure d'alarme arrive calculée par le navigateur.
   * La recalculer ici la placerait dans le fuseau du
   * serveur — deux heures d'écart en été.
   */

  const fireAt = Number(searchParams.get('fire'));

  const id = (searchParams.get('id') || 'rappel').replace(
    /[^a-zA-Z0-9_-]/g,
    ''
  );

  if (!text.trim() || !Number.isFinite(dueAt)) {
    return new Response('Requête incomplète', {
      status: 400,
    });
  }

  const ics = buildIcs(
    { id: id || 'rappel', text, done: false, dueAt },
    Number.isFinite(fireAt) ? fireAt : undefined
  );

  if (!ics) {
    return new Response('Requête incomplète', {
      status: 400,
    });
  }

  const filename =
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'rappel';

  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',

      /*
       * `inline` plutôt qu'`attachment` : c'est ce qui
       * pousse iOS à ouvrir la fiche « Ajouter au
       * calendrier » au lieu de ranger le fichier dans
       * Fichiers, où personne n'irait le chercher.
       */
      'Content-Disposition': `inline; filename="${filename}.ics"`,
      'Cache-Control': 'no-store',
    },
  });
}
