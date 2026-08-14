import { NextResponse } from 'next/server';

const BASE_URL = 'https://anime-sama.to';

function slugToName(slug: string) {
  return slug
    .split('-')
    .filter(Boolean)
    .map(
      (word) =>
        word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(' ');
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const query = searchParams.get('q')?.trim();

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    const url = `${BASE_URL}/catalogue/?search=${encodeURIComponent(
      query
    )}`;

    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 8000);

    let response: Response;

    try {
      response = await fetch(url, {
        signal: controller.signal,
        cache: 'no-store',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml',
          Referer: `${BASE_URL}/`,
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return NextResponse.json(
        { results: [] },
        { status: 200 }
      );
    }

    const html = await response.text();

    const results = [];
    const seen = new Set<string>();

    const regex =
      /href\s*=\s*["'](?:https?:\/\/[^/"']+)?\/catalogue\/([^"'/?#]+)\/?["']/gi;

    const ignored = new Set([
      'catalogue',
      'planning',
      'connexion',
      'inscription',
      'recherche',
      'page',
    ]);

    for (const match of html.matchAll(regex)) {
      const slug = decodeURIComponent(match[1]).trim();

      if (
        !slug ||
        ignored.has(slug.toLowerCase()) ||
        seen.has(slug)
      ) {
        continue;
      }

      seen.add(slug);

      results.push({
        name: slugToName(slug),
        slug,
        image: `https://cdn.statically.io/gh/anime-sama/assets/main/catalogue/${slug}/cover.jpg`,
      });

      if (results.length >= 20) {
        break;
      }
    }

    return NextResponse.json(
      { results },
      {
        headers: {
          'Cache-Control':
            'public, s-maxage=60, stale-while-revalidate=300',
        },
      }
    );
  } catch (error) {
    console.error('Search error:', error);

    return NextResponse.json({
      results: [],
    });
  }
}