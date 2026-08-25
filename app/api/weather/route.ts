import { ensureDayTotals, isConfigured } from '@/lib/solar';
import { redisGetJson, redisSetJson } from '@/lib/redis';
import {
  Calibration,
  DEFAULT_CALIBRATION,
  Sample,
  calibrate,
  forecastProduction,
  seasonalCeiling,
} from '@/lib/solarForecast';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/*
 * =============================================================
 * MÉTÉO — Open-Meteo, gratuit et sans clé d'API.
 *
 * On passe par une route serveur plutôt que d'appeler l'API
 * depuis le navigateur pour trois raisons : les coordonnées de
 * l'utilisateur ne transitent pas dans l'historique du
 * navigateur, on peut mettre le résultat en cache, et surtout
 * c'est ici qu'on a accès à l'historique de production —
 * indispensable pour prévoir ce que les panneaux vont donner.
 *
 * Le rayonnement demandé à la météo est la même donnée
 * physique que celle qui remplit les panneaux. Croisée avec
 * l'historique réel de cette installation, elle donne une
 * prévision de production à 7 kWh d'erreur moyenne, contre 11
 * pour « comme hier ». Voir lib/solarForecast.ts.
 * =============================================================
 */

const CACHE_SECONDS = 900;

/* Codes météo WMO — c'est la nomenclature qu'Open-Meteo
   renvoie. On ne garde que les regroupements utiles. */

const WMO: Record<number, { label: string; icon: string }> = {
  0: { label: 'Ciel dégagé', icon: '☀' },
  1: { label: 'Plutôt dégagé', icon: '🌤' },
  2: { label: 'Partiellement nuageux', icon: '⛅' },
  3: { label: 'Couvert', icon: '☁' },
  45: { label: 'Brouillard', icon: '🌫' },
  48: { label: 'Brouillard givrant', icon: '🌫' },
  51: { label: 'Bruine légère', icon: '🌦' },
  53: { label: 'Bruine', icon: '🌦' },
  55: { label: 'Bruine dense', icon: '🌦' },
  61: { label: 'Pluie faible', icon: '🌧' },
  63: { label: 'Pluie', icon: '🌧' },
  65: { label: 'Forte pluie', icon: '🌧' },
  71: { label: 'Neige faible', icon: '🌨' },
  73: { label: 'Neige', icon: '🌨' },
  75: { label: 'Forte neige', icon: '🌨' },
  80: { label: 'Averses', icon: '🌦' },
  81: { label: 'Averses', icon: '🌦' },
  82: { label: 'Fortes averses', icon: '⛈' },
  95: { label: 'Orage', icon: '⛈' },
  96: { label: 'Orage grêleux', icon: '⛈' },
  99: { label: 'Orage grêleux', icon: '⛈' },
};

function describe(code: number) {
  return (
    WMO[code] || { label: 'Météo indisponible', icon: '·' }
  );
}

/*
 * L'icône de nuit. Un soleil éclatant à 22 h est une petite
 * trahison visuelle : la donnée est juste, l'image ment.
 */

function nightIcon(code: number, isDay: boolean) {
  if (isDay) return describe(code).icon;

  if (code === 0) return '🌙';
  if (code === 1 || code === 2) return '☁';

  return describe(code).icon;
}

function hhmm(iso: string | undefined) {
  if (!iso) return null;

  const m = iso.match(/T(\d{2}:\d{2})/);

  return m ? m[1].replace(':', 'h') : null;
}

/* =========================================================
   RECALIBRATION
   ========================================================= */

const CALIB_KEY = 'hub_solar_calib';
const MAX_SAMPLES = 120;

interface CalibStore {
  calibration: Calibration;
  samples: Sample[];
  lastRun: string;
}

/*
 * Une fois par jour, on ajoute la journée d'hier au jeu
 * d'ajustement : le rayonnement qui avait été annoncé, et la
 * production réellement mesurée.
 *
 * Pourquoi hier et pas avant-hier : c'est la journée la plus
 * récente qui soit à la fois complète et déjà mise en cache
 * par le solaire. Et pourquoi le rayonnement PRÉVU plutôt que
 * l'observé : c'est celui-là que la prévision utilisera
 * demain. Le calibrage absorbe ainsi le biais propre de la
 * météo, en plus de l'état des panneaux.
 */

