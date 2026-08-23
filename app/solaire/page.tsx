'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

/*
 * =============================================================
 * SOLAIRE — JOUR, MOIS, ANNÉE
 *
 * Trois échelles, deux formes de tracé, et c'est délibéré :
 *
 *   Jour   une COURBE — la puissance est continue, elle monte
 *          et redescend, et la forme de la journée est
 *          l'information.
 *
 *   Mois   des BARRES — une journée est une quantité close,
 *          pas un instant. Relier deux journées par un trait
 *          suggérerait un passage progressif de l'une à
 *          l'autre, ce qui n'a aucun sens.
 *   Année  idem, une barre par mois.
 *
 * Les couleurs racontent la même histoire aux trois échelles :
 * l'orange est ce que la maison a gardé du soleil, le jaune ce
 * qui est parti au réseau, et leur somme la production. Le
 * bleu reste la consommation.
 * =============================================================
 */

const SLOT_MINUTES = 5;
const DAY_MINUTES = 24 * 60;

const STEP_KW = 2;
const MIN_TOP_KW = 10;

const W = 360;

/*
 * Le graphique occupe presque toute la hauteur d'écran
 * disponible. La largeur du viewBox reste proche de la largeur
 * réelle d'affichage : c'est ce rapport qui décide de la
 * taille apparente des libellés d'axe, et un viewBox trop
 * large les réduirait à quelques pixels.
 */

const H = 430;
const PAD_L = 30;
const PAD_R = 8;
const PAD_T = 14;
const PAD_B = 28;

type Scope = 'day' | 'month' | 'year';

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

type Row = {
  key: string;
  label: string;
  totals: Totals | null;
};

/* ---------------------------------------------------------
   DATES
   --------------------------------------------------------- */

function nowParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '01';

  return {
    day: `${get('year')}-${get('month')}-${get('day')}`,
    month: `${get('year')}-${get('month')}`,
    year: get('year'),
  };
}

function shiftDay(iso: string, days: number) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function shiftMonth(iso: string, months: number) {
  const [year, month] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1 + months, 1));

  return (
    d.getUTCFullYear() +
    '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0')
  );
}

