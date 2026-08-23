'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

/*
 * =============================================================
 * JOURNÉE SOLAIRE — courbe, légende, tableau
 *
 * Trois séries, et deux façons de les distinguer, pas une :
 *
 *   Production        aire orange pâle
 *   Autoconsommation  aire orange dense, PAR-DESSUS la
 *                     précédente — c'est la part de la
 *                     production que la maison a gardée
 *   Consommation      trait bleu
 *
 * Les deux aires partagent la même teinte à deux intensités,
 * et c'est délibéré : l'autoconsommation est une PARTIE de la
 * production, pas une grandeur indépendante. Deux teintes
 * différentes suggéreraient deux choses sans rapport. La
 * consommation, elle, est une grandeur à part : autre teinte,
 * et autre forme de tracé.
 *
 * La palette est celle du référentiel de visualisation,
 * vérifiée par son script : séparation suffisante pour un
 * daltonien, contraste suffisant sur les deux thèmes.
 * =============================================================
 */

const SLOT_MINUTES = 5;
const DAY_MINUTES = 24 * 60;

/* Graduations horizontales tous les 2 kW, au moins jusqu'à 10. */
const STEP_KW = 2;
const MIN_TOP_KW = 10;

/*
 * Géométrie du tracé, en unités du viewBox.
 *
 * La largeur est volontairement proche de la largeur réelle
 * d'affichage. Le SVG s'étire pour remplir la carte : avec un
 * viewBox deux fois plus large que la place disponible, tout
 * était divisé par deux à l'écran — les libellés d'axe
 * tombaient à cinq pixels de haut, illisibles. À 360, l'unité
 * du dessin vaut à peu près le pixel.
 *
 * La hauteur double la place occupée par le graphique.
 */

const W = 360;
const H = 300;
const PAD_L = 30;
const PAD_R = 8;
const PAD_T = 14;
const PAD_B = 28;

type Point = {
  minute: number;
  production: number | null;
  consumption: number | null;
  grid: number | null;
};

type Totals = {
  productionWh: number | null;
  importWh: number | null;
  exportWh: number | null;
  consumptionWh: number | null;
  selfConsumedWh: number | null;
  estimated: boolean;
};

function todayIso() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '01';

  return `${get('year')}-${get('month')}-${get('day')}`;
}

function shiftDate(iso: string, days: number) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function labelDate(iso: string) {
  if (iso === todayIso()) return "Aujourd'hui";
  if (iso === shiftDate(todayIso(), -1)) return 'Hier';

  const formatted = new Date(
    iso + 'T12:00:00Z'
  ).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

  return (
    formatted.charAt(0).toUpperCase() + formatted.slice(1)
  );
}

function formatKwh(wh: number | null) {
  if (wh === null) return '—';

  return (wh / 1000).toFixed(1).replace('.', ',') + ' kWh';
}

function formatKw(watts: number | null) {
  if (watts === null) return '—';

  return (watts / 1000).toFixed(2).replace('.', ',');
}

function formatClock(minute: number) {
  const h = Math.floor(minute / 60);
  const m = minute % 60;

  return (
    String(h).padStart(2, '0') +
    ':' +
    String(m).padStart(2, '0')
  );
}

