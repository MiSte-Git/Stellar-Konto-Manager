import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProgressBar from '../components/ProgressBar.jsx';
import { NOTE_ERROR, NOTE_NEUTRAL, NOTE_WARN } from '../components/liquidity/LiquidityDialogShell.jsx';
import { formatAmountWithUnit, parseAmountInput } from '../components/liquidity/formatPoolAmount.js';
import RoundPicker from '../components/groupfund/RoundPicker.jsx';
import SenderList from '../components/groupfund/SenderList.jsx';
import useGroupfundScan, { setGroupfundSummary } from '../components/groupfund/hooks/useGroupfundScan.js';
import { isTestNetwork, NETWORKS } from '../config/networks.js';
import { formatLocalDateTime } from '../utils/datetime';
import { getCachedDirectoryEntry, loadDirectoryBatch } from '../utils/expert/expertDirectory.js';
import { buildDefaultFilename } from '../utils/filename';
import { loadGroupfundPrefs, saveGroupfundPrefs } from '../utils/groupfundPrefs.js';
import { findLookalikeCounterparties } from '../utils/stellar/activity.js';
import { aggregateRound, assetUnitLabel, counterpartiesOfRound } from '../utils/stellar/groupfundAggregate.js';
import { buildGroupfundExport, downloadTextFile, groupfundExportToCsv, groupfundExportToJson } from '../utils/stellar/groupfundExport.js';
import { DEFAULT_BUFFER_XLM, buildDateRangeRound } from '../utils/stellar/groupfundRounds.js';
import { extractMuxedIdFromAddress } from '../utils/stellar/stellarUtils.js';

const BTN = 'rounded-sm border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800';
const FIELD = 'w-full rounded-sm border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900';

function muxedIdOf(address) {
  if (!address) return '';
  try {
    return extractMuxedIdFromAddress(address);
  } catch {
    return '';
  }
}

/**
 * Groupfund-Ansicht, nur lesend. Eingaenge einer Runde ueber eine M-Adresse oder ein Memo,
 * pro Absender und Asset. Eine M-Adresse hat keinen Saldo: Die Betraege sind Summen aus
 * der Historie, das verfuegbare Guthaben liegt auf dem G-Konto.
 */
