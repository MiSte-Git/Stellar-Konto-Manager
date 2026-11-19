import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const H = 200;
const DEFAULT_W = 640;
const PAD = { top: 12, right: 12, bottom: 24, left: 12 };
const DOTS_MAX = 30;

/** Breite des Containers in px; ohne ResizeObserver (Tests, alte Browser) die Standardbreite. */
function useWidth(ref) {
  const [width, setWidth] = useState(DEFAULT_W);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const apply = () => { if (el.clientWidth > 0) setWidth(el.clientWidth); };
    apply();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/**
 * Kursverlauf als Linie (Schlusskurs je Stunde bzw. Tag, XLM je Token). Eine Reihe, daher ohne Legende; die
 * Ueberschrift nennt sie. Zeitachse nach echter Zeit (Luecken ohne Handel bleiben sichtbar, bei wenigen Punkten mit
 * Markern). Die Zeichnung nutzt die echte Breite (Schrift in echten px, Hover passt auf jeder Breite, AM-6). Maus,
 * Tippen und Pfeiltasten (Pos1, Ende, Esc) zeigen Zeit, Kurs und Volumen in einer festen Live-Region; die Werte gibt
 * es zusaetzlich als Tabelle.
 */
// base: was 1 Einheit ist, unit: worin der Preis steht (normal base = Token, unit = XLM; umgekehrt XLM und Token).
export default function PriceChart({ series, fmtPrice, fmtXlm, rangeLabel, base, unit = 'XLM', dateTimeFormat }) {
  const { t } = useTranslation(['wallet']);
  const [active, setActive] = useState(null);
  const boxRef = useRef(null);
  const W = useWidth(boxRef);
  const points = useMemo(() => (Array.isArray(series) ? series : []), [series]);

  const geo = useMemo(() => {
    if (points.length < 2) return null;
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const prices = points.map((p) => p.price);
    let min = Math.min(...prices);
    let max = Math.max(...prices);
    if (min === max) { min *= 0.98; max *= 1.02; }
    const pad = (max - min) * 0.08;
    min = Math.max(0, min - pad);
    max += pad;
    const x = (tt) => PAD.left + ((tt - t0) / (t1 - t0 || 1)) * (W - PAD.left - PAD.right);
    const y = (p) => PAD.top + (1 - (p - min) / (max - min)) * (H - PAD.top - PAD.bottom);
    const pts = points.map((p) => ({ ...p, x: x(p.t), y: y(p.price) }));
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const ticks = [max - pad, (min + max) / 2, min + pad].map((v, i) => ({ v, y: y(v), i }));
    return { pts, path, ticks };
  }, [points, W]);

  const table = (
    <details className="text-xs">
      <summary className="cursor-pointer text-gray-600 dark:text-gray-300">{t('wallet:assetDetail.market.chart.table', 'Werte als Tabelle')}</summary>
      <div className="mt-2 max-h-48 overflow-y-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-gray-500 dark:text-gray-400">
              <th className="py-1 font-medium">{t('wallet:assetDetail.market.chart.time', 'Zeit')}</th>
              <th className="py-1 text-right font-medium">{t('wallet:assetDetail.market.chart.close', { unit, defaultValue: 'Schlusskurs ({{unit}})' })}</th>
              <th className="py-1 text-right font-medium">{t('wallet:assetDetail.market.chart.volumeCol', 'Volumen (XLM)')}</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {points.map((p) => (
              <tr key={p.t}>
                <td className="py-0.5">{dateTimeFormat(p.t)}</td>
                <td className="py-0.5 text-right">{fmtPrice(p.price)}</td>
                <td className="py-0.5 text-right">{fmtXlm(p.xlm)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );

  if (!points.length) {
    return (
      <p className="text-sm text-gray-600 dark:text-gray-300" data-testid="asset-chart-empty">
        {t('wallet:assetDetail.market.chart.tooFew', 'Zu wenig Handel in diesem Zeitraum für einen Verlauf.')}
      </p>
    );
  }
  if (!geo) {
    return (
      <div className="space-y-2" data-testid="asset-chart-single">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t('wallet:assetDetail.market.chart.single', { time: dateTimeFormat(points[0].t), price: fmtPrice(points[0].price), unit, defaultValue: 'Nur ein Handelszeitraum: {{time}}, Schlusskurs {{price}} {{unit}}.' })}
        </p>
        {table}
      </div>
    );
  }

  const count = geo.pts.length;
  const pick = (clientX) => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return;
    const px = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    geo.pts.forEach((p, i) => { if (Math.abs(p.x - px) < Math.abs(geo.pts[best].x - px)) best = i; });
    setActive(best);
  };
  const point = active != null ? geo.pts[Math.min(active, count - 1)] : null;
  const label = t('wallet:assetDetail.market.chart.aria', { code: base, unit, range: rangeLabel, defaultValue: 'Kursverlauf {{code}} in {{unit}}, {{range}}' });

  return (
    <div className="space-y-2">
      <div
        ref={boxRef}
        className="relative rounded-sm text-blue-600 outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400"
        role="group"
        aria-label={`${label}. ${t('wallet:assetDetail.market.chart.keyboardHint', 'Pfeiltasten, Pos1 und Ende wählen einen Punkt. Die Werte gibt es auch als Tabelle unter der Grafik.')}`}
        tabIndex={0}
        data-testid="asset-chart"
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setActive((i) => Math.min(count - 1, (i ?? -1) + 1));
          else if (e.key === 'ArrowLeft') setActive((i) => Math.max(0, (i ?? count) - 1));
          else if (e.key === 'Home') setActive(0);
          else if (e.key === 'End') setActive(count - 1);
          else if (e.key === 'Escape') setActive(null);
          else return;
          e.preventDefault();
        }}
        onBlur={() => setActive(null)}
      >
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block h-[200px] w-full touch-pan-y select-none"
          aria-hidden="true"
          onPointerMove={(e) => pick(e.clientX)}
          onPointerDown={(e) => pick(e.clientX)}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse') setActive(null); }}
        >
          {geo.ticks.map((tk) => (
            <line key={tk.i} x1={PAD.left} x2={W - PAD.right} y1={tk.y} y2={tk.y} className="stroke-gray-200 dark:stroke-gray-700" strokeWidth="1" />
          ))}
          <path d={geo.path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {/* Achsenwerte ueber der Linie, mit Rand in Kartenfarbe, damit die Linie sie nicht verdeckt */}
          {geo.ticks.map((tk) => (
            <text key={tk.i} x={W - PAD.right} y={tk.y - 3} textAnchor="end" paintOrder="stroke" strokeWidth="3" strokeLinejoin="round" className="fill-gray-500 stroke-white text-[11px] dark:fill-gray-400 dark:stroke-gray-800">{fmtPrice(tk.v)}</text>
          ))}
          {count <= DOTS_MAX && geo.pts.map((p) => <circle key={p.t} cx={p.x} cy={p.y} r="2" fill="currentColor" />)}
          <text x={PAD.left} y={H - 6} className="fill-gray-500 text-[11px] dark:fill-gray-400">{dateTimeFormat(geo.pts[0].t)}</text>
          <text x={W - PAD.right} y={H - 6} textAnchor="end" className="fill-gray-500 text-[11px] dark:fill-gray-400">{dateTimeFormat(geo.pts[count - 1].t)}</text>
          {point && (
            <g>
              <line x1={point.x} x2={point.x} y1={PAD.top} y2={H - PAD.bottom} className="stroke-gray-400 dark:stroke-gray-500" strokeWidth="1" />
              <circle cx={point.x} cy={point.y} r="4.5" fill="currentColor" className="stroke-white dark:stroke-gray-800" strokeWidth="2" />
            </g>
          )}
        </svg>
        {point && (
          <div
            className="pointer-events-none absolute top-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs shadow-sm dark:border-gray-700 dark:bg-gray-900"
            style={{ left: `${Math.min(65, Math.max(0, (point.x / W) * 100 - 15))}%` }}
            data-testid="asset-chart-tooltip"
          >
            <div className="text-gray-500 dark:text-gray-400">{dateTimeFormat(point.t)}</div>
            <div className="font-mono text-gray-900 dark:text-gray-100">{fmtPrice(point.price)} {unit}</div>
            <div className="text-gray-500 dark:text-gray-400">{t('wallet:assetDetail.market.chart.volume', { value: fmtXlm(point.xlm), defaultValue: 'Volumen {{value}} XLM' })}</div>
          </div>
        )}
      </div>
      {/* Feste Live-Region: nur der Inhalt wechselt, damit Screenreader den gewaehlten Punkt ansagen (AM-6). */}
      <div className="sr-only" aria-live="polite" data-testid="asset-chart-live">
        {point ? `${dateTimeFormat(point.t)}: ${fmtPrice(point.price)} ${unit}` : ''}
      </div>
      {table}
    </div>
  );
}
