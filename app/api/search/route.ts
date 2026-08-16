import { NextResponse } from 'next/server';

const BASE_URL = 'https://anime-sama.to';

interface SearchResult {
  name: string;
  slug: string;
  image: string;
}

function slugToName(
  slug: string
) {
  return slug
    .split('-')
    .filter(Boolean)
    .map(
      (word) =>
        word.charAt(0).toUpperCase() +
        word.slice(1)
    )
    .join(' ');
}

function absoluteUrl(
  value: string,
  base: string
) {
  try {
    return new URL(
      value,
      base
    ).toString();
  } catch {
    return '';
  }
}

function cleanImageUrl(
  value: string,
  base: string
) {
  let url =
    value
      .trim()
      .replace(/^['"`]/, '')
      .replace(/['"`;,]+$/, '');

  if (
    !url ||
    url.startsWith('data:') ||
    url.startsWith('javascript:')
  ) {
    return '';
  }

  return absoluteUrl(
    url,
    base
  );
}

function extractImageFromBlock(
  block: string,
  pageUrl: string
) {
  const imgPatterns = [
    /<img[^>]+src\s*=\s*["']([^"']+)["']/i,

    /<img[^>]+data-src\s*=\s*["']([^"']+)["']/i,

    /<img[^>]+data-lazy-src\s*=\s*["']([^"']+)["']/i,

    /<img[^>]+data-original\s*=\s*["']([^"']+)["']/i,
  ];

  for (
    const regex of imgPatterns
  ) {
    const match =
      block.match(regex);

    if (match?.[1]) {
      const image =
        cleanImageUrl(
          match[1],
          pageUrl
        );

      if (image) {
        return image;
      }
    }
  }

  const background =
    block.match(
      /background-image\s*:\s*url$begin:math:text$\\s\*\[\"\'\]\?\(\[\^\"\'\)\]\+\)\[\"\'\]\?\\s\*$end:math:text$/i
    );

  if (background?.[1]) {
    const image =
      cleanImageUrl(
        background[1],
        pageUrl
      );

    if (image) {
      return image;
    }
  }

  return '';
}

function extractResults(
  html: string,
  pageUrl: string
): SearchResult[] {
  const results: SearchResult[] =
    [];

  const seen =
    new Set<string>();

  const linkRegex =
    /<a\b[^>]*href\s*=\s*["']([^"']*\/catalogue\/([^"'/?#]+)\/?[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (
    const match of html.matchAll(
      linkRegex
    )
  ) {
    const href =
      match[1];

    const slug =
      decodeURIComponent(
        match[2]
      ).trim();

    const block =
      match[3];

    if (
      !slug ||
      seen.has(slug)
    ) {
      continue;
    }

    const ignored =
      new Set([
        'catalogue',
        'planning',
        'connexion',
        'inscription',
        'recherche',
        'page',
      ]);

    if (
      ignored.has(
        slug.toLowerCase()
      )
    ) {
      continue;
    }

    const linkPosition =
      match.index ?? -1;

    let surroundingBlock =
      block;

    if (
      linkPosition >= 0
    ) {
      const start =
        Math.max(
          0,
          linkPosition -
            2500
        );

      const end =
        Math.min(
          html.length,
          linkPosition +
            2500
        );

      surroundingBlock =
        html.slice(
          start,
          end
        );
    }

    let image =
      extractImageFromBlock(
        surroundingBlock,
        pageUrl
      );

    if (!image) {
      const imageRegex =
        new RegExp(
          `<img[^>]+(?:src|data-src|data-lazy-src|data-original)\\s*=\\s*["'][^"']*${slug}[^"']*["']`,
          'i'
        );

      const imageMatch =
        html.match(
          imageRegex
        );

      if (
        imageMatch
      ) {
        const srcMatch =
          imageMatch[0].match(
            /(?:src|data-src|data-lazy-src|data-original)\s*=\s*["']([^"']+)["']/i
          );

        if (
          srcMatch?.[1]
        ) {
          image =
            cleanImageUrl(
              srcMatch[1],
              pageUrl
            );
        }
      }
    }

    if (!image) {
      image =
        `https://cdn.statically.io/gh/anime-sama/assets/main/catalogue/${slug}/cover.jpg`;
    }

    seen.add(slug);

    results.push({
      name:
        slugToName(
          slug
        ),

      slug,

      image,
    });

    if (
      results.length >= 30
    ) {
      break;
    }
  }

  return results;
}

export async function GET(
  request: Request
) {
  const {
    searchParams,
  } = new URL(
    request.url
  );

  const query =
    searchParams
      .get('q')
      ?.trim();

  if (
    !query ||
    query.length < 2
  ) {
    return NextResponse.json({
      results: [],
    });
  }

  try {
    const url =
      `${BASE_URL}/catalogue/?search=` +
      encodeURIComponent(
        query
      );

    const controller =
      new AbortController();

    const timeout =
      setTimeout(() => {
        controller.abort();
      }, 10000);

    let response: Response;

    try {
      response =
        await fetch(
          url,
          {
            signal:
              controller.signal,

            cache:
              'no-store',

            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',

              Accept:
                'text/html,application/xhtml+xml,application/javascript,*/*',

              Referer:
                `${BASE_URL}/`,
            },
          }
        );
    } finally {
      clearTimeout(
        timeout
      );
    }

    if (
      !response.ok
    ) {
      return NextResponse.json({
        results: [],
      });
    }

    const html =
      await response.text();

    const results =
      extractResults(
        html,
        url
      );

    return NextResponse.json(
      {
        results,
      },
      {
        headers: {
          'Cache-Control':
            'public, s-maxage=60, stale-while-revalidate=300',
        },
      }
    );
  } catch (error) {
    console.error(
      'Search error:',
      error
    );

    return NextResponse.json({
      results: [],
    });
  }
}