import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import AddressDropdown from '../AddressDropdown.jsx';
import SecretKeyModal from '../SecretKeyModal.jsx';
import { horizonUrlFor, passphraseFor, readStoredNetworkId } from '../../config/networks.js';
import { getHorizonServer } from '../../utils/stellar/stellarUtils.js';
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
  assetDisplay, buildSignedRowTx, checkRowOnNetwork, checkSourceAccount, computeSourceTotals, describeSubmitError,
  paymentFingerprint, resolveAmbiguous, routingFingerprint, toStroops, validateRowInput,
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
export default function BatchPaymentDialog({ onClose }) {
  const { t } = useTranslation(['batchPayment', 'common']);
  const [network] = useState(() => readStoredNetworkId());
  const server = useMemo(() => getHorizonServer(horizonUrlFor(network)), [network]);
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
  const [inputErrors, setInputErrors] = useState({});
  const [review, setReview] = useState(null);
  const [results, setResults] = useState({});
  const [secretPrompt, setSecretPrompt] = useState(null); // { source, account, resolve }
  const [secretError, setSecretError] = useState('');
  const [generalError, setGeneralError] = useState('');
  const [copied, setCopied] = useState(false);
  const [waitingForLock, setWaitingForLock] = useState(false);
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
  const loadResolvedEntry = async (fp) => {
    let entry = readSentEntry(network, fp);
    if (entry?.status === 'ambiguous') {
      const outcome = await resolveAmbiguous({ server, entry });
      if (outcome === 'success') {
        entry = { ...entry, status: 'success' };
        writeSentEntry(network, fp, entry);
      } else if (outcome === 'failed' || outcome === 'expired') {
        writeSentEntry(network, fp, null);
        entry = null;
      }
    }
    return entry;
  };

  const handleCheck = async () => {
    setGeneralError('');
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
      try {
        const ledgers = await server.ledgers().order('desc').limit(1).call();
        const br = Number(ledgers?.records?.[0]?.base_reserve_in_stroops);
        if (Number.isInteger(br) && br > 0) baseReserveStroops = BigInt(br);
      } catch { /* Standardwert */ }
      let feeStroops = 100;
      try { feeStroops = Number(await resolveFeePerOp(server, { deferred: false })) || 100; } catch { /* Standardwert */ }

      const items = [];
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
            recent = recentSendOf(await loadResolvedEntry(fp));
            if (!recent) {
              // Gleiche Zahlung in anderer Form (M-Adresse gegen G plus Memo ID)? Gesendet:
              // Warnung. Unklar: Sperre wie beim Haupteintrag.
              const routeFp = routingFingerprint({ network, row, destination: check.destination });
              similar = routeFp ? recentSendOf(await loadResolvedEntry(routeFp)) : null;
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
      setReview({ items, accounts, baseReserveStroops, feeStroops });
      setPhase('review');
    } catch (e) {
      if (!mountedRef.current) return;
      setGeneralError(String(e?.message || e));
      setPhase('edit');
    }
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
    const items = includedItems;
    const setResult = (id, value) => { if (mountedRef.current) setResults((prev) => ({ ...prev, [id]: value })); };
    setResults(Object.fromEntries(items.map((i) => [i.row.id, { status: 'pending' }])));
    setPhase('sending');
    const keys = new Map();
    let stopReason = '';
    try {
      // 1. Alle Keys vor der ersten Zahlung, damit ein Abbruch nichts halb sendet.
      for (const source of new Set(items.map((i) => i.row.source.trim()))) {
        const kp = await obtainKeypair(source, review.accounts.get(source));
        if (!kp) { stopReason = mountedRef.current ? 'cancelled' : 'aborted'; break; }
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
          // Lock vor jeder Zahlung erneuern; ging er verloren (Tab gedrosselt oder
          // eingefroren, anderer Tab hat uebernommen), sofort stoppen.
          if (!stopReason && !lock.touch()) stopReason = 'lockLost';
          if (stopReason) { setResult(row.id, { status: 'skipped', message: errorText(stopReason) }); continue; }

          const routeFp = routingFingerprint({ network, row, destination: item.destination });
          // Sperrt das Protokoll diese Zahlung (inzwischen gesendet oder unklar)? Bewusst
          // bestaetigt sind nur die Eintraege, die in der Pruefung angezeigt wurden.
          const blockReason = () => {
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
          let hash = '';
          let wroteOwn = false;
          try {
            const account = await server.loadAccount(source);
            const tx = buildSignedRowTx({
              account, row, destination: item.destination, fee: review.feeStroops,
              networkPassphrase: passphraseFor(network), keypair: keys.get(source),
            });
            hash = txHashHex(tx);
            const maxTime = Number(tx.timeBounds?.maxTime);
            // Unmittelbar vor dem Schreiben erneut pruefen (Fenster nur noch Mikrosekunden).
            if (!lock.isHeld()) {
              stopReason = 'lockLost';
              setResult(row.id, { status: 'skipped', message: errorText(stopReason) });
              continue;
            }
            const lateBlock = blockReason();
            if (lateBlock) { setResult(row.id, { status: 'skipped', message: errorText(lateBlock) }); continue; }
            // Vor dem Submit als unklar vermerken (Haupt- und Routing-Eintrag) und
            // zuruecklesen: Bricht der Tab jetzt ab, bleibt die Zahlung gesperrt, bis
            // Horizon den Ausgang zeigt. Steht danach ein fremder Hash dort, sendet gerade
            // ein anderer Lauf.
            const pending = { hash, at: Date.now(), status: 'ambiguous', maxTime };
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
            const done = { hash, at: Date.now(), status: 'success', maxTime };
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
              setResult(row.id, { status: 'ambiguous', hash: err.hash || hash, message: causeText });
              stopReason = 'stoppedAmbiguous';
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
          const reason = mountedRef.current ? 'lockCancelled' : 'aborted';
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
    if (r.status === 'skipped') return `${t('batchPayment:status.skipped')} (${r.message})`;
    if (r.status === 'sending') return t('batchPayment:status.sending');
    return t('batchPayment:status.pending');
  };
  const statusCls = (r) => {
    if (r?.status === 'success') return 'text-green-700 dark:text-green-400';
    if (r?.status === 'failed' || r?.status === 'ambiguous') return 'text-red-600';
    if (r?.status === 'skipped') return 'text-amber-700 dark:text-amber-300';
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
      `${t('batchPayment:review.status')}: ${statusText(r)}`,
      r?.hash ? `TX: ${r.hash}` : '',
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
                              ? <span className="text-red-600">{t('batchPayment:review.similarAmbiguous')}</span>
                              : <span className="text-amber-700 dark:text-amber-300">{t('batchPayment:review.similarSent', { time: new Date(item.similar.at).toLocaleString() })}</span>}
                            <HashLinks hash={item.similar.hash} links={explorerLinks(item.similar.hash)} />
                          </>
                        )}
                        {phase === 'review' && !item.code && (item.flags?.compromised || item.flags?.deactivated) && (
                          <div className="text-amber-700 dark:text-amber-300">{t('batchPayment:review.flaggedNotPreselected')}</div>
                        )}
                        {phase === 'review' && !item.code && !item.recent && !item.similar && !item.flags?.compromised && !item.flags?.deactivated && <span className="text-green-700 dark:text-green-400">{t('batchPayment:review.ready')}</span>}
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
                    <HashLinks hash={res?.hash} links={explorerLinks(res?.hash)} />
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap justify-between gap-2">
              <button type="button" className={btnCls} onClick={() => { sendStartedRef.current = false; setReview(null); setResults({}); setPhase('edit'); }}>{t('batchPayment:actions.backToList')}</button>
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
