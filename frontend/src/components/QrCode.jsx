import React from 'react';
import qrcode from 'qrcode-generator';

const QUIET_ZONE = 4;

/**
 * Erzeugt einen QR-Code lokal im Browser (kein externer Dienst) und rendert ihn
 * als SVG-Pfad. Hintergrund ist immer hell, damit Scanner ihn auch im
 * Dunkelmodus zuverlaessig lesen.
 * @param {{ value: string, size?: number, label?: string, errorCorrection?: 'L'|'M'|'Q'|'H' }} props
 */
export default function QrCode({ value, size = 224, label, errorCorrection = 'M' }) {
  const model = React.useMemo(() => {
    if (!value) return null;
    try {
      const qr = qrcode(0, errorCorrection);
      qr.addData(String(value), 'Byte');
      qr.make();
      const count = qr.getModuleCount();
      let d = '';
      for (let row = 0; row < count; row += 1) {
        for (let col = 0; col < count; col += 1) {
          if (qr.isDark(row, col)) d += `M${col + QUIET_ZONE},${row + QUIET_ZONE}h1v1h-1z`;
        }
      }
      return { d, dim: count + QUIET_ZONE * 2 };
    } catch {
      return null;
    }
  }, [value, errorCorrection]);

  if (!model) return null;
  // Ganzzahlige Pixel pro Modul, damit die Kanten scharf bleiben.
  const px = Math.max(model.dim, Math.floor(size / model.dim) * model.dim);

  return (
    <svg
      role="img"
      aria-label={label || value}
      width={px}
      height={px}
      viewBox={`0 0 ${model.dim} ${model.dim}`}
      shapeRendering="crispEdges"
      data-testid="qr-code"
      className="block rounded-lg"
    >
      <rect width={model.dim} height={model.dim} fill="#ffffff" />
      <path d={model.d} fill="#000000" />
    </svg>
  );
}
