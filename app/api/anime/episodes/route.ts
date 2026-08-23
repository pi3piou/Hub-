import { NextResponse } from 'next/server';

import {
  fetchCatalogue,
  fetchEpisodes,
  FILM_ID_BASE,
  getDefaultPlayerIndex,
  parsePlayers,
  parseSeasons,
} from '@/lib/anime';

/*
 * =========================================================
 * ÉPISODES D'UNE PARTIE (saison, film ou hors-série)
 *
 * Les deux langues partent en parallèle. Si la langue
 * demandée n'existe pas, on renvoie l'autre plutôt
 * qu'une erreur : certains animes ne sont qu'en VF.
 *
 * Les films et les hors-séries arrivent ici sous un numéro
 * fabriqué (900 et plus). Leur adresse réelle vit dans la
 * page catalogue, qu'on relit alors pour retrouver le
 * segment correspondant. Cette relecture ne coûte rien en
 * pratique — la même requête est déjà mise en cache par
 * Next pour une heure — et surtout elle évite de faire
 * transiter le segment par le navigateur, donc de casser
 * les liens déjà en circulation.
 * =========================================================
 */

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const slug = searchParams.get('slug')?.trim();

  const lang =
    searchParams.get('lang') === 'vf'
      ? 'vf'
      : 'vostfr';

  const season = Math.max(
    1,
    Number(searchParams.get('saison')) || 1
  );

  if (!slug) {
    return NextResponse.json(
      { error: 'Slug manquant' },
      { status: 400 }
    );
  }

  const otherLang =
    lang === 'vostfr' ? 'vf' : 'vostfr';

  try {
    /*
     * En dessous de 900 c'est une vraie saison : l'adresse
     * se déduit du numéro, aucune requête supplémentaire.
     */

    let part: string | number = season;

    if (season >= FILM_ID_BASE) {
      const html = await fetchCatalogue(slug);

      const entry = html
        ? parseSeasons(html, slug).find(
            (item) => item.number === season
          )
        : undefined;

      if (!entry) {
        return NextResponse.json(
          {
            error: 'Partie indisponible',
            slug,
            saison: season,
            lang,
          },
          { status: 404 }
        );
      }

      part = entry.path;
    }

    const [requestedText, otherText] =
      await Promise.all([
        fetchEpisodes(slug, part, lang),
        fetchEpisodes(slug, part, otherLang),
      ]);

    /*
     * Aucune des deux langues : la partie
     * n'existe vraiment pas.
     */
    if (!requestedText && !otherText) {
      return NextResponse.json(
        {
          error: 'Saison indisponible',
          slug,
          saison: season,
          lang,
        },
        { status: 404 }
      );
    }

    const fallback = !requestedText;

    const effectiveLang = fallback
      ? otherLang
      : lang;

    const effectiveText = fallback
      ? otherText
      : requestedText;

    const players = parsePlayers(
      effectiveText as string
    );

    const defaultPlayerIndex =
      getDefaultPlayerIndex(players);

    const totalEpisodes =
      players[defaultPlayerIndex]?.urls.length ||
      players[0]?.urls.length ||
      0;

    const hasVostfr =
      lang === 'vostfr'
        ? Boolean(requestedText)
        : Boolean(otherText);

    const hasVF =
      lang === 'vf'
        ? Boolean(requestedText)
        : Boolean(otherText);

    return NextResponse.json(
      {
        slug,
        saison: season,

        /* Langue réellement servie */
        lang: effectiveLang,

        /* Langue initialement demandée */
        requestedLang: lang,

        /* true si on a dû basculer */
        fallback,

        players,
        defaultPlayerIndex,
        totalEpisodes,

        hasVF,
        hasVOSTFR: hasVostfr,
      },
      {
        headers: {
          'Cache-Control':
            'public, s-maxage=900, stale-while-revalidate=3600',
        },
      }
    );
  } catch (error) {
    console.error('Anime episodes error:', error);

    return NextResponse.json(
      { error: 'Erreur serveur' },
      { status: 500 }
    );
  }
}
