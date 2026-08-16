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
    const cards: unknown[] = [];

    const regex =
      /<div class="([^"]*planning-card[^"]*)"([^>]*)>\s*<a href="([^"]+)"/gi;

    for (const match of html.matchAll(regex)) {
      const attrs = match[2];

      const ts = attrs.match(
        /data-release-ts="(\d+)"/i
      );

      const dataTitle = attrs.match(
        /data-title="([^"]*)"/i
      );

      cards.push({
        classes: match[1],
        href: match[3],
        ts: ts ? Number(ts[1]) : null,
        date: ts
          ? new Date(
              Number(ts[1]) * 1000
            ).toISOString()
          : null,
        title: dataTitle?.[1] || null,
      });

      if (cards.length >= 6) break;
    }

    return NextResponse.json(
      { total: cards.length, cards },
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
