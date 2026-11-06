import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import AddressDropdown from '../AddressDropdown.jsx';
import SecretKeyModal from '../SecretKeyModal.jsx';
import { passphraseFor, readStoredNetworkId } from '../../config/networks.js';
import { getHorizonServerForNetwork } from '../../utils/stellar/stellarUtils.js';
import { NETWORK_CHANGED_EVENT, networkFromEvent } from '../../utils/globalNetwork.js';
import { resolveFeePerOp } from '../../utils/stellar/fees.js';
import { submitTransactionSafely, AmbiguousSubmitResultError } from '../../utils/stellar/submitTransactionSafely.js';
import { txHashHex } from '../../utils/stellar/txHash.js';
import { buildExplorerUrl } from '../../utils/stellar/accountUtils.js';
import { splitAddressForCompare } from '../../utils/stellar/walletSummary.js';
import { getSessionSecret, rememberSessionSecrets } from '../../utils/sessionSecrets.js';
import { copyText } from '../../utils/clipboard.js';
import { useRecentWalletOptions } from '../../utils/useRecentWalletOptions.js';
import { useTrustedWallets } from '../../utils/useTrustedWallets.js';
import { useSettings } from '../../utils/useSettings';
import { createWalletInfoMap, findWalletInfo } from '../../utils/walletInfo.js';
import {
  MAX_ROWS, MEMO_TYPES, containsSecretKey, createEmptyRow, isStorageWritable, loadBatchRows, looksLikeThousandsSeparator,
  normalizeAmount, pruneSentLog, readSentEntry, recentSendOf, saveBatchRows, writeSentEntry,
} from '../../utils/batchPayment/batchPaymentStore.js';
import {
  AMBIGUOUS_LEDGER_BUFFER_SECONDS, ambiguousClearAt, assetDisplay, buildSignedRowTx, checkRowOnNetwork, checkSourceAccount,
  computeSourceTotals, describeSubmitError, findAnyTransaction, findRecentMatchingPayment, isBadSeqError, paymentFingerprint,
  pinnedSendAccount, resolveAmbiguousDetailed, routingFingerprint, toStroops, validateRowInput,
} from '../../utils/batchPayment/batchPaymentLogic.js';
import { withSendLock } from '../../utils/batchPayment/sendLock.js';

const inputCls = 'border rounded-sm w-full px-2 py-1 text-base md:text-sm bg-white dark:bg-gray-900';
const btnCls = 'px-3 py-1.5 rounded-sm border text-sm font-medium disabled:opacity-50';
const smallBtnCls = 'px-2 py-1 rounded-sm border border-blue-200 text-blue-700 dark:border-blue-800 dark:text-blue-100 hover:bg-blue-50 dark:hover:bg-blue-900 text-xs';
const primaryBtnCls = 'px-3 py-1.5 rounded-sm text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50';

