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

    const entries = parseSeasons(html);

    const seasonEntries = entries.length
      ? entries
      : [
          {
            number: 1,
            label: 'Saison 1',
            langs: [],
          },
        ];

    /* Toutes les langues rencontrées, dédupliquées */
    const langs = Array.from(
      new Set(
        seasonEntries.flatMap(
          (item) => item.langs
        )
      )
    );

    return NextResponse.json(
      {
        ...info,

        /* Détail par saison : numéro, libellé, langues */
        seasonEntries,

        /* Conservé pour compatibilité */
        seasons: seasonEntries.map(
          (item) => item.number
        ),

        totalSeasons: seasonEntries.length,

        langs,
      },
      {
        headers: {
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
