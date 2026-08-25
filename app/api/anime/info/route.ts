import { NextResponse } from 'next/server';

import {
  extractAnimeInfo,
  fetchCatalogue,
  getCatalogueUrl,
  parseSeasons,
  SeasonEntry,
} from '@/lib/anime';

/*
 * =========================================================
 * FICHE ANIME
 *
 * Une seule requête vers Anime-Sama : la page catalogue.
 * Ne touche jamais aux fichiers episodes.js.
 * =========================================================
 */

import { debugAllowed } from '@/lib/debugGate';


export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const slug = searchParams.get('slug')?.trim();

  if (!slug) {
    return NextResponse.json(
      { error: 'Slug manquant' },
      { status: 400 }
    );
  }

  try {
    const catalogueUrl = getCatalogueUrl(slug);

    const html = await fetchCatalogue(slug);

    if (!html) {
      return NextResponse.json(
        {
          error:
            'Impossible de récupérer la page de l’anime',
        },
        { status: 502 }
      );
    }

 // if (searchParams.get('debug') === 'status') {   →
    if (
      searchParams.get('debug') === 'status' &&
      debugAllowed(request)
    ) {

// if (searchParams.get('debug') === 'img') {      →
    if (
      searchParams.get('debug') === 'img' &&
      debugAllowed(request)
    ) {

// if (searchParams.get('debug')) {                →
    if (searchParams.get('debug') && debugAllowed(request)) {


    const info = extractAnimeInfo(
      html,
      slug,
      catalogueUrl
    );

    const entries = parseSeasons(html, slug);

    const seasonEntries: SeasonEntry[] = entries.length
      ? entries
      : [
          {
            number: 1,
            label: 'Saison 1',
            langs: [],
            path: 'saison1',
            kind: 'season',
          },
        ];

    const langs = Array.from(
      new Set(
        seasonEntries.flatMap(
          (item) => item.langs
        )
      )
    );

    /*
     * `seasons` ne contient que les VRAIES saisons, et pas
     * les films ni les hors-séries. Plusieurs écrans s'en
     * servent pour écrire « 3 saisons » ou pour deviner la
     * saison suivante d'une série : y glisser les films
     * fausserait ces deux calculs. Les autres parties
     * restent accessibles par `seasonEntries`.
     */

    const realSeasons = seasonEntries.filter(
      (item) => item.kind === 'season'
    );

    return NextResponse.json(
      {
        ...info,
        seasonEntries,
        seasons: realSeasons.map(
          (item) => item.number
        ),
        totalSeasons: realSeasons.length,
        langs,
      },
      {
        headers: {
          'Content-Type':
            'application/json; charset=utf-8',

          'Cache-Control':
            'public, s-maxage=3600, stale-while-revalidate=86400',
        },
      }
    );
  } catch (error) {
    console.error('Anime info error:', error);

    return NextResponse.json(
      { error: 'Erreur serveur' },
      { status: 500 }
    );
  }
}