// Adresse in 4er-Gruppen, Anfang und Ende hervorgehoben (wie auf der Empfangen-Seite).
function AddressCompare({ address }) {
  const groups = splitAddressForCompare(address);
  return (
    <span className="font-mono text-xs break-all" title={address}>
      {groups.map((g, gi) => (
        <span key={gi} className="mr-1 inline-block">
          {g.map((seg, si) => (
            <span key={si} className={seg.strong ? 'font-bold text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}>{seg.text}</span>
          ))}
        </span>
      ))}
    </span>
  );
}

// Memo mit Typ, z.B. "12345 (ID)". Ohne Typ waeren Text-Memo und Memo ID nicht zu
// unterscheiden; Boersen verlangen oft ausdruecklich eine Memo ID.
function memoDisplay(row, t) {
  if (row.memoType === 'none' || !String(row.memoVal || '').trim()) return '';
  return `${String(row.memoVal).trim()} (${t(`batchPayment:memoTypes.${row.memoType}`)})`;
}

// Markierungen aus der eigenen Vertrauensliste. Geprueft werden Eingabe (auch
// Federation-Adresse), aufgeloeste Adresse und bei M-Adressen das Basis-G-Konto.
function flagsFor(map, addresses) {
  const infos = addresses.map((a) => findWalletInfo(map, a)).filter(Boolean);
  return { compromised: infos.some((i) => i.compromised), deactivated: infos.some((i) => i.deactivated) };
}

function FlagWarnings({ flags, t }) {
  if (!flags?.compromised && !flags?.deactivated) return null;
  return (
    <>
      {flags.compromised && <div className="text-red-600 dark:text-red-400 font-semibold" role="alert">{t('batchPayment:flags.compromised')}</div>}
      {flags.deactivated && <div className="text-amber-700 dark:text-amber-300 font-medium">{t('batchPayment:flags.deactivated')}</div>}
    </>
  );
}

function PaymentDetails({ item, t, labelOf }) {
  return (
    <div className="space-y-0.5 text-sm">
      <div>
        <span className="text-gray-600 dark:text-gray-400">{t('batchPayment:fields.source')}:</span>{' '}
        {labelOf(item.row.source) && <span className="font-medium">{labelOf(item.row.source)} </span>}
        <AddressCompare address={item.row.source.trim()} />
      </div>
      <div>
        <span className="text-gray-600 dark:text-gray-400">{t('batchPayment:fields.dest')}:</span>{' '}
        {item.federation && <span className="font-medium">{item.federation} </span>}
        {!item.federation && labelOf(item.destination || item.row.dest) && <span className="font-medium">{labelOf(item.destination || item.row.dest)} </span>}
        <AddressCompare address={item.destination || item.row.dest.trim()} />
        <FlagWarnings flags={item.flags} t={t} />
      </div>
      <div>
        <span className="text-gray-600 dark:text-gray-400">{t('batchPayment:fields.amount')}:</span>{' '}
        <span className="font-semibold">{normalizeAmount(item.row.amount)} {assetDisplay(item.row.assetKey)}</span>
        <span className="ml-3 text-gray-600 dark:text-gray-400">{t('batchPayment:fields.memo')}:</span>{' '}
        <span className="break-all">{memoDisplay(item.row, t) || '–'}</span>
      </div>
    </div>
  );
}

function HashLinks({ hash, links }) {
  if (!hash) return null;
  return (
    <div className="mt-1 space-y-1">
      <div className="text-xs"><span className="text-gray-600 dark:text-gray-400">TX:</span> <span className="font-mono break-all">{hash}</span></div>
      <div className="flex flex-wrap gap-2">
        {links.map((l) => (
          <a key={l.href} className={smallBtnCls} href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>
        ))}
      </div>
    </div>
  );
}

// Uhrzeit, ab der ein unklarer Status eindeutig werden kann (lokale Zeit; Datum nur,
// wenn es nicht heute ist).
function formatClearTime(ms) {
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString() : d.toLocaleString();
}

// Wartezeit nach maxTime plus Puffer bis zur automatischen Pruefung: ein bis zwei
// Ledger (je etwa 5 s), damit Horizon den entscheidenden Ledger schon kennt.
const AUTO_CHECK_MARGIN_MS = 10 * 1000;

// Restzeit als mm:ss (aufgerundete Sekunden).
function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

// Zeitpunkt der automatischen Pruefung: maxTime plus Puffer plus Marge. Haengt nur am
// gespeicherten maxTime, stimmt also auch nach Neuladen.
function autoCheckDue(entry) {
  const clearAt = ambiguousClearAt(entry);
  return clearAt ? clearAt + AUTO_CHECK_MARGIN_MS : null;
}

// Unklarer Status: Countdown bis zur automatischen Pruefung (Amber-Kasten), darunter klein
// die Uhrzeit, ab der der Status eindeutig werden kann, und "Status jetzt pruefen".
// check: { state, at } der letzten Pruefung (at = Beginn der Horizon-Abfrage).
function AmbiguousStatus({ entry, check, onCheck, t }) {
  const clearAt = ambiguousClearAt(entry);
  const due = autoCheckDue(entry);
  const [now, setNow] = useState(() => Date.now());
  const checking = check?.state === 'checking';
  const ticking = !!due && now < due;
  useEffect(() => {
    if (!due) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [due]);
  // Ergebnis einer Pruefung nach dem Zeitpunkt (automatisch, beim Pruefen der Liste oder per Button)
  const checkedAfterDue = !!due && Number(check?.at) >= due && !checking;
  let main;
  if (checking) main = t('batchPayment:ambiguous.checking');
  else if (ticking) main = t('batchPayment:ambiguous.countdown', { time: formatCountdown(due - now) });
  else if (!due) main = t('batchPayment:ambiguous.clearAtUnknown');
  else if (checkedAfterDue && check.state === 'pending') main = t('batchPayment:ambiguous.stillPending', { time: formatClearTime(clearAt) });
  else if (checkedAfterDue && check.state === 'unknown') main = t('batchPayment:ambiguous.unreachable');
  else main = t('batchPayment:ambiguous.checking');
  // Ergebnis einer Pruefung per Button vor dem Zeitpunkt: klein unter dem Countdown.
  const earlyResult = ticking && !checking && check && Number(check.at) < due ? check.state : '';
  // Unlesbarer Eintrag: kein Hash bekannt, Horizon kann nichts klaeren. Bleibt gesperrt.
  if (entry?.unreadable) {
    return (
      <div className="mt-1 text-xs" data-testid="batch-ambiguous-status">
        <div
          className="rounded-sm border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/30 px-2 py-1.5 text-sm font-medium text-amber-900 dark:text-amber-100"
          role="status"
          data-testid="batch-ambiguous-unreadable"
        >
          {t('batchPayment:ambiguous.unreadable')}
        </div>
      </div>
    );
  }
  return (
    <div className="mt-1 space-y-1 text-xs" data-testid="batch-ambiguous-status">
      <div
        className="rounded-sm border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/30 px-2 py-1.5 text-sm font-medium text-amber-900 dark:text-amber-100"
        role="status"
        data-testid="batch-ambiguous-countdown"
      >
        {main}
      </div>
      {clearAt && (
        <div className="text-gray-600 dark:text-gray-400" data-testid="batch-ambiguous-clear-at">
          {t('batchPayment:ambiguous.clearAt', { time: formatClearTime(clearAt) })}
        </div>
      )}
      {earlyResult === 'pending' && (
        <div className="text-amber-700 dark:text-amber-300">{t('batchPayment:ambiguous.stillPending', { time: formatClearTime(clearAt) })}</div>
      )}
      {earlyResult === 'unknown' && (
        <div className="text-amber-700 dark:text-amber-300">{t('batchPayment:ambiguous.unreachable')}</div>
      )}
      <button type="button" className={smallBtnCls} onClick={onCheck} disabled={checking}>
        {checking ? t('batchPayment:actions.checkingStatus') : t('batchPayment:actions.checkStatusNow')}
      </button>
    </div>
  );
}

// Diagnose-Text ohne Secrets und ohne lange Base64-Folgen (XDR); kurz gehalten.
function safeDiagText(value) {
  const text = String(value ?? '').slice(0, 300);
  if (containsSecretKey(text)) return '[entfernt]';
  return text.replace(/[A-Za-z0-9+/=]{56,}/g, '[…]');
}

// Diagnose eines unklaren Ausgangs fuer "Details kopieren" (eine Zeile pro Feld).
function diagnosticsLines(diag, t) {
  if (!diag) return [];
  const req = diag.request || {};
  const err = req.error || {};
  const lines = [t('batchPayment:diag.title')];
  lines.push(`  ${t('batchPayment:diag.request', { method: safeDiagText(req.method || 'POST'), url: safeDiagText(req.url || '?') })}`);
  lines.push(`  ${t('batchPayment:diag.time', { at: safeDiagText(req.at || '?'), ms: Number.isFinite(req.durationMs) ? req.durationMs : '?' })}`);
  const kind = err.status
    ? t('batchPayment:diag.httpStatus', { status: err.status, statusText: safeDiagText(err.statusText || '') }).trim()
    : t('batchPayment:diag.noResponse');
  lines.push(`  ${t('batchPayment:diag.error', { name: safeDiagText(err.name || '?'), message: safeDiagText(err.message || ''), kind })}`);
  lines.push(`  ${t('batchPayment:diag.env', { online: req.online === null || req.online === undefined ? '?' : String(req.online), visibility: safeDiagText(req.visibility || '?') })}`);
  lines.push(`  ${t('batchPayment:diag.requests', { run: diag.requestsInRun ?? '?', total: diag.requestsSinceOpen ?? '?' })}`);
  const lookups = Array.isArray(diag.lookups) ? diag.lookups : [];
  lines.push(`  ${t('batchPayment:diag.lookups', { count: lookups.length })}`);
  lookups.forEach((l, idx) => {
    let result;
    if (l.result === 'notFound') result = t('batchPayment:diag.lookupNotFound');
    else if (l.result === 'found') result = t('batchPayment:diag.lookupFound');
    else if (l.result === 'status') result = t('batchPayment:diag.lookupStatus', { status: l.status });
    else if (l.result === 'network') result = t('batchPayment:diag.lookupNetwork', { name: safeDiagText(l.name || '?'), message: safeDiagText(l.message || '') });
    else result = safeDiagText(l.result || '?');
    lines.push(`    ${idx + 1}. ${safeDiagText(l.at || '?')} ${result}`);
  });
  return lines;
}

/**
 * Sammelzahlung: mehrere Zahlungen von verschiedenen Konten nacheinander senden.
 * Ablauf: Bearbeiten -> Pruefen -> Senden -> Abschluss.
 * - Die Liste (ohne Secret Keys) wird pro Netz in localStorage gehalten.
 * - Das Sende-Protokoll (Fingerprint -> Hash, Status) wird vor und nach jedem Submit
 *   sofort geschrieben und vor jeder Zahlung frisch gelesen (Schutz gegen Doppelzahlung,
 *   auch ueber Unmount, Neuladen und zweiten Tab hinweg).
 * - Secret Keys werden vor der ersten Zahlung fuer alle Sender eingesammelt, nur fuer
 *   diesen Lauf im Speicher gehalten und danach verworfen.
 */
export default function BatchPaymentDialog({ onClose, onNetworkChangeClose }) {
  const { t } = useTranslation(['batchPayment', 'common']);
  const [network] = useState(() => readStoredNetworkId());
  // Explizites Netz: getHorizonServer(Mainnet-URL) liest das Netz sonst erneut aus localStorage.
  const server = useMemo(() => getHorizonServerForNetwork(network), [network]);
  // Horizon-Requests dieses Dialogs zaehlen (fuer die Diagnose bei unklarem Status): alle
  // seit dem Oeffnen und ab Beginn des Laufs. Zaehlt ueber den Request-Interceptor des SDK.
  const requestCountRef = useRef({ total: 0, runStart: 0 });
  useEffect(() => {
    const interceptors = server?.httpClient?.interceptors?.request;
    if (!interceptors?.use) return undefined;
    const id = interceptors.use((config) => { requestCountRef.current.total += 1; return config; });
    return () => { try { interceptors.eject?.(id); } catch { /* noop */ } };
  }, [server]);
  const { recentWalletOptions } = useRecentWalletOptions();
  const { wallets } = useTrustedWallets();
  const { explorers } = useSettings();
  const walletInfoMap = useMemo(() => createWalletInfoMap(wallets), [wallets]);
  const labelOf = useCallback((addr) => findWalletInfo(walletInfoMap, addr)?.label || '', [walletInfoMap]);
  const editFlagsOf = useCallback((addr) => flagsFor(walletInfoMap, [addr]), [walletInfoMap]);
  const addressOptions = useMemo(
    () => recentWalletOptions.filter((o) => (network === 'TESTNET') === !!o.isTestnet),
    [recentWalletOptions, network]
  );

  const mountedRef = useRef(true);
  // Offene Key-Abfrage beim Unmount mit null aufloesen, damit der Lauf sauber endet.
  const secretResolveRef = useRef(null);
  // Abbruch des Wartens auf einen anderen laufenden Sendevorgang (Button oder Unmount).
  const lockAbortRef = useRef(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      lockAbortRef.current?.abort();
      const resolve = secretResolveRef.current;
      secretResolveRef.current = null;
      resolve?.(null);
    };
  }, []);

  const [rows, setRows] = useState(() => {
    const stored = loadBatchRows(network);
    return stored.length ? stored : [createEmptyRow()];
  });
  useEffect(() => { saveBatchRows(network, rows); }, [network, rows]);

  const [phase, setPhase] = useState('edit'); // edit | checking | review | sending | done
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // Netzwechsel (eigener Tab oder anderer Tab, beides als stm-network-changed): Der Dialog
  // gehoert fest zu dem Netz, mit dem er geoeffnet wurde. Ohne aktiven Lauf schliessen
  // (Elternseite zeigt den Hinweis). Mit aktivem Lauf die laufende Zahlung zu Ende gehen
  // lassen und danach ueber stopReason stoppen; keine weitere Zahlung. Die gespeicherte
  // Liste dieses Netzes bleibt erhalten.
  const networkChangedRef = useRef(false);
  const [networkStopped, setNetworkStopped] = useState(false);
  const onNetworkChangeCloseRef = useRef(onNetworkChangeClose);
  onNetworkChangeCloseRef.current = onNetworkChangeClose;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const handler = (e) => {
      if (networkFromEvent(e) === network) return;
      if (phaseRef.current === 'sending') {
        networkChangedRef.current = true;
        setNetworkStopped(true);
        // Offene Key-Abfrage oder Warten auf einen anderen Lauf beenden: noch nichts gesendet.
        const resolve = secretResolveRef.current;
        secretResolveRef.current = null;
        if (resolve) { setSecretPrompt(null); resolve(null); }
        lockAbortRef.current?.abort();
        return;
      }
      (onNetworkChangeCloseRef.current || onCloseRef.current)?.();
    };
    window.addEventListener(NETWORK_CHANGED_EVENT, handler);
    return () => window.removeEventListener(NETWORK_CHANGED_EVENT, handler);
  }, [network]);
  const [inputErrors, setInputErrors] = useState({});
  const [review, setReview] = useState(null);
  const [results, setResults] = useState({});
  const [secretPrompt, setSecretPrompt] = useState(null); // { source, account, resolve }
  const [secretError, setSecretError] = useState('');
  const [generalError, setGeneralError] = useState('');
  const [copied, setCopied] = useState(false);
  const [waitingForLock, setWaitingForLock] = useState(false);
  // Pruefung unklarer Zahlungen pro Zeile: { state: checking | pending | unknown | notSent | success }
  const [ambiguousChecks, setAmbiguousChecks] = useState({});
  const autoCheckedRef = useRef(new Set());
  const checkingRef = useRef(new Set());
  const reviewRef = useRef(review);
  reviewRef.current = review;
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const locked = phase !== 'edit';

  // Trustlines der Sender fuer die Asset-Auswahl (nur lesend, pro Adresse einmal geladen).
  const [sourceAccounts, setSourceAccounts] = useState({});
  const requestedSourcesRef = useRef(new Set());
  useEffect(() => {
    const sources = [...new Set(rows.map((r) => r.source.trim()).filter((s) => StrKey.isValidEd25519PublicKey(s)))];
    sources.forEach((s) => {
      if (requestedSourcesRef.current.has(s)) return;
      requestedSourcesRef.current.add(s);
      server.loadAccount(s)
        .then((acc) => { if (mountedRef.current) setSourceAccounts((prev) => ({ ...prev, [s]: acc })); })
        .catch(() => { requestedSourcesRef.current.delete(s); });
    });
  }, [rows, server]);

  const assetOptionsFor = useCallback((row) => {
    const opts = [{ key: 'XLM', label: 'XLM' }];
    const acc = sourceAccounts[row.source.trim()];
    for (const b of acc?.balances || []) {
      if (b.asset_type === 'native' || b.asset_type === 'liquidity_pool_shares') continue;
      const key = `${b.asset_code}:${b.asset_issuer}`;
      opts.push({ key, label: assetDisplay(key) });
    }
    if (!opts.some((o) => o.key === row.assetKey)) opts.push({ key: row.assetKey, label: assetDisplay(row.assetKey) });
    return opts;
  }, [sourceAccounts]);

  const txExplorers = useMemo(() => {
    const list = explorers || [];
    return {
      stellarExpert: list.find((e) => (e.key || e.id) === 'stellar_expert') || null,
      stellarchain: list.find((e) => (e.key || e.id) === 'stellarchain') || null,
      fallback: list[0] || null,
    };
  }, [explorers]);
  const explorerLinks = useCallback((hash) => {
    if (!hash) return [];
    const links = [
      { href: buildExplorerUrl(txExplorers.stellarExpert, hash, network, { type: 'tx' }), label: t('common:balance.explorer.expert', 'stellar.expert') },
      { href: buildExplorerUrl(txExplorers.stellarchain, hash, network, { type: 'tx' }), label: t('common:balance.explorer.stellarchain', 'Stellarchain.io') },
    ].filter((l) => l.href);
    if (!links.length && txExplorers.fallback) {
      const href = buildExplorerUrl(txExplorers.fallback, hash, network, { type: 'tx' });
      if (href) links.push({ href, label: txExplorers.fallback.name || txExplorers.fallback.label || 'Explorer' });
    }
    return links;
  }, [txExplorers, network, t]);

  const updateRow = (id, patch) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setInputErrors((prev) => (prev[id] ? { ...prev, [id]: null } : prev));
  };
  const addRow = () => setRows((prev) => (prev.length >= MAX_ROWS ? prev : [...prev, createEmptyRow()]));
  const duplicateRow = (row) => setRows((prev) => {
    if (prev.length >= MAX_ROWS) return prev;
    const idx = prev.findIndex((r) => r.id === row.id);
    const copy = createEmptyRow({ source: row.source, assetKey: row.assetKey, memoType: row.memoType });
    return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
  });
  const removeRow = (id) => setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : [createEmptyRow()]));
  const moveRow = (id, dir) => setRows((prev) => {
    const idx = prev.findIndex((r) => r.id === id);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= prev.length) return prev;
    const next = [...prev];
    [next[idx], next[to]] = [next[to], next[idx]];
    return next;
  });

  const errorText = useCallback((code, params) => t(`batchPayment:errors.${code}`, params || {}), [t]);

  // Eintrag lesen und einen unklaren Status ueber Horizon aufloesen (und speichern).
  // outcome: success | failed | expired | pending | unknown oder null, wenn nichts
  // aufzuloesen war. Nicht ausgefuehrt wird als 'notApplied' vermerkt (nicht geloescht),
  // bei noch freier Sequence mit Pin. Ein fehlender Eintrag entsteht so nie durch eine
  // Aufloesung. cache (Map Hash -> Ergebnis): Haupt- und Routing-Eintrag mit demselben
  // Hash nur einmal bei Horizon pruefen.
  const resolveEntry = async (fp, cache = null) => {
    let entry = readSentEntry(network, fp);
    if (entry?.status !== 'ambiguous' || entry.unreadable) return { entry, outcome: null };
    let res = cache?.get(entry.hash);
    if (!res) {
      res = await resolveAmbiguousDetailed({ server, entry });
      cache?.set(entry.hash, res);
    }
    // Nur den eben geprueften Eintrag aendern: Ein anderer Tab kann inzwischen einen
    // neuen Eintrag geschrieben (oder diesen schon aufgeloest) haben.
    const current = readSentEntry(network, fp);
    if (current?.hash !== entry.hash || current.status !== 'ambiguous') return { entry: current, outcome: null };
    const { outcome } = res;
    if (outcome === 'success') {
      entry = { hash: res.hash || entry.hash, at: entry.at, status: 'success', maxTime: entry.maxTime, seq: entry.seq, source: entry.source };
      writeSentEntry(network, fp, entry);
    } else if (outcome === 'failed' || outcome === 'expired' || outcome === 'expiredPinned') {
      entry = { ...entry, status: 'notApplied', pin: outcome === 'expiredPinned' };
      writeSentEntry(network, fp, entry);
    }
    return { entry, outcome: outcome === 'expiredPinned' ? 'expired' : outcome };
  };

  // Unklare Eintraege, die in diesem Dialog verschwunden sind (Website-Daten geloescht,
  // Speicher aufgeraeumt): Fingerprint -> zuletzt bekannter Eintrag. Vor dem Senden sucht
  // SKM dann bei Horizon nach der Zahlung (letzte 24 h).
  const missingRef = useRef(new Map());

  const handleCheck = async () => {
    setGeneralError('');
    setAmbiguousChecks({});
    autoCheckedRef.current.clear();
    const errs = {};
    rows.forEach((r) => { const c = validateRowInput(r); if (c) errs[r.id] = c; });
    setInputErrors(errs);
    if (Object.keys(errs).length) return;

    setPhase('checking');
    pruneSentLog();
    try {
      const snapshot = rows.map((r) => ({ ...r }));
      const accounts = new Map();
      const sourceCodes = new Map();
      for (const source of new Set(snapshot.map((r) => r.source.trim()))) {
        try {
          const acc = await server.loadAccount(source);
          accounts.set(source, acc);
          sourceCodes.set(source, checkSourceAccount(acc));
        } catch (e) {
          sourceCodes.set(source, e?.response?.status === 404 ? 'sourceNotFound' : 'sourceLoadFailed');
        }
      }
      let baseReserveStroops = 5000000n;
      // Zeit des Netzes (closed_at des letzten Ledgers) fuer die Suche bei fehlendem Eintrag.
      let ledgerClosedSec = NaN;
      try {
        const ledgers = await server.ledgers().order('desc').limit(1).call();
        const br = Number(ledgers?.records?.[0]?.base_reserve_in_stroops);
        if (Number.isInteger(br) && br > 0) baseReserveStroops = BigInt(br);
        ledgerClosedSec = Date.parse(ledgers?.records?.[0]?.closed_at) / 1000;
      } catch { /* Standardwert */ }
      const resolveCache = new Map();
      let feeStroops = 100;
      try { feeStroops = Number(await resolveFeePerOp(server, { deferred: false })) || 100; } catch { /* Standardwert */ }

      const items = [];
      const checksAtLoad = {};
      const seen = new Set();
      const seenRoutes = new Set();
      for (const row of snapshot) {
        const sourceCode = sourceCodes.get(row.source.trim());
        let check = sourceCode ? { code: sourceCode } : await checkRowOnNetwork({ server, row });
        let fp = '';
        let recent = null;
        let similar = null;
        if (!check.code) {
          fp = paymentFingerprint({ network, row, destination: check.destination });
          const routeFpCheck = routingFingerprint({ network, row, destination: check.destination });
          if (seen.has(fp)) {
            check = { ...check, code: 'duplicateInList' };
          } else if (routeFpCheck && seenRoutes.has(routeFpCheck)) {
            check = { ...check, code: 'duplicateRouteInList' };
          } else {
            seen.add(fp);
            const checkedAt = Date.now();
            const mainResolved = await resolveEntry(fp, resolveCache);
            recent = recentSendOf(mainResolved.entry);
            let lastOutcome = mainResolved.outcome;
            let routeResolved = null;
            if (!recent) {
              // Gleiche Zahlung in anderer Form (M-Adresse gegen G plus Memo ID)? Gesendet:
              // Warnung. Unklar: Sperre wie beim Haupteintrag.
              routeResolved = routeFpCheck ? await resolveEntry(routeFpCheck, resolveCache) : null;
              similar = routeResolved ? recentSendOf(routeResolved.entry) : null;
              if (routeResolved?.outcome) lastOutcome = routeResolved.outcome;
            }
            // Ein unklarer Eintrag ist in diesem Dialog verschwunden: Vor dem Senden bei
            // Horizon nach der Zahlung suchen. Treffer: wie bereits gesendet. Kein Treffer:
            // normale Zahlung (mit Pin der frueheren Sequence, falls bekannt). Horizon nicht
            // erreichbar: nicht senden.
            const missingKey = [fp, routeFpCheck].find((k) => k && missingRef.current.has(k));
            if (!recent && !similar && !mainResolved.entry && !routeResolved?.entry && missingKey) {
              const remembered = missingRef.current.get(missingKey) || {};
              const forget = () => { missingRef.current.delete(fp); if (routeFpCheck) missingRef.current.delete(routeFpCheck); };
              const maxTime = Number(remembered.maxTime);
              const stillValid = Number.isInteger(maxTime) && maxTime > 0
                && !(Number.isFinite(ledgerClosedSec) && ledgerClosedSec > maxTime + AMBIGUOUS_LEDGER_BUFFER_SECONDS);
              if (stillValid) {
                check = { ...check, code: 'logMissingPending' };
              } else {
                const nowMs = Number.isFinite(ledgerClosedSec) ? ledgerClosedSec * 1000 : Date.now();
                const hit = await findRecentMatchingPayment({ server, row, destination: check.destination, nowMs });
                if (hit.status === 'found') {
                  writeSentEntry(network, fp, { hash: hit.hash, at: hit.at, status: 'success' });
                  recent = recentSendOf(readSentEntry(network, fp)) || { hash: hit.hash, at: hit.at, status: 'success' };
                  forget();
                } else if (hit.status === 'none') {
                  if (remembered.hash) {
                    const pin = !!(remembered.seq && remembered.source);
                    writeSentEntry(network, fp, {
                      hash: remembered.hash, at: Number(remembered.at) || Date.now(), status: 'notApplied',
                      maxTime: remembered.maxTime, seq: remembered.seq, source: remembered.source, prev: remembered.prev, pin,
                    });
                  }
                  forget();
                } else {
                  check = { ...check, code: 'historyCheckFailed' };
                }
              }
            }
            // Noch unklar: Ergebnis dieser Abfrage merken (Countdown zeigt es nach Ablauf).
            if (recent?.status === 'ambiguous' || similar?.status === 'ambiguous') {
              checksAtLoad[row.id] = { state: lastOutcome === 'pending' ? 'pending' : 'unknown', at: checkedAt };
            }
          }
        }
        // Kompromittierte oder deaktivierte Empfaenger nicht vorwaehlen, nur bewusst auswaehlbar.
        const flags = flagsFor(walletInfoMap, [row.dest, check.destination, check.accountId]);
        const flagged = flags.compromised || flags.deactivated;
        // Routing-Dublette nur gegen Zeilen, die tatsaechlich zum Senden vorgewaehlt sind.
        const routeForSeen = !check.code ? routingFingerprint({ network, row, destination: check.destination }) : null;
        if (routeForSeen && !recent && !similar && !flagged) seenRoutes.add(routeForSeen);
        items.push({
          row,
          code: check.code,
          params: check.params,
          destination: check.destination,
          federation: check.federation || '',
          fp,
          recent,
          similar,
          flags,
          include: !check.code && !recent && !similar && !flagged,
        });
      }
      if (!mountedRef.current) return;
      setAmbiguousChecks(checksAtLoad);
      setReview({ items, accounts, baseReserveStroops, feeStroops });
      setPhase('review');
    } catch (e) {
      if (!mountedRef.current) return;
      setGeneralError(String(e?.message || e));
      setPhase('edit');
    }
  };

  // "Erneut senden" im Ergebnis: neue Pruefung derselben Liste. Die nicht gesendete Zahlung
  // ist dann wieder bereit, bereits gesendete sind nicht vorgewaehlt.
  const resendFromDone = () => {
    sendStartedRef.current = false;
    setReview(null);
    setResults({});
    setPhase('edit');
    handleCheck();
  };

  const isBlocked = (i) => !!i.code || i.recent?.status === 'ambiguous' || i.similar?.status === 'ambiguous';
  const includedItems = useMemo(() => (review?.items || []).filter((i) => i.include && !i.code), [review]);
  const totals = useMemo(() => {
    if (!review) return new Map();
    return computeSourceTotals({
      rows: includedItems.map((i) => i.row),
      accounts: review.accounts,
      baseReserveStroops: review.baseReserveStroops,
      feeStroops: review.feeStroops,
    });
  }, [review, includedItems]);
  const allTotalsOk = [...totals.values()].every((x) => x.ok);

  // Unklarer Status ist hart gesperrt, ein bereits erfolgreich gesendeter darf bewusst
  // wieder ausgewaehlt werden.
  const toggleInclude = (id) => setReview((prev) => ({
    ...prev,
    items: prev.items.map((i) => (i.row.id === id && !isBlocked(i) ? { ...i, include: !i.include } : i)),
  }));
  const selectForResend = (id) => setReview((prev) => ({
    ...prev,
    items: prev.items.map((i) => (i.row.id === id && !isBlocked(i) ? { ...i, include: true } : i)),
  }));

  // Unklare Zahlung erneut ueber Horizon pruefen (Button oder automatisch nach Ablauf).
  // Gesperrt bleibt sie, solange Horizon nicht eindeutig ist; freigegeben wird nur, was
  // resolveAmbiguous als expired/failed meldet (Eintrag geloescht), nie manuell.
  const recheckAmbiguous = async (id) => {
    const phaseNow = phaseRef.current;
    if ((phaseNow !== 'review' && phaseNow !== 'done') || checkingRef.current.has(id)) return;
    const item = reviewRef.current?.items.find((i) => i.row.id === id);
    if (!item?.fp) return;
    // Zuletzt bekannter unklarer Eintrag (fuer den Fall, dass er gleich fehlt).
    const expected = phaseNow === 'done'
      ? resultsRef.current?.[id]
      : (item.recent?.status === 'ambiguous' ? item.recent : item.similar);
    checkingRef.current.add(id);
    const at = Date.now();
    setAmbiguousChecks((prev) => ({ ...prev, [id]: { state: 'checking', at } }));
    try {
      const routeFp = routingFingerprint({ network, row: item.row, destination: item.destination });
      const cache = new Map();
      const main = await resolveEntry(item.fp, cache);
      const route = routeFp && routeFp !== item.fp ? await resolveEntry(routeFp, cache) : null;
      if (!mountedRef.current) return;
      const outcomes = [main.outcome, route?.outcome].filter(Boolean);
      const mainRecent = recentSendOf(main.entry);
      const routeRecent = route ? recentSendOf(route.entry) : null;
      const entries = [main.entry, route?.entry].filter(Boolean);
      let state;
      if (mainRecent?.status === 'ambiguous' || routeRecent?.status === 'ambiguous') {
        state = outcomes.includes('unknown') ? 'unknown' : 'pending';
      } else if (outcomes.includes('success') || (!outcomes.length && entries.some((e) => e.status === 'success'))) {
        state = 'success';
      } else if (outcomes.includes('expired') || outcomes.includes('failed') || entries.some((e) => e.status === 'notApplied')) {
        // Nur eine Aufloesung ueber Horizon (hier oder in einem anderen Tab) schreibt notApplied.
        state = 'notSent';
      } else {
        // Kein Eintrag mehr da, ohne dass Horizon gefragt wurde: kein "laut Horizon", kein
        // Erneut senden. Vor dem naechsten Senden sucht SKM bei Horizon nach der Zahlung.
        state = 'logMissing';
        const remembered = expected?.hash ? {
          hash: expected.hash, at: expected.at, maxTime: expected.maxTime, seq: expected.seq, source: expected.source, prev: expected.prev,
        } : {};
        missingRef.current.set(item.fp, remembered);
        if (routeFp) missingRef.current.set(routeFp, remembered);
      }
      setAmbiguousChecks((prev) => ({ ...prev, [id]: { state, at } }));
      if (phaseRef.current === 'review') {
        setReview((prev) => (prev ? {
          ...prev,
          items: prev.items.map((i) => {
            if (i.row.id !== id) return i;
            if (state === 'logMissing') return { ...i, recent: null, similar: null, code: 'logMissing', include: false };
            return { ...i, recent: mainRecent, similar: mainRecent ? null : routeRecent };
          }),
        } : prev));
      } else if (phaseRef.current === 'done' && (state === 'success' || state === 'notSent' || state === 'logMissing')) {
        setResults((prev) => {
          const r = prev[id];
          if (!r || (r.status !== 'ambiguous' && r.status !== 'maybeSent')) return prev;
          let next;
          if (state === 'success') next = { ...r, status: 'success', message: t('batchPayment:ambiguous.resolvedSent') };
          else if (state === 'notSent') next = { ...r, status: 'notSent', message: t('batchPayment:ambiguous.resolvedNotSent') };
          else next = { ...r, status: 'logMissing', message: '' };
          return { ...prev, [id]: next };
        });
      }
    } catch {
      if (mountedRef.current) setAmbiguousChecks((prev) => ({ ...prev, [id]: { state: 'unknown', at } }));
    } finally {
      checkingRef.current.delete(id);
    }
  };
  const recheckRef = useRef(recheckAmbiguous);
  recheckRef.current = recheckAmbiguous;

  // Zum Zeitpunkt des Countdowns (maxTime plus Puffer plus Marge) einmal automatisch
  // pruefen, solange der Dialog offen und die Zeile unklar ist. Entfaellt, wenn nach diesem
  // Zeitpunkt schon gefragt wurde (z.B. beim Pruefen der Liste nach dem Neuladen).
  const autoTargets = useMemo(() => {
    let list = [];
    if (phase === 'review') {
      list = (review?.items || [])
        .filter((i) => !i.code && (i.recent?.status === 'ambiguous' || i.similar?.status === 'ambiguous'))
        .map((i) => ({ id: i.row.id, due: autoCheckDue(i.recent?.status === 'ambiguous' ? i.recent : i.similar) }));
    } else if (phase === 'done') {
      list = Object.entries(results)
        .filter(([, r]) => r?.status === 'ambiguous' || r?.status === 'maybeSent')
        .map(([id, r]) => ({ id, due: autoCheckDue(r) }));
    }
    return list.filter((x) => x.due && !(Number(ambiguousChecks[x.id]?.at) >= x.due));
  }, [phase, review, results, ambiguousChecks]);
  const autoKey = autoTargets.map((x) => `${x.id}:${x.due}`).join('|');
  useEffect(() => {
    const timers = [];
    const now = Date.now();
    for (const { id, due } of autoTargets) {
      if (autoCheckedRef.current.has(id)) continue;
      timers.push(setTimeout(() => {
        autoCheckedRef.current.add(id);
        recheckRef.current(id);
      }, Math.max(0, due - now)));
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- autoKey fasst autoTargets zusammen
  }, [autoKey]);

  // Master Key des Senders: aus der Session oder per Dialog. null = abgebrochen.
  const obtainKeypair = useCallback(async (source, account) => {
    try {
      const saved = await getSessionSecret(source, source);
      if (saved) {
        const kp = Keypair.fromSecret(saved);
        if (kp.publicKey() === source) return kp;
      }
    } catch { /* dann per Dialog */ }
    if (!mountedRef.current) return null;
    // Netz gewechselt, waehrend die Session-Secrets gelesen wurden: Lauf ist gestoppt,
    // also nicht mehr nach einem Secret Key fragen.
    if (networkChangedRef.current) return null;
    setSecretError('');
    return new Promise((resolve) => {
      const once = (value) => { secretResolveRef.current = null; resolve(value); };
      secretResolveRef.current = once;
      setSecretPrompt({ source, account, resolve: once });
    });
  }, []);

  const handleSecretConfirm = async (collected, remember) => {
    const prompt = secretPrompt;
    if (!prompt) return;
    const entry = (collected || []).find((c) => c?.publicKey === prompt.source);
    if (!entry) {
      setSecretError(t('batchPayment:errors.keyMismatch'));
      return;
    }
    setSecretPrompt(null);
    prompt.resolve(entry.keypair);
    if (remember) {
      try { await rememberSessionSecrets(prompt.source, [entry]); } catch { /* Senden geht trotzdem */ }
    }
  };
  const handleSecretCancel = () => {
    const prompt = secretPrompt;
    setSecretPrompt(null);
    prompt?.resolve(null);
  };

  const sendStartedRef = useRef(false);
  const handleSend = async () => {
    // Schutz gegen Doppelklick: ein Lauf pro Pruefung.
    if (sendStartedRef.current || !includedItems.length || !allTotalsOk) return;
    setGeneralError('');
    if (!isStorageWritable()) {
      setGeneralError(errorText('storageUnavailable'));
      return;
    }
    sendStartedRef.current = true;
    requestCountRef.current.runStart = requestCountRef.current.total;
    // Zahlungen, die mit der Sequence einer frueheren, nicht ausgefuehrten Transaktion
    // gesendet werden muessen (Pin), zuerst und nach Sequence: Eine andere Zahlung desselben
    // Kontos in diesem Lauf wuerde die Sequence sonst vorher verbrauchen.
    const pinSeqOf = (item) => {
      const routeFp = routingFingerprint({ network, row: item.row, destination: item.destination });
      const e = [readSentEntry(network, item.fp), routeFp ? readSentEntry(network, routeFp) : null]
        .find((x) => x?.status === 'notApplied' && x.pin);
      return e ? BigInt(e.seq) : null;
    };
    const pinSeqs = new Map(includedItems.map((i) => [i.row.id, pinSeqOf(i)]));
    const items = [...includedItems].sort((x, y) => {
      const a = pinSeqs.get(x.row.id);
      const b = pinSeqs.get(y.row.id);
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const setResult = (id, value) => { if (mountedRef.current) setResults((prev) => ({ ...prev, [id]: value })); };
    setResults(Object.fromEntries(items.map((i) => [i.row.id, { status: 'pending' }])));
    setPhase('sending');
    const keys = new Map();
    let stopReason = '';
    try {
      // 1. Alle Keys vor der ersten Zahlung, damit ein Abbruch nichts halb sendet.
      for (const source of new Set(items.map((i) => i.row.source.trim()))) {
        const kp = await obtainKeypair(source, review.accounts.get(source));
        if (!kp) { stopReason = networkChangedRef.current ? 'networkChanged' : (mountedRef.current ? 'cancelled' : 'aborted'); break; }
        if (networkChangedRef.current) { stopReason = 'networkChanged'; break; }
        keys.set(source, kp);
      }
      const keysOk = !stopReason;

      // 2. Zahlungen nacheinander, pro Netz exklusiv (anderer Tab wartet, abbrechbar).
      const controller = new AbortController();
      lockAbortRef.current = controller;
      const runRows = async (lock) => {
        if (mountedRef.current) setWaitingForLock(false);
        for (const item of items) {
          const { row } = item;
          if (!stopReason && !mountedRef.current) stopReason = 'aborted';
          // Netz gewechselt: keine weitere Zahlung (die laufende ist schon fertig).
          if (!stopReason && networkChangedRef.current) stopReason = 'networkChanged';
          // Lock vor jeder Zahlung erneuern; ging er verloren (Tab gedrosselt oder
          // eingefroren, anderer Tab hat uebernommen), sofort stoppen.
          if (!stopReason && !lock.touch()) stopReason = 'lockLost';
          if (stopReason) { setResult(row.id, { status: 'skipped', message: errorText(stopReason) }); continue; }

          const routeFp = routingFingerprint({ network, row, destination: item.destination });
          // Sperrt das Protokoll diese Zahlung (inzwischen gesendet oder unklar)? Bewusst
          // bestaetigt sind nur die Eintraege, die in der Pruefung angezeigt wurden.
          const blockReason = () => {
            // Eintrag in diesem Dialog verschwunden und noch nicht bei Horizon gesucht.
            if (missingRef.current.has(item.fp) || (routeFp && missingRef.current.has(routeFp))) return 'logMissing';
            const main = recentSendOf(readSentEntry(network, item.fp));
            const mainOk = !main || (main.status === 'success' && item.recent && main.hash === item.recent.hash && main.at === item.recent.at);
            if (!mainOk) return main.status === 'ambiguous' ? 'blockedAmbiguous' : 'sentMeanwhile';
            const route = routeFp ? recentSendOf(readSentEntry(network, routeFp)) : null;
            const routeOk = !route || route.hash === main?.hash
              || (route.status === 'success' && item.similar && route.hash === item.similar.hash && route.at === item.similar.at);
            if (!routeOk) return route.status === 'ambiguous' ? 'blockedAmbiguous' : 'sentMeanwhile';
            return '';
          };
          const firstBlock = blockReason();
          if (firstBlock) { setResult(row.id, { status: 'skipped', message: errorText(firstBlock) }); continue; }

          setResult(row.id, { status: 'sending' });
          const source = row.source.trim();
          const before = readSentEntry(network, item.fp);
          const routeBefore = routeFp ? readSentEntry(network, routeFp) : null;
          // Fruehere, laut Horizon nicht ausgefuehrte Transaktion dieser Zahlung (Haupt- oder
          // Routing-Eintrag). Mit Pin wird genau ihre Sequence wiederverwendet.
          const earlier = [before, routeBefore].find((e) => e?.status === 'notApplied') || null;
          const prevHashes = earlier ? [earlier.hash, ...(earlier.prev || [])] : undefined;
          // Nur dort zuruecksetzen bzw. ueberschreiben, wo noch der eigene Eintrag steht.
          const writeOwn = (ownHash, entry) => {
            if (readSentEntry(network, item.fp)?.hash === ownHash) writeSentEntry(network, item.fp, entry);
            if (routeFp && readSentEntry(network, routeFp)?.hash === ownHash) writeSentEntry(network, routeFp, entry);
          };
          // Die fruehere Transaktion wieder als unklar fuehren (strenge Pruefung beim Aufloesen).
          const earlierAsAmbiguous = () => ({
            hash: earlier.hash, at: earlier.at, status: 'ambiguous', maxTime: earlier.maxTime,
            seq: earlier.seq, source: earlier.source, prev: earlier.prev,
          });
          let hash = '';
          let maxTime;
          let seq;
          let pinned = false;
          let wroteOwn = false;
          try {
            const loaded = await server.loadAccount(source);
            let account = loaded;
            if (earlier?.pin) {
              const p = pinnedSendAccount({ account: loaded, source, pinSeq: earlier.seq });
              if (p.consumed) {
                // Sequence inzwischen verbraucht: Die neue Transaktion koennte neben der
                // frueheren ausgefuehrt werden. Nicht senden, frueheren Status erneut pruefen.
                if (readSentEntry(network, item.fp)?.hash === earlier.hash) writeSentEntry(network, item.fp, earlierAsAmbiguous());
                if (routeFp && readSentEntry(network, routeFp)?.hash === earlier.hash) writeSentEntry(network, routeFp, earlierAsAmbiguous());
                setResult(row.id, { status: 'skipped', message: errorText('pinConsumed') });
                continue;
              }
              account = p.account;
              pinned = true;
            }
            const tx = buildSignedRowTx({
              account, row, destination: item.destination, fee: review.feeStroops,
              networkPassphrase: passphraseFor(network), keypair: keys.get(source),
            });
            hash = txHashHex(tx);
            maxTime = Number(tx.timeBounds?.maxTime);
            seq = String(tx.sequence);
            // Unmittelbar vor dem Schreiben erneut pruefen (Fenster nur noch Mikrosekunden).
            if (!lock.isHeld()) {
              stopReason = 'lockLost';
              setResult(row.id, { status: 'skipped', message: errorText(stopReason) });
              continue;
            }
            const lateBlock = blockReason();
            if (lateBlock) { setResult(row.id, { status: 'skipped', message: errorText(lateBlock) }); continue; }
            // Wechsel waehrend Konto laden/Bauen: diese Zahlung ist noch nicht gesendet, also
            // auch sie nicht mehr senden.
            if (networkChangedRef.current) {
              stopReason = 'networkChanged';
              setResult(row.id, { status: 'skipped', message: errorText(stopReason) });
              continue;
            }
            // Vor dem Submit als unklar vermerken (Haupt- und Routing-Eintrag) und
            // zuruecklesen: Bricht der Tab jetzt ab, bleibt die Zahlung gesperrt, bis
            // Horizon den Ausgang zeigt. Steht danach ein fremder Hash dort, sendet gerade
            // ein anderer Lauf.
            // Mit Sequence und Quellkonto (fuer die Aufloesung und einen Pin beim erneuten
            // Senden) und den Hashes frueherer Versuche dieser Zahlung.
            const pending = { hash, at: Date.now(), status: 'ambiguous', maxTime, seq, source, prev: prevHashes };
            const written = writeSentEntry(network, item.fp, pending)
              && (!routeFp || writeSentEntry(network, routeFp, pending));
            const own = readSentEntry(network, item.fp)?.hash === hash
              && (!routeFp || readSentEntry(network, routeFp)?.hash === hash);
            if (!written || !own) {
              // Eigene Teil-Eintraege zuruecknehmen, sonst haengt die Zahlung als "unklar"
              // mit einem Hash, der nie gesendet wurde.
              if (readSentEntry(network, item.fp)?.hash === hash) writeSentEntry(network, item.fp, before);
              if (routeFp && readSentEntry(network, routeFp)?.hash === hash) writeSentEntry(network, routeFp, routeBefore);
              stopReason = written ? 'concurrentRun' : 'storageUnavailable';
              setResult(row.id, { status: 'skipped', message: errorText(stopReason) });
              continue;
            }
            wroteOwn = true;
            await submitTransactionSafely(server, tx);
            const done = { hash, at: Date.now(), status: 'success', maxTime, seq, source };
            const savedMain = readSentEntry(network, item.fp)?.hash === hash && writeSentEntry(network, item.fp, done);
            const savedRoute = !routeFp || (readSentEntry(network, routeFp)?.hash === hash && writeSentEntry(network, routeFp, done));
            setResult(row.id, { status: 'success', hash, message: savedMain && savedRoute ? '' : errorText('logNotUpdated') });
          } catch (err) {
            if (err instanceof AmbiguousSubmitResultError) {
              // Ursache anzeigen (HTTP-Status oder Netzfehler), damit nachvollziehbar ist,
              // warum der Ausgang offen blieb. Enthaelt keine Secrets.
              const cause = err.cause;
              const causeText = cause?.response?.status
                ? `HTTP ${cause.response.status}${cause.response.statusText ? ` ${cause.response.statusText}` : ''}`
                : String(cause?.message || cause || '').slice(0, 200);
              const counts = requestCountRef.current;
              const diag = {
                ...(err.diagnostics || {}),
                requestsInRun: counts.total - counts.runStart,
                requestsSinceOpen: counts.total,
              };
              setResult(row.id, {
                status: 'ambiguous', hash: err.hash || hash, message: causeText, maxTime, seq, source, prev: prevHashes, at: Date.now(), diag,
              });
              stopReason = 'stoppedAmbiguous';
            } else if (pinned && wroteOwn && isBadSeqError(err)) {
              // Das Netz lehnt die gespeicherte Sequence ab: Sie ist inzwischen verbraucht,
              // vermutlich von der frueheren Transaktion. Nicht erneut versuchen, sondern als
              // moeglicherweise gesendet fuehren und nach den frueheren Hashes suchen.
              const back = earlierAsAmbiguous();
              setResult(row.id, { ...back, status: 'maybeSent', message: errorText('badSeqMaybeSent') });
              const foundEarlier = await findAnyTransaction({ server, hashes: prevHashes });
              if (foundEarlier.result === 'success') {
                writeOwn(hash, { hash: foundEarlier.hash, at: earlier.at, status: 'success', maxTime: earlier.maxTime, seq: earlier.seq, source: earlier.source });
                setResult(row.id, { status: 'success', hash: foundEarlier.hash, message: t('batchPayment:ambiguous.sentEarlier') });
              } else {
                // Ausgang offen: wie nach einem unklaren Ergebnis den Lauf stoppen.
                writeOwn(hash, back);
                stopReason = 'stoppedAmbiguous';
              }
            } else {
              // Eindeutig fehlgeschlagen: vorherigen Stand wiederherstellen, aber nur, wo
              // im Protokoll noch unser eigener Eintrag steht.
              if (wroteOwn) {
                if (readSentEntry(network, item.fp)?.hash === hash) writeSentEntry(network, item.fp, before);
                if (routeFp && readSentEntry(network, routeFp)?.hash === hash) writeSentEntry(network, routeFp, routeBefore);
              }
              setResult(row.id, { status: 'failed', hash: err?.hash || '', message: describeSubmitError(err) || errorText('sendFailed') });
            }
          }
        }
      };
      if (keysOk) {
        try {
          await withSendLock(network, runRows, {
            signal: controller.signal,
            onWaiting: () => { if (mountedRef.current) setWaitingForLock(true); },
          });
        } catch (err) {
          if (err?.name !== 'AbortError') throw err;
          const reason = networkChangedRef.current ? 'networkChanged' : (mountedRef.current ? 'lockCancelled' : 'aborted');
          items.forEach((i) => setResult(i.row.id, { status: 'skipped', message: errorText(reason) }));
        } finally {
          lockAbortRef.current = null;
          if (mountedRef.current) setWaitingForLock(false);
        }
      }
      if (!keysOk) {
        items.forEach((i) => setResult(i.row.id, { status: 'skipped', message: errorText(stopReason) }));
      }
    } catch (err) {
      if (mountedRef.current) {
        setGeneralError(`${errorText('unexpected')}: ${String(err?.message || err)}`);
        setResults((prev) => Object.fromEntries(Object.entries(prev).map(([id, r]) => (
          [id, r.status === 'pending' || r.status === 'sending' ? { status: 'skipped', message: errorText('unexpected') } : r]
        ))));
      }
    } finally {
      keys.clear();
      if (mountedRef.current) setPhase('done');
    }
  };

  const statusText = (r) => {
    if (!r) return '';
    if (r.status === 'success') return r.message ? `${t('batchPayment:status.success')} (${r.message})` : t('batchPayment:status.success');
    if (r.status === 'failed') return `${t('batchPayment:status.failed')}: ${r.message}`;
    if (r.status === 'ambiguous') {
      return r.message ? `${t('batchPayment:status.ambiguous')} (${t('batchPayment:status.cause')}: ${r.message})` : t('batchPayment:status.ambiguous');
    }
    if (r.status === 'maybeSent') return r.message ? `${t('batchPayment:status.maybeSent')} (${r.message})` : t('batchPayment:status.maybeSent');
    if (r.status === 'logMissing') return t('batchPayment:status.logMissing');
    if (r.status === 'notSent') return `${t('batchPayment:status.notSent')} (${r.message})`;
    if (r.status === 'skipped') return `${t('batchPayment:status.skipped')} (${r.message})`;
    if (r.status === 'sending') return t('batchPayment:status.sending');
    return t('batchPayment:status.pending');
  };
  const statusCls = (r) => {
    if (r?.status === 'success') return 'text-green-700 dark:text-green-400';
    if (r?.status === 'failed' || r?.status === 'ambiguous' || r?.status === 'maybeSent' || r?.status === 'logMissing') return 'text-red-600';
    if (r?.status === 'skipped' || r?.status === 'notSent') return 'text-amber-700 dark:text-amber-300';
    return 'text-gray-700 dark:text-gray-300';
  };

  const doneItems = useMemo(() => (review?.items || []).filter((i) => results[i.row.id]), [review, results]);
  const successItems = doneItems.filter((i) => results[i.row.id]?.status === 'success');
  // Gesendete Summen pro Sender und Asset (nur erfolgreiche Zahlungen).
  const sentTotals = useMemo(() => {
    const map = new Map();
    for (const i of successItems) {
      const source = i.row.source.trim();
      if (!map.has(source)) map.set(source, new Map());
      const assetMap = map.get(source);
      const key = String(i.row.assetKey || 'XLM');
      assetMap.set(key, (assetMap.get(key) || 0n) + toStroops(normalizeAmount(i.row.amount)));
    }
    return map;
  }, [successItems]);
  const formatStroops = (v) => {
    const i = v / 10000000n;
    const f = (v % 10000000n).toString().padStart(7, '0').replace(/0+$/, '');
    return f ? `${i}.${f}` : `${i}`;
  };

  const detailsText = () => doneItems.map((i) => {
    const r = results[i.row.id];
    return [
      `${t('batchPayment:fields.source')}: ${i.row.source}${labelOf(i.row.source) ? ` (${labelOf(i.row.source)})` : ''}`,
      `${t('batchPayment:fields.dest')}: ${i.destination}${i.federation ? ` (${i.federation})` : ''}`,
      i.flags?.compromised ? t('batchPayment:flags.compromised') : '',
      i.flags?.deactivated ? t('batchPayment:flags.deactivated') : '',
      `${t('batchPayment:fields.amount')}: ${normalizeAmount(i.row.amount)} ${i.row.assetKey === 'XLM' ? 'XLM' : i.row.assetKey}`,
      `${t('batchPayment:fields.memo')}: ${memoDisplay(i.row, t) || '-'}`,
      // Meldung mit derselben Bereinigung wie die Diagnose (keine Secrets, keine langen
      // Base64-Folgen wie XDR).
      `${t('batchPayment:review.status')}: ${statusText(r?.message ? { ...r, message: safeDiagText(r.message) } : r)}`,
      (r?.status === 'ambiguous' || r?.status === 'maybeSent') && ambiguousClearAt(r)
        ? t('batchPayment:ambiguous.clearAt', { time: formatClearTime(ambiguousClearAt(r)) }) : '',
      r?.hash ? `TX: ${r.hash}` : '',
      ...diagnosticsLines(r?.diag, t),
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-center items-start z-40 overflow-y-auto p-2 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="batch-payment-title" data-testid="batch-payment-dialog">
      <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-4xl my-4 p-4 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 id="batch-payment-title" className="text-xl font-semibold">{t('batchPayment:title')}</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">{t('batchPayment:subtitle')}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('batchPayment:network', { network: network === 'TESTNET' ? 'Testnet' : 'Mainnet' })}
            </p>
          </div>
          <button type="button" className={btnCls} onClick={onClose} disabled={phase === 'sending' || phase === 'checking'}>
            {t('batchPayment:actions.close')}
          </button>
        </div>

        {networkStopped && (
          <div className="text-sm text-amber-800 dark:text-amber-200 border border-amber-300 bg-amber-50 dark:bg-amber-900/30 rounded-sm p-2" role="alert" data-testid="batch-network-stopped">
            {t('batchPayment:networkChanged.stopped')}
          </div>
        )}
        {generalError && <div className="text-sm text-red-600" role="alert">{generalError}</div>}

        {(phase === 'edit' || phase === 'checking') && (
          <>
            <p className="text-xs text-gray-600 dark:text-gray-400">{t('batchPayment:edit.hint')}</p>
            <div className="space-y-3">
              {rows.map((row, idx) => (
                <div key={row.id} className="border rounded-sm p-3 space-y-2" data-testid="batch-row">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{t('batchPayment:edit.rowLabel', { n: idx + 1 })}</span>
                    <span className="flex gap-1">
                      <button type="button" className="px-1.5 border rounded-sm disabled:opacity-40" onClick={() => moveRow(row.id, -1)} disabled={locked || idx === 0} aria-label={t('batchPayment:actions.moveUp')}>↑</button>
                      <button type="button" className="px-1.5 border rounded-sm disabled:opacity-40" onClick={() => moveRow(row.id, 1)} disabled={locked || idx === rows.length - 1} aria-label={t('batchPayment:actions.moveDown')}>↓</button>
                      <button type="button" className="px-1.5 border rounded-sm disabled:opacity-40" onClick={() => duplicateRow(row)} disabled={locked || rows.length >= MAX_ROWS}>{t('batchPayment:actions.duplicate')}</button>
                      <button type="button" className="px-1.5 border rounded-sm text-red-700 disabled:opacity-40" onClick={() => removeRow(row.id)} disabled={locked}>{t('batchPayment:actions.remove')}</button>
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs mb-0.5">{t('batchPayment:fields.source')}</label>
                      <AddressDropdown
                        value={row.source}
                        onChange={(v) => updateRow(row.id, { source: v })}
                        onSelect={(v) => updateRow(row.id, { source: v })}
                        options={addressOptions}
                        placeholder="G..."
                        inputClassName={`${inputCls} font-mono`}
                        accountPicker
                        disabled={locked}
                        inputProps={{ 'aria-label': t('batchPayment:fields.source') }}
                      />
                      {labelOf(row.source) && <div className="text-xs text-gray-500 mt-0.5">{labelOf(row.source)}</div>}
                    </div>
                    <div>
                      <label className="block text-xs mb-0.5">{t('batchPayment:fields.dest')}</label>
                      <AddressDropdown
                        value={row.dest}
                        onChange={(v) => updateRow(row.id, { dest: v })}
                        onSelect={(v) => updateRow(row.id, { dest: v })}
                        options={addressOptions}
                        placeholder={t('batchPayment:fields.destPlaceholder')}
                        inputClassName={`${inputCls} font-mono`}
                        accountPicker
                        disabled={locked}
                        inputProps={{ 'aria-label': t('batchPayment:fields.dest') }}
                      />
                      {labelOf(row.dest) && <div className="text-xs text-gray-500 mt-0.5">{labelOf(row.dest)}</div>}
                      <div className="text-xs mt-0.5"><FlagWarnings flags={editFlagsOf(row.dest)} t={t} /></div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-12 gap-2">
                    <div className="md:col-span-2">
                      <label className="block text-xs mb-0.5">{t('batchPayment:fields.asset')}</label>
                      <select className={inputCls} value={row.assetKey} disabled={locked} aria-label={t('batchPayment:fields.asset')}
                        onChange={(e) => updateRow(row.id, { assetKey: e.target.value })}>
                        {assetOptionsFor(row).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                      </select>
                    </div>
                    <div className="md:col-span-3">
                      <label className="block text-xs mb-0.5">{t('batchPayment:fields.amount')}</label>
                      <input className={inputCls} inputMode="decimal" value={row.amount} disabled={locked} aria-label={t('batchPayment:fields.amount')}
                        onChange={(e) => updateRow(row.id, { amount: e.target.value })} />
                      {looksLikeThousandsSeparator(row.amount) && (
                        <div className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                          {t('batchPayment:edit.decimalPointHint', { value: normalizeAmount(row.amount) || row.amount })}
                        </div>
                      )}
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs mb-0.5">{t('batchPayment:fields.memoType')}</label>
                      <select className={inputCls} value={row.memoType} disabled={locked} aria-label={t('batchPayment:fields.memoType')}
                        onChange={(e) => updateRow(row.id, { memoType: e.target.value })}>
                        {MEMO_TYPES.map((m) => <option key={m} value={m}>{t(`batchPayment:memoTypes.${m}`)}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2 md:col-span-5">
                      <label className="block text-xs mb-0.5">{t('batchPayment:fields.memo')}</label>
                      <input className={inputCls} value={row.memoVal} disabled={locked || row.memoType === 'none'} aria-label={t('batchPayment:fields.memo')}
                        onChange={(e) => updateRow(row.id, { memoVal: e.target.value })} />
                    </div>
                  </div>
                  {['source', 'dest', 'amount', 'memoVal'].some((f) => containsSecretKey(row[f])) && (
                    <div className="text-xs text-red-600" role="alert">{t('batchPayment:edit.secretWarning')}</div>
                  )}
                  {inputErrors[row.id] && <div className="text-xs text-red-600">{errorText(inputErrors[row.id])}</div>}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <button type="button" className={btnCls} onClick={addRow} disabled={locked || rows.length >= MAX_ROWS}>{t('batchPayment:actions.addRow')}</button>
              <button type="button" className={primaryBtnCls} onClick={handleCheck} disabled={locked}>
                {phase === 'checking' ? t('batchPayment:actions.checking') : t('batchPayment:actions.check')}
              </button>
            </div>
          </>
        )}

        {(phase === 'review' || phase === 'sending') && review && (
          <>
            <div className="space-y-2">
              {review.items.map((item) => {
                const res = results[item.row.id];
                if (phase === 'sending' && !res) return null;
                const blocked = isBlocked(item);
                return (
                  <div key={item.row.id} className={`border rounded-sm p-3 flex gap-3 ${blocked ? 'opacity-90 bg-gray-50 dark:bg-gray-900/40' : ''}`} data-testid="batch-review-row">
                    {phase === 'review' && (
                      <input type="checkbox" className="mt-1" checked={item.include} disabled={blocked} onChange={() => toggleInclude(item.row.id)}
                        aria-label={t('batchPayment:review.include')} />
                    )}
                    <div className="flex-1 min-w-0">
                      <PaymentDetails item={item} t={t} labelOf={labelOf} />
                      <div className="text-xs mt-1">
                        {phase === 'review' && item.code && <span className="text-red-600">{errorText(item.code, item.params)}</span>}
                        {phase === 'review' && !item.code && item.recent?.status === 'ambiguous' && (
                          <>
                            <span className="text-red-600">{t('batchPayment:review.recentAmbiguous')}</span>
                            <AmbiguousStatus entry={item.recent} check={ambiguousChecks[item.row.id]} onCheck={() => recheckAmbiguous(item.row.id)} t={t} />
                            <HashLinks hash={item.recent.hash} links={explorerLinks(item.recent.hash)} />
                          </>
                        )}
                        {phase === 'review' && !item.code && item.recent?.status === 'success' && (
                          <>
                            <span className="text-amber-700 dark:text-amber-300">{t('batchPayment:review.recentSent', { time: new Date(item.recent.at).toLocaleString() })}</span>
                            <HashLinks hash={item.recent.hash} links={explorerLinks(item.recent.hash)} />
                          </>
                        )}
                        {phase === 'review' && !item.code && !item.recent && item.similar && (
                          <>
                            {item.similar.status === 'ambiguous'
                              ? (
                                <>
                                  <span className="text-red-600">{t('batchPayment:review.similarAmbiguous')}</span>
                                  <AmbiguousStatus entry={item.similar} check={ambiguousChecks[item.row.id]} onCheck={() => recheckAmbiguous(item.row.id)} t={t} />
                                </>
                              )
                              : <span className="text-amber-700 dark:text-amber-300">{t('batchPayment:review.similarSent', { time: new Date(item.similar.at).toLocaleString() })}</span>}
                            <HashLinks hash={item.similar.hash} links={explorerLinks(item.similar.hash)} />
                          </>
                        )}
                        {phase === 'review' && !item.code && (item.flags?.compromised || item.flags?.deactivated) && (
                          <div className="text-amber-700 dark:text-amber-300">{t('batchPayment:review.flaggedNotPreselected')}</div>
                        )}
                        {phase === 'review' && !item.code && !item.recent && !item.similar && ambiguousChecks[item.row.id]?.state === 'notSent' && (
                          <div className="space-y-1" data-testid="batch-resolved-not-sent">
                            <div className="text-amber-700 dark:text-amber-300">{t('batchPayment:ambiguous.notSentHint')}</div>
                            {!item.include && (
                              <button type="button" className={smallBtnCls} onClick={() => selectForResend(item.row.id)}>{t('batchPayment:actions.resend')}</button>
                            )}
                          </div>
                        )}
                        {phase === 'review' && !item.code && item.recent?.status === 'success' && ambiguousChecks[item.row.id]?.state === 'success' && (
                          <div className="text-green-700 dark:text-green-400">{t('batchPayment:ambiguous.resolvedSent')}</div>
                        )}
                        {phase === 'review' && !item.code && !item.recent && !item.similar && ambiguousChecks[item.row.id]?.state !== 'notSent' && !item.flags?.compromised && !item.flags?.deactivated && <span className="text-green-700 dark:text-green-400">{t('batchPayment:review.ready')}</span>}
                        {phase === 'sending' && <span className={statusCls(res)}>{statusText(res)}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {phase === 'review' && (
              <div className="space-y-1 text-sm">
                <div className="font-semibold">{t('batchPayment:review.totalsTitle')}</div>
                {totals.size === 0 && <div className="text-gray-500">{t('batchPayment:review.nothingSelected')}</div>}
                {[...totals.entries()].map(([source, tot]) => (
                  <div key={source} className={tot.ok ? '' : 'text-red-600'} data-testid="batch-total">
                    {labelOf(source) ? <span className="font-medium">{labelOf(source)} </span> : null}
                    <AddressCompare address={source} />:{' '}
                    {t('batchPayment:review.xlmTotal', { needed: tot.xlmNeeded, available: tot.xlmAvailable })}
                    {tot.assets.map((a) => (
                      <span key={a.key}>, {a.available === null
                        ? t('batchPayment:review.assetTotalIssuer', { code: assetDisplay(a.key), needed: a.needed })
                        : t('batchPayment:review.assetTotal', { code: assetDisplay(a.key), needed: a.needed, available: a.available })}</span>
                    ))}
                    {!tot.ok && <span> – {t('batchPayment:review.insufficient')}</span>}
                  </div>
                ))}
                <p className="text-xs text-gray-600 dark:text-gray-400">{t('batchPayment:review.signHint')}</p>
              </div>
            )}

            <div className="flex flex-wrap justify-between gap-2">
              {phase === 'review' && (
                <>
                  <button type="button" className={btnCls} onClick={() => { setReview(null); setPhase('edit'); }}>{t('batchPayment:actions.back')}</button>
                  <button type="button" className={primaryBtnCls} onClick={handleSend} disabled={!includedItems.length || !allTotalsOk}>
                    {t('batchPayment:actions.send', { count: includedItems.length })}
                  </button>
                </>
              )}
              {phase === 'sending' && !waitingForLock && <div className="text-sm text-blue-700 dark:text-blue-300">{t('batchPayment:status.running')}</div>}
              {phase === 'sending' && waitingForLock && (
                <div className="flex flex-wrap items-center gap-2 text-sm text-amber-700 dark:text-amber-300" data-testid="batch-waiting-lock">
                  <span>{t('batchPayment:status.waitingForLock')}</span>
                  <button type="button" className={btnCls} onClick={() => lockAbortRef.current?.abort()}>{t('batchPayment:actions.cancelWaiting')}</button>
                </div>
              )}
            </div>
          </>
        )}

        {phase === 'done' && review && (
          <>
            <div
              className={`text-sm rounded-sm p-3 border ${successItems.length === doneItems.length
                ? 'bg-green-100 dark:bg-green-900/30 border-green-300/60 text-green-800 dark:text-green-200'
                : 'bg-amber-100 dark:bg-amber-900/30 border-amber-300/60 text-amber-800 dark:text-amber-200'}`}
              data-testid="batch-summary"
            >
              <div className="font-semibold mb-1">
                {t('batchPayment:done.summary', { sent: successItems.length, total: doneItems.length })}
              </div>
              {[...sentTotals.entries()].map(([source, assetMap]) => (
                <div key={source}>
                  {labelOf(source) || `${source.slice(0, 8)}…${source.slice(-8)}`}:{' '}
                  {[...assetMap.entries()].map(([key, v]) => `${formatStroops(v)} ${assetDisplay(key)}`).join(', ')}
                </div>
              ))}
              {doneItems.some((i) => results[i.row.id]?.status === 'ambiguous') && (
                <div className="mt-2">{t('batchPayment:done.ambiguousHint')}</div>
              )}
              {doneItems.some((i) => results[i.row.id]?.status === 'maybeSent') && (
                <div className="mt-2">{t('batchPayment:done.maybeSentHint')}</div>
              )}
              <div className="mt-2">
                <button type="button" className={smallBtnCls} onClick={async () => {
                  const ok = await copyText(detailsText());
                  if (ok && mountedRef.current) { setCopied(true); setTimeout(() => { if (mountedRef.current) setCopied(false); }, 1500); }
                }}>
                  {copied ? t('batchPayment:actions.copied') : t('batchPayment:actions.copyDetails')}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {doneItems.map((item) => {
                const res = results[item.row.id];
                return (
                  <div key={item.row.id} className="border rounded-sm p-3" data-testid="batch-done-row">
                    <div className={`text-sm font-semibold mb-1 ${statusCls(res)}`}>{statusText(res)}</div>
                    <PaymentDetails item={item} t={t} labelOf={labelOf} />
                    {(res?.status === 'ambiguous' || res?.status === 'maybeSent') && (
                      <AmbiguousStatus entry={res} check={ambiguousChecks[item.row.id]} onCheck={() => recheckAmbiguous(item.row.id)} t={t} />
                    )}
                    {res?.status === 'logMissing' && (
                      <div className="mt-1 text-xs text-amber-700 dark:text-amber-300" data-testid="batch-log-missing">{t('batchPayment:ambiguous.logMissing')}</div>
                    )}
                    {res?.status === 'notSent' && (
                      <div className="mt-1 space-y-1 text-xs" data-testid="batch-resolved-not-sent">
                        <div className="text-amber-700 dark:text-amber-300">{t('batchPayment:ambiguous.notSentHint')}</div>
                        <button type="button" className={smallBtnCls} onClick={resendFromDone}>{t('batchPayment:actions.resend')}</button>
                      </div>
                    )}
                    <HashLinks hash={res?.hash} links={explorerLinks(res?.hash)} />
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap justify-between gap-2">
              <button type="button" className={btnCls} onClick={() => { sendStartedRef.current = false; setReview(null); setResults({}); setAmbiguousChecks({}); setPhase('edit'); }}>{t('batchPayment:actions.backToList')}</button>
              <button type="button" className={primaryBtnCls} onClick={onClose}>{t('batchPayment:actions.close')}</button>
            </div>
          </>
        )}
      </div>

      {secretPrompt && (
        <SecretKeyModal
          key={secretPrompt.source}
          subtitle={t('batchPayment:secret.forAccount', {
            account: secretPrompt.source,
            label: labelOf(secretPrompt.source) || '–',
          })}
          errorMessage={secretError}
          onConfirm={handleSecretConfirm}
          onCancel={handleSecretCancel}
          account={secretPrompt.account}
          thresholds={secretPrompt.account?.thresholds || null}
          signers={(secretPrompt.account?.signers || []).map((s) => ({ public_key: s.key, weight: s.weight }))}
          operationType="payment"
          requiredThreshold={Number(secretPrompt.account?.thresholds?.med_threshold || 0)}
        />
      )}
    </div>
  );
}
