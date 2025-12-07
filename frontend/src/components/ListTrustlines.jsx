// src/components/ListTrustlines.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  validateSecretKey, 
  loadTrustlines, 
  deleteTrustlinesInChunks 
} from '../utils/stellar/stellarUtils';
import SecretKeyModal from './SecretKeyModal';
import MenuHeader from './MenuHeader';
import ErrorModal from './ErrorModal';
import { 
  isSelected, 
  areAllSelected,
  toggleTrustlineSelection
} from '../utils/stellar/trustlineUtils.js';
import ProgressBar from "../components/ProgressBar.jsx";
import { formatElapsedMmSs } from '../utils/datetime';
import { useSettings } from '../utils/useSettings';
import { formatErrorForUi } from '../utils/formatErrorForUi.js';
import { getRequiredThreshold } from '../utils/getRequiredThreshold.js';
import { getHorizonServer } from '../utils/stellar/stellarUtils.js';
import AddTrustlineModal from './AddTrustlineModal.jsx';
import { Networks, TransactionBuilder, Operation, Asset } from '@stellar/stellar-sdk';
import MultisigPrepareDialog from './MultisigPrepareDialog.jsx';
import { BACKEND_URL } from '../config.js';
// import { refreshSinceCursor } from '../utils/stellar/syncUtils';

