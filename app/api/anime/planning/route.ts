import { NextResponse } from 'next/server';

import { fetchText } from '@/lib/anime';

const PLANNING_URL =
  'https://anime-sama.to/planning/';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const html = await fetchText(PLANNING_URL, 3600);

  if (!html) {
    return NextResponse.json(
      { error: 'Planning indisponible' },
      { status: 502 }
    );
  }

  /* Sonde : /api/anime/planning?debug=1 */
  if (searchParams.get('debug')) {
    const count = (marker: string) =>
      (
        html.match(
          new RegExp(marker, 'gi')
        ) || []
      ).length;

    const index = html.search(
      /cartePlanningAnime|cartePlanning|planning-/i
    );

    return NextResponse.json(
      {
        taille: html.length,

        marqueurs: {
          cartePlanningAnime: count(
            'cartePlanningAnime'
          ),
          cartePlanning: count('cartePlanning'),
          catalogue: count('/catalogue/'),
          lundi: count('lundi'),
        },

        extrait:
          index >= 0
            ? html.slice(index, index + 1200)
            : html.slice(0, 800),
      },
      {
        headers: {
          'Content-Type':
            'application/json; charset=utf-8',
        },
      }
    );
  }

  return NextResponse.json({ ok: true });
}