async function maybeRecalibrate(
  yesterday: string,
  radiation: number | null,
  tmax: number | null
): Promise<Calibration> {
  if (!isConfigured()) return DEFAULT_CALIBRATION;

  let store: CalibStore | null = null;

  try {
    store = await redisGetJson<CalibStore>(CALIB_KEY);
  } catch {
    return DEFAULT_CALIBRATION;
  }

  const current =
    store?.calibration || DEFAULT_CALIBRATION;

  /* Déjà passé aujourd'hui, ou météo incomplète : on rend
     l'ajustement en cours sans rien toucher. */
  if (
    store?.lastRun === yesterday ||
    radiation === null ||
    tmax === null
  ) {
    return current;
  }

  try {
    const totals = await ensureDayTotals(yesterday);

    const prod = totals.productionWh;

    if (prod === null || prod <= 0) return current;

    const samples = (store?.samples || []).filter(
      (s) => s.date !== yesterday
    );

    samples.push({
      date: yesterday,
      rad: radiation,
      tmax,
      prod: prod / 1000,
    });

    /* On ne garde que les journées récentes : le but est de
       suivre la dérive, pas de moyenner quatre ans. */
    const trimmed = samples
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .slice(-MAX_SAMPLES);

    const fitted = calibrate(trimmed) || current;

    await redisSetJson(CALIB_KEY, {
      calibration: fitted,
      samples: trimmed,
      lastRun: yesterday,
    });

    return fitted;
  } catch {
    /* La recalibration est un confort, jamais un blocage :
       une panne de stockage ne doit pas priver de météo. */
    return current;
  }
}

