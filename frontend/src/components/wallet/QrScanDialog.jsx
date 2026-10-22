import React from 'react';
import { useTranslation } from 'react-i18next';
import jsQR from 'jsqr';

const SCAN_INTERVAL_MS = 250;
const MAX_FRAME_WIDTH = 640;

/**
 * QR-Code scannen oder Link einfuegen. onResult(text) gibt null zurueck, wenn der Inhalt
 * uebernommen wurde, sonst einen Fehlertext; dann scannt der Dialog weiter.
 * Die Kamera laeuft nur, solange der Dialog offen ist.
 * @param {{ onResult: (text: string) => string|null, onClose: () => void }} props
 */
export default function QrScanDialog({ onResult, onClose }) {
  const { t } = useTranslation(['wallet', 'common']);
  const videoRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const streamRef = React.useRef(null);
  const timerRef = React.useRef(null);
  const doneRef = React.useRef(false);
  const lastRejectedRef = React.useRef('');
  const onResultRef = React.useRef(onResult);
  const [camState, setCamState] = React.useState('starting'); // starting | scanning | denied | unavailable
  const [error, setError] = React.useState('');
  const [pasteValue, setPasteValue] = React.useState('');

  React.useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  const stopCamera = React.useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    (streamRef.current?.getTracks?.() || []).forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const handleText = React.useCallback((text) => {
    const value = String(text || '').trim();
    if (!value || doneRef.current) return;
    if (value === lastRejectedRef.current) return; // denselben abgelehnten Code nicht immer wieder melden
    const err = onResultRef.current(value);
    if (err) {
      lastRejectedRef.current = value;
      setError(err);
      return;
    }
    doneRef.current = true;
    stopCamera();
  }, [stopCamera]);

  React.useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamState('unavailable');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        setCamState('scanning');
        let detector = null;
        try {
          if ('BarcodeDetector' in window) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        } catch { detector = null; }
        const tick = async () => {
          if (cancelled || doneRef.current) return;
          try {
            if (video.readyState >= 2 && video.videoWidth > 0) {
              if (detector) {
                const codes = await detector.detect(video);
                if (codes?.[0]?.rawValue) handleText(codes[0].rawValue);
              } else {
                const scale = Math.min(1, MAX_FRAME_WIDTH / video.videoWidth);
                const w = Math.round(video.videoWidth * scale);
                const h = Math.round(video.videoHeight * scale);
                const canvas = canvasRef.current;
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(video, 0, 0, w, h);
                const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
                if (code?.data) handleText(code.data);
              }
            }
          } catch { /* einzelner Frame fehlgeschlagen, weiter scannen */ }
          if (!cancelled && !doneRef.current) timerRef.current = setTimeout(tick, SCAN_INTERVAL_MS);
        };
        tick();
      } catch (e) {
        if (cancelled) return;
        setCamState(e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'denied' : 'unavailable');
      }
    }
    start();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [handleText, stopCamera]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="qr-scan-title">
      <div className="my-auto w-full max-w-md rounded-2xl bg-white p-5 text-left shadow-xl dark:bg-gray-800">
        <h2 id="qr-scan-title" className="text-lg font-semibold text-gray-900 dark:text-white">{t('wallet:qrScan.title')}</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{t('wallet:qrScan.intro')}</p>

        <div className={`mt-3 overflow-hidden rounded-xl bg-black ${camState === 'denied' || camState === 'unavailable' ? 'hidden' : 'block'}`}>
          <video ref={videoRef} className="block h-auto w-full" playsInline muted aria-label={t('wallet:qrScan.videoLabel')} />
        </div>
        <canvas ref={canvasRef} className="hidden" aria-hidden="true" />
        {camState === 'starting' && <p className="mt-2 text-xs text-gray-500">{t('wallet:qrScan.starting')}</p>}
        {camState === 'denied' && <p className="mt-3 text-sm text-amber-800 dark:text-amber-200">{t('wallet:qrScan.denied')}</p>}
        {camState === 'unavailable' && <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">{t('wallet:qrScan.unavailable')}</p>}

        <label htmlFor="qr-paste" className="mt-4 block text-sm font-medium text-gray-800 dark:text-gray-200">{t('wallet:qrScan.pasteLabel')}</label>
        <textarea
          id="qr-paste"
          value={pasteValue}
          onChange={(e) => { setPasteValue(e.target.value); lastRejectedRef.current = ''; }}
          rows={3}
          className="mt-1 w-full rounded-sm border px-2 py-1.5 font-mono text-xs dark:bg-gray-900"
          placeholder="web+stellar:pay?destination=G…"
          spellCheck="false"
          autoComplete="off"
        />
        {error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100">
            {t('common:option.cancel', 'Abbrechen')}
          </button>
          <button
            type="button"
            onClick={() => handleText(pasteValue)}
            disabled={!pasteValue.trim()}
            className="rounded-lg border-0 bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {t('wallet:qrScan.apply')}
          </button>
        </div>
      </div>
    </div>
  );
}
