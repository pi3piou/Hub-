import {
  cleanText,
  decodeEntities,
  inspectThumbnail,
  parseFeed,
} from '@/lib/techfeed/feeds';

import { debugAllowed } from '@/lib/debugGate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const feedUrl = searchParams.get('url');
  const name = searchParams.get('name') || 'Source';
  const page = parseInt(searchParams.get('page') || '1', 10);

  if (!feedUrl) return Response.json({ articles: [] });

  const target = page > 1 ? feedUrl + (feedUrl.includes('?') ? '&' : '?') + 'paged=' + page : feedUrl;

  try {
    const res = await fetch(target, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
      redirect: 'follow',
      cache: 'no-store',
    });
    if (!res.ok) return Response.json({ articles: [] });
    const xml = await res.text();

  // if (searchParams.get('debug') === 'vignettes') { →
    if (
      searchParams.get('debug') === 'vignettes' &&
      debugAllowed(request)
    ) {

    const articles = parseFeed(xml, name, page).map((a) => ({
      ...a,
      date: a.date.toISOString(),
    }));
    return Response.json({ articles });
  } catch (e) {
    return Response.json({ articles: [] });
  }
}
