import { NextResponse } from 'next/server';

import { fetchText } from '@/lib/anime';
import {
  PLANNING_URL,
  parsePlanning,
} from '@/lib/planning';

export async function GET() {
  const html = await fetchText(PLANNING_URL, 3600);

  if (!html) {
    return NextResponse.json(
      { error: 'Planning indisponible' },
      { status: 502 }
    );
  }

  const items = parsePlanning(html);

  return NextResponse.json(
    {
      items,
      total: items.length,
      fetchedAt: Date.now(),
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
}
