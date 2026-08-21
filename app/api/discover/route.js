export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const COMMON_PATHS = [
  '/feed', '/rss', '/feed.xml', '/rss.xml', '/index.xml', '/atom.xml',
  '/?feed=rss2', '/feeds/posts/default', '/rss/feed.xml', '/en/rss.xml',
  '/flux.xml', '/rss/', '/feed/rss', '/news.xml', '/xml/rss.xml',
];

function looksLikeFeed(text) {
  const head = text.slice(0, 2000).toLowerCase();
  return head.includes('<rss') || head.includes('<feed') || head.includes('<rdf:rdf');
}

function absolute(href, base) {
  try {
    return new URL(href, base).toString();
  } catch (e) {
    return null;
  }
}

function extractTitle(html) {
  const og = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
  if (og) return og[1].trim();
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t) return t[1].replace(/\s+/g, ' ').split(/[|\-–—]/)[0].trim();
  return null;
}

async function tryFetch(url) {
  const variants = [url];
  try {
    const u = new URL(url);
    if (!u.hostname.startsWith('www.')) {
      u.hostname = 'www.' + u.hostname;
      variants.push(u.toString());
    }
  } catch (e) {}

  for (const candidate of variants) {
    try {
      const res = await fetch(candidate, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'fr-FR,fr;q=0.9',
        },
        redirect: 'follow',
        cache: 'no-store',
      });
      if (!res.ok) continue;
      return await res.text();
    } catch (e) {
      continue;
    }
  }
  return null;
}


export async function GET(request) {
  const { searchParams } = new URL(request.url);
  let input = (searchParams.get('url') || '').trim();
  if (!input) return Response.json({ error: 'URL manquante' }, { status: 400 });
  if (!/^https?:\/\//i.test(input)) input = 'https://' + input;

  let origin;
  try {
    origin = new URL(input).origin;
  } catch (e) {
    return Response.json({ error: 'URL invalide' }, { status: 400 });
  }

  const body = await tryFetch(input);

  if (body && looksLikeFeed(body)) {
    const title = (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
    return Response.json({
      feedUrl: input,
      name: title ? title.replace(/<!\[CDATA\[|\]\]>/g, '').trim() : new URL(input).hostname,
    });
  }

  if (body) {
    const links = [...body.matchAll(/<link[^>]+>/gi)].map((m) => m[0]);
    for (const tag of links) {
      const isAlt = /rel=["']?alternate/i.test(tag);
      const isFeed = /type=["'](application\/(rss|atom)\+xml)["']/i.test(tag);
      if (!isAlt || !isFeed) continue;
      const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
      const abs = href ? absolute(href, input) : null;
      if (!abs) continue;
      const check = await tryFetch(abs);
      if (check && looksLikeFeed(check)) {
        return Response.json({ feedUrl: abs, name: extractTitle(body) || new URL(abs).hostname });
      }
    }
  }

  for (const path of COMMON_PATHS) {
    const candidate = origin + path;
    const check = await tryFetch(candidate);
    if (check && looksLikeFeed(check)) {
      return Response.json({
        feedUrl: candidate,
        name: (body && extractTitle(body)) || new URL(candidate).hostname,
      });
    }
  }

  return Response.json({ error: 'Aucun flux RSS trouvé sur ce site' }, { status: 404 });
}
