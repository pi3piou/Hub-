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
 * N'a pas besoin de la page catalogue : le fichier
 * episodes.js s'atteint directement depuis le slug
 * et le numéro de saison.
 *
 * Les deux langues partent en parallèle, ce qui
 * permet de savoir si la VF existe sans allonger
 * le temps de réponse.
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

    if (!requestedText) {
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

    const players = parsePlayers(requestedText);

    const defaultPlayerIndex =
      getDefaultPlayerIndex(players);

    const totalEpisodes =
      players[defaultPlayerIndex]?.urls.length ||
      players[0]?.urls.length ||
      0;

    const hasVF =
      lang === 'vf'
        ? true
        : Boolean(otherText);

    return NextResponse.json(
      {
        slug,
        saison: season,
        lang,
        players,
        defaultPlayerIndex,
        totalEpisodes,
        hasVF,
      },
      {
        headers: {
          /*
           * Les épisodes d'une saison en cours
           * peuvent s'ajouter : cache plus court.
           */
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
