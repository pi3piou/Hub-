import { NextResponse } from 'next/server';

import {
  fetchEpisodes,
  getDefaultPlayerIndex,
  parsePlayers,
} from '@/lib/anime';

/*
 * =========================================================
 * ÉPISODES D'UNE SAISON
 *
 * Les deux langues partent en parallèle. Si la langue
 * demandée n'existe pas, on renvoie l'autre plutôt
 * qu'une erreur : certains animes ne sont qu'en VF.
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
    const [requestedText, otherText] =
      await Promise.all([
        fetchEpisodes(slug, season, lang),
        fetchEpisodes(slug, season, otherLang),
      ]);

    /*
     * Aucune des deux langues : la saison
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