/* =========================================================
   ROUTE
   ========================================================= */

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const lat = Number(searchParams.get('lat'));
  const lon = Number(searchParams.get('lon'));

  /*
   * Coordonnées validées avant l'appel : sans ce garde-fou une
   * valeur absente devient NaN, part telle quelle dans l'URL,
   * et Open-Meteo répond une erreur qu'on afficherait comme
   * une panne alors que c'est nous qui avons mal demandé.
   */

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  ) {
    return Response.json(
      { error: 'coordonnees invalides' },
      { status: 400 }
    );
  }

  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lat.toFixed(4)}` +
    `&longitude=${lon.toFixed(4)}` +
    '&current=temperature_2m,apparent_temperature,weather_code,is_day' +
    '&hourly=temperature_2m,weather_code,precipitation_probability' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,shortwave_radiation_sum,precipitation_probability_max' +
    /*
     * `past_days=1` sert uniquement à la recalibration : il
     * ramène le rayonnement d'hier, qu'on confronte à la
     * production réellement enregistrée.
     *
     * `forecast_days=7` donne, au-delà d'aujourd'hui et demain,
     * cinq jours de plus pour la petite bande « prochains
     * jours ». Ni plus (Open-Meteo perd en fiabilité au-delà
     * d'une semaine) ni moins (une bande à trois jours se lit
     * mal).
     */
    '&past_days=1&forecast_days=7' +
    '&timezone=auto';

  try {
    const res = await fetch(url, {
      next: { revalidate: CACHE_SECONDS },
    });

    if (!res.ok) {
      return Response.json(
        { error: 'meteo indisponible' },
        { status: 502 }
      );
    }

    const data = await res.json();

    const code = data?.current?.weather_code ?? -1;
    const info = describe(code);
    const isDay = data?.current?.is_day !== 0;

    /*
     * Avec `past_days=1`, l'indice 0 est HIER. Aujourd'hui est
     * donc en 1 et demain en 2. Se tromper d'indice ici
     * donnerait une météo décalée d'un jour, cohérente en
     * apparence et fausse en tout — d'où ces constantes
     * nommées plutôt que des 1 et des 2 disséminés.
     */

    const HIER = 0;
    const AUJOURD_HUI = 1;
    const DEMAIN = 2;

    const daily = data?.daily || {};

    const at = (key: string, i: number) =>
      Array.isArray(daily[key]) ? daily[key][i] : null;

    /* --- bande horaire ---
     *
     * On cherche les index par l'horodatage plutôt que par un
     * décalage calculé : le fuseau vient de la position, pas
     * du serveur, et un décalage serait faux la nuit du
     * changement d'heure.
     *
     * SEULES LES HEURES DE JOUR SONT MONTRÉES. Une première
     * version affichait les cinq créneaux suivants quoi qu'il
     * arrive, ce qui donnait, consulté à 18 h : 20 h, 22 h,
     * minuit, 2 h, 4 h. Techniquement juste, et sans le
     * moindre intérêt — personne ne se demande le temps qu'il
     * fera à 2 h du matin.
     *
     * Passé le coucher du soleil, la bande bascule donc sur la
     * journée de demain, du lever au coucher.
     */

    const hourly = data?.hourly || {};
    const times: string[] = hourly.time || [];

    const hourOf = (iso: string | null, fallback: number) =>
      iso ? Number(iso.slice(11, 13)) : fallback;

    const nowHourNum = Number(
      (data?.current?.time || 'T12').slice(11, 13)
    );

    const setToday = hourOf(at('sunset', AUJOURD_HUI), 21);

    /* Deux heures avant le coucher, il ne reste plus assez de
       journée pour remplir une bande utile. */
    const useTomorrow = nowHourNum >= setToday - 2;

    const stripDay = useTomorrow ? DEMAIN : AUJOURD_HUI;
    const stripDate = (at('sunrise', stripDay) || '').slice(
      0,
      10
    );

    const rise = hourOf(at('sunrise', stripDay), 7);
    const set = hourOf(at('sunset', stripDay), 21);

    /*
     * Un créneau par heure plutôt que tous les deux : la
     * version précédente en tenait cinq pour rester lisible
     * sur une seule ligne, mais c'était plus court qu'utile.
     * La bande défile désormais horizontalement (voir le CSS),
     * ce qui autorise plus de détail sans casser la mise en
     * page.
     *
     * Demain, on part du lever du jour. Aujourd'hui, on part
     * de l'heure qui vient : l'heure déjà passée n'intéresse
     * personne.
     */

    const first = useTomorrow
      ? rise
      : Math.max(rise, nowHourNum + 1);

    const MAX_HOURS = 12;

    const hours = [];

    for (
      let hour = first;
      hour <= set && hours.length < MAX_HOURS;
      hour += 1
    ) {
      const i = times.indexOf(
        `${stripDate}T${String(hour).padStart(2, '0')}:00`
      );

      if (i < 0) continue;

      hours.push({
        label: `${hour}h`,
        icon: nightIcon(
          hourly.weather_code?.[i] ?? -1,
          true
        ),
        temp: Math.round(hourly.temperature_2m?.[i] ?? 0),
        rain: Math.round(
          hourly.precipitation_probability?.[i] ?? 0
        ),
      });
    }

    /* --- recalibration, puis prévision de production --- */

    const yesterday = (at('sunrise', HIER) || '').slice(
      0,
      10
    );

    const calibration = yesterday
      ? await maybeRecalibrate(
          yesterday,
          at('shortwave_radiation_sum', HIER),
          at('temperature_2m_max', HIER)
        )
      : DEFAULT_CALIBRATION;

    /*
     * La prévision du jour reste affichée toute la journée,
     * du matin (« est-ce que je lance le lave-linge ») jusqu'au
     * soir, où elle sert alors à comparer l'annonce à ce que
     * les panneaux ont vraiment donné. La remplacer par celle
     * de demain à 15 h, comme le faisait une version
     * précédente, effaçait cette comparaison au moment
     * précis où elle devenait possible.
     *
     * Celle de demain est calculée en plus, pas à la place.
     */

    const forecastFor = (dayIndex: number) => {
      const dateStr = (
        at('sunrise', dayIndex) ||
        at('time', dayIndex) ||
        ''
      ).slice(0, 10);

      if (!dateStr) return null;

      const date = new Date(`${dateStr}T12:00:00`);

      const forecast = forecastProduction(
        at('shortwave_radiation_sum', dayIndex),
        at('temperature_2m_max', dayIndex),
        date,
        calibration
      );

      if (!forecast) return null;

      return {
        ...forecast,
        ceiling: Math.round(seasonalCeiling(date)),
        /* Rendu visible pour que la dérive éventuelle des
           panneaux soit constatable, pas seulement subie. */
        calibrated: calibration.samples > 0,
      };
    };

    const production = {
      today: forecastFor(AUJOURD_HUI),
      tomorrow: forecastFor(DEMAIN),
    };

    /*
     * --- prochains jours ---
     *
     * Un simple coup d'œil au-delà de demain : icône et
     * températures, sans prévision de production — le modèle
     * de production n'a jamais été validé à plus d'un jour, le
     * proposer plus loin annoncerait une confiance qu'il n'a
     * pas.
     */

    const dayLabel = (iso: string) => {
      const label = new Date(
        `${iso}T12:00:00`
      ).toLocaleDateString('fr-FR', { weekday: 'short' });

      return (
        label.charAt(0).toUpperCase() + label.slice(1)
      ).replace(/\.$/, '');
    };

    const days = [];

    for (let i = DEMAIN; i < 8; i += 1) {
      const dateStr = at('time', i);

      if (!dateStr) break;

      const dayCode = at('weather_code', i);

      days.push({
        label: dayLabel(dateStr),
        icon: describe(dayCode ?? -1).icon,
        max: Math.round(
          at('temperature_2m_max', i) ?? 0
        ),
        min: Math.round(
          at('temperature_2m_min', i) ?? 0
        ),
        rain: Math.round(
          at('precipitation_probability_max', i) ?? 0
        ),
      });
    }

    return Response.json({
      temperature: Math.round(
        data?.current?.temperature_2m ?? 0
      ),
      feltAs: Math.round(
        data?.current?.apparent_temperature ?? 0
      ),
      label: info.label,
      icon: nightIcon(code, isDay),
      max: Math.round(at('temperature_2m_max', AUJOURD_HUI) ?? 0),
      min: Math.round(at('temperature_2m_min', AUJOURD_HUI) ?? 0),

      sunrise: hhmm(at('sunrise', AUJOURD_HUI)),
      sunset: hhmm(at('sunset', AUJOURD_HUI)),

      hours,

      /*
       * Indispensable : le soir, la bande montre 7 h, 10 h,
       * 13 h… qui sont ceux de DEMAIN. Sans ce drapeau,
       * l'affichage laisserait croire qu'il s'agit d'heures
       * déjà passées aujourd'hui.
       */
      hoursDay: useTomorrow ? 'tomorrow' : 'today',

      days,

      production,
    });
  } catch {
    return Response.json(
      { error: 'meteo indisponible' },
      { status: 502 }
    );
  }
}