export default function SolarDayPage() {
  const [date, setDate] = useState(todayIso());
  const [points, setPoints] = useState<Point[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTable, setShowTable] = useState(false);
  const [cursor, setCursor] = useState<number | null>(null);

  const plotRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);

    fetch('/api/solar/history?date=' + date)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;

        setPoints(
          Array.isArray(data.points) ? data.points : []
        );
        setTotals(data.totals || null);
      })
      .catch(() => {
        if (!cancelled) {
          setPoints([]);
          setTotals(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [date]);

  /*
   * Le haut de l'échelle est un multiple de 2 kW, jamais moins
   * de 10. Un plafond fixe à 10 aurait tronqué la courbe le
   * jour où l'installation dépasse — une erreur invisible,
   * puisqu'une courbe rognée ressemble à une courbe plate.
   */

  const topKw = useMemo(() => {
    let peak = 0;

    for (const point of points) {
      if (point.production !== null) {
        peak = Math.max(peak, point.production);
      }
      if (point.consumption !== null) {
        peak = Math.max(peak, point.consumption);
      }
    }

    const needed =
      Math.ceil(peak / 1000 / STEP_KW) * STEP_KW;

    return Math.max(MIN_TOP_KW, needed);
  }, [points]);

  const x = (minute: number) =>
    PAD_L +
    (minute / DAY_MINUTES) * (W - PAD_L - PAD_R);

  const y = (watts: number) =>
    H -
    PAD_B -
    (watts / (topKw * 1000)) * (H - PAD_T - PAD_B);

  /*
   * Les séries sont découpées en segments continus : une
   * coupure de collecte doit se voir comme un TROU, pas se
   * faire enjamber par un trait droit qui inventerait des
   * valeurs jamais mesurées.
   */

  const segments = useMemo(() => {
    const production: Array<Array<[number, number]>> = [];
    const selfUse: Array<Array<[number, number]>> = [];
    const consumption: Array<Array<[number, number]>> = [];

    let cp: Array<[number, number]> = [];
    let cs: Array<[number, number]> = [];
    let cc: Array<[number, number]> = [];

    const flush = () => {
      if (cp.length > 1) production.push(cp);
      if (cs.length > 1) selfUse.push(cs);
      if (cc.length > 1) consumption.push(cc);
      cp = [];
      cs = [];
      cc = [];
    };

    let previousMinute: number | null = null;

    for (const point of points) {
      /* Plus d'un créneau d'écart = collecte interrompue. */
      if (
        previousMinute !== null &&
        point.minute - previousMinute > SLOT_MINUTES
      ) {
        flush();
      }

      previousMinute = point.minute;

      if (point.production !== null) {
        cp.push([point.minute, point.production]);
      }

      if (point.consumption !== null) {
        cc.push([point.minute, point.consumption]);
      }

      if (
        point.production !== null &&
        point.consumption !== null
      ) {
        cs.push([
          point.minute,
          Math.min(point.production, point.consumption),
        ]);
      }
    }

    flush();

    return { production, selfUse, consumption };
  }, [points]);

  const areaPath = (segment: Array<[number, number]>) => {
    const top = segment
      .map(
        ([minute, watts], index) =>
          (index === 0 ? 'M' : 'L') +
          x(minute).toFixed(1) +
          ' ' +
          y(watts).toFixed(1)
      )
      .join(' ');

    const first = segment[0][0];
    const last = segment[segment.length - 1][0];
    const base = (H - PAD_B).toFixed(1);

    return (
      top +
      ' L' +
      x(last).toFixed(1) +
      ' ' +
      base +
      ' L' +
      x(first).toFixed(1) +
      ' ' +
      base +
      ' Z'
    );
  };

  const linePath = (segment: Array<[number, number]>) =>
    segment
      .map(
        ([minute, watts], index) =>
          (index === 0 ? 'M' : 'L') +
          x(minute).toFixed(1) +
          ' ' +
          y(watts).toFixed(1)
      )
      .join(' ');

  const gridLines = useMemo(() => {
    const lines: number[] = [];

    for (let kw = 0; kw <= topKw; kw += STEP_KW) {
      lines.push(kw);
    }

    return lines;
  }, [topKw]);

  /*
   * Curseur : le doigt glisse sur le tracé et lit les trois
   * valeurs à cet instant. Il ne REMPLACE rien — la légende et
   * le tableau donnent les mêmes chiffres sans geste, pour qui
   * ne peut pas viser.
   */

  const readAt = (clientX: number) => {
    const svg = plotRef.current;

    if (!svg) return;

    const box = svg.getBoundingClientRect();
    const ratio = (clientX - box.left) / box.width;

    const minute = Math.round(
      (ratio * W - PAD_L) /
        (W - PAD_L - PAD_R) *
        DAY_MINUTES /
        SLOT_MINUTES
    ) * SLOT_MINUTES;

    setCursor(
      Math.min(Math.max(minute, 0), DAY_MINUTES)
    );
  };

  const cursorPoint = useMemo(() => {
    if (cursor === null) return null;

    let best: Point | null = null;
    let bestGap = Infinity;

    for (const point of points) {
      const gap = Math.abs(point.minute - cursor);

      if (gap < bestGap) {
        bestGap = gap;
        best = point;
      }
    }

    return bestGap <= SLOT_MINUTES * 2 ? best : null;
  }, [cursor, points]);

  /* Tableau : moyennes horaires. 288 lignes seraient
     illisibles ; 24 se parcourent. */

  const hourly = useMemo(() => {
    const rows: Array<{
      hour: number;
      production: number | null;
      consumption: number | null;
    }> = [];

    for (let hour = 0; hour < 24; hour++) {
      const inHour = points.filter(
        (point) =>
          point.minute >= hour * 60 &&
          point.minute < (hour + 1) * 60
      );

      if (inHour.length === 0) {
        rows.push({
          hour,
          production: null,
          consumption: null,
        });
        continue;
      }

      const mean = (
        pick: (p: Point) => number | null
      ) => {
        const values = inHour
          .map(pick)
          .filter((v): v is number => v !== null);

        if (values.length === 0) return null;

        return (
          values.reduce((a, b) => a + b, 0) / values.length
        );
      };

      rows.push({
        hour,
        production: mean((p) => p.production),
        consumption: mean((p) => p.consumption),
      });
    }

    return rows;
  }, [points]);

  const isToday = date === todayIso();

  return (
    <main className="page solar-page">

      <header className="solar-head">

        <Link href="/" className="solar-back">
          ‹ Accueil
        </Link>

        <h1>{labelDate(date)}</h1>

        <div className="solar-nav">

          <button
            type="button"
            onClick={() => setDate(shiftDate(date, -1))}
            aria-label="Jour précédent"
          >
            ‹
          </button>

          <button
            type="button"
            onClick={() => setDate(shiftDate(date, 1))}
            disabled={isToday}
            aria-label="Jour suivant"
          >
            ›
          </button>

        </div>

      </header>

      <section className="solar-chart-card">

        <svg
          ref={plotRef}
          className="solar-chart"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Production et consommation de la journée"
          onPointerDown={(e) => readAt(e.clientX)}
          onPointerMove={(e) => {
            if (e.buttons > 0 || e.pointerType === 'touch') {
              readAt(e.clientX);
            }
          }}
          onPointerLeave={() => setCursor(null)}
          onPointerUp={() => setCursor(null)}
        >

          {/* Graduations : traits pleins d'un demi-pixel.
              Des pointillés se liraient comme un seuil. */}

          {gridLines.map((kw) => (
            <g key={kw}>
              <line
                className="solar-grid-line"
                x1={PAD_L}
                x2={W - PAD_R}
                y1={y(kw * 1000)}
                y2={y(kw * 1000)}
              />
              <text
                className="solar-axis-text"
                x={PAD_L - 8}
                y={y(kw * 1000) + 3.5}
                textAnchor="end"
              >
                {kw}
              </text>
            </g>
          ))}

          {[0, 6, 12, 18, 24].map((hour) => (
            <text
              key={hour}
              className="solar-axis-text"
              x={x(hour * 60)}
              y={H - PAD_B + 16}
              textAnchor={
                hour === 0
                  ? 'start'
                  : hour === 24
                    ? 'end'
                    : 'middle'
              }
            >
              {String(hour).padStart(2, '0')}h
            </text>
          ))}

          {segments.production.map((segment, index) => (
            <path
              key={'p' + index}
              className="solar-area-production"
              d={areaPath(segment)}
            />
          ))}

          {segments.selfUse.map((segment, index) => (
            <path
              key={'s' + index}
              className="solar-area-self"
              d={areaPath(segment)}
            />
          ))}

          {segments.consumption.map((segment, index) => (
            <path
              key={'c' + index}
              className="solar-line-consumption"
              d={linePath(segment)}
            />
          ))}

          {cursorPoint && (
            <line
              className="solar-cursor"
              x1={x(cursorPoint.minute)}
              x2={x(cursorPoint.minute)}
              y1={PAD_T}
              y2={H - PAD_B}
            />
          )}

        </svg>

        {cursorPoint && (
          <div className="solar-readout">

            <strong>
              {formatClock(cursorPoint.minute)}
            </strong>

            <span>
              {formatKw(cursorPoint.production)} kW produits
            </span>

            <span>
              {formatKw(cursorPoint.consumption)} kW consommés
            </span>

          </div>
        )}

        {loading && (
          <p className="solar-empty">Chargement…</p>
        )}

        {!loading && points.length === 0 && (
          <p className="solar-empty">
            Aucun relevé pour cette journée.
          </p>
        )}

      </section>

      {/* ---------------------------------------------
          LÉGENDE — elle porte aussi les totaux, ce qui
          rend chaque série lisible sans dépendre de sa
          couleur seule.
          --------------------------------------------- */}

      <section className="solar-legend">

        <div className="solar-legend-row">
          <span className="solar-swatch is-production" />
          <span className="solar-legend-label">Production</span>
          <strong>{formatKwh(totals?.productionWh ?? null)}</strong>
        </div>

        <div className="solar-legend-row">
          <span className="solar-swatch is-self" />
          <span className="solar-legend-label">
            Autoconsommée
          </span>
          <strong>
            {formatKwh(totals?.selfConsumedWh ?? null)}
          </strong>
        </div>

        <div className="solar-legend-row">
          <span className="solar-swatch is-consumption" />
          <span className="solar-legend-label">
            Consommation
          </span>
          <strong>
            {formatKwh(totals?.consumptionWh ?? null)}
          </strong>
        </div>

        <div className="solar-legend-split">

          <div>
            <small>Soutiré au réseau</small>
            <strong>{formatKwh(totals?.importWh ?? null)}</strong>
          </div>

          <div>
            <small>Injecté sur le réseau</small>
            <strong>{formatKwh(totals?.exportWh ?? null)}</strong>
          </div>

        </div>

        {totals?.estimated && (
          <p className="solar-estimated">
            Totaux reconstitués depuis les courbes : les
            compteurs du Smart Meter n&apos;ont pas couvert
            toute la journée.
          </p>
        )}

      </section>

      <button
        type="button"
        className="solar-table-toggle"
        onClick={() => setShowTable(!showTable)}
      >
        {showTable
          ? 'Masquer le tableau'
          : 'Afficher le tableau'}
      </button>

      {showTable && (
        <div className="solar-table-wrap">

          <table className="solar-table">

            <thead>
              <tr>
                <th>Heure</th>
                <th>Production</th>
                <th>Consommation</th>
              </tr>
            </thead>

            <tbody>
              {hourly.map((row) => (
                <tr key={row.hour}>
                  <td>
                    {String(row.hour).padStart(2, '0')}h
                  </td>
                  <td>{formatKw(row.production)}</td>
                  <td>{formatKw(row.consumption)}</td>
                </tr>
              ))}
            </tbody>

          </table>

          <p className="solar-table-note">
            Moyennes horaires, en kW.
          </p>

        </div>
      )}

    </main>
  );
}
