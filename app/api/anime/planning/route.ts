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
    const positions: number[] = [];

    const regex = /\/catalogue\//gi;

    let match;

    while (
      (match = regex.exec(html)) !== null &&
      positions.length < 3
    ) {
      positions.push(match.index);
    }

    const cible = positions[1] ?? positions[0] ?? 0;

    return NextResponse.json(
      {
        heures: (
          html.match(/\d{1,2}h\d{2}/g) || []
        ).slice(0, 8),

        jours: (
          html.match(
            /(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)/gi
          ) || []
        ).slice(0, 10),

        extrait: html.slice(
          Math.max(0, cible - 900),
          cible + 900
        ),
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