function labelFor(scope: Scope, value: string) {
  const now = nowParts();

  if (scope === 'year') return value;

  if (scope === 'month') {
    const [year, month] = value.split('-').map(Number);

    const formatted = new Date(
      Date.UTC(year, month - 1, 15)
    ).toLocaleDateString('fr-FR', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });

    return (
      formatted.charAt(0).toUpperCase() + formatted.slice(1)
    );
  }

  if (value === now.day) return "Aujourd'hui";
  if (value === shiftDay(now.day, -1)) return 'Hier';

  const formatted = new Date(
    value + 'T12:00:00Z'
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

/* ---------------------------------------------------------
   FORMATS
   --------------------------------------------------------- */

function formatKwh(wh: number | null | undefined) {
  if (wh === null || wh === undefined) return '—';

  if (Math.abs(wh) >= 100000) {
    return (
      Math.round(wh / 1000)
        .toString()
        .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' kWh'
    );
  }

  return (wh / 1000).toFixed(1).replace('.', ',') + ' kWh';
}

function formatKw(watts: number | null) {
  if (watts === null) return '—';

  return (watts / 1000).toFixed(2).replace('.', ',');
}

function formatClock(minute: number) {
  return (
    String(Math.floor(minute / 60)).padStart(2, '0') +
    ':' +
    String(minute % 60).padStart(2, '0')
  );
}

/*
 * Graduations : on cherche un pas rond qui donne quatre à six
 * lignes. Un pas calculé au plus juste donnerait des repères
 * du genre « 3,7 kWh », impossibles à lire d'un coup d'œil.
 */

function niceStep(max: number) {
  if (max <= 0) return 1;

  const rough = max / 5;
  const magnitude = Math.pow(
    10,
    Math.floor(Math.log10(rough))
  );

  for (const factor of [1, 2, 2.5, 5, 10]) {
    const step = magnitude * factor;
    if (step >= rough) return step;
  }

  return magnitude * 10;
}

export default function SolarPage() {
  const [scope, setScope] = useState<Scope>('day');
  const [day, setDay] = useState(() => nowParts().day);
  const [month, setMonth] = useState(
    () => nowParts().month
  );
  const [year, setYear] = useState(() => nowParts().year);

  const [points, setPoints] = useState<Point[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTable, setShowTable] = useState(false);

  const [cursor, setCursor] = useState<number | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  const plotRef = useRef<SVGSVGElement | null>(null);
  const retriesRef = useRef(0);

  const current =
    scope === 'day' ? day : scope === 'month' ? month : year;

  /* ---------------------------------------------------------
     CHARGEMENT
     --------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setCursor(null);
    setPicked(null);

    const load = () => {
      fetch(
        `/api/solar/history?scope=${scope}&date=${current}`
      )
        .then((res) => res.json())
        .then((data) => {
          if (cancelled) return;

          setPoints(
            Array.isArray(data.points) ? data.points : []
          );
          setRows(Array.isArray(data.rows) ? data.rows : []);
          setTotals(data.totals || null);

          /*
           * La vue annuelle ne reconstitue que quelques mois
           * par requête, pour ne pas dépasser le temps imparti
           * à la fonction serveur. On relance tant qu'il en
           * manque — mais pas indéfiniment : si un mois refuse
           * obstinément de se calculer, mieux vaut une page
           * incomplète qu'une boucle sans fin.
           */
          if (
            data.pending > 0 &&
            retriesRef.current < 6
          ) {
            retriesRef.current += 1;
            load();
            return;
          }

          setLoading(false);
        })
        .catch(() => {
          if (cancelled) return;

          setPoints([]);
          setRows([]);
          setTotals(null);
          setLoading(false);
        });
    };

    retriesRef.current = 0;
    load();

    return () => {
      cancelled = true;
    };
  }, [scope, current]);

  /* Cumuls d'un mois ou d'une année : la somme des lignes. */

  const aggregate = useMemo(() => {
    if (scope === 'day') return totals;

    const sum = (pick: (t: Totals) => number | null) => {
      let total = 0;
      let seen = false;

      for (const row of rows) {
        if (!row.totals) continue;

        const value = pick(row.totals);

        if (value === null) continue;

        total += value;
        seen = true;
      }

      return seen ? total : null;
    };

    return {
      productionWh: sum((t) => t.productionWh),
      importWh: sum((t) => t.importWh),
      exportWh: sum((t) => t.exportWh),
      consumptionWh: sum((t) => t.consumptionWh),
      selfConsumedWh: sum((t) => t.selfConsumedWh),
      estimated: rows.some((r) => r.totals?.estimated),
    } as Totals;
  }, [scope, rows, totals]);

  /* ---------------------------------------------------------
     ÉCHELLE VERTICALE
     --------------------------------------------------------- */

  const dayTopKw = useMemo(() => {
    let peak = 0;

    for (const point of points) {
      if (point.production !== null) {
        peak = Math.max(peak, point.production);
      }
      if (point.consumption !== null) {
        peak = Math.max(peak, point.consumption);
      }
    }

    return Math.max(
      MIN_TOP_KW,
      Math.ceil(peak / 1000 / STEP_KW) * STEP_KW
    );
  }, [points]);

  const barScale = useMemo(() => {
    let peak = 0;

    for (const row of rows) {
      if (!row.totals) continue;

      peak = Math.max(
        peak,
        row.totals.productionWh ?? 0,
        row.totals.consumptionWh ?? 0
      );
    }

    const step = niceStep(peak / 1000);
    const top = Math.max(step, Math.ceil(peak / 1000 / step) * step);

    return { top, step };
  }, [rows]);

  const x = (minute: number) =>
    PAD_L + (minute / DAY_MINUTES) * (W - PAD_L - PAD_R);

  const yDay = (watts: number) =>
    H -
    PAD_B -
    (watts / (dayTopKw * 1000)) * (H - PAD_T - PAD_B);

  const yBar = (wh: number) =>
    H -
    PAD_B -
    (wh / (barScale.top * 1000)) * (H - PAD_T - PAD_B);

  /* ---------------------------------------------------------
     COURBE DU JOUR
     --------------------------------------------------------- */

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

    let previous: number | null = null;

    for (const point of points) {
      /* Plus d'un créneau d'écart = collecte interrompue. Le
         trou doit rester un trou : un trait droit inventerait
         des valeurs jamais mesurées. */
      if (
        previous !== null &&
        point.minute - previous > SLOT_MINUTES
      ) {
        flush();
      }

      previous = point.minute;

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
          yDay(watts).toFixed(1)
      )
      .join(' ');

    const base = (H - PAD_B).toFixed(1);

    return (
      top +
      ' L' +
      x(segment[segment.length - 1][0]).toFixed(1) +
      ' ' +
      base +
      ' L' +
      x(segment[0][0]).toFixed(1) +
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
          yDay(watts).toFixed(1)
      )
      .join(' ');

  const readAt = (clientX: number) => {
    const svg = plotRef.current;

    if (!svg) return;

    const box = svg.getBoundingClientRect();
    const ratio = (clientX - box.left) / box.width;

    const minute =
      Math.round(
        (((ratio * W - PAD_L) / (W - PAD_L - PAD_R)) *
          DAY_MINUTES) /
          SLOT_MINUTES
      ) * SLOT_MINUTES;

    setCursor(Math.min(Math.max(minute, 0), DAY_MINUTES));
  };

  const cursorPoint = useMemo(() => {
    if (cursor === null) return null;

    let best: Point | null = null;
    let gap = Infinity;

    for (const point of points) {
      const distance = Math.abs(point.minute - cursor);

      if (distance < gap) {
        gap = distance;
        best = point;
      }
    }

    return gap <= SLOT_MINUTES * 2 ? best : null;
  }, [cursor, points]);

  /* ---------------------------------------------------------
     NAVIGATION
     --------------------------------------------------------- */

  const now = nowParts();

  const atPresent =
    scope === 'day'
      ? day === now.day
      : scope === 'month'
        ? month === now.month
        : year === now.year;

  const step = (direction: number) => {
    if (scope === 'day') setDay(shiftDay(day, direction));
    else if (scope === 'month')
      setMonth(shiftMonth(month, direction));
    else setYear(String(Number(year) + direction));
  };

  /*
   * Descendre d'un niveau : toucher un mois ouvre ce mois,
   * toucher un jour ouvre ce jour. C'est le geste que tout le
   * monde tente devant un graphique en barres.
   */

  const drillInto = (key: string) => {
    if (scope === 'year') {
      setMonth(key);
      setScope('month');
    } else if (scope === 'month') {
      setDay(key);
      setScope('day');
    }
  };

  const pickedRow = rows.find((row) => row.key === picked);

  const gridValues = useMemo(() => {
    if (scope === 'day') {
      const lines: number[] = [];
      for (let kw = 0; kw <= dayTopKw; kw += STEP_KW) {
        lines.push(kw);
      }
      return lines;
    }

    const lines: number[] = [];
    for (
      let value = 0;
      value <= barScale.top + 0.0001;
      value += barScale.step
    ) {
      lines.push(Number(value.toFixed(3)));
    }
    return lines;
  }, [scope, dayTopKw, barScale]);

  /* Largeur d'une barre, avec un intervalle constant. */

  /*
   * Deux barres par période, côte à côte : production et
   * consommation. Un intervalle de 2 unités les sépare — la
   * règle de tracé veut un espace de fond entre deux barres
   * voisines plutôt qu'un contour, qui alourdirait le dessin.
   */

  const barGeometry = useMemo(() => {
    const count = Math.max(rows.length, 1);
    const slot = (W - PAD_L - PAD_R) / count;

    const group = slot * 0.78;
    const width = Math.max((group - 2) / 2, 1.5);

    return { slot, group, width };
  }, [rows.length]);

  return (
    <main className="page solar-page">

      <header className="solar-head">

        <Link href="/" className="solar-back">
          ‹ Accueil
        </Link>

        <h1>{labelFor(scope, current)}</h1>

        <div className="solar-controls">

          <div className="solar-scopes">
            {(['day', 'month', 'year'] as Scope[]).map(
              (value) => (
                <button
                  key={value}
                  type="button"
                  className={
                    scope === value ? 'is-active' : ''
                  }
                  onClick={() => setScope(value)}
                >
                  {value === 'day'
                    ? 'Jour'
                    : value === 'month'
                      ? 'Mois'
                      : 'Année'}
                </button>
              )
            )}
          </div>

          <div className="solar-nav">

            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Précédent"
            >
              ‹
            </button>

            <button
              type="button"
              onClick={() => step(1)}
              disabled={atPresent}
              aria-label="Suivant"
            >
              ›
            </button>

          </div>

        </div>

      </header>

      <section className="solar-chart-card">

        <svg
          ref={plotRef}
          className="solar-chart"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Production et consommation"
          onPointerDown={
            scope === 'day'
              ? (e) => readAt(e.clientX)
              : undefined
          }
          onPointerMove={
            scope === 'day'
              ? (e) => {
                  if (
                    e.buttons > 0 ||
                    e.pointerType === 'touch'
                  ) {
                    readAt(e.clientX);
                  }
                }
              : undefined
          }
          onPointerLeave={() => setCursor(null)}
          onPointerUp={() => setCursor(null)}
        >

          {/* Graduations : traits pleins d'un demi-pixel. Des
              pointillés se liraient comme un seuil. */}

          {gridValues.map((value) => {
            const yy =
              scope === 'day'
                ? yDay(value * 1000)
                : yBar(value * 1000);

            return (
              <g key={value}>
                <line
                  className="solar-grid-line"
                  x1={PAD_L}
                  x2={W - PAD_R}
                  y1={yy}
                  y2={yy}
                />
                <text
                  className="solar-axis-text"
                  x={PAD_L - 6}
                  y={yy + 3.5}
                  textAnchor="end"
                >
                  {value}
                </text>
              </g>
            );
          })}

          {scope === 'day' ? (
            <>
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
            </>
          ) : (
            <>
              {rows.map((row, index) => {
                const cx =
                  PAD_L + barGeometry.slot * (index + 0.5);

                const base = H - PAD_B;

                const produced =
                  row.totals?.productionWh ?? 0;
                const used =
                  row.totals?.consumptionWh ?? 0;

                const halfGap = 1;

                return (
                  <g
                    key={row.key}
                    className={
                      picked === row.key
                        ? 'solar-bar is-picked'
                        : 'solar-bar'
                    }
                    onPointerDown={() =>
                      setPicked(
                        picked === row.key ? null : row.key
                      )
                    }
                  >

                    {/* Zone tactile large : viser une barre de
                        trois unités au doigt est impossible. */}
                    <rect
                      className="solar-bar-hit"
                      x={cx - barGeometry.slot / 2}
                      y={PAD_T}
                      width={barGeometry.slot}
                      height={base - PAD_T}
                    />

                    {produced > 0 && (
                      <rect
                        className="solar-bar-production"
                        x={
                          cx -
                          halfGap -
                          barGeometry.width
                        }
                        y={yBar(produced)}
                        width={barGeometry.width}
                        height={Math.max(
                          base - yBar(produced),
                          0.5
                        )}
                        rx={1.5}
                      />
                    )}

                    {used > 0 && (
                      <rect
                        className="solar-bar-consumption"
                        x={cx + halfGap}
                        y={yBar(used)}
                        width={barGeometry.width}
                        height={Math.max(
                          base - yBar(used),
                          0.5
                        )}
                        rx={1.5}
                      />
                    )}

                  </g>
                );
              })}

              {rows.map((row, index) => {
                const show =
                  scope === 'year' ||
                  index === 0 ||
                  (index + 1) % 5 === 0;

                if (!show) return null;

                return (
                  <text
                    key={'l' + row.key}
                    className="solar-axis-text"
                    x={
                      PAD_L +
                      barGeometry.slot * (index + 0.5)
                    }
                    y={H - PAD_B + 16}
                    textAnchor="middle"
                  >
                    {row.label}
                  </text>
                );
              })}
            </>
          )}

        </svg>

        {scope === 'day' && cursorPoint && (
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

        {scope !== 'day' && pickedRow && (
          <div className="solar-readout">

            <strong>{pickedRow.label}</strong>

            <span>
              {formatKwh(pickedRow.totals?.productionWh)}{' '}
              produits
            </span>

            <span>
              {formatKwh(pickedRow.totals?.consumptionWh)}{' '}
              consommés
            </span>

            <button
              type="button"
              className="solar-drill"
              onClick={() => drillInto(pickedRow.key)}
            >
              Voir le détail ›
            </button>

          </div>
        )}

        {loading && (
          <p className="solar-empty">Chargement…</p>
        )}

        {!loading &&
          scope === 'day' &&
          points.length === 0 && (
            <p className="solar-empty">
              Aucun relevé pour cette journée.
            </p>
          )}

        {!loading &&
          scope !== 'day' &&
          rows.length === 0 && (
            <p className="solar-empty">
              Aucun relevé sur cette période.
            </p>
          )}

      </section>

      {/* Légende : elle porte les totaux, ce qui rend chaque
          série lisible sans dépendre de sa couleur seule. */}

      <section className="solar-legend">

        <div className="solar-legend-row">
          <span className="solar-swatch is-production" />
          <span className="solar-legend-label">
            Production
          </span>
          <strong>
            {formatKwh(aggregate?.productionWh)}
          </strong>
        </div>

        {/* L'autoconsommation n'apparaît en légende que sur la
            journée : c'est là qu'elle est DESSINÉE, en aire
            orange sous la courbe. Aux autres échelles les
            barres ne montrent que production et consommation,
            et une pastille de couleur sans forme
            correspondante sur le graphique induirait en
            erreur. Le chiffre reste juste en dessous. */}

        {scope === 'day' && (
          <div className="solar-legend-row">
            <span className="solar-swatch is-self" />
            <span className="solar-legend-label">
              Autoconsommée
            </span>
            <strong>
              {formatKwh(aggregate?.selfConsumedWh)}
            </strong>
          </div>
        )}

        <div className="solar-legend-row">
          <span className="solar-swatch is-consumption" />
          <span className="solar-legend-label">
            Consommation
          </span>
          <strong>
            {formatKwh(aggregate?.consumptionWh)}
          </strong>
        </div>

        <div className="solar-legend-split">

          {scope !== 'day' && (
            <div>
              <small>Autoconsommée</small>
              <strong>
                {formatKwh(aggregate?.selfConsumedWh)}
              </strong>
            </div>
          )}

          <div>
            <small>Soutiré</small>
            <strong>{formatKwh(aggregate?.importWh)}</strong>
          </div>

          <div>
            <small>Injecté</small>
            <strong>{formatKwh(aggregate?.exportWh)}</strong>
          </div>

        </div>

        {aggregate?.estimated && (
          <p className="solar-estimated">
            Certains totaux ont été reconstitués depuis les
            courbes, faute de compteur sur toute la période.
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
                <th>
                  {scope === 'day'
                    ? 'Heure'
                    : scope === 'month'
                      ? 'Jour'
                      : 'Mois'}
                </th>
                <th>Production</th>
                <th>Consommation</th>
              </tr>
            </thead>

            <tbody>
              {scope === 'day'
                ? Array.from({ length: 24 }).map(
                    (_, hour) => {
                      const inHour = points.filter(
                        (point) =>
                          point.minute >= hour * 60 &&
                          point.minute < (hour + 1) * 60
                      );

                      const mean = (
                        pick: (p: Point) => number | null
                      ) => {
                        const values = inHour
                          .map(pick)
                          .filter(
                            (v): v is number => v !== null
                          );

                        if (values.length === 0) return null;

                        return (
                          values.reduce((a, b) => a + b, 0) /
                          values.length
                        );
                      };

                      return (
                        <tr key={hour}>
                          <td>
                            {String(hour).padStart(2, '0')}h
                          </td>
                          <td>
                            {formatKw(
                              mean((p) => p.production)
                            )}
                          </td>
                          <td>
                            {formatKw(
                              mean((p) => p.consumption)
                            )}
                          </td>
                        </tr>
                      );
                    }
                  )
                : rows.map((row) => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td>
                        {formatKwh(
                          row.totals?.productionWh
                        )}
                      </td>
                      <td>
                        {formatKwh(
                          row.totals?.consumptionWh
                        )}
                      </td>
                    </tr>
                  ))}
            </tbody>

          </table>

          <p className="solar-table-note">
            {scope === 'day'
              ? 'Moyennes horaires, en kW.'
              : 'Totaux par période.'}
          </p>

        </div>
      )}

    </main>
  );
}