function ListTrustlines({
  trustlines,
  itemsPerPage,
  currentPage,
  sortColumn,
  sortDirection,
  onSort,
  filters,
  onFilterChange,
  selectedTrustlines,
  onToggleAll,
  setSelectedTrustlines,
  results,
  setResults,
  setMenuSelection,
  menuSelection,
  setSecretKey,
  publicKey,
  setTrustlines, 
  isProcessing,
  deleteProgress,
  setIsProcessing,
  setDeleteProgress,
  setInfoMessage,
}) {
  const { t, i18n } = useTranslation(['common', 'trustline', 'errors', 'multisig']);
  const { decimalsMode } = useSettings();
  const [paginated, setPaginated] = useState([]);
  const [showOverviewModal, setShowOverviewModal] = useState(false);
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [overviewSort, setOverviewSort] = useState({ column: 'assetCode', direction: 'asc' });
  // Steuert die Anzeige eines Ladeindikators beim Löschvorgang
  //const [isProcessing, setIsProcessing] = useState(false);
  // Fehlerausgabe im Secret-Key-Modal
  const [modalError, setModalError] = useState('');
  const [statusMessages, setStatusMessages] = useState([]);
  // Ergebnisse für Info- oder Fehlermeldungen nach Löschaktionen
  const [errorMessage, setErrorMessage] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [pendingAdd, setPendingAdd] = useState(null);
  const [pendingAction, setPendingAction] = useState(null); // 'delete' | 'add'
  const [preparedTx, setPreparedTx] = useState(null);
  const [accountInfo, setAccountInfo] = useState(null);
  const thresholdsForModal = useMemo(() => accountInfo?.thresholds || null, [accountInfo]);
  const signersForModal = useMemo(() => accountInfo?.signers || [], [accountInfo]);
  const requiredThreshold = useMemo(
    () => getRequiredThreshold('changeTrust', thresholdsForModal),
    [thresholdsForModal]
  );
  const delProg = useMemo(() => {
    const p = deleteProgress?.total ? deleteProgress.current / deleteProgress.total : 0;
    return { progress: isProcessing ? p : 0, phase: isProcessing ? 'chunkDone' : 'idle', page: 0, etaMs: 0 };
  }, [deleteProgress, isProcessing]);
  const [delElapsedMs, setDelElapsedMs] = useState(0);
  const delStartedAtRef = useRef(0);

  const balanceFmt = useMemo(() => {
    const isAuto = decimalsMode === 'auto';
    const n = isAuto ? undefined : Math.max(0, Math.min(7, Number(decimalsMode)));
    return new Intl.NumberFormat(i18n.language || undefined, {
      minimumFractionDigits: isAuto ? 0 : n,
      maximumFractionDigits: isAuto ? 7 : n,
    });
  }, [i18n.language, decimalsMode]);

  // Account laden für Thresholds/Signer
  useEffect(() => {
    let cancelled = false;
    async function loadAccountInfo() {
      if (!publicKey) return;
      try {
        const net = (typeof window !== 'undefined' && window.localStorage?.getItem('SKM_NETWORK') === 'TESTNET') ? 'TESTNET' : 'PUBLIC';
        const server = getHorizonServer(net === 'TESTNET' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org');
        const acct = await server.loadAccount(publicKey);
        if (!cancelled) setAccountInfo(acct);
      } catch {
        if (!cancelled) setAccountInfo(null);
      }
    }
    loadAccountInfo();
    return () => { cancelled = true; };
  }, [publicKey]);

  const reloadTrustlinesForCurrentAccount = async () => {
    const refreshed = await loadTrustlines(publicKey, undefined, { includeOps: true, ttlMs: 0 });
    setTrustlines(refreshed);
  };

  const submitChangeTrustTx = async ({ asset, limit, collectedSigners }) => {
    const net = (typeof window !== 'undefined' && window.localStorage?.getItem('SKM_NETWORK') === 'TESTNET') ? 'TESTNET' : 'PUBLIC';
    const server = getHorizonServer(net === 'TESTNET' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org');
    const account = await server.loadAccount(publicKey);
    const thresholds = account?.thresholds || {};
    const required = getRequiredThreshold('changeTrust', thresholds);
    const horizonSigners = account?.signers || [];
    const current = (Array.isArray(collectedSigners) ? collectedSigners : []).reduce((acc, s) => {
      try {
        const pub = s.keypair?.publicKey?.();
        const match = horizonSigners.find((sg) => sg.key === pub || sg.public_key === pub);
        const w = Number(match?.weight || 0);
        return acc + (w > 0 ? w : 0);
      } catch {
        return acc;
      }
    }, 0);
    if (current <= 0) throw new Error('submitTransaction.failed:' + 'multisig.noKeysProvided');
    if (current < required) throw new Error('submitTransaction.failed:' + 'multisig.insufficientWeight');

    const feeStats = await server.feeStats();
    const fee = String(Number(feeStats?.fee_charged?.mode || 100));
    const txb = new TransactionBuilder(account, {
      fee,
      networkPassphrase: net === 'TESTNET' ? Networks.TESTNET : Networks.PUBLIC,
    });
    txb.addOperation(Operation.changeTrust({ asset, limit }));
    const tx = txb.setTimeout(60).build();
    (Array.isArray(collectedSigners) ? collectedSigners : []).forEach((s) => {
      try { tx.sign(s.keypair); } catch (e) { console.debug?.('sign failed', e); }
    });
    if (process.env.NODE_ENV !== 'production') {
      try {
        console.debug('multisig changeTrust signing', {
          required,
          current,
          signers: (Array.isArray(collectedSigners) ? collectedSigners : []).map((s) => ({
            publicKey: s.publicKey,
            weight: horizonSigners.find((sg) => sg.key === s.publicKey || sg.public_key === s.publicKey)?.weight || 0
          })),
          asset: asset.getCode ? asset.getCode() : '',
        });
      } catch { /* noop */ }
    }
    return server.submitTransaction(tx);
  };

  useEffect(() => {
    let id = null;
    const active = isProcessing && deleteProgress?.total > 0;
    if (active) {
      if (!delStartedAtRef.current) delStartedAtRef.current = Date.now();
      id = setInterval(() => setDelElapsedMs(Date.now() - delStartedAtRef.current), 1000);
    } else {
      delStartedAtRef.current = 0;
      setDelElapsedMs(0);
    }
    return () => id && clearInterval(id);
  }, [isProcessing, deleteProgress?.total]);

  useEffect(() => {
    let filtered = trustlines.filter((tl) => {
      return (
        (!filters.assetCode || tl.assetCode.toLowerCase().includes(filters.assetCode.toLowerCase())) &&
        (!filters.assetIssuer || tl.assetIssuer.toLowerCase().includes(filters.assetIssuer.toLowerCase())) &&
        (!filters.createdAt || tl.createdAt?.toLowerCase().includes(filters.createdAt.toLowerCase()))
      );
    });

    // Optional: nur Trustlines mit Guthaben 0 anzeigen
    if (filters.zeroOnly) {
      filtered = filtered.filter(tl => parseFloat(tl.assetBalance) === 0);
    }

    filtered.sort((a, b) => {
      const isAsc = sortDirection === 'asc' ? 1 : -1;
      if (sortColumn === 'assetCode') {
        return a.assetCode.localeCompare(b.assetCode) * isAsc;
      } else if (sortColumn === 'assetBalance') {
        return (parseFloat(a.assetBalance) - parseFloat(b.assetBalance)) * isAsc;
      } else if (sortColumn === 'assetIssuer') {
        return a.assetIssuer.localeCompare(b.assetIssuer) * isAsc;
      } else if (sortColumn === 'createdAt') {
        const dateA = new Date(a.createdAt || 0).getTime();
        const dateB = new Date(b.createdAt || 0).getTime();
        return (dateA - dateB) * isAsc;
      }
      // Ignore 'selected' sort to avoid jumping rows
      return 0;
    });

    const start = currentPage * itemsPerPage;
    const end = start + itemsPerPage;
    setPaginated(filtered.slice(start, end));
  }, [trustlines, filters, sortColumn, sortDirection, currentPage, itemsPerPage, selectedTrustlines]);

  useEffect(() => {
    console.log('[DEBUG] Komponente ListTrustlines wurde geladen.');
  }, []); // <-- keine Abhängigkeit

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (showOverviewModal) setShowOverviewModal(false);
        if (showSecretModal) setShowSecretModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showOverviewModal, showSecretModal]);

  const handlePrepareMultisig = async () => {
    try {
      if (deletableOverview.length === 0) {
        setErrorMessage(t('common:trustlines.deleteConfirm', 'Delete the selected trustlines?'));
        return;
      }
      const net = (typeof window !== 'undefined' && window.localStorage?.getItem('SKM_NETWORK') === 'TESTNET') ? 'TESTNET' : 'PUBLIC';
      const server = getHorizonServer(net === 'TESTNET' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org');
      const account = await server.loadAccount(publicKey);
      const feeStats = await server.feeStats();
      const fee = String(Number(feeStats?.fee_charged?.mode || 100));
      const txb = new TransactionBuilder(account, {
        fee,
        networkPassphrase: net === 'TESTNET' ? Networks.TESTNET : Networks.PUBLIC,
      });
      deletableOverview.forEach((tl) => {
        txb.addOperation(Operation.changeTrust({
          asset: new Asset(tl.assetCode, tl.assetIssuer),
          limit: '0',
        }));
      });
      const tx = txb.setTimeout(60).build();
      const hashHex = tx.hash().toString('hex');
      const xdr = tx.toXDR();
      let job = null;
      try {
        const r = await fetch(`${BACKEND_URL}/api/multisig/jobs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            network: net === 'TESTNET' ? 'testnet' : 'public',
            accountId: publicKey,
            txXdr: xdr,
            createdBy: 'local',
          }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data?.error || 'multisig.jobs.create_failed');
        job = data;
      } catch (e) {
        setErrorMessage(formatErrorForUi(t, e));
        return;
      }

      setPreparedTx({
        id: job?.id,
        hash: job?.txHash || hashHex,
        xdr: job?.txXdrCurrent || xdr,
        summary: {
          title: t('multisig:prepare.title'),
          subtitle: t('multisig:prepare.subtitle'),
          items: [
            { label: t('common:account.source', 'Quelle'), value: publicKey },
            { label: t('trustline:delete'), value: `${deletableOverview.length}` },
            { label: t('common:network', 'Netzwerk'), value: net },
            job?.id ? { label: t('multisig:detail.idLabel', 'Job-ID'), value: job.id } : null,
          ].filter(Boolean),
        },
      });
      setShowOverviewModal(false);
    } catch (e) {
      setErrorMessage(formatErrorForUi(t, e));
    }
  };



  /**
   * Führt eine echte Trustline-Löschung durch, nach Validierung der gesammelten Signer.
   * Zeigt Erfolg oder Fehler im UI an.
   */
  const handleDeleteReal = async (signerKeypairs) => {
    try {
      delStartedAtRef.current = Date.now();
      const signerList = Array.isArray(signerKeypairs) ? signerKeypairs : [signerKeypairs];
      const primary = signerList?.[0];
      const sec = primary?.secret ? primary.secret() : (typeof primary === 'string' ? primary : '');
      // Formatprüfung des ersten Secret Keys
      if (sec) validateSecretKey(sec);

      const hasAccountData = !!(accountInfo?.thresholds && accountInfo?.signers);
      if (hasAccountData) {
        const required = getRequiredThreshold('changeTrust', accountInfo?.thresholds);
        const current = signerList.reduce((acc, kp) => {
          try {
            const pub = kp.publicKey();
            const s = (accountInfo?.signers || []).find((sg) => sg.key === pub || sg.public_key === pub);
            const w = Number(s?.weight || 0);
            return acc + (w > 0 ? w : 0);
          } catch { return acc; }
        }, 0);
        if (current <= 0) throw new Error('submitTransaction.failed:' + 'multisig.noKeysProvided');
        if (current < required) throw new Error('submitTransaction.failed:' + 'multisig.insufficientWeight');
      }

      // 🔍 Nur Trustlines ohne Guthaben weiterverarbeiten
      const deletableTrustlines = selectedTrustlines.filter(
        (tl) => parseFloat(tl.assetBalance) === 0
      );

      // 💬 Hinweis anzeigen, wenn Trustlines übersprungen werden
      const skippedCount = selectedTrustlines.length - deletableTrustlines.length;
      if (skippedCount > 0) {
        setInfoMessage(t('common:trustlines.skippedDueToBalance', { count: skippedCount }));
      }

      // Wenn nichts löschbar ist, Dialog schließen
      if (deletableTrustlines.length === 0) {
        setModalError(t('trustline:deleted.notFound'));
        setIsProcessing(false);
        return;
      }

      // UI vorbereiten
      setIsProcessing(true);
      setModalError('');

      if (deletableTrustlines.length === 0) {
        setModalError(t('trustline:deleted.notFound'));
        setIsProcessing(false);
        return;
      }

      const onProgress = ({ processed, total /*, phase*/ }) => {
        setDeleteProgress({ current: processed, total });
      };

      // Nur Trustlines löschen, die noch im aktuellen Trustlines-Array vorkommen
      const stillValid = deletableTrustlines.filter(tl =>
        trustlines.some(current =>
          current.assetCode === tl.assetCode &&
          current.assetIssuer === tl.assetIssuer
        )
      );

      if (stillValid.length === 0) {
        setModalError(t('trustline:deleted.notFound'));
        setIsProcessing(false);
        return;
      }

      // Fortschrittsanzeige vorbereiten
      setDeleteProgress({ current: 0, total: stillValid.length });

      // Trustlines wirklich löschen via Horizon
      const deleted = await deleteTrustlinesInChunks({
        signerKeypairs,
        trustlines: deletableTrustlines,
        onProgress,
        accountPublicKey: publicKey,
      });
      await reloadTrustlinesForCurrentAccount();

      // Erfolgsmeldung anzeigen
      const count = Math.max(1,
        Number(deleted?.length || 0),
        Number(deletableTrustlines.length || 0)
      );
      setStatusMessages([t('trustline:deleted.success', { count })]);
      setResults([]);

      // UI zurücksetzen
      setIsProcessing(false);      
      onFilterChange({ ...filters }); // Optional: filter neu anwenden
      setSelectedTrustlines((prev) =>
        prev.filter(tl => !deleted.some(d =>
          d.assetCode === tl.assetCode && d.assetIssuer === tl.assetIssuer
        ))
      );
      setSecretKey('');
      setShowSecretModal(false);
      setPendingAction(null);
    } catch (err) {
      const rawMsg = String(err?.message || '');
      const translatedOriginal = t(rawMsg, rawMsg);
      const { formatted, detail } = formatErrorForUi(t, err, { returnParts: true });

      console.error('[ERROR]', formatted);

      if (rawMsg === 'secretKey.mismatch') {
        setModalError(translatedOriginal);
        alert(translatedOriginal);
      } else {
        setModalError(formatted);
      }

      if (
        detail.includes('op_invalid_limit') ||
        detail.includes('op_has_balance') ||
        detail.includes('op_has_trustline_offer')
      ) {
        setErrorMessage(formatted); // ➜ öffnet ErrorModal
      }

      setStatusMessages([formatted]);
      setResults([]);
    } finally {
      setIsProcessing(false);
      delStartedAtRef.current = 0;
      setDelElapsedMs(0);
    }
  };

  const handleCreateTrustline = async (collectedSigners) => {
    try {
      setIsProcessing(true);
      setModalError('');
      if (!pendingAdd) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('[Trustline create] missing pendingAdd', { pendingAdd });
        }
        return;
      }
      const codeStr = String(pendingAdd.code ?? '').trim();
      const issuerStr = String(pendingAdd.issuer ?? '').trim();
      const limitStr = String(pendingAdd.limit ?? '').trim();
      if (process.env.NODE_ENV !== 'production') {
        console.debug('[AddTrustline create payload]', { code: codeStr, issuer: issuerStr, limit: limitStr });
      }
      const asset = new Asset(codeStr, issuerStr);
      const res = await submitChangeTrustTx({ asset, limit: String(limitStr), collectedSigners });

      setStatusMessages([t('trustline:add.success', { code: codeStr, issuer: issuerStr, count: 1 })]);
      setResults([]);
      await reloadTrustlinesForCurrentAccount();
      setShowSecretModal(false);
      setPendingAdd(null);
      setPendingAction(null);
      setShowAddModal(false);
    } catch (err) {
      const formatted = formatErrorForUi(t, err);
      setModalError(formatted);
      setStatusMessages([formatted]);
      setResults([]);
      if (process.env.NODE_ENV !== 'production') {
        console.error('[AddTrustline exception]', err);
      }
    } finally {
      setIsProcessing(false);
    }
  };


  const handleSortOverview = (column) => {
    const direction = overviewSort.column === column ? (overviewSort.direction === 'asc' ? 'desc' : 'asc') : 'asc';
    setOverviewSort({ column, direction });
  };

  // Nur Trustlines ohne Guthaben anzeigen
  const deletableOverview = selectedTrustlines.filter(
    (tl) => parseFloat(tl.assetBalance) === 0
  );

  const sortedOverview = [...deletableOverview].sort((a, b) => {
    const isAsc = overviewSort.direction === 'asc' ? 1 : -1;
    if (overviewSort.column === 'assetCode') {
      return a.assetCode.localeCompare(b.assetCode) * isAsc;
    } else if (overviewSort.column === 'assetBalance') {
      return (parseFloat(a.assetBalance) - parseFloat(b.assetBalance)) * isAsc;
    } else if (overviewSort.column === 'assetIssuer') {
      return a.assetIssuer.localeCompare(b.assetIssuer) * isAsc;
    }
    return 0;
  });

  const handleToggleFromOverview = (tl) => {
    const stillSelected = selectedTrustlines.filter(item => !(item.assetCode === tl.assetCode && item.assetIssuer === tl.assetIssuer));
    setSelectedTrustlines(stillSelected);
  };

  return (
    <div className="mt-4">
      {/* Menükopf mit Zurück-Button + aktuelle Ansicht */}
      <MenuHeader setMenuSelection={setMenuSelection} menuSelection={menuSelection} />
      {/* Menütitel anzeigen */}
      <h2 className="text-center text-xl font-semibold">{t('trustline:all')}</h2>
      {/* Fortschritt der Löschung an der Spitze */}
      <div className="mb-3">
        <ProgressBar {...delProg} />
        <div className="text-xs text-gray-500 mt-1">
          {t('common:progress.elapsed', { time: formatElapsedMmSs(delElapsedMs) })}
        </div>
      </div>

      { (statusMessages.length > 0 || results.length > 0) && (
        <div className="mt-4 text-sm text-blue-600 dark:text-blue-400">
          {(statusMessages.length ? statusMessages : results).map((msg, idx) => <p key={idx}>{msg}</p>)}
        </div>
      )}
 
      {/* Infoleiste: Wallet, Anzahl, Modusauswahl */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center bg-gray-500 rounded p-3 text-sm mb-4">
        <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300 mb-2 sm:mb-0 flex-wrap">
          <span>{t('trustline:all')}: {trustlines.length}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onFilterChange('zeroOnly', false)}
              className={`px-3 py-1 rounded border ${!filters.zeroOnly ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            >
              Alle anzeigen
            </button>
            <button
              type="button"
              onClick={() => { onFilterChange('zeroOnly', true); onSort('assetBalance'); }}
              className={`px-3 py-1 rounded border ${filters.zeroOnly ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
            >
              Nur löschbare
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 items-center">
          {/* 🗑️ Löschen-Button */}
          {selectedTrustlines.length > 0 && (
            <div className="ml-2">
              <button
                onClick={() => { setPendingAction('delete'); setShowOverviewModal(true); }}
                className="ml-4 px-4 py-1 bg-red-600 text-white rounded hover:bg-red-700"
              >
                {t('trustline:delete')}
              </button>
            </div>
          )}
          <div className="ml-2">
            <button
              type="button"
              onClick={() => { setShowAddModal(true); setPendingAdd(null); setPendingAction('add'); }}
              className="px-4 py-1 bg-green-600 text-white rounded hover:bg-green-700"
            >
              {t('trustline:add.button')}
            </button>
          </div>
        </div>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
        {t('trustline:onlyZeroBalanceInfo')}
      </p>
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead>
          <tr>
            <th className="px-4 py-2 text-left">
              <input
                type="checkbox"
                checked={areAllSelected(paginated, selectedTrustlines)}
                onChange={(e) => {
                  e.stopPropagation();
                  onToggleAll(paginated);
                  // UX: Nach "Alle" automatisch Guthaben-Sortierung und nur Guthaben=0 anzeigen
                  onSort('assetBalance');
                  onFilterChange('zeroOnly', true);
                }}
              />
            </th>
            <th
              className="px-4 py-2 cursor-pointer text-left"
              onClick={() => onSort('assetCode')}
            >
              {t('common:asset.code', 'Asset code')}
            </th>
            <th
              className="px-4 py-2 cursor-pointer text-left"
              onClick={() => onSort('assetBalance')}
            >
              {t('common:asset.balance', 'Balance')}
            </th>
            <th
              className="px-4 py-2 cursor-pointer text-left"
              onClick={() => onSort('assetIssuer')}
            >
              {t('common:asset.issuer', 'Issuer')}
            </th>
            <th
              className="px-4 py-2 cursor-pointer text-left"
              onClick={() => onSort('createdAt')}
            >
              {t('common:asset.creationDate', 'Created at')}
            </th>
          </tr>
        </thead>
        <tbody>
          {paginated.map((tl) => (
            <tr key={`${tl.assetCode}__${tl.assetIssuer}`} className="border-b border-gray-200 dark:border-gray-700">
              <td className="px-4 py-2 text-center align-middle">
                <input
                  type="checkbox"
                  checked={isSelected(tl, selectedTrustlines)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation();
                    if (parseFloat(tl.assetBalance) !== 0) {
                      alert(t('trustline:nonZeroBalance'));
                      return;
                    }
                    setSelectedTrustlines(prev => toggleTrustlineSelection(tl, prev));
                  }}
                  disabled={false}
                  className={parseFloat(tl.assetBalance) !== 0 ? 'opacity-50' : ''}
                  title={parseFloat(tl.assetBalance) !== 0 ? t('trustline:nonZeroBalance') : ''}
                />
              </td>
              <td className="px-4 py-2">{tl.assetCode}</td>
              <td className="px-4 py-2">{balanceFmt.format(Number(tl.assetBalance || 0))}</td>
              <td className="px-4 py-2">{tl.assetIssuer}</td>
              <td className="px-4 py-2">{tl.createdAt ? new Date(tl.createdAt).toLocaleString() : t('errors:asset.creationDateUnknown', 'Unknown creation date')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      
      {selectedTrustlines.length > 0 && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => { setPendingAction('delete'); setShowOverviewModal(true); }}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            {t('trustline:delete')}
          </button>
        </div>
      )}

      {selectedTrustlines.length !== deletableOverview.length && (
        <p className="mb-2 text-sm text-yellow-600 dark:text-yellow-400">
          {t('common:trustlines.skippedDueToBalance', {
            count: selectedTrustlines.length - deletableOverview.length,
          })}
        </p>
      )}

      {showOverviewModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg w-full max-w-3xl max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-black dark:text-white">
                {t('common:option.confirm.action.title', 'Confirm action')}
              </h2>
            </div>
            <p className="mb-4 text-sm text-gray-700 dark:text-gray-300">
              {t('common:trustlines.deleteConfirm', 'Delete the selected trustlines?')}
            </p>

            <table className="min-w-full text-sm mb-4">
              <thead>
                <tr>
                  <th className="px-2 py-1 cursor-pointer" onClick={() => handleSortOverview('assetCode')}>
                    {t('common:asset.code', 'Asset code')}
                  </th>
                  <th className="px-2 py-1 cursor-pointer" onClick={() => handleSortOverview('assetBalance')}>
                    {t('common:asset.balance', 'Balance')}
                  </th>
                  <th className="px-2 py-1 cursor-pointer" onClick={() => handleSortOverview('assetIssuer')}>
                    {t('common:asset.issuer', 'Issuer')}
                  </th>
                  <th className="px-2 py-1">{t('common:option.delete', 'Delete')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedOverview.map((tl, idx) => (
                  <tr key={idx}>
                    <td className="px-2 py-1">{tl.assetCode}</td>
                    <td className="px-2 py-1">{balanceFmt.format(Number(tl.assetBalance || 0))}</td>
                    <td className="px-2 py-1">{tl.assetIssuer}</td>
                    <td className="px-2 py-1">
                      <button
                        className="text-red-600 hover:underline"
                        onClick={() => handleToggleFromOverview(tl)}
                      >
                        {t('common:option.delete', 'Delete')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-6">
              <p className="text-sm text-red-700 dark:text-red-300 mb-3">
                {t('common:trustlines.deleteConfirm', 'Delete the selected trustlines?')}
              </p>
              <div className="flex justify-end mb-3">
                <button
                  onClick={() => { setShowOverviewModal(false); setPendingAction(null); }}
                  className="px-4 py-2 bg-gray-400 text-black rounded hover:bg-gray-500"
                >
                  {t('common:option.cancel', 'Cancel')}
                </button>
              </div>
              <div className="grid gap-3">
                <div className="border rounded p-3">
                  <div className="font-semibold mb-1">{t('multisig:confirm.testModeTitle')}</div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">{t('multisig:confirm.testModeDescription')}</p>
                  <button
                    onClick={() => {
                      setShowOverviewModal(false);
                      setPendingAction('delete');
                      setShowSecretModal(true);
                    }}
                    className="w-full px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                  >
                    {t('multisig:confirm.testModeButton')}
                  </button>
                </div>
                <div className="border rounded p-3">
                  <div className="font-semibold mb-1">{t('multisig:confirm.prepareTitle')}</div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">{t('multisig:confirm.prepareDescription')}</p>
                  <button
                    onClick={handlePrepareMultisig}
                    className="w-full px-4 py-2 rounded border border-blue-200 text-blue-700 dark:text-blue-200 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900"
                  >
                    {t('multisig:confirm.prepareButton')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddModal && (
        <AddTrustlineModal
          onSubmit={(payload) => {
            setPendingAdd(payload);
            setPendingAction('add');
            setShowAddModal(false);
            setShowSecretModal(true);
          }}
          onCancel={() => { setShowAddModal(false); setPendingAdd(null); setPendingAction(null); }}
        />
      )}

      {showSecretModal && (
        <SecretKeyModal
          onConfirm={(collected) => {
            if (pendingAction === 'add') {
              handleCreateTrustline(collected);
            } else {
              handleDeleteReal(collected.map((s) => s.keypair));
            }
          }}
          onCancel={() => { setShowSecretModal(false); setPendingAction(null); }}
          errorMessage={modalError}
          isProcessing={isProcessing}               // ⬅️ Fortschritt aktiv?
          deleteProgress={deleteProgress}           // ⬅️ Aktueller Fortschritt
          thresholds={thresholdsForModal}
          signers={signersForModal}
          operationType="changeTrust"
          requiredThreshold={requiredThreshold}
          account={accountInfo}
        />
      )}

      {isProcessing && (
        <p className="text-blue-600 text-sm mt-2">{t('common:main.processing')}</p>
      )}
      {isProcessing && deleteProgress && (
        <p className="text-sm text-blue-500 mt-2">
          {t('common:trustlines.deleted.deletingProgress', {
            current: deleteProgress.current,
            total: deleteProgress.total,
          })}
        </p>
      )}
      <ErrorModal
        message={errorMessage}
        onClose={() => setErrorMessage('')}
      />
      {preparedTx && (
        <MultisigPrepareDialog
          open={!!preparedTx}
          onClose={() => setPreparedTx(null)}
          hash={preparedTx.hash}
          xdr={preparedTx.xdr}
          summary={preparedTx.summary}
        />
      )}
  </div>
  );
}

export default ListTrustlines;
