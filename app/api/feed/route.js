import {
  cleanText,
  decodeEntities,
  inspectThumbnail,
  parseFeed,
} from '@/lib/techfeed/feeds';

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

    /*
     * Sonde : &debug=vignettes
     *
     * Pour les six premiers articles, toutes les adresses
     * d'image envisagees et celle qui l'emporte. Sans elle, un
     * logo de site affiche a la place d'une photo ressemble
     * exactement a une extraction reussie — il faut voir les
     * adresses pour savoir laquelle bannir.
     */

    if (searchParams.get('debug') === 'vignettes') {
      const blocks = xml.split(/<item[\s>]/).slice(1).slice(0, 6);

      const items = blocks.map((block) => {
        const chunk = block.split('</item>')[0];

        const titre = decodeEntities(
          cleanText(
            (chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [
              '',
              '',
            ])[1]
          )
        );

        const description = (chunk.match(
          /<description[^>]*>([\s\S]*?)<\/description>/i
        ) || ['', ''])[1];

        return {
          titre: titre.slice(0, 70),
          ...inspectThumbnail(chunk, description),
        };
      });

      return Response.json(
        { source: name, articles: items },
        {
          headers: {
            'Content-Type':
              'application/json; charset=utf-8',
          },
        }
      );
    }

    const articles = parseFeed(xml, name, page).map((a) => ({
      ...a,
      date: a.date.toISOString(),
    }));
    return Response.json({ articles });
  } catch (e) {
    return Response.json({ articles: [] });
  }
}
