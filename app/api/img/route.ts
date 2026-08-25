import { FEEDS } from '@/lib/techfeed/feeds';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * =========================================================
 * PROXY D'IMAGES — pour les vignettes des flux TechFeed.
 *
 * `strict-origin-when-cross-origin` sur la balise <img> ne
 * suffisait pas pour iPhoneAddict : le logo du site continuait
 * d'apparaître à la place de la photo, référent envoyé ou pas.
 * Un CDN qui protège ses images de cette façon ne regarde en
 * général qu'une chose : que la requête vienne bien de chez
 * lui. Un navigateur ne peut pas mentir sur ce point — le
 * Referer est un en-tête interdit à la main en JavaScript.
 * Un serveur, lui, le peut : c'est tout l'intérêt de faire
 * transiter l'image par ici plutôt que de la charger
 * directement depuis le téléphone.
 *
 * Ouvert uniquement aux domaines des flux suivis, dérivés de
 * FEEDS plutôt que recopiés à la main : une nouvelle source
 * ajoutée là-bas devient utilisable ici sans y repenser, et
 * ça évite d'ouvrir un proxy d'images qui accepterait
 * n'importe quelle adresse.
 * =========================================================
 */

/*
 * Numerama ne sert pas ses images depuis numerama.com mais
 * depuis un CDN mutualisé, `lestechnophiles.com` — le domaine
 * du site d'origine réapparaît dans le CHEMIN de l'URL
 * (`c0.lestechnophiles.com/www.numerama.com/...`), pas dans
 * son hôte. Rien dans FEEDS ne pouvait le deviner : la liste
 * qui en est dérivée doit donc être complétée à la main pour
 * ce genre de cas.
 */

const EXTRA_HOSTS = ['lestechnophiles.com'];

const ALLOWED_HOSTS: string[] = [
  ...FEEDS.map(
    (f: { base: string }) =>
      new URL(f.base).hostname.replace(/^www\./, '')
  ),
  ...EXTRA_HOSTS,
];

function hostAllowed(hostname: string): boolean {
  const h = hostname.toLowerCase();

  return ALLOWED_HOSTS.some(
    (base) => h === base || h.endsWith('.' + base)
  );
}

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('u');

  if (!raw) {
    return new Response('Paramètre manquant', { status: 400 });
  }

  let target: URL;

  try {
    target = new URL(raw);
  } catch {
    return new Response('Adresse invalide', { status: 400 });
  }

  if (
    target.protocol !== 'https:' ||
    !hostAllowed(target.hostname)
  ) {
    return new Response('Domaine non autorisé', {
      status: 403,
    });
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        'User-Agent': UA,
        Accept: 'image/avif,image/webp,image/*,*/*',
        /*
         * On se fait passer pour une page du site lui-même.
         * C'est précisément ce que vérifie une protection
         * anti-hotlink par Referer, et une fois vu depuis le
         * serveur plutôt que depuis le téléphone, ça ne
         * révèle plus rien sur qui regarde quoi.
         */
        Referer: `https://${target.hostname}/`,
      },
      cache: 'no-store',
    });

    if (!upstream.ok || !upstream.body) {
      return new Response('Image indisponible', {
        status: 502,
      });
    }

    const contentType =
      upstream.headers.get('content-type') || 'image/jpeg';

    return new Response(upstream.body, {
      headers: {
        'Content-Type': contentType,
        /*
         * Une image publiée ne change pas de contenu sous la
         * même adresse : WordPress en crée une nouvelle plutôt
         * que d'écraser l'ancienne. Un cache long côté
         * navigateur et CDN est donc sans risque, et évite de
         * repasser par ce proxy à chaque défilement de liste.
         */
        'Cache-Control':
          'public, max-age=604800, immutable',
      },
    });
  } catch {
    return new Response('Récupération impossible', {
      status: 502,
    });
  }
}
