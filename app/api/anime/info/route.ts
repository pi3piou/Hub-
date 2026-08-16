import { NextResponse } from 'next/server';

import {
  extractAnimeInfo,
  fetchCatalogue,
  getCatalogueUrl,
  parseSeasons,
} from '@/lib/anime';

/*
 * =========================================================
 * FICHE ANIME
 *
 * Une seule requête vers Anime-Sama : la page catalogue.
 * Ne touche jamais aux fichiers episodes.js.
 * =========================================================
 */

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

    const info = extractAnimeInfo(
      html,
      slug,
      catalogueUrl
    );

    const seasons = parseSeasons(html);

    return NextResponse.json(
      {
        ...info,
        seasons: seasons.length ? seasons : [1],
        totalSeasons: seasons.length || 1,
      },
      {
        headers: {
          /*
           * Une fiche bouge très peu :
           * 1 h de cache, 24 h de tolérance.
           */
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
