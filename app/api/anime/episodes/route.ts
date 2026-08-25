import { NextResponse } from 'next/server';
import { debugAllowed } from '@/lib/debugGate';

import {
  fetchCatalogue,
  fetchEpisodes,
  fetchPartPage,
  FILM_ID_BASE,
  getDefaultPlayerIndex,
  parsePartTitles,
  parsePlayers,
  parseSeasons,
} from '@/lib/anime';

/*
 * =========================================================
 * ÉPISODES D'UNE PARTIE (saison, film ou hors-série)
 *
 * Les deux langues partent en parallèle. Si la langue
 * demandée n'existe pas, on renvoie l'autre plutôt
 * qu'une erreur : certains animes ne sont qu'en VF.
 *
 * Les films et les hors-séries arrivent ici sous un numéro
 * fabriqué (900 et plus). Leur adresse réelle vit dans la
 * page catalogue, qu'on relit alors pour retrouver le
 * segment correspondant. Cette relecture ne coûte rien en
 * pratique — la même requête est déjà mise en cache par
 * Next pour une heure — et surtout elle évite de faire
 * transiter le segment par le navigateur, donc de casser
 * les liens déjà en circulation.
 * =========================================================
 */

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const slug = searchParams.get('slug')?.trim();

  const lang =
    searchParams.get('lang') === 'vf'
      ? 'vf'
      : 'vostfr';

  const season = Math.max(
    1,
    Number(searchParams.get('saison')) || 1
  );

  if (!slug) {
    return NextResponse.json(
      { error: 'Slug manquant' },
      { status: 400 }
    );
  }

  const otherLang =
    lang === 'vostfr' ? 'vf' : 'vostfr';

  try {
    /*
     * En dessous de 900 c'est une vraie saison : l'adresse
     * se déduit du numéro, aucune requête supplémentaire.
     */

    let part: string | number = season;

    if (season >= FILM_ID_BASE) {
      const html = await fetchCatalogue(slug);

      const entry = html
        ? parseSeasons(html, slug).find(
            (item) => item.number === season
          )
        : undefined;

      if (!entry) {
        return NextResponse.json(
          {
            error: 'Partie indisponible',
            slug,
            saison: season,
            lang,
          },
          { status: 404 }
        );
      }

      part = entry.path;
    }

    /*
     * Sonde de reconnaissance : &debug=noms
     *
     * Elle renvoie le contenu des balises <script> de la page
     * de la partie, la ou vivent les titres des films. Elle
     * existe parce que deviner la forme d'un balisage qu'on
     * n'a pas sous les yeux revient a ecrire un analyseur au
     * hasard — et un analyseur qui se trompe en silence rend
     * simplement des titres vides.
     */

    if (
      searchParams.get('debug') === 'noms' &&
      debugAllowed(request)
    ) {
      const page = await fetchPartPage(slug, part, lang);

      if (!page) {
        return NextResponse.json(
          { error: 'page introuvable', part, lang },
          { status: 404 }
        );
      }

      const scripts = Array.from(
        page.matchAll(
          /<script[^>]*>([\s\S]*?)<\/script>/gi
        )
      )
        .map((match) => match[1].trim())
        .filter(Boolean);

      /* Les lignes qui ont une chance de nommer quelque chose :
         un appel de fonction avec une chaine de caracteres. */

      const interessantes = scripts
        .join('\n')
        .split('\n')
        .map((line) => line.trim())
        .filter(
          (line) =>
            /\w+\s*\(\s*["'`][^"'`]/.test(line) &&
            !/^\/\//.test(line)
        )
        .slice(0, 120);

      return NextResponse.json(
        {
          part,
          lang,
          taillePage: page.length,
          nombreDeScripts: scripts.length,
          lignesAvecTexte: interessantes,
        },
        {
          headers: {
            'Content-Type':
              'application/json; charset=utf-8',
          },
        }
      );
    }

    const [requestedText, otherText] =
      await Promise.all([
        fetchEpisodes(slug, part, lang),
        fetchEpisodes(slug, part, otherLang),
      ]);

    /*
     * Aucune des deux langues : la partie
     * n'existe vraiment pas.
     */
    if (!requestedText && !otherText) {
      return NextResponse.json(
        {
          error: 'Saison indisponible',
          slug,
          saison: season,
          lang,
        },
        { status: 404 }
      );
    }

    const fallback = !requestedText;

    const effectiveLang = fallback
      ? otherLang
      : lang;

    const effectiveText = fallback
      ? otherText
      : requestedText;

    const players = parsePlayers(
      effectiveText as string
    );

    const defaultPlayerIndex =
      getDefaultPlayerIndex(players);

    const totalEpisodes =
      players[defaultPlayerIndex]?.urls.length ||
      players[0]?.urls.length ||
      0;

    const hasVostfr =
      lang === 'vostfr'
        ? Boolean(requestedText)
        : Boolean(otherText);

    const hasVF =
      lang === 'vf'
        ? Boolean(requestedText)
        : Boolean(otherText);

    /*
     * Les noms des entrees ne sont lus QUE pour les films et
     * les hors-series. Une saison numerote ses episodes, elle
     * n'a rien a nommer — aller chercher sa page couterait une
     * requete de plus a chaque ouverture de fiche pour ne
     * ramener aucune information.
     */

    let episodeNames: string[] = [];

    if (season >= FILM_ID_BASE) {
      const page = await fetchPartPage(
        slug,
        part,
        effectiveLang
      );

      if (page) {
        const titles = parsePartTitles(page);

        /*
         * On n'accepte les noms que s'ils sont au moins aussi
         * nombreux que les entrees du lecteur. En dessous, le
         * decalage silencieux guette : le film numero trois
         * porterait le titre du deuxieme, et rien ne le
         * signalerait. Mieux vaut alors la numerotation.
         */

        if (titles.length >= totalEpisodes) {
          episodeNames = titles.slice(0, totalEpisodes);
        }
      }
    }

    return NextResponse.json(
      {
        slug,
        saison: season,

        /* Vide pour une saison, un nom par film sinon. */
        episodeNames,

        /* Langue réellement servie */
        lang: effectiveLang,

        /* Langue initialement demandée */
        requestedLang: lang,

        /* true si on a dû basculer */
        fallback,

        players,
        defaultPlayerIndex,
        totalEpisodes,

        hasVF,
        hasVOSTFR: hasVostfr,
      },
      {
        headers: {
          'Cache-Control':
            'public, s-maxage=900, stale-while-revalidate=3600',
        },
      }
    );
  } catch (error) {
    console.error('Anime episodes error:', error);

    return NextResponse.json(
      { error: 'Erreur serveur' },
      { status: 500 }
    );
  }
}
