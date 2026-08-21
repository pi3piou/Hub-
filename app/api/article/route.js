export const dynamic = 'force-dynamic';

export const runtime = 'nodejs';

function decodeEntities(str) {
  const entities = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&#8217;': '’', '&#8216;': '‘', '&#8220;': '“', '&#8221;': '”',
    '&#8211;': '–', '&#8212;': '—', '&#039;': "'", '&apos;': "'",
    '&nbsp;': ' ', '&hellip;': '…',
  };
  return str
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&\w+;/g, (m) => entities[m] || m);
}

function stripTags(str) {
  return decodeEntities(str.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
}

function resolveUrl(src, baseUrl) {
  if (!src) return null;
  if (/^data:/i.test(src)) return null;
  try {
    return new URL(src, baseUrl).toString();
  } catch (e) {
    return null;
  }
}

const STOP_MARKERS = [
  'signaler une erreur', 'signaler cette erreur', 'cliquez ici pour annuler',
  'laisser un commentaire', 'votre adresse e-mail', 'quelques règles à respecter',
  'partager cet article', 'articles similaires', 'à lire aussi', 'articles liés',
];

function isStopText(text) {
  const lower = text.toLowerCase();
  return STOP_MARKERS.some((m) => lower.includes(m));
}

function cutBeforeComments(html) {
  const markers = [
    /<div[^>]+id=["']comments?["']/i,
    /<div[^>]+class=["'][^"']*comment/i,
    /<section[^>]+id=["']comments?["']/i,
    /<div[^>]+id=["']respond["']/i,
    /<ol[^>]+class=["'][^"']*comment-list/i,
    /<div[^>]+class=["'][^"']*relatives/i,
    /<section[^>]+class=["'][^"']*sidebarPost/i,
    /<div[^>]+class=["'][^"']*(related|similar|suggest)/i,
  ];
  let cutIndex = html.length;
  for (const re of markers) {
    const m = html.match(re);
    if (m && m.index < cutIndex) cutIndex = m.index;
  }
  return html.slice(0, cutIndex);
}

function isJunkImage(fullTag, src) {
  const s = src.toLowerCase();
  const tag = fullTag.toLowerCase();

  if (/\/(blank|spacer|transparent)\.(gif|png)/.test(s)) return true;
  if (/\/appstore\//.test(s)) return true;

  const nameJunk = [
    'avatar', 'gravatar', 'sprite', 'pixel.gif', '1x1',
    'favicon', 'cropped-', 'placeholder', 'default-', 'share-', 'social-',
    'badge', 'banner-ad', '-ad-', 'author-', 'profile-', 'redacteurs',
  ];
  if (nameJunk.some((j) => s.includes(j))) return true;

  const fileName = s.split('/').pop() || s;
  const wordJunk = [/(^|[\/_.-])icons?([._-]|$)/, /(^|[\/_.-])logos?([._-]|$)/];
  if (wordJunk.some((re) => re.test(fileName))) return true;

  const widthMatch = tag.match(/width=["']?(\d+)/);
  const heightMatch = tag.match(/height=["']?(\d+)/);
  if (widthMatch && parseInt(widthMatch[1]) < 150) return true;
  if (heightMatch && parseInt(heightMatch[1]) < 150) return true;

  return false;
}

const NAV_JUNK = [
  'identifiant ou e-mail', 'mot de passe', 'créer un compte', 'se connecter',
  'confirmer le mot de passe', 'combien font', 'sauvegarder mon pseudo',
  'télécharger iaddict', 'auto connexion',
];

function isNavJunk(text) {
  const lower = text.toLowerCase();
  return NAV_JUNK.some((m) => lower.includes(m));
}

function isConsentBlock(text) {
  const lower = text.toLowerCase();
  const exact = [
    'ce contenu est bloqué car vous',
    'pour pouvoir le visualiser, vous devez accepter',
    "en cliquant sur « j'accepte tout »",
    'vous gardez la possibilité de retirer votre consentement',
    'nous vous invitons à prendre connaissance de notre politique cookies',
  ];
  return exact.some((phrase) => lower.includes(phrase));
}

function buildContent(html, baseUrl) {
  let m;

  const paragraphs = [];
  let cutAt = html.length;
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  while ((m = pRe.exec(html))) {
    const text = stripTags(m[1]);
    if (isStopText(text)) { if (m.index < cutAt) cutAt = m.index; continue; }
    if (isNavJunk(text) || isConsentBlock(text)) continue;
    if (text.length > 40) paragraphs.push({ idx: m.index, text });
  }

  if (paragraphs.length === 0) return '';

  const h1Match = html.match(/<h1[^>]*>[\s\S]*?<\/h1>/i);
  const bodyStart = h1Match ? h1Match.index : Math.max(0, paragraphs[0].idx - 500);

  const items = [];
  const push = (idx, type, value) => {
    if (idx < bodyStart || idx >= cutAt) return;
    items.push({ idx, type, value });
  };

  for (const p of paragraphs) push(p.idx, 'p', p.text);

  const hRe = /<h([2-4])[^>]*>([\s\S]*?)<\/h\1>/gi;
  while ((m = hRe.exec(html))) {
    const text = stripTags(m[2]);
    if (isStopText(text)) { if (m.index < cutAt) cutAt = m.index; continue; }
    if (text.length > 3) push(m.index, 'h', text);
  }

  const imgTagRe = /<img\b[^>]*>/gi;
  let lastImage = '';
  while ((m = imgTagRe.exec(html))) {
    const fullTag = m[0];
    const attrOrder = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'src'];
    let src = null;
    for (const attr of attrOrder) {
      const attrRe = new RegExp(`${attr}=["']([^"']+)["']`, 'i');
      const attrMatch = fullTag.match(attrRe);
      if (attrMatch && !/\/(blank|spacer)\.(gif|png)/i.test(attrMatch[1])) {
        src = attrMatch[1];
        break;
      }
    }
    if (!src) continue;
    const absolute = resolveUrl(src, baseUrl);
    if (!absolute) continue;
    if (!isJunkImage(fullTag, absolute) && absolute !== lastImage) {
      push(m.index, 'img', absolute);
      lastImage = absolute;
    }
  }

  const iframeRe = /<iframe[^>]+?(?:data-src|src)=["']([^"']+)["'][^>]*>[\s\S]*?<\/iframe>/gi;
  while ((m = iframeRe.exec(html))) {
    if (/youtube|youtu\.be|vimeo|dailymotion/i.test(m[1])) {
      const abs = resolveUrl(m[1], baseUrl);
      if (abs) push(m.index, 'video', abs);
    }
  }

  const bqRe = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi;
  while ((m = bqRe.exec(html))) {
    const text = stripTags(m[1]);
    if (text.length > 10 && !isStopText(text) && !isConsentBlock(text)) {
      push(m.index, 'quote', text);
    }
  }

  items.sort((a, b) => a.idx - b.idx);

  let out = '';
  for (const item of items) {
    if (item.type === 'h') out += `<h3>${item.value}</h3>`;
    else if (item.type === 'p') out += `<p>${item.value}</p>`;
    else if (item.type === 'img') out += `<img src="${item.value}" loading="lazy" alt="" />`;
    else if (item.type === 'video') out += `<div class="video-embed"><iframe src="${item.value}" allowfullscreen loading="lazy"></iframe></div>`;
    else if (item.type === 'quote') out += `<blockquote>${item.value}</blockquote>`;
  }
  return out;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return Response.json({ error: 'URL manquante' }, { status: 400 });
  }

  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
    });
    const html = await res.text();
    const baseUrl = res.url || url;

    let cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '');

    cleaned = cutBeforeComments(cleaned);

    const content = buildContent(cleaned, baseUrl);

    const imageMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    const image = imageMatch ? resolveUrl(imageMatch[1], baseUrl) : null;

    if (!content) {
      return Response.json({ content: null, image });
    }
    return Response.json({ content, image });
  } catch (e) {
    return Response.json({ content: null, image: null });
  }
}