export default function GroupfundPage({ publicKey, muxedAddress = '', network = 'PUBLIC' }) {
  const { t, i18n } = useTranslation(['groupfund', 'common']);
  const locale = i18n.language;
  const muxedId = muxedIdOf(muxedAddress);
  const [prefs, setPrefs] = useState(() => loadGroupfundPrefs(network, publicKey));
  const updatePrefs = useCallback((patch) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      saveGroupfundPrefs(network, publicKey, next);
      return next;
    });
  }, [network, publicKey]);

  const mode = muxedId && prefs.mode === 'muxed' ? 'muxed' : 'memo';
  const identifier = useMemo(() => (mode === 'muxed' ? { mode, id: muxedId } : { mode, memo: prefs.memo }), [mode, muxedId, prefs.memo]);
  const hasIdentifier = mode === 'muxed' || !!prefs.memo.trim();

  const parsedBuffer = parseAmountInput(prefs.bufferXlm);
  const bufferStroops = parsedBuffer ?? parseAmountInput(DEFAULT_BUFFER_XLM);
  const dismissedIds = useMemo(() => prefs.dismissed.map((b) => b.opId), [prefs.dismissed]);
  const scan = useGroupfundScan({ accountId: publicKey, network, bufferStroops, dismissed: dismissedIds, manual: prefs.manual });
  const { analysis, start, status } = scan;
  const scanning = status === 'scanning';

  const startRef = useRef(start);
  startRef.current = start;
  const autoStart = hasIdentifier && status === 'idle';
  useEffect(() => { if (autoStart) void startRef.current({ rounds: 1 }); }, [autoStart]);

  const [selectedId, setSelectedId] = useState('current');
  const [range, setRange] = useState(null);
  const [roundGone, setRoundGone] = useState(false);

  // Eine gewaehlte Runde kann durch Neu laden oder Korrekturen wegfallen.
  useEffect(() => {
    if (scanning || !analysis || selectedId === 'current' || selectedId === 'range') return;
    if (analysis.rounds.some((r) => r.id === selectedId)) return;
    setSelectedId('current');
    setRoundGone(true);
  }, [analysis, scanning, selectedId]);

  const round = useMemo(() => {
    if (!analysis) return null;
    if (selectedId === 'range') {
      return range ? buildDateRangeRound({ ...range, coveredAt: analysis.coveredAt, complete: analysis.complete }) : null;
    }
    return analysis.rounds.find((r) => r.id === selectedId) || analysis.rounds[0];
  }, [analysis, range, selectedId]);

  const { payments, effects, currentStroops } = scan;
  const result = useMemo(() => {
    if (!round || !hasIdentifier) return null;
    return aggregateRound({ payments, effects, accountId: publicKey, identifier, round });
    // payments/effects werden beim Scan fortgeschrieben; analysis aendert sich mit jeder Seite.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, round, hasIdentifier, identifier, publicKey]);

  const lookalikes = useMemo(
    () => (round ? findLookalikeCounterparties(counterpartiesOfRound({ payments, accountId: publicKey, round })) : new Set()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [analysis, round, publicKey]
  );

  useEffect(() => {
    if (!result || scanning || !round?.complete || round.id === 'range' || analysis?.rounds[0]?.id !== round.id) return;
    // Eine Summe mit fehlendem Betrag darf die Kachel nicht als Zahl zeigen.
    const incomplete = result.amountUnknownCount > 0;
    setGroupfundSummary(network, publicKey, {
      identifierKey: `${mode}:${mode === 'muxed' ? muxedId : prefs.memo}`,
      incomplete,
      totals: incomplete ? [] : result.totals,
      at: scan.scannedAt,
    });
  }, [analysis, mode, muxedId, network, prefs.memo, publicKey, result, round, scan.scannedAt, scanning]);

  // Directory nur auf Knopfdruck, siehe expertDirectory.js
  const senders = useMemo(() => [...new Set((result?.rows || []).map((row) => row.sender))], [result]);
  const [directoryVersion, setDirectoryVersion] = useState(0);
  const directory = useMemo(() => {
    const map = new Map();
    senders.forEach((sender) => {
      const entry = getCachedDirectoryEntry(network, sender);
      if (entry) map.set(sender, entry);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [senders, network, directoryVersion]);
  const [directoryState, setDirectoryState] = useState({ busy: false, stopped: '' });
  const directoryOpen = senders.length - directory.size;
  const directoryAbortRef = useRef(null);
  useEffect(() => () => directoryAbortRef.current?.abort(), []);
  const checkDirectory = async () => {
    const controller = new AbortController();
    directoryAbortRef.current = controller;
    setDirectoryState({ busy: true, stopped: '' });
    const { stopped } = await loadDirectoryBatch({ accounts: senders, network, signal: controller.signal, onEntry: () => setDirectoryVersion((v) => v + 1) });
    if (!controller.signal.aborted) setDirectoryState({ busy: false, stopped });
  };

  const canExport = !!result && !!round?.complete && !scanning;
  const exportData = (format) => {
    const data = buildGroupfundExport({
      network,
      accountId: publicKey,
      identifier,
      round,
      rows: result.rows,
      directory,
      bufferStroops,
      coverage: { complete: analysis.complete, coveredAt: analysis.coveredAt, scannedAt: scan.scannedAt },
      generatedAt: new Date().toISOString(),
    });
    const filename = buildDefaultFilename({ publicKey, menuLabel: 'Groupfund', ext: format });
    if (format === 'csv') downloadTextFile(filename, groupfundExportToCsv(data), 'text/csv;charset=utf-8');
    else downloadTextFile(filename, groupfundExportToJson(data), 'application/json');
  };

  const selectRound = (id) => {
    setSelectedId(id);
    setRoundGone(false);
    if (id !== 'range') setRange(null);
  };
  const applyRange = (next) => {
    setRange(next);
    void start({ fromISO: next.fromISO });
  };
  const loadMore = () => {
    void start({ rounds: (analysis?.boundaries.length || 0) + 1 });
  };

  let emptySummary = t('groupfund:summary.noIdentifier');
  if (!round) emptySummary = t('groupfund:summary.pickRange');
  else if (hasIdentifier) emptySummary = t('groupfund:summary.empty');

  const summaryTitle = mode === 'muxed' ? t('groupfund:summary.titleMuxed') : t('groupfund:summary.titleMemo');

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 text-left" data-testid="groupfund-page">
      <div>
        <h1 className="text-center text-2xl font-bold">{t('groupfund:page.title')}</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{t('groupfund:page.intro')}</p>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">{t('groupfund:page.network')}: {NETWORKS[network]?.label || network}</p>
      </div>

      <section className="space-y-2 rounded-sm border border-gray-200 p-3 dark:border-gray-700">
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="mb-1 text-xs font-semibold">{t('groupfund:identifier.label')}</legend>
          <label className="inline-flex items-center gap-1">
            <input type="radio" name="groupfund-mode" checked={mode === 'muxed'} disabled={!muxedId} onChange={() => updatePrefs({ mode: 'muxed' })} />
            {t('groupfund:identifier.muxed')}
          </label>
          <label className="inline-flex items-center gap-1">
            <input type="radio" name="groupfund-mode" checked={mode === 'memo'} onChange={() => updatePrefs({ mode: 'memo' })} />
            {t('groupfund:identifier.memo')}
          </label>
        </fieldset>
        {mode === 'muxed' ? (
          <p className="break-all font-mono text-xs">{muxedAddress} ({t('groupfund:identifier.id', { id: muxedId })})</p>
        ) : (
          <label className="block text-xs">
            <span className="mb-1 block font-semibold">{t('groupfund:identifier.memoLabel')}</span>
            <input className={FIELD} value={prefs.memo} onChange={(e) => updatePrefs({ memo: e.target.value })} />
          </label>
        )}
        {!muxedId && <p className="text-xs text-gray-600 dark:text-gray-300">{t('groupfund:identifier.noMuxed')}</p>}
        <div className="flex flex-wrap gap-2">
          {scanning ? (
            <button type="button" className={BTN} onClick={scan.cancel}>{t('groupfund:scan.cancel')}</button>
          ) : (
            <button type="button" className={BTN} onClick={() => (analysis ? scan.refresh() : start({ rounds: 1 }))} disabled={!hasIdentifier}>
              {analysis ? t('groupfund:scan.refresh') : t('groupfund:scan.start')}
            </button>
          )}
          {scan.scannedAt && <span className="self-center text-xs text-gray-600 dark:text-gray-300">{t('groupfund:scan.scannedAt', { time: formatLocalDateTime(scan.scannedAt) })}</span>}
        </div>
        {scanning && <ProgressBar progress={null} phase="scan" page={scan.pages} oldest={analysis?.coveredAt ? formatLocalDateTime(analysis.coveredAt) : ''} />}
        {status === 'aborted' && <div className={NOTE_WARN} role="status">{t('groupfund:scan.aborted')}</div>}
        {status === 'error' && <div className={NOTE_ERROR} role="alert">{t('groupfund:scan.failed', { detail: scan.error })}</div>}
      </section>

      {analysis && (
        <>
          <section className="rounded-sm border border-blue-200 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-900/30" data-testid="groupfund-summary">
            <h2 className="text-sm font-semibold">{summaryTitle}</h2>
            {result?.totals.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {result.totals.map((total) => (
                  <li key={total.key} className="text-lg font-semibold tabular-nums">
                    {total.amountUnknown
                      ? t('groupfund:summary.atLeast', { amount: formatAmountWithUnit(total.gross, assetUnitLabel(total.asset), locale) })
                      : formatAmountWithUnit(total.gross, assetUnitLabel(total.asset), locale)}
                    <span className="ml-2 text-xs font-normal">{t('groupfund:summary.counts', { count: total.count, senders: total.senders })}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm">{emptySummary}</p>
            )}
            <p className="mt-1 text-xs">{t('groupfund:summary.notBalance')}</p>
          </section>

          <section className="text-xs text-gray-700 dark:text-gray-300" data-testid="groupfund-g-balance">
            <span className="font-semibold">{t('groupfund:balance.label')}:</span>{' '}
            <span className="tabular-nums">{formatAmountWithUnit(currentStroops, 'XLM', locale)}</span>
            <span className="block">{t('groupfund:balance.hint')}</span>
          </section>

          <RoundPicker
            analysis={analysis}
            selectedId={selectedId}
            onSelect={selectRound}
            onLoadMore={loadMore}
            busy={scanning}
            onApplyRange={applyRange}
            bufferXlm={prefs.bufferXlm}
            bufferValid={parsedBuffer !== null}
            onBufferChange={(value) => updatePrefs({ bufferXlm: value })}
            dismissed={prefs.dismissed}
            manual={prefs.manual}
            onDismiss={(boundary) => updatePrefs({ dismissed: [...prefs.dismissed, boundary] })}
            onRestore={(opId) => updatePrefs({ dismissed: prefs.dismissed.filter((b) => b.opId !== opId) })}
            onSetBoundary={({ opId, txHash, createdAt, to, outflow, balanceAfter, hasIncoming }) => updatePrefs({
              manual: [...prefs.manual, { opId, txHash, createdAt, to, outflow, balanceAfter, hasIncoming }],
              dismissed: prefs.dismissed.filter((b) => b.opId !== opId),
            })}
            onRemoveManual={(opId) => updatePrefs({ manual: prefs.manual.filter((b) => b.opId !== opId) })}
            locale={locale}
          />

          {roundGone && <div className={NOTE_WARN} role="status" data-testid="groupfund-round-gone">{t('groupfund:notes.roundGone')}</div>}
          {analysis.unsureEffects > 0 && <div className={NOTE_WARN} data-testid="groupfund-unsure">{t('groupfund:notes.unsureEffects')}</div>}
          {round?.historyEnd && <div className={NOTE_NEUTRAL} data-testid="groupfund-history-end">{t('groupfund:notes.historyEnd')}</div>}
          {round && !round.complete && !scanning && <div className={NOTE_WARN} data-testid="groupfund-incomplete">{t('groupfund:notes.incomplete')}</div>}
          {result?.accountCreatedInRound && <div className={NOTE_NEUTRAL} data-testid="groupfund-account-created">{t('groupfund:notes.accountCreated')}</div>}
          {result?.amountUnknownCount > 0 && <div className={NOTE_WARN} data-testid="groupfund-amount-unknown-note">{t('groupfund:notes.amountUnknown', { count: result.amountUnknownCount })}</div>}
          {result?.memoJoinMissing > 0 && <div className={NOTE_WARN}>{t('groupfund:notes.memoJoinMissing', { count: result.memoJoinMissing })}</div>}

          {result?.rows.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {isTestNetwork(network) ? (
                  <span className="text-xs text-gray-600 dark:text-gray-300">{t('groupfund:directory.testnet')}</span>
                ) : (
                  <button type="button" className={BTN} onClick={checkDirectory} disabled={directoryState.busy || directoryOpen === 0}>
                    {directoryState.busy ? t('groupfund:directory.busy') : t('groupfund:directory.check')}
                  </button>
                )}
                {!isTestNetwork(network) && <span className="text-xs text-gray-600 dark:text-gray-300">{t('groupfund:directory.progress', { done: directory.size, total: senders.length })}</span>}
                <button type="button" className={BTN} disabled={!canExport} onClick={() => exportData('csv')}>{t('groupfund:export.csv')}</button>
                <button type="button" className={BTN} disabled={!canExport} onClick={() => exportData('json')}>{t('groupfund:export.json')}</button>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-300" data-testid="groupfund-export-hint">{t('groupfund:export.hint')}</p>
              {directoryState.stopped === 'rateLimited' && <div className={NOTE_WARN} role="status">{t('groupfund:directory.rateLimited')}</div>}
              {directoryState.stopped === 'unavailable' && <div className={NOTE_WARN} role="status">{t('groupfund:directory.unavailable')}</div>}
              <p className="text-xs text-gray-600 dark:text-gray-300" data-testid="groupfund-unmarked-hint">{t('groupfund:senders.unmarkedHint')}</p>
              <SenderList rows={result.rows} network={network} locale={locale} directory={directory} lookalikes={lookalikes} />
            </>
          )}
        </>
      )}
    </div>
  );
}
