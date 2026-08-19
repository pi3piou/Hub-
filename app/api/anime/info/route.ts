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

     if (searchParams.get('debug') === 'status') {
      const matches = [
        ...html.matchAll(/info-lbl["'][^>]*>/gi),
      ];

      const target = matches[1] || matches[0];

      const index = target
        ? (target.index ?? 0)
        : -1;

      return NextResponse.json(
        {
          totalMatches: matches.length,
          extrait:
            index >= 0
              ? html.slice(index, index + 12500)
              : 'introuvable',
        },
        {
          headers: {
            'Content-Type':
              'application/json; charset=utf-8',
          },
        }
      );
    }


    /*
     * Sonde image : /api/anime/info?slug=x&debug=img
     */
    if (searchParams.get('debug') === 'img') {
      const og = html.match(
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
      )?.[1];

      const imgTags = Array.from(
        html.matchAll(/<img[^>]{0,300}>/gi)
      )
        .slice(0, 8)
        .map((m) => m[0]);

      return NextResponse.json(
        { og, imgTags },
        {
          headers: {
            'Content-Type':
              'application/json; charset=utf-8',
          },
        }
      );
    }

    /*
     * Sonde générique : /api/anime/info?slug=x&debug=1
     */
    if (searchParams.get('debug')) {
      const index = html.search(/genre/i);

      return NextResponse.json(
        {
          found: index,
          snippet:
            index >= 0
              ? html.slice(
                  Math.max(0, index - 300),
                  index + 700
                )
              : html.slice(0, 500),
        },
        {
          headers: {
            'Content-Type':
              'application/json; charset=utf-8',
          },
        }
      );
    }

    const info = extractAnimeInfo(
      html,
      slug,
      catalogueUrl
    );

    const entries = parseSeasons(html, slug);

    const seasonEntries = entries.length
      ? entries
      : [
          {
            number: 1,
            label: 'Saison 1',
            langs: [],
          },
        ];

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
        seasonEntries,
        seasons: seasonEntries.map(
          (item) => item.number
        ),
        totalSeasons: seasonEntries.length,
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
