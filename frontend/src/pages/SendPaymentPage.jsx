import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getHorizonServer, resolveOrValidateAccount, isValidAccountId, extractBasePublicKeyFromMuxed } from '../utils/stellar/stellarUtils';
import { Asset, Keypair, Networks, Operation, TransactionBuilder, Memo, StrKey } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
import SecretKeyModal from '../components/SecretKeyModal';
import { getSessionSecrets } from '../utils/sessionSecrets.js';
import { isMultisigAccount } from '../utils/stellar/isMultisigAccount.js';
import { apiUrl } from '../utils/apiBase.js';
import { mergeSignedXdr } from '../utils/multisigApi.js';
import { getRequiredThreshold } from '../utils/getRequiredThreshold.js';
import { useSettings } from '../utils/useSettings';
import { buildExplorerUrl } from '../utils/stellar/accountUtils.js';
import { isTestnetAccount } from '../utils/stellar/accountUtils.js';
import AddressDropdown from '../components/AddressDropdown.jsx';
import { useTrustedWallets } from '../utils/useTrustedWallets.js';
import { createWalletInfoMap, findWalletInfo } from '../utils/walletInfo.js';
import { getSessionSecret, rememberSessionSecrets, InsecureCryptoContextError } from '../utils/sessionSecrets.js';
import {
  INPUT_HISTORY_CHANGED_EVENT,
  PAYMENT_AMOUNT_HISTORY_KEY,
  PAYMENT_MEMO_HISTORY_KEY,
  PAYMENT_RECIPIENT_HISTORY_KEY,
  clearHistoryKey,
  readHistoryArray,
  removeHistoryValue,
  writeHistoryArray,
} from '../utils/inputHistory.js';
import { submitTransactionSafely, AmbiguousSubmitResultError } from '../utils/stellar/submitTransactionSafely.js';

// Immediate local submits (single-sig send, or a multisig job collected and
// submitted right away) expect a near-term Horizon confirmation, unlike a
// multisig job's XDR which may sit unsigned for up to a day - so they get a
// short-lived timeout instead of the long job timeout below.
const LOCAL_SUBMIT_TIMEOUT_SECONDS = 180;

// createAccount can only target a base G-account, never a muxed destination. When the
// activation path fires for a muxed recipient, this minimal follow-up payment (1 stroop,
// the smallest indivisible XLM unit) captures the muxed ID on-chain so it isn't silently lost.
const MUXED_ACTIVATION_STROOP = '0.0000001';

function HistoryInput({
  value,
  onChange,
  onFocus,
  onBlur,
  onSelect,
  onRemoveSuggestion,
  onClearSuggestions,
  suggestions = [],
  className = '',
  inputProps = {},
  rightAdornment = null,
}) {
  const { t } = useTranslation(['common']);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  const filteredSuggestions = useMemo(() => {
    const query = String(value || '').trim().toLowerCase();
    const unique = [];
    const seen = new Set();
    for (const suggestion of suggestions) {
      const item = String(suggestion || '').trim();
      if (!item || seen.has(item)) continue;
      if (!query || item.toLowerCase().includes(query)) {
        seen.add(item);
        unique.push(item);
      }
    }
    return unique;
  }, [suggestions, value]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [open]);

  const canClearSuggestions = typeof onClearSuggestions === 'function' && suggestions.length > 0;
  const showDropdown = open && (filteredSuggestions.length > 0 || canClearSuggestions);

  return (
    <div className="relative" ref={wrapperRef}>
      <input
        className={className}
        value={value}
        onFocus={(event) => {
          onFocus?.(event);
          setOpen(true);
        }}
        onBlur={(event) => {
          onBlur?.(event);
          window.setTimeout(() => {
            if (wrapperRef.current && !wrapperRef.current.contains(document.activeElement)) {
              setOpen(false);
            }
          }, 0);
        }}
        onChange={(event) => {
          onChange?.(event);
          setOpen(true);
        }}
        autoComplete="off"
        {...inputProps}
      />
      {rightAdornment}
      {showDropdown && (
        <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded border bg-white dark:bg-gray-900 shadow-lg">
          {filteredSuggestions.map((suggestion, index) => (
            <div
              key={`${suggestion}-${index}`}
              className="flex items-stretch text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left px-3 py-1.5"
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect?.(suggestion);
                  setOpen(false);
                }}
                onTouchStart={(event) => {
                  event.preventDefault();
                  onSelect?.(suggestion);
                  setOpen(false);
                }}
              >
                <span className="break-all">{suggestion}</span>
              </button>
              {typeof onRemoveSuggestion === 'function' && (
                <button
                  type="button"
                  className="shrink-0 px-3 text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-300"
                  title={t('common:inputHistory.removeEntry', 'Aus Verlauf entfernen')}
                  aria-label={t('common:inputHistory.removeEntry', 'Aus Verlauf entfernen')}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onRemoveSuggestion(suggestion);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {canClearSuggestions && (
            <button
              type="button"
              className="w-full border-t px-3 py-2 text-left text-xs text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30"
              onMouseDown={(event) => {
                event.preventDefault();
                onClearSuggestions();
                setOpen(false);
              }}
            >
              {t('common:inputHistory.clearField', 'Verlauf dieses Feldes löschen')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Maps a SEP-2 federation memo (memo_type/memo) onto SKM's local memo form model.
// 'hash' memos are base64 per SEP-2 but SKM's hash field expects hex — convert and
// validate length so a malformed federation response never silently mis-fills the form.
function federationMemoToLocal(memoType, memoValue) {
  if (typeof memoValue !== 'string' || !memoValue) return null;
  if (memoType === 'text' || memoType === 'id') {
    return { memoType, memoVal: memoValue };
  }
  if (memoType === 'hash') {
    try {
      const hex = Buffer.from(memoValue, 'base64').toString('hex');
      if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
      return { memoType: 'hash', memoVal: hex };
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeRecipientHistoryValue(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const pkMatch = trimmed.match(/G[A-Z0-9]{55}/);
  if (pkMatch) return pkMatch[0];
  const withoutTestnet = trimmed.replace(/\s*\(Testnet\)\s*/i, '').trim();
  const base = withoutTestnet.split(' - ')[0].trim();
  return base;
}

export default function SendPaymentPage({ publicKey, onBack: _onBack, initial }) {
  const { t, i18n } = useTranslation(['common', 'errors', 'publicKey', 'secretKey', 'investedTokens', 'wallet', 'multisig', 'network']);
  void _onBack;
  const { wallets } = useTrustedWallets();
  const { decimalsMode, multisigTimeoutSeconds, explorers } = useSettings();

  const [dest, setDest] = useState(initial?.recipient || '');
  const [amount, setAmount] = useState('');
  const [amountFocused, setAmountFocused] = useState(false);
  const [assetKey, setAssetKey] = useState('XLM'); // 'XLM' or 'CODE:ISSUER'
  const [memoType, setMemoType] = useState('text'); // 'none' | 'text' | 'id' | 'hash' | 'return'
  const [memoVal, setMemoVal] = useState('');
  const memoValRef = useRef(memoVal);
  useEffect(() => { memoValRef.current = memoVal; }, [memoVal]);
  // Tracks the memo value WE last auto-filled from a federation lookup, so a later lookup
  // (e.g. after the user changes the recipient) can tell "field still holds what we put
  // there" (safe to overwrite/clear) apart from "user has since edited it" (never touch
  // again). `null` means the user has taken manual control; a string means that value is
  // still ours. Initialized to '' to match the pristine (never-touched) memoVal state.
  const autoFilledMemoRef = useRef('');
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [secretModalPrefill, setSecretModalPrefill] = useState([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showOptionInfo, setShowOptionInfo] = useState(false);
  const [confirmChoice, setConfirmChoice] = useState('job');
  const [resultDialog, setResultDialog] = useState(null);
  const [copiedXdr, setCopiedXdr] = useState(false);
  const [copiedJobId, setCopiedJobId] = useState(false);
  const [copiedDetails, setCopiedDetails] = useState(false);
  const [showJobInfo, setShowJobInfo] = useState(false);
  const [pendingLocalPreflight, setPendingLocalPreflight] = useState(null);
  const [reviewDialog, setReviewDialog] = useState({ open: false, signers: [], preflight: null, snapshot: null });
  const [reviewError, setReviewError] = useState('');
  const [reviewProcessing, setReviewProcessing] = useState(false);
  const closeConfirmDialogs = useCallback(() => {
    setShowConfirmModal(false);
    setShowOptionInfo(false);
  }, []);
  const [secretError, setSecretError] = useState('');
  const [forceLocalFlow, setForceLocalFlow] = useState(false);
  const [forceSignerCount, setForceSignerCount] = useState(null);
  const [secretReturnTo, setSecretReturnTo] = useState(''); // where to go back after secret modal
  const [secretContext, setSecretContext] = useState(''); // 'job' | 'local' | 'send' | ''
  const [lastResultDialog, setLastResultDialog] = useState(null);

  const openSecretModal = useCallback((forceLocal = false, context = 'local', forceCount = null, returnTo = '') => {
    setForceLocalFlow(!!forceLocal);
    setForceSignerCount(forceCount);
    setSecretContext(context || '');
    setSecretError('');
    setSecretReturnTo(returnTo || '');
    setShowSecretModal(true);
  }, []);

  const closeSecretModal = useCallback(() => {
    setShowSecretModal(false);
    setSecretError('');
    setSecretContext('');
    setForceLocalFlow(false);
    setForceSignerCount(null);
    setSecretReturnTo('');
  }, []);

  // Pre-fills the secret modal's inputs with any secret(s) already remembered
  // for this account/session. Decryption is async (Web Crypto), so this can't
  // happen inline in the render below - it resolves into state just before/as
  // the modal becomes visible instead.
  useEffect(() => {
    let cancelled = false;
    if (!showSecretModal || !publicKey) {
      setSecretModalPrefill([]);
      return undefined;
    }
    (async () => {
      const map = await getSessionSecrets(publicKey);
      if (!cancelled) setSecretModalPrefill(Object.values(map));
    })();
    return () => { cancelled = true; };
  }, [showSecretModal, publicKey]);

  const [status, setStatus] = useState('');
  const [sentInfo, setSentInfo] = useState(null);
  const [ambiguousSubmission, setAmbiguousSubmission] = useState(null); // { hash } - set when a submit's outcome could not be confirmed
  const [isProcessing, setIsProcessing] = useState(false); // Zeigt einen globalen Processing-Indikator während des Payment-Flows an.
  const [error, setError] = useState('');
  const [preflight, setPreflight] = useState({
    loading: false,
    err: '',
    destExists: true,
    activationRequired: false,
    minReserve: 0,
    desired: 0,
    adjusted: 0,
    willBump: false,
    resolvedDest: ''
  });

  const walletInfoMap = useMemo(() => createWalletInfoMap(wallets), [wallets]);

  const clearSuccess = useCallback(() => {
    setSentInfo(null);
    setStatus('');
  }, []);

  const [balances, setBalances] = useState(null); // array from account.balances
  const [accountInfo, setAccountInfo] = useState(null); // horizon account
  const [offersCount, setOffersCount] = useState(0);
  const [baseReserve, setBaseReserve] = useState(0.5); // default fallback
  const [showReserveInfo, setShowReserveInfo] = useState(false);

  const [netLabel, setNetLabel] = useState(() => {
    try { return (typeof window !== 'undefined' && window.localStorage?.getItem('SKM_NETWORK') === 'TESTNET') ? 'TESTNET' : 'PUBLIC'; } catch { return 'PUBLIC'; }
  });
  const server = useMemo(() => {
    const url = netLabel === 'TESTNET' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org';
    return getHorizonServer(url);
  }, [netLabel]);
  const popupRef = useRef(null);

  const normalizeAmountValue = useCallback(() => {
    let raw = (amount || '').trim();
    if (raw.endsWith('.')) raw = raw.slice(0, -1);
    if (!raw) throw new Error(t('common:payment.send.amountMissing'));
    if (!/^\d+(\.\d{1,7})?$/.test(raw)) throw new Error(t('common:payment.send.amountInvalid'));
    const [intPartRaw, fracPartRaw = ''] = raw.split('.');
    const intPart = intPartRaw.replace(/^0+(?=\d)/, '') || '0';
    const fracPart = fracPartRaw.replace(/0+$/, '');
    const normalized = fracPart ? `${intPart}.${fracPart}` : intPart;
    if (parseFloat(normalized) <= 0) throw new Error(t('common:payment.send.amountPositive'));
    return normalized;
  }, [amount, t]);

  const buildMemoObject = useCallback(() => {
    const value = (memoVal || '').trim();
    if (!value || memoType === 'none') {
      return { memo: undefined, display: '' };
    }
    try {
      switch (memoType) {
        case 'text':
          return { memo: Memo.text(value), display: value };
        case 'id':
          return { memo: Memo.id(value), display: value };
        case 'hash': {
          const hex = value.replace(/^0x/i, '');
          if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('invalid');
          return { memo: Memo.hash(Buffer.from(hex, 'hex')), display: value };
        }
        case 'return': {
          const hex = value.replace(/^0x/i, '');
          if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('invalid');
          return { memo: Memo.return(Buffer.from(hex, 'hex')), display: value };
        }
        default:
          return { memo: undefined, display: '' };
      }
    } catch {
      throw new Error(t('errors:query.invalidMemo'));
    }
  }, [memoType, memoVal, t]);

  const describeHorizonError = useCallback((err) => {
    const extras = err?.response?.data?.extras;
    if (extras?.result_codes) {
      const tx = extras.result_codes.transaction;
      const ops = extras.result_codes.operations;
      let codes = '';
      if (tx) codes = tx;
      if (ops) {
        const opText = Array.isArray(ops) ? ops.join(', ') : ops;
        codes = codes ? `${codes} / ${opText}` : opText;
      }
      return codes
        ? `${t('common:payment.send.horizonError')} (${codes})`
        : t('common:payment.send.horizonError');
    }
    const status = err?.response?.status;
    if (status === 504) return t('common:payment.send.timeout');
    if (typeof status === 'number') {
      return t('common:payment.send.httpError', { status });
    }
    return err?.message || 'unknown';
  }, [t]);

  const handlePaymentError = useCallback((err) => {
    console.error('Payment submission failed', err);
    const detail = describeHorizonError(err);
    setError(t('common:payment.send.error', { detail }));
    return detail;
  }, [describeHorizonError, t]);

  const applySendResult = useCallback((payload) => {
    setStatus(payload.hash);
    setSentInfo({
      account: publicKey,
      recipient: payload.recipient,
      amount: Number(payload.amountDisplay),
      amountDisplay: payload.amountDisplay,
      asset: payload.asset,
      memo: payload.memo,
      activated: !!payload.activated,
      muxedActivationCapture: !!payload.muxedActivationCapture,
    });
  }, [publicKey]);

  const runPreflight = useCallback(async () => {
    let nextState = {
      loading: true,
      err: '',
      destExists: true,
      activationRequired: false,
      minReserve: 0,
      desired: 0,
      adjusted: 0,
      willBump: false,
      resolvedDest: ''
    };
    try {
      setPreflight(nextState);
      const v = (dest || '').trim();
      if (!v) {
        nextState = { ...nextState, loading: false, err: t('publicKey:destination.error') };
        setPreflight(nextState);
        return nextState;
      }
      let resolvedDest;
      let resolvedAccountId;
      try {
        const resolved = await resolveOrValidateAccount(v);
        resolvedAccountId = resolved.accountId;
        resolvedDest = resolved.muxedAddress || resolved.accountId;
      } catch {
        nextState = { ...nextState, loading: false, err: t('publicKey:destination.error') };
        setPreflight(nextState);
        return nextState;
      }
      let desiredNum = 0;
      try {
        desiredNum = Number(normalizeAmountValue());
      } catch (e) {
        nextState = { ...nextState, loading: false, err: e?.message || t('common:payment.send.amountInvalid') };
        setPreflight(nextState);
        return nextState;
      }
      const minReserve = (baseReserve || 0.5) * 2;
      let destExists = true;
      try {
        await server.loadAccount(resolvedAccountId);
      } catch {
        destExists = false;
      }
      if (!destExists) {
        if (assetKey !== 'XLM') {
          nextState = {
            loading: false,
            err: t('common:payment.send.destUnfundedNonNative', 'Destination account is not active. Please send XLM to activate it first or switch the asset to XLM.'),
            destExists,
            activationRequired: true,
            minReserve,
            desired: desiredNum,
            adjusted: desiredNum,
            willBump: false,
            resolvedDest
          };
          setPreflight(nextState);
          return nextState;
        }
        const adjusted = Math.max(desiredNum, minReserve);
        nextState = {
          loading: false,
          err: '',
          destExists,
          activationRequired: true,
          minReserve,
          desired: desiredNum,
          adjusted,
          willBump: adjusted > desiredNum,
          resolvedDest
        };
        setPreflight(nextState);
        return nextState;
      }
      nextState = {
        loading: false,
        err: '',
        destExists,
        activationRequired: false,
        minReserve,
        desired: desiredNum,
        adjusted: desiredNum,
        willBump: false,
        resolvedDest
      };
      setPreflight(nextState);
      return nextState;
    } catch (e) {
      nextState = { ...nextState, loading: false, err: e?.message || 'unknown' };
      setPreflight(nextState);
      return nextState;
    }
  }, [assetKey, baseReserve, dest, normalizeAmountValue, server, t]);

  const formatNetworkLabel = useCallback((net) => {
    const v = String(net || '').toUpperCase();
    if (v === 'TESTNET') return t('network:testnet', 'Testnet');
    if (v === 'PUBLIC') return t('network:mainnet', 'Mainnet');
    return net || '';
  }, [t]);

  const buildSummaryItems = useCallback((summary) => {
    if (!summary) return [];
    const items = [
      { label: t('common:account.source', 'Quelle'), value: summary.source },
      { label: t('common:payment.send.recipient'), value: summary.recipient },
      { label: t('common:payment.send.amount'), value: summary.amount },
      { label: t('common:payment.send.memo'), value: summary.memo || '-' },
    ];
    if (summary.network) {
      items.push({ label: t('common:networkLabel', 'Netzwerk'), value: formatNetworkLabel(summary.network) });
    }
    return items;
  }, [formatNetworkLabel, t]);

  const reopenSelection = useCallback((choice) => {
    setResultDialog(null);
    setCopiedXdr(false);
    if (choice) setConfirmChoice(choice);
    setShowConfirmModal(true);
    void runPreflight();
  }, [runPreflight]);

  const handleCopyXdr = useCallback(async (text) => {
    try {
      await navigator.clipboard.writeText(text || '');
      setCopiedXdr(true);
      setTimeout(() => setCopiedXdr(false), 1500);
    } catch (e) {
      console.error('copy failed', e);
    }
  }, []);

  const handleCopyJobId = useCallback(async (text) => {
    try {
      await navigator.clipboard.writeText(text || '');
      setCopiedJobId(true);
      setTimeout(() => setCopiedJobId(false), 1500);
    } catch (e) {
      console.error('copy job id failed', e);
    }
  }, []);

  const handleCopySentDetails = useCallback(async (dialog) => {
    if (!dialog) return;
    const lines = buildSummaryItems(dialog.summary).map((item) => `${item.label}: ${item.value}`);
    if (dialog.hash) {
      const hashLabel = dialog.type === 'sent'
        ? t('multisig:confirm.result.sent.hashLabel', 'Transaktions-Hash')
        : t('multisig:confirm.result.job.hashLabel', 'Transaktions-Hash');
      lines.push(`${hashLabel}: ${dialog.hash}`);
    }
    try {
      await navigator.clipboard.writeText(lines.filter(Boolean).join('\n'));
      setCopiedDetails(true);
      setTimeout(() => setCopiedDetails(false), 1500);
    } catch (e) {
      console.error('copy details failed', e);
    }
  }, [buildSummaryItems, t]);

  const showErrorMessage = useCallback((msg) => {
    setError(msg || '');
    try {
      if (msg && typeof window !== 'undefined') {
        window.alert(msg);
      }
    } catch { /* ignore alert errors */ }
  }, []);

  const closeResultDialog = useCallback(() => {
    setResultDialog(null);
    setCopiedXdr(false);
    setCopiedJobId(false);
    setCopiedDetails(false);
    setShowJobInfo(false);
    setLastResultDialog(null);
    setSecretReturnTo('');
  }, []);

  const closeReviewDialog = useCallback(() => {
    setReviewDialog({ open: false, signers: [], preflight: null, snapshot: null });
    setReviewError('');
    setReviewProcessing(false);
  }, []);

  const txExplorers = useMemo(() => {
    const list = explorers || [];
    return {
      stellarchain: list.find((exp) => (exp.key || exp.id) === 'stellarchain') || null,
      stellarExpert: list.find((exp) => (exp.key || exp.id) === 'stellar_expert') || null,
    };
  }, [explorers]);

  const thresholdsForModal = useMemo(() => {
    if (!accountInfo?.thresholds) return null;
    return {
      low_threshold: Number(accountInfo.thresholds.low_threshold ?? 0),
      med_threshold: Number(accountInfo.thresholds.med_threshold ?? 0),
      high_threshold: Number(accountInfo.thresholds.high_threshold ?? 0),
    };
  }, [accountInfo]);
  const signersForModal = useMemo(
    () => (accountInfo?.signers || []).map((s) => ({
      public_key: s.key || s.public_key || s.ed25519PublicKey || '',
      weight: Number(s.weight || 0),
    })).filter((s) => !!s.public_key),
    [accountInfo]
  );
  const requiredThreshold = useMemo(
    () => getRequiredThreshold('payment', thresholdsForModal),
    [thresholdsForModal]
  );
  const masterWeight = useMemo(() => {
    const master = signersForModal.find((s) => s.public_key === publicKey);
    return Number(master?.weight || 0);
  }, [signersForModal, publicKey]);

  const buildPaymentTx = useCallback(async ({ signers, signTx = false, requireSigners = false, immediateSubmit = false } = {}) => {
    const signerList = Array.isArray(signers) ? signers.filter(Boolean) : [];
    const primary = signerList[0];
    if (requireSigners && !primary) throw new Error('submitTransaction.failed:' + 'multisig.noKeysProvided');
    if (primary) {
      const sec = primary.secret?.();
      if (sec) Keypair.fromSecret(sec); // validate
    }
    const isTestnet = typeof window !== 'undefined' && window.localStorage?.getItem('SKM_NETWORK') === 'TESTNET';
    const net = isTestnet ? Networks.TESTNET : Networks.PUBLIC;
    const account = await server.loadAccount(publicKey);
    const feeStats = await server.feeStats();
    const fee = Number(feeStats?.fee_charged?.mode || 100);
    const { memo, display: memoDisplay } = buildMemoObject();
    let resolvedDest;
    let resolvedAccountId;
    let isMuxedDestination;
    try {
      const resolved = await resolveOrValidateAccount(dest);
      resolvedAccountId = resolved.accountId;
      resolvedDest = resolved.muxedAddress || resolved.accountId;
      isMuxedDestination = !!resolved.muxedAddress;
    } catch (resolveError) {
      throw new Error(t(resolveError?.message || 'resolveOrValidatePublicKey.invalid'));
    }
    const paymentAmount = normalizeAmountValue();
    let asset;
    let assetLabel = 'XLM';
    if (assetKey === 'XLM') {
      asset = Asset.native();
    } else {
      const [code, issuer] = assetKey.split(':');
      asset = new Asset(code, issuer);
      assetLabel = code || 'XLM';
    }

    let destExists = true;
    try {
      await server.loadAccount(resolvedAccountId);
    } catch {
      destExists = false;
    }

    let tx;
    const txTimeout = immediateSubmit
      ? LOCAL_SUBMIT_TIMEOUT_SECONDS
      : Math.max(60, Number(multisigTimeoutSeconds || 0) || 86400);
    let activated = false;
    let muxedActivationCapture = false;
    if (!destExists) {
      if (assetKey !== 'XLM') {
        throw new Error(t('common:payment.send.destUnfundedNonNative', 'Destination account is not active. Please send XLM to activate it first or switch the asset to XLM.'));
      }
      const desired = parseFloat(paymentAmount);
      const minStart = Math.max(desired, (baseReserve || 0.5) * 2);
      const startingBalance = (Math.round(minStart * 1e7) / 1e7).toFixed(7).replace(/\.0+$/, '');
      const builder = new TransactionBuilder(account, { fee, networkPassphrase: net, memo })
        .addOperation(Operation.createAccount({ destination: resolvedAccountId, startingBalance }));
      if (isMuxedDestination) {
        // createAccount can only target the base G-account, so the muxed ID would otherwise
        // never reach the ledger. A minimal follow-up payment to the muxed destination (same
        // tx, executes after the account exists) captures the ID via a real muxed operation.
        builder.addOperation(Operation.payment({
          destination: resolvedDest,
          amount: MUXED_ACTIVATION_STROOP,
          asset: Asset.native(),
        }));
        muxedActivationCapture = true;
      }
      tx = builder.setTimeout(txTimeout).build();
      activated = true;
      assetLabel = 'XLM';
    } else {
      tx = new TransactionBuilder(account, { fee, networkPassphrase: net, memo })
        .addOperation(Operation.payment({ destination: resolvedDest, amount: paymentAmount, asset }))
        .setTimeout(txTimeout)
        .build();
    }

    if (signTx && signerList.length) {
      const signFailures = [];
      signerList.forEach((kpItem) => {
        try { tx.sign(kpItem); } catch (err) { signFailures.push(err); }
      });
      if (signFailures.length > 0) {
        console.error('[SKM] Payment signing failed for one or more keys', signFailures);
        throw new Error(t('errors:submitTransaction.failed.signingFailed', 'One or more signatures could not be created. Please try again.'));
      }
      if (import.meta.env.MODE !== 'production') {
        const required = requiredThreshold || 0;
        const signerMeta = signerList.map((s) => ({ publicKey: s.publicKey(), weight: (signersForModal.find((si)=>si.public_key===s.publicKey())?.weight)||0 }));
        const current = signerMeta.reduce((acc, s) => acc + Number(s.weight || 0), 0);
        console.debug('multisig payment signing', { required, current, signers: signerMeta });
      }
    }

    const amountDisplayOut = activated ? (
      (() => {
        const desired = parseFloat(paymentAmount);
        const minStart = Math.max(desired, (baseReserve || 0.5) * 2);
        return (Math.round(minStart * 1e7) / 1e7).toFixed(7).replace(/\.0+$/, '');
      })()
    ) : paymentAmount;

    return {
      tx,
      meta: {
        recipient: resolvedDest,
        amountDisplay: amountDisplayOut,
        asset: assetLabel,
        memo: memoDisplay,
        activated,
        muxedActivationCapture,
      },
    };
  }, [assetKey, baseReserve, buildMemoObject, dest, multisigTimeoutSeconds, normalizeAmountValue, publicKey, requiredThreshold, server, signersForModal, t]);

  // Send-time guard against sending without a memo a federation server expects (SEP-2).
  // Re-resolves `dest` fresh (same call buildPaymentTx itself makes) rather than trusting
  // the resolve-effect's state, so a debounced/stale effect can't let a mismatch slip
  // through. Returns true when it's fine to proceed immediately; false when it has opened
  // a confirmation dialog and the caller must stop (the dialog resumes via
  // pendingMemoActionRef for "send anyway", or the user re-triggers send after "apply memo").
  const [memoMismatchDialog, setMemoMismatchDialog] = useState(null);
  const pendingMemoActionRef = useRef(null);

  const checkFederationMemoMismatch = useCallback(async () => {
    const v = (dest || '').trim();
    if (!v) return true;
    let resolved;
    try {
      resolved = await resolveOrValidateAccount(v);
    } catch {
      return true; // resolution failure is reported by buildPaymentTx's own error handling
    }
    if (!resolved?.memo) return true; // Fall C: no expected memo, nothing to confirm
    const mapped = federationMemoToLocal(resolved.memoType, resolved.memo);
    let currentMemoDisplay = '';
    try {
      currentMemoDisplay = buildMemoObject().display || '';
    } catch {
      return true; // an invalid memo is already reported by buildMemoObject's own caller
    }
    if (mapped && currentMemoDisplay.trim() === mapped.memoVal.trim()) return true;
    setMemoMismatchDialog({
      mappable: !!mapped,
      expectedMemo: mapped ? mapped.memoVal : '',
      expectedMemoType: mapped ? mapped.memoType : null,
      currentMemo: currentMemoDisplay,
    });
    return false;
  }, [dest, buildMemoObject]);

  const closeMemoMismatchDialog = useCallback(() => {
    setMemoMismatchDialog(null);
    pendingMemoActionRef.current = null;
  }, []);

  // Applies the federation-expected memo to the form. Deliberately does NOT auto-resume the
  // send afterwards - re-reading component state synchronously after a setState call would
  // still observe the pre-update value, so silently resubmitting here risks sending with the
  // very state the user just changed on screen. Requiring an explicit second click on Send
  // is safer for a money-movement action, and now the mismatch check will pass.
  const acceptExpectedFederationMemo = useCallback(() => {
    setMemoMismatchDialog((dlg) => {
      if (dlg?.mappable) {
        setMemoType(dlg.expectedMemoType);
        setMemoVal(dlg.expectedMemo);
        autoFilledMemoRef.current = dlg.expectedMemo;
        setFederationMemoApplied(true);
      }
      return null;
    });
    pendingMemoActionRef.current = null;
  }, []);

  // "Send anyway": safe to resume the exact action that was paused, even though it was
  // captured in an earlier render's closure - nothing relevant (dest/memo state) has changed
  // between the check and this click, since the user only interacted with the dialog itself.
  const sendAnywayDespiteMemoMismatch = useCallback(async () => {
    const action = pendingMemoActionRef.current;
    closeMemoMismatchDialog();
    if (action) await action();
  }, [closeMemoMismatchDialog]);

  // Send-time guard against a payment that's protocol-guaranteed to fail: the recipient has
  // no trustline for the asset, or has one the issuer hasn't authorized. Unlike the memo
  // mismatch check above, this hard-blocks - there is no legitimate "send anyway", the
  // transaction cannot succeed either way. A destination that doesn't exist yet is left
  // alone (no trustline can exist on an unfunded account; the existing activation path
  // already covers that case), and a genuine Horizon failure (network/timeout) never blocks
  // - only a definitive "no trustline"/"not authorized" answer does, same as before this
  // check existed, just with a console warning for debugging.
  const checkRecipientTrustlineStatus = useCallback(async () => {
    if (assetKey === 'XLM') return { status: 'ok' };
    const v = (dest || '').trim();
    if (!v) return { status: 'ok' };
    const [assetCode, assetIssuer] = assetKey.split(':');

    let resolvedAccountId;
    try {
      const resolved = await resolveOrValidateAccount(v);
      resolvedAccountId = resolved.accountId;
    } catch {
      return { status: 'ok' }; // resolution failure is reported by buildPaymentTx's own error handling
    }

    // The issuer never holds a trustline on its own asset - sending back to it (redemption/
    // burn) is protocol-valid without one, so it must never be treated as "no trustline".
    if (resolvedAccountId === assetIssuer) return { status: 'ok' };

    let account;
    try {
      account = await server.loadAccount(resolvedAccountId);
    } catch (e) {
      if (e?.response?.status === 404) return { status: 'ok' }; // unfunded - activation path handles this
      console.warn('[SKM] trustline preflight: could not load recipient account', e);
      return { status: 'ok' };
    }

    const balance = (account.balances || []).find(
      (b) => b.asset_code === assetCode && b.asset_issuer === assetIssuer
    );
    if (!balance) return { status: 'no_trustline', assetLabel: assetCode };

    // stellar-core checks only the trustline's own authorized flag at payment time - an
    // issuer that later drops AUTH_REQUIRED does not retroactively authorize existing
    // trustlines, so gating on the issuer's current flag would let a still-unauthorized
    // trustline through. is_authorized === false is sufficient on its own.
    if (balance.is_authorized === false) {
      return { status: 'not_authorized', assetLabel: assetCode };
    }
    return { status: 'ok' };
  }, [assetKey, dest, server]);

  // Runs both pre-submit guards - trustline (hard block, no override) then federation-memo
  // (soft block via a confirmation dialog) - in the same order at every entry point that can
  // actually move funds, so none of them can skip either check. `onTrustlineBlock(message)`
  // is invoked (and this resolves to false without calling `proceed`) when the payment is
  // protocol-guaranteed to fail. Otherwise `proceed` either runs immediately (both checks
  // passed) or is captured in pendingMemoActionRef for the memo dialog's "send anyway" to
  // resume later - callers must give `proceed` its own try/catch/finally, since it may run
  // from that later, unguarded call instead of from here.
  const runPreSubmitChecks = useCallback(async (proceed, onTrustlineBlock) => {
    const trustlineStatus = await checkRecipientTrustlineStatus();
    if (trustlineStatus.status === 'no_trustline') {
      onTrustlineBlock(t('common:payment.send.trustlineError.noTrustline', { asset: trustlineStatus.assetLabel }));
      return false;
    }
    if (trustlineStatus.status === 'not_authorized') {
      onTrustlineBlock(t('common:payment.send.trustlineError.notAuthorized', { asset: trustlineStatus.assetLabel }));
      return false;
    }

    const memoOk = await checkFederationMemoMismatch();
    if (!memoOk) {
      pendingMemoActionRef.current = proceed;
      return false;
    }

    await proceed();
    return true;
  }, [checkRecipientTrustlineStatus, checkFederationMemoMismatch, t]);

  const submitPayment = useCallback(async (signerKeypairs) => {
    const signerList = Array.isArray(signerKeypairs) ? signerKeypairs : [signerKeypairs];
    const { tx, meta } = await buildPaymentTx({ signers: signerList, signTx: true, requireSigners: true, immediateSubmit: true });
    const txHash = tx.hash().toString('hex');
    const res = await submitTransactionSafely(server, tx);
    return {
      hash: res.hash || res.id || txHash,
      recipient: meta.recipient,
      amountDisplay: meta.amountDisplay,
      asset: meta.asset,
      memo: meta.memo,
      activated: meta.activated,
      muxedActivationCapture: meta.muxedActivationCapture,
      network: netLabel,
    };
  }, [buildPaymentTx, netLabel, server]);

  // Export produces an unsigned XDR that may be signed and submitted later - possibly by a
  // different person, offline, well after this click. Skipping the pre-submit guards here
  // would let a protocol-guaranteed-to-fail (no trustline) or federation-memo-mismatched XDR
  // out the door, only to surface as a raw error code at submit time, far removed from this
  // form's context. Routed through the same runPreSubmitChecks as the other send paths so
  // none of them can drift out of sync again; the trustline block hard-stops (no "export
  // anyway" - the tx cannot succeed either way), while a memo mismatch reuses the existing
  // confirmation dialog and resumes via "Send anyway" into export instead of submitPayment.
  const handleExportXdr = useCallback(async () => {
    try {
      if (preflight.loading || preflight.err) {
        setError(preflight.err || t('errors:unknown', 'Unbekannter Fehler'));
        return;
      }

      const proceed = async () => {
        try {
          const { tx, meta } = await buildPaymentTx({ signTx: false, requireSigners: false });
          const hashHex = tx.hash().toString('hex');
          const xdr = tx.toXDR();
          setResultDialog({
            type: 'xdr',
            summary: {
              source: publicKey,
              recipient: meta.recipient,
              amount: `${meta.amountDisplay} ${meta.asset}`,
              memo: meta.memo || '-',
              network: netLabel,
            },
            hash: hashHex,
            xdr,
            muxedActivationCapture: meta.muxedActivationCapture,
          });
          closeConfirmDialogs();
        } catch (err) {
          handlePaymentError(err);
        }
      };

      await runPreSubmitChecks(proceed, (msg) => showErrorMessage(msg));
    } catch (err) {
      handlePaymentError(err);
    }
  }, [buildPaymentTx, closeConfirmDialogs, handlePaymentError, netLabel, preflight, publicKey, runPreSubmitChecks, showErrorMessage, t]);

  useEffect(() => {
    clearSuccess();
  }, [publicKey, initial, clearSuccess]);

  useEffect(() => {
    const handler = (e) => {
      try {
        const v = (typeof e?.detail === 'string') ? e.detail : (window.localStorage?.getItem('SKM_NETWORK') || 'PUBLIC');
        setNetLabel(v === 'TESTNET' ? 'TESTNET' : 'PUBLIC');
      } catch { /* noop */ }
    };
    window.addEventListener('stm-network-changed', handler);
    return () => window.removeEventListener('stm-network-changed', handler);
  }, []);


  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!publicKey) return;
      setError('');
      clearSuccess();
      setStatus('');
      try {
        const acct = await server.loadAccount(publicKey);
        if (cancelled) return;
        setAccountInfo(acct);
        setBalances(acct.balances || []);
        // offers count
        try {
          const offers = await server.offers().forAccount(publicKey).limit(1).call();
          const total = (offers?.records?.length || 0) < 1 ? 0 : (offers?.records?._embedded?.records?.length || offers.records.length); // horizon may not provide total easily
          // naive: follow next pages not needed just for count; approximate via first page length
          setOffersCount(total);
        } catch { setOffersCount(0); }
        // latest ledger base reserve
        try {
          const ledgers = await server.ledgers().order('desc').limit(1).call();
          const br = parseFloat((ledgers?.records?.[0]?.base_reserve_in_stroops || '5000000')) / 1e7;
          if (!Number.isNaN(br)) setBaseReserve(br);
        } catch { /* keep default */ }
      } catch (e) {
        if (!cancelled) setError(t('common:error.loadTrustlines') + ': ' + (e?.message || ''));
      }
    }
    load();
    return () => { cancelled = true; };
  }, [publicKey, server, t, clearSuccess]);

  // Close popup when clicking outside
  useEffect(() => {
    if (!showReserveInfo) return;
    const onDocClick = (e) => {
      try {
        if (popupRef.current && !popupRef.current.contains(e.target)) {
          setShowReserveInfo(false);
        }
      } catch { /* noop */ }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showReserveInfo]);

  const native = useMemo(() => (balances || []).find(b => b.asset_type === 'native') || { balance: '0', selling_liabilities: '0' }, [balances]);
  const trustlines = useMemo(() => (balances || []).filter(b => b.asset_type !== 'native' && b.asset_type !== 'liquidity_pool_shares'), [balances]);
  const lpTrusts = useMemo(() => (balances || []).filter(b => b.asset_type === 'liquidity_pool_shares'), [balances]);

  const handlePrepareMultisig = useCallback(async (initialSigners = [], opts = {}) => {
    try {
      if (preflight.loading || preflight.err) {
        setError(preflight.err || t('errors:unknown', 'Unbekannter Fehler'));
        return;
      }
      const saved = await getSessionSecret(publicKey, publicKey);
      let storedSigner = null;
      try {
        storedSigner = saved ? Keypair.fromSecret(saved) : null;
        if (storedSigner && storedSigner.publicKey() !== publicKey) {
          storedSigner = null; // Nur Secret des geladenen Kontos zulassen
        }
      } catch {
        storedSigner = null;
      }

      const providedSigners = Array.isArray(initialSigners) ? initialSigners.filter(Boolean) : [];
      const signers = providedSigners.length ? providedSigners : (storedSigner ? [storedSigner] : []);

      const allowUnsigned = opts.allowUnsigned === true;

      if (!signers.length && masterWeight > 0 && !allowUnsigned) {
        // Kein Secret im SessionStorage: Secret-Modal öffnen, nur Master-Key erlauben
        closeConfirmDialogs();
        openSecretModal(false, 'job');
        return;
      }

      if (!signers.length && masterWeight <= 0) {
        // master=0 -> Job ohne lokale Signatur erstellen
      }

      const proceed = async () => {
        try {
          const { tx, meta } = await buildPaymentTx({ signers, signTx: signers.length > 0, requireSigners: false });
          const hashHex = tx.hash().toString('hex');
          const xdr = tx.toXDR();
          const signerMeta = (accountInfo?.signers || []).map((s) => ({
            publicKey: s.key || s.publicKey || s.public_key || '',
            weight: Number(s.weight || 0),
          })).filter((s) => s.publicKey && s.weight > 0);
          const requiredWeight = (() => {
            if (requiredThreshold) return requiredThreshold;
            const thr = accountInfo?.thresholds || {};
            return Number(thr.med_threshold ?? thr.med ?? 0) || 0;
          })();
          const collectedForJob = Array.isArray(signers)
            ? signers.map((kp) => {
                const pk = kp?.publicKey?.() || '';
                const w = signerMeta.find((s) => s.publicKey === pk)?.weight ?? 0;
                return pk ? { publicKey: pk, weight: w } : null;
              }).filter(Boolean)
            : [];
          const payload = {
            network: netLabel === 'TESTNET' ? 'testnet' : 'public',
            accountId: publicKey,
            txXdr: xdr,
            createdBy: 'local',
            signers: signerMeta,
            requiredWeight: requiredWeight || null,
            clientCollected: collectedForJob,
          };
          let job = null;
          try {
            const r = await fetch(apiUrl('multisig/jobs'), {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) {
              const detail = data?.detail ? `: ${data.detail}` : '';
              throw new Error((data?.error || 'multisig.jobs.create_failed') + detail);
            }
            job = data;
          } catch (e) {
            const detail = e?.message || 'multisig.jobs.create_failed';
            showErrorMessage(detail);
            closeConfirmDialogs();
            return;
          }
          const jobId = job?.id || job?.jobId || '';
          const jobHash = job?.txHash || job?.tx_hash || hashHex;
          const jobXdr = job?.txXdrCurrent || job?.tx_xdr_current || xdr;
          if (!jobId) {
            handlePaymentError(new Error('multisig.jobs.create_failed'));
            return;
          }
          setResultDialog({
            type: 'job',
            summary: {
              source: publicKey,
              recipient: meta.recipient,
              amount: `${meta.amountDisplay} ${meta.asset}`,
              memo: meta.memo || '-',
              network: netLabel,
            },
            jobId,
            hash: jobHash,
            xdr: jobXdr,
            muxedActivationCapture: meta.muxedActivationCapture,
          });
          closeConfirmDialogs();
        } catch (err) {
          const detail = err?.message || handlePaymentError(err);
          showErrorMessage(detail || '');
          closeConfirmDialogs();
        }
      };

      await runPreSubmitChecks(proceed, (msg) => showErrorMessage(msg));
    } catch (err) {
      const detail = err?.message || handlePaymentError(err);
      showErrorMessage(detail || '');
      closeConfirmDialogs();
    }
  }, [accountInfo, buildPaymentTx, runPreSubmitChecks, closeConfirmDialogs, handlePaymentError, masterWeight, netLabel, openSecretModal, preflight, publicKey, requiredThreshold, showErrorMessage, t]);

  const handleConfirmProceed = useCallback(async () => {
    if (confirmChoice === 'local') {
      closeConfirmDialogs();
      openSecretModal(true, 'local');
      return;
    }
    if (confirmChoice === 'xdr') {
      await handleExportXdr();
      return;
    }
    await handlePrepareMultisig([], { allowUnsigned: true });
  }, [closeConfirmDialogs, confirmChoice, handleExportXdr, handlePrepareMultisig, openSecretModal]);

  const isMultisig = useMemo(() => isMultisigAccount(accountInfo), [accountInfo]);

  // Resolve recipient helpers
  const [resolvedAccount, setResolvedAccount] = useState('');
  const [resolvedFederation, setResolvedFederation] = useState('');
  const [inputWasFederation, setInputWasFederation] = useState(false);
  const [federationMemoApplied, setFederationMemoApplied] = useState(false);
  const [recipientRefreshKey, setRecipientRefreshKey] = useState(0);

  // Holds the memoType that belongs to the auto-fill the memoVal updater below just
  // decided to apply (or `null` for a clear), so the effect further down can sync
  // memoType/federationMemoApplied once that decision has actually landed in state.
  // `undefined` means "the updater declined to touch memoVal - nothing to sync".
  // React does not guarantee a functional setState updater runs synchronously (it may be
  // deferred to the render phase), so reading the outcome immediately after calling
  // setMemoVal is not reliable - this ref + effect pairing waits for the real commit instead.
  const pendingAutoFillMemoTypeRef = useRef(undefined);

  // Applies (or clears) the federation-sourced memo for the just-resolved destination. Only
  // touches the field if it still holds exactly what a PREVIOUS auto-fill put there
  // (autoFilledMemoRef) — a manual edit (see markMemoManuallyEdited) permanently opts the
  // field out until this runs again with a genuinely new lookup result. Passing `mapped =
  // null` clears a stale auto-filled memo when the new destination has none (e.g. the user
  // switched away from a federation address). Uses a functional update on memoVal so a
  // same-tick keystroke from the user can never be clobbered by a slow-returning lookup.
  const applyFederationMemo = useCallback((mapped) => {
    setMemoVal((prev) => {
      const safeToTouch = autoFilledMemoRef.current !== null && prev === autoFilledMemoRef.current;
      if (!safeToTouch) {
        pendingAutoFillMemoTypeRef.current = undefined;
        return prev;
      }
      const next = mapped ? mapped.memoVal : '';
      autoFilledMemoRef.current = next;
      pendingAutoFillMemoTypeRef.current = mapped ? mapped.memoType : null;
      return next;
    });
  }, []);

  useEffect(() => {
    const pendingType = pendingAutoFillMemoTypeRef.current;
    if (pendingType === undefined) return; // updater left memoVal untouched
    pendingAutoFillMemoTypeRef.current = undefined;
    if (pendingType) {
      setMemoType(pendingType);
      setFederationMemoApplied(true);
    } else {
      setFederationMemoApplied(false);
    }
  }, [memoVal]);

  // Any manual memo change (typing, clearing, picking a history suggestion, or an external
  // prefill) takes the field out of federation-autofill control until a fresh lookup applies
  // a genuinely new value — see applyFederationMemo's safeToTouch check above.
  const markMemoManuallyEdited = useCallback(() => {
    autoFilledMemoRef.current = null;
    setFederationMemoApplied(false);
  }, []);

  // Destination XLM balance state (resolved recipient account)
  const [destXlmBalance, setDestXlmBalance] = useState(undefined); // undefined = not resolved yet; null = unfunded/error; string = balance
  const [destXlmLoading, setDestXlmLoading] = useState(false);
  useEffect(() => {
    let active = true;
    async function resolve() {
      try {
        const v = (dest || '').trim();
        if (!v) { setResolvedAccount(''); setResolvedFederation(''); setInputWasFederation(false); applyFederationMemo(null); return; }
        if (v.includes('*')) {
          const acc = await resolveOrValidateAccount(v);
          if (!active) return;
          setResolvedAccount(acc.accountId);
          setResolvedFederation(v);
          setInputWasFederation(true);
          const mapped = federationMemoToLocal(acc.memoType, acc.memo);
          applyFederationMemo(mapped);
        } else if (isValidAccountId(v)) {
          const resolved = StrKey.isValidMed25519PublicKey(v)
            ? extractBasePublicKeyFromMuxed(v)
            : v;
          setResolvedAccount(resolved);
          setInputWasFederation(false);
          applyFederationMemo(null);
          // Try reverse federation lookup via home_domain → stellar.toml → FEDERATION_SERVER
          try {
            const acct = await server.loadAccount(resolved);
            const domain = acct?.home_domain || acct?.homeDomain || '';
            if (domain) {
              try {
                const tomlUrl = `https://${domain}/.well-known/stellar.toml`;
                const resp = await fetch(tomlUrl, { mode: 'cors' });
                const txt = await resp.text();
                const m = txt.match(/FEDERATION_SERVER\s*=\s*"([^"]+)"/i);
                const fedUrl = m && m[1] ? m[1] : null;
                if (fedUrl) {
                  const q = `${fedUrl}?q=${encodeURIComponent(v)}&type=id`;
                  const fr = await fetch(q, { mode: 'cors' });
                  if (fr.ok) {
                    const data = await fr.json();
                    const addr = data?.stellar_address || data?.stellar_address || '';
                    if (addr && active) setResolvedFederation(addr);
                  }
                }
              } catch { /* ignore reverse federation failures */ }
            }
          } catch { /* ignore account/home_domain issues */ }
        } else {
          setResolvedAccount('');
          setResolvedFederation('');
          setInputWasFederation(false);
          applyFederationMemo(null);
        }
      } catch {
        if (!active) return;
        setResolvedAccount('');
        setResolvedFederation('');
        setInputWasFederation(false);
        applyFederationMemo(null);
      }
    }
    resolve();
    return () => { active = false; };
  }, [dest, server, recipientRefreshKey, applyFederationMemo]);

  // Load destination account XLM balance for the resolved recipient
  useEffect(() => {
    let cancelled = false;
    async function loadDestBalance() {
      try {
        if (!resolvedAccount) {
          setDestXlmLoading(false);
          setDestXlmBalance(undefined);
          return;
        }
        setDestXlmLoading(true);
        try {
          const acct = await server.loadAccount(resolvedAccount);
          if (cancelled) return;
          const native = (acct?.balances || []).find(b => b.asset_type === 'native');
          setDestXlmBalance(native ? native.balance : null);
        } catch {
          if (!cancelled) setDestXlmBalance(null);
        } finally {
          if (!cancelled) setDestXlmLoading(false);
        }
      } catch {
        if (!cancelled) {
          setDestXlmLoading(false);
          setDestXlmBalance(null);
        }
      }
    }
    loadDestBalance();
    return () => { cancelled = true; };
  }, [resolvedAccount, server, recipientRefreshKey]);

  const trimmedRecipient = (dest || '').trim();
  const walletInfoFromInput = useMemo(() => findWalletInfo(walletInfoMap, trimmedRecipient), [walletInfoMap, trimmedRecipient]);
  const walletInfoFromAccount = useMemo(() => findWalletInfo(walletInfoMap, resolvedAccount), [walletInfoMap, resolvedAccount]);
  const effectiveRecipientInfo = walletInfoFromInput || walletInfoFromAccount;
  const recipientLabel = effectiveRecipientInfo?.label || '';
  const savedRecipientFederation = effectiveRecipientInfo?.federation || '';
  const recipientCompromised = !!effectiveRecipientInfo?.compromised;
  const recipientDeactivated = !!effectiveRecipientInfo?.deactivated;
  const recipientFederationDisplay = resolvedFederation || savedRecipientFederation || (trimmedRecipient && trimmedRecipient.includes('*') ? trimmedRecipient : '');
  const handleRecipientRefresh = useCallback(() => {
    setRecipientRefreshKey((prev) => prev + 1);
  }, []);

  // Zahlformat gemäß Settings
  const amountFmt = useMemo(() => {
    const isAuto = decimalsMode === 'auto';
    const n = isAuto ? undefined : Math.max(0, Math.min(7, Number(decimalsMode)));
    return new Intl.NumberFormat(i18n.language || undefined, {
      minimumFractionDigits: isAuto ? 0 : n,
      maximumFractionDigits: isAuto ? 7 : n,
    });
  }, [i18n.language, decimalsMode]);

  const openReviewDialog = useCallback((signers, preflightResult) => {
    try {
      const { display: memoDisplay } = buildMemoObject();
      const assetLabel = assetKey === 'XLM' ? 'XLM' : (assetKey.split(':')[0] || 'XLM');
      const desiredAmount = Number.isFinite(preflightResult?.desired)
        ? preflightResult.desired
        : Number(normalizeAmountValue());
      const adjustedAmount = (preflightResult?.activationRequired && assetKey === 'XLM' && preflightResult?.willBump)
        ? preflightResult.adjusted
        : null;
      const amountEnteredDisplay = amountFmt.format(desiredAmount);
      const amountToSendDisplay = amountFmt.format(adjustedAmount ?? desiredAmount);
      setReviewDialog({
        open: true,
        signers: Array.isArray(signers) ? signers.filter(Boolean) : [],
        preflight: preflightResult || null,
        snapshot: {
          source: publicKey,
          recipient: preflightResult?.resolvedDest || (dest || '').trim(),
          amountDisplay: amountEnteredDisplay,
          amountEntered: amountEnteredDisplay,
          amountToSend: amountToSendDisplay,
          adjustedAmount: adjustedAmount != null ? amountFmt.format(adjustedAmount) : null,
          memo: memoDisplay || '-',
          assetLabel,
          network: netLabel,
          activationNotice: !!(preflightResult?.activationRequired && assetKey === 'XLM' && preflightResult?.willBump),
          compromised: recipientCompromised,
          deactivated: recipientDeactivated,
        },
      });
      setReviewError('');
      setReviewProcessing(false);
    } catch (e) {
      setError(e?.message || t('errors:unknown', 'Unbekannter Fehler'));
    }
  }, [amountFmt, assetKey, buildMemoObject, dest, netLabel, normalizeAmountValue, publicKey, recipientCompromised, recipientDeactivated, t]);

  const openSentResultDialog = useCallback((result) => {
    if (!result) return;
    setResultDialog({
      type: 'sent',
      summary: {
        source: publicKey,
        recipient: result.recipient,
        amount: `${result.amountDisplay} ${result.asset}`,
        memo: result.memo || '-',
        network: result.network,
      },
      hash: result.hash,
      muxedActivationCapture: !!result.muxedActivationCapture,
    });
  }, [publicKey]);

  const handleReviewConfirm = useCallback(async () => {
    if (!Array.isArray(reviewDialog?.signers) || reviewDialog.signers.length < 1) {
      setReviewError(t('secretKey:errorMissing', 'Secret Key fehlt für den Versand.'));
      return;
    }
    const proceed = async () => {
      try {
        setReviewProcessing(true);
        setIsProcessing(true);
        const result = await submitPayment(reviewDialog.signers);
        applySendResult(result);
        openSentResultDialog(result);
        closeReviewDialog();
        setSecretError('');
      } catch (err) {
        if (err instanceof AmbiguousSubmitResultError) {
          setAmbiguousSubmission({ hash: err.hash });
          closeReviewDialog();
        } else {
          const detail = handlePaymentError(err);
          setReviewError(detail);
        }
      } finally {
        setReviewProcessing(false);
        setIsProcessing(false);
      }
    };

    // Reuses the review dialog's existing busy indicator to cover the pre-submit checks
    // below too, so the extra Horizon round-trip doesn't look like the click did nothing.
    // try/finally guarantees the lock releases even if a future edit makes a check throw -
    // proceed() manages its own true/false around the actual submit, so this is a no-op
    // once proceed has already run; it only matters for the blocked/dialog-opened branches.
    setReviewProcessing(true);
    try {
      await runPreSubmitChecks(proceed, (msg) => setReviewError(msg));
    } finally {
      setReviewProcessing(false);
    }
  }, [applySendResult, runPreSubmitChecks, closeReviewDialog, handlePaymentError, openSentResultDialog, reviewDialog, submitPayment, t]);

  const handleSendClick = useCallback(async () => {
    clearSuccess();
    setError('');
    try {
      window.dispatchEvent(new Event('stm-transaction-start'));
    } catch (dispatchError) {
      console.debug('stm-transaction-start event failed', dispatchError);
    }

    if (isMultisig) {
      setConfirmChoice('job');
      setShowOptionInfo(false);
      setShowConfirmModal(true);
      await runPreflight();
      return;
    }

    const preflightResult = await runPreflight();
    if (preflightResult?.err) {
      setError(preflightResult.err);
      return;
    }
    setPendingLocalPreflight(preflightResult);
    try {
      buildMemoObject(); // validate memo before showing review
    } catch (memoErr) {
      setError(memoErr?.message || t('errors:unknown', 'Unbekannter Fehler'));
      return;
    }
    const saved = await getSessionSecret(publicKey, publicKey);
    if (saved) {
      try {
        openReviewDialog([Keypair.fromSecret(saved)], preflightResult);
        return;
      } catch (err) {
        setError(err?.message || t('errors:unknown', 'Unbekannter Fehler'));
        return;
      }
    }
    openSecretModal(false, 'send');
  }, [buildMemoObject, clearSuccess, isMultisig, openReviewDialog, openSecretModal, publicKey, runPreflight, setError, setShowConfirmModal, t]);

  const trustCount = trustlines.length;
  const lpCount = lpTrusts.length;
  const signerCount = Math.max(0, (accountInfo?.signers?.length || 1) - 1);
  const dataCount = Object.keys(accountInfo?.data_attr || {}).length;
  const sponsoring = Number(accountInfo?.num_sponsoring || 0);
  const sponsored = Number(accountInfo?.num_sponsored || 0);

  const reservedBase = baseReserve * 2;
  const reservedTrust = baseReserve * trustCount;
  const reservedLp = baseReserve * lpCount;
  const reservedOffers = baseReserve * offersCount;
  const reservedSigners = baseReserve * signerCount;
  const reservedData = baseReserve * dataCount;
  const reservedSponsor = baseReserve * sponsoring;
  const reservedSponsored = baseReserve * sponsored;
  const reservedTotal = Math.max(0, reservedBase + reservedTrust + reservedLp + reservedOffers + reservedSigners + reservedData + reservedSponsor - reservedSponsored);
  const xlmInOffers = parseFloat(native?.selling_liabilities || '0') || 0;
  const nativeBalance = parseFloat(native?.balance || '0') || 0;
  const availableXLM = Math.max(0, nativeBalance - reservedTotal - xlmInOffers);

  // Histories for inputs
  const [historyRecipients, setHistoryRecipients] = useState(() => readHistoryArray(PAYMENT_RECIPIENT_HISTORY_KEY));
  const [historyAmounts, setHistoryAmounts] = useState(() => readHistoryArray(PAYMENT_AMOUNT_HISTORY_KEY));
  const [historyMemos, setHistoryMemos] = useState(() => readHistoryArray(PAYMENT_MEMO_HISTORY_KEY));
  const [recipientTestnetMap, setRecipientTestnetMap] = useState({});
  useEffect(() => {
    let cancelled = false;
    async function annotateHistoryTestnet() {
      const normalized = historyRecipients.map((entry) => {
        const trimmed = String(entry || '').trim();
        const pkMatch = trimmed.match(/G[A-Z0-9]{55}/);
        return pkMatch ? pkMatch[0] : '';
      }).filter((pk) => pk && StrKey.isValidEd25519PublicKey(pk));
      const unique = Array.from(new Set(normalized));
      if (unique.length === 0) return;
      const updates = {};
      await Promise.all(unique.map(async (pk) => {
        if (recipientTestnetMap[pk] !== undefined) return;
        try {
          const isTestnet = await isTestnetAccount(pk);
          updates[pk] = isTestnet;
        } catch {
          updates[pk] = false;
        }
      }));
      if (!cancelled && Object.keys(updates).length > 0) {
        setRecipientTestnetMap((prev) => ({ ...prev, ...updates }));
      }
    }
    annotateHistoryTestnet();
    return () => { cancelled = true; };
  }, [historyRecipients, recipientTestnetMap]);
  const recipientSuggestions = useMemo(() => {
    const options = [];
    const seen = new Set();
    const testnetSuffix = t('common:account.testnetLabel', '(Testnet)');
    const add = (value, info = {}) => {
      const trimmed = normalizeRecipientHistoryValue(value);
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      const isTestnet = typeof info.isTestnet === 'boolean'
        ? info.isTestnet
        : !!recipientTestnetMap[trimmed];
      const displayValue = `${trimmed}${isTestnet ? ` ${testnetSuffix}` : ''}`;
      options.push({
        value: trimmed,
        displayValue,
        label: info.label || '',
        isTestnet,
        removable: info.removable !== false,
      });
    };
    historyRecipients.forEach((entry) => {
      const normalized = normalizeRecipientHistoryValue(entry);
      const info = findWalletInfo(walletInfoMap, normalized) || {};
      add(normalized, { ...info, removable: true });
    });
    wallets.forEach((wallet) => {
      if (!wallet || typeof wallet !== 'object') return;
      const info = { label: String(wallet.label || '').trim(), isTestnet: !!wallet.isTestnet };
      const address = String(wallet.address || wallet.publicKey || '').trim();
      if (address) {
        add(address, { ...info, removable: false });
      }
      const federation = String(wallet.federation || wallet.federationAddress || '').trim();
      if (federation) {
        add(federation, { ...info, removable: false });
      }
    });
    return options;
  }, [historyRecipients, wallets, walletInfoMap, t, recipientTestnetMap]);
  const pushHistory = (key, val, setter, limit=15) => {
    try {
      const v = String(val||'').trim(); if (!v) return;
      setter(prev => {
        const next = [v, ...prev.filter(x => x !== v)].slice(0, limit);
        writeHistoryArray(key, next, { silent: true });
        return next;
      });
    } catch { /* noop */ }
  };
  const removeFromHistory = (key, value, setter) => {
    setter(removeHistoryValue(key, value));
  };
  const removeRecipientFromHistory = (value) => {
    const target = normalizeRecipientHistoryValue(value);
    const next = historyRecipients.filter((entry) => normalizeRecipientHistoryValue(entry) !== target);
    writeHistoryArray(PAYMENT_RECIPIENT_HISTORY_KEY, next);
    setHistoryRecipients(next);
  };
  const clearHistory = (key, setter) => {
    clearHistoryKey(key);
    setter([]);
  };
  useEffect(() => {
    const syncPaymentHistories = (event) => {
      const keys = event?.detail?.keys;
      if (Array.isArray(keys) && !keys.some((key) => [
        PAYMENT_RECIPIENT_HISTORY_KEY,
        PAYMENT_AMOUNT_HISTORY_KEY,
        PAYMENT_MEMO_HISTORY_KEY,
      ].includes(key))) {
        return;
      }
      setHistoryRecipients(readHistoryArray(PAYMENT_RECIPIENT_HISTORY_KEY));
      setHistoryAmounts(readHistoryArray(PAYMENT_AMOUNT_HISTORY_KEY));
      setHistoryMemos(readHistoryArray(PAYMENT_MEMO_HISTORY_KEY));
    };
    window.addEventListener(INPUT_HISTORY_CHANGED_EVENT, syncPaymentHistories);
    window.addEventListener('storage', syncPaymentHistories);
    return () => {
      window.removeEventListener(INPUT_HISTORY_CHANGED_EVENT, syncPaymentHistories);
      window.removeEventListener('storage', syncPaymentHistories);
    };
  }, []);
 
  const assetOptions = useMemo(() => {
    const opts = [{ key: 'XLM', label: 'XLM' }];
    for (const b of trustlines) {
      const key = `${b.asset_code}:${b.asset_issuer}`;
      // Anzeige nur der Asset-Bezeichnung (ohne Issuer)
      opts.push({ key, label: `${b.asset_code}`, title: `${b.asset_code}:${b.asset_issuer}` });
    }
    return opts;
  }, [trustlines]);

  // Update fields when donation is triggered again or initial changes
  useEffect(() => {
    try {
      if (!initial) return;
      clearSuccess();
      if (initial.recipient) setDest(initial.recipient);
      if (initial.amount != null) setAmount(String(initial.amount));
      if (initial.memoText) { markMemoManuallyEdited(); setMemoType('text'); setMemoVal(initial.memoText); }
    } catch { /* noop */ }
  }, [initial, clearSuccess, markMemoManuallyEdited]);

  const sentAmountText = sentInfo
    ? sentInfo.amountDisplay || (Number.isFinite(sentInfo.amount) ? amountFmt.format(sentInfo.amount) : '')
    : '';

  if (!publicKey) {
    return (
      <div className="my-8 text-center text-sm text-gray-700 dark:text-gray-200">
        {t('common:balance.noPublicKey')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-semibold">{t('common:payment.send.title')}</h2>
      </div>

      {error && <div className="text-red-600 text-sm text-center">{error}</div>}
      {ambiguousSubmission && (
        <div className="text-sm bg-amber-100 dark:bg-amber-900/30 border border-amber-300/60 text-amber-800 dark:text-amber-200 rounded p-3 max-w-4xl mx-auto">
          <div className="font-semibold mb-1">{t('common:payment.send.ambiguousResult.title', 'Status unklar – nicht erneut senden')}</div>
          <div>{t('common:payment.send.ambiguousResult.body', 'Die Transaktion konnte serverseitig nicht eindeutig bestätigt werden (Zeitüberschreitung oder Serverfehler). Bitte prüfen Sie den Transaktions-Hash im Explorer, bevor Sie es erneut versuchen.')}</div>
          {ambiguousSubmission.hash && (
            <div className="mt-1 font-mono break-all text-xs">{ambiguousSubmission.hash}</div>
          )}
          <button
            type="button"
            className="mt-2 px-3 py-1 rounded border border-amber-400 text-xs font-semibold hover:bg-amber-200/60 dark:hover:bg-amber-900/60"
            onClick={() => setAmbiguousSubmission(null)}
          >
            {t('common:payment.send.ambiguousResult.acknowledge', 'Status geprüft – Senden wieder freigeben')}
          </button>
        </div>
      )}
      {sentInfo && sentInfo.account === publicKey && (
        <div className="text-sm bg-green-100 dark:bg-green-900/30 border border-green-300/60 text-green-800 dark:text-green-200 rounded p-3 max-w-4xl mx-auto">
          <div className="font-semibold mb-1">{t('common:payment.send.successShort', 'Erfolgreich gesendet')}</div>
          <div className="space-y-0.5">
            <div><span className="text-gray-600 dark:text-gray-400">{t('common:payment.send.recipient')}:</span> <span className="font-mono break-all">{sentInfo.recipient}</span></div>
            <div><span className="text-gray-600 dark:text-gray-400">{t('common:payment.send.amount')}:</span> {sentAmountText || '0'} {sentInfo.asset}</div>
            <div><span className="text-gray-600 dark:text-gray-400">{t('common:payment.send.memo')}:</span> {sentInfo.memo || '-'}</div>
            {sentInfo.activated && (
              <div className="text-green-800 dark:text-green-200 font-medium">{t('common:payment.send.activated', 'The destination account was activated.')}</div>
            )}
            {sentInfo.muxedActivationCapture && (
              <div className="text-green-800 dark:text-green-200 font-medium">{t('common:payment.send.muxedActivationCapture', 'Account was activated; an additional minimal transaction fee applied to also record the muxed ID on-chain.')}</div>
            )}
            {status && (<div><span className="text-gray-600 dark:text-gray-400">TX:</span> <span className="font-mono break-all">{status}</span></div>)}
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded border p-4 max-w-4xl mx-auto">
        <div className="grid grid-cols-1 gap-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm">{t('common:payment.send.recipient')}</label>
            <button
              type="button"
              onClick={handleRecipientRefresh}
              disabled={!trimmedRecipient}
              title={t('common:payment.send.recipientRefresh', 'Empfänger aktualisieren')}
              aria-label={t('common:payment.send.recipientRefresh', 'Empfänger aktualisieren')}
              className="ml-2 w-7 h-7 rounded-full border border-white/80 bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              <span
                className="text-white text-base leading-none"
                style={{ transform: 'rotate(120deg)', display: 'inline-block' }}
                aria-hidden="true"
              >
                ↻
              </span>
            </button>
          </div>
          <AddressDropdown
            value={dest}
            onChange={(next) => { clearSuccess(); setDest(next); }}
            onSelect={(next) => {
              clearSuccess();
              setDest(next);
              pushHistory(PAYMENT_RECIPIENT_HISTORY_KEY, next, setHistoryRecipients);
            }}
            onRemoveOption={(entry) => removeRecipientFromHistory(entry.value)}
            onClearOptions={historyRecipients.length > 0 ? () => clearHistory(PAYMENT_RECIPIENT_HISTORY_KEY, setHistoryRecipients) : undefined}
            onBlur={() => pushHistory(PAYMENT_RECIPIENT_HISTORY_KEY, dest, setHistoryRecipients)}
            placeholder="G... oder user*domain"
            options={recipientSuggestions}
            inputClassName="border rounded w-full pr-8 px-2 py-1 text-base md:text-sm font-mono"
            rightAdornment={dest ? (
              <button
                type="button"
                onClick={()=>{ clearSuccess(); setDest(''); }}
                title={t('common:clear', 'Clear')}
                aria-label={t('common:clear', 'Clear')}
                className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 md:w-6 md:h-6 rounded-full bg-gray-300 hover:bg-red-500 text-gray-600 hover:text-white text-sm flex items-center justify-center"
              >
                ×
              </button>
            ) : null}
          />
          <div className="mt-1 text-xs text-gray-700 dark:text-gray-300">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] items-start gap-x-4 gap-y-1">
              {/* Links: Empfänger-Infos linksbündig */}
              <div className="min-w-0 space-y-0.5 text-left">
                <div>
                  <span className="font-semibold">{t('wallet:federationDisplay.label', 'Föderationsadresse')}:</span>{' '}
                  {recipientFederationDisplay
                    ? <span className="font-mono break-all">{recipientFederationDisplay}</span>
                    : <span className="italic text-gray-500">{t('wallet:federationDisplay.none', 'Keine Föderationsadresse definiert')}</span>}
                </div>

                {resolvedFederation && resolvedAccount && inputWasFederation && (
                  <div>
                    <span className="font-semibold">{t('wallet:federationDisplay.account', 'Konto')}:</span>{' '}
                    <span className="font-mono break-all">{resolvedAccount}</span>
                  </div>
                )}

                {recipientLabel && (
                  <div>
                    <span className="font-semibold">{t('wallet:federationDisplay.accountLabel', 'Label')}:</span>{' '}
                    <span>{recipientLabel}</span>
                  </div>
                )}

                {recipientCompromised && (
                  <div className="text-red-600 dark:text-red-400 font-semibold">
                    {t('wallet:flag.compromised', 'Warning: This recipient is marked as compromised in your trusted list.')}
                  </div>
                )}
                {recipientDeactivated && (
                  <div className="text-amber-600 dark:text-amber-400 font-medium">
                    {t('wallet:flag.deactivated', 'Note: This recipient is marked as deactivated in your trusted list.')}
                  </div>
                )}
              </div>

              {/* Rechts: Ziel-XLM-Kontostand als Label, ohne Überlagerung */}
              <div className="text-right">
                <span className="font-semibold">{t('wallet:xlmBalance', 'XLM')}:</span>{' '}
                <span className="font-mono">
                  {destXlmLoading
                    ? t('common:common.loading', 'Loading…')
                    : (resolvedAccount
                        ? (destXlmBalance != null ? `${destXlmBalance}` : t('wallet:unfunded', 'Unfunded'))
                        : '—')}
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[2fr_3fr] gap-3 mt-2">
          <div className="flex flex-col min-w-0">
          <label className="text-sm">{t('common:payment.send.amount')}</label>
          <HistoryInput
            value={amountFocused ? amount : (amount ? amountFmt.format(Number(amount) || 0) : '')}
            suggestions={historyAmounts}
            className="border rounded pr-8 px-2 py-1 text-base md:text-sm w-full appearance-none [-moz-appearance:textfield]"
            inputProps={{ type: 'text', inputMode: 'decimal' }}
            onFocus={() => setAmountFocused(true)}
            onBlur={() => { setAmountFocused(false); pushHistory(PAYMENT_AMOUNT_HISTORY_KEY, amount, setHistoryAmounts); }}
            onSelect={(next) => {
              clearSuccess();
              setAmount(String(next || ''));
              pushHistory(PAYMENT_AMOUNT_HISTORY_KEY, next, setHistoryAmounts);
            }}
            onRemoveSuggestion={(next) => removeFromHistory(PAYMENT_AMOUNT_HISTORY_KEY, next, setHistoryAmounts)}
            onClearSuggestions={() => clearHistory(PAYMENT_AMOUNT_HISTORY_KEY, setHistoryAmounts)}
            onChange={(e) => {
              clearSuccess();
              let s = e.target.value || '';
              s = s.replace(/,/g, '.');
              s = s.replace(/[^0-9.]/g, '');
              const i = s.indexOf('.');
              if (i !== -1) {
                s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '');
                const decimals = s.length - i - 1;
                if (decimals > 7) s = s.slice(0, i + 1 + 7);
              }
              setAmount(s);
            }}
            rightAdornment={amount ? (
              <button type="button" onClick={()=>{ clearSuccess(); setAmount(''); }} title={t('common:clear', 'Clear')} aria-label={t('common:clear', 'Clear')} className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 md:w-6 md:h-6 rounded-full bg-gray-300 hover:bg-red-500 text-gray-600 hover:text-white text-sm flex items-center justify-center">×</button>
            ) : null}
          />
          </div>
          <div className="flex flex-col min-w-0">
          <label className="text-sm">{t('common:payment.send.asset')}</label>
          <select className="border rounded w-full px-2 py-1 text-base md:text-sm" value={assetKey} onChange={(e)=>{ clearSuccess(); setAssetKey(e.target.value); }}>
          {assetOptions.map(o => <option key={o.key} value={o.key} title={o.title || o.key}>{o.label}</option>)}
          </select>
          </div>
          </div>
          <div className="mt-1 flex items-center justify-between">
          <div className="relative">
          <button
          type="button"
          onClick={() => setShowReserveInfo(v => !v)}
          className="w-5 h-5 inline-flex items-center justify-center rounded-full bg-green-600 text-white text-xs hover:bg-green-700"
          title={t('common:payment.send.reserved')}
          aria-label={t('common:payment.send.reserved')}
          >
          !
          </button>
          <span className="ml-2 text-xs text-gray-700 dark:text-gray-300 align-middle">{t('common:payment.send.reservedInline', { amount: amountFmt.format(reservedTotal) })}</span>
          {showReserveInfo && (
          <div ref={popupRef} className="absolute left-0 mt-2 w-80 z-40 bg-white dark:bg-gray-800 border rounded shadow-lg p-3 text-left">
          <div className="flex items-start justify-between">
          <div className="font-semibold mr-4">{t('common:payment.send.reserved')}</div>
          <button className="text-xs px-2 py-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700" onClick={()=>setShowReserveInfo(false)}>×</button>
          </div>
          <div className="text-lg font-bold mt-1">{amountFmt.format(reservedTotal)} XLM</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mt-2">
            <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.baseReserve')}</div><div>{amountFmt.format(baseReserve)} XLM</div>
              <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.extra')}</div><div>{amountFmt.format(reservedTotal - baseReserve*2)} XLM</div>
                <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.xlmInOffers')}</div><div>{amountFmt.format(xlmInOffers)} XLM</div>
                  <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.trustlines', { n: trustCount })}</div><div>{amountFmt.format(reservedTrust)} XLM</div>
                  <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.lpTrustlines')}</div><div>{amountFmt.format(reservedLp)} XLM</div>
                    <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.offers')}</div><div>{amountFmt.format(reservedOffers)} XLM</div>
                             <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.signers')}</div><div>{amountFmt.format(reservedSigners)} XLM</div>
                    <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.accountData')}</div><div>{amountFmt.format(reservedData)} XLM</div>
                    <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.sponsoring')}</div><div>{amountFmt.format(reservedSponsor)} XLM</div>
                  <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.sponsored')}</div><div>{amountFmt.format(reservedSponsored)} XLM</div>
                  </div>
                </div>
              )}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400 ml-2 text-right">{t('common:payment.send.available')}: {amountFmt.format(availableXLM)} XLM</div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
            <div>
              <label className="block text-sm">{t('common:payment.send.memoType')}</label>
              <select className="border rounded w-full px-2 py-1 text-base md:text-sm" value={memoType} onChange={(e)=>{ clearSuccess(); setMemoType(e.target.value); }}>
                <option value="none">{t('common:payment.send.memoTypes.none')}</option>
                <option value="text">{t('common:payment.send.memoTypes.text')}</option>
                <option value="id">{t('common:payment.send.memoTypes.id')}</option>
                <option value="hash">{t('common:payment.send.memoTypes.hash')}</option>
                <option value="return">{t('common:payment.send.memoTypes.return')}</option>
              </select>
              <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">{t(`payment.send.memoTypes.info.${memoType}`)}</div>
            </div>
            <div>
              <label className="block text-sm">{t('common:payment.send.memo')}</label>
              <HistoryInput
                value={memoVal}
                suggestions={historyMemos}
                className="border rounded w-full pr-8 px-2 py-1 text-base md:text-sm"
                onChange={(e)=>{ clearSuccess(); markMemoManuallyEdited(); setMemoVal(e.target.value); }}
                onBlur={()=>pushHistory(PAYMENT_MEMO_HISTORY_KEY, memoVal, setHistoryMemos)}
                onSelect={(next) => {
                  clearSuccess();
                  markMemoManuallyEdited();
                  setMemoVal(next);
                  pushHistory(PAYMENT_MEMO_HISTORY_KEY, next, setHistoryMemos);
                }}
                onRemoveSuggestion={(next) => removeFromHistory(PAYMENT_MEMO_HISTORY_KEY, next, setHistoryMemos)}
                onClearSuggestions={() => clearHistory(PAYMENT_MEMO_HISTORY_KEY, setHistoryMemos)}
                rightAdornment={memoVal ? (
                  <button type="button" onClick={()=>{ clearSuccess(); markMemoManuallyEdited(); setMemoVal(''); }} title={t('common:clear', 'Clear')} aria-label={t('common:clear', 'Clear')} className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 md:w-6 md:h-6 rounded-full bg-gray-300 hover:bg-red-500 text-gray-600 hover:text-white text-sm flex items-center justify-center">×</button>
                ) : null}
              />
              {inputWasFederation && federationMemoApplied && (
                <div className="text-xs text-amber-700 dark:text-amber-400 mt-1">{t('common:payment.send.memoFederationHint')}</div>
              )}
            </div>
          </div>

          <button
            className="mt-3 px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
            disabled={!dest || !amount || (Number(amount) || 0) <= 0 || !!ambiguousSubmission}
            onClick={handleSendClick}
          >
            {t('common:payment.send.sendButton')}
          </button>
          {isProcessing && (
            <p className="text-blue-600 text-sm mt-2 text-center">{t('common:main.processing')}</p>
          )}
        </div>

      </div>
           </div>
      
      {showConfirmModal && isMultisig && (
       <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto p-4">
          <div className="bg-white dark:bg-gray-800 rounded p-4 w-full max-w-md my-auto max-h-[calc(100svh-2rem)] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="text-lg font-semibold">{t('multisig:confirm.options.selectTitle', 'Option wählen')}</h3>
              <button
                type="button"
                className="px-2 py-1 rounded border hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={closeConfirmDialogs}
                aria-label={t('common:option.cancel', 'Cancel')}
              >
                ×
              </button>
            </div>

            <div className="text-sm space-y-1 mb-4">
              <div className="flex items-start justify-between gap-2">
                <span className="text-gray-600 dark:text-gray-400">{t('common:payment.send.recipient')}:</span>
                <span className="font-mono break-all text-right">{dest}</span>
              </div>
              <div className="flex items-start justify-between gap-2">
                <span className="text-gray-600 dark:text-gray-400">{t('common:payment.send.amount')}:</span>
                <span className="text-right">
                  {amountFmt.format(Number(amount))} {(assetKey==='XLM'?'XLM':assetKey.split(':')[0])}
                  {preflight.activationRequired && assetKey==='XLM' && preflight.willBump && !preflight.loading && !preflight.err && (
                    <span className="ml-2 text-amber-600 dark:text-amber-400">→ {amountFmt.format(preflight.adjusted)} XLM</span>
                  )}
                </span>
              </div>
              <div className="flex items-start justify-between gap-2">
                <span className="text-gray-600 dark:text-gray-400">{t('common:payment.send.memo')}:</span>
                <span className="text-right break-all">{memoType==='none' || !memoVal ? '-' : memoVal}</span>
              </div>
              {netLabel && (
                <div className="flex items-start justify-between gap-2">
                  <span className="text-gray-600 dark:text-gray-400">{t('common:networkLabel', 'Netzwerk')}:</span>
                  <span className="font-mono text-right">{formatNetworkLabel(netLabel)}</span>
                </div>
              )}
              {recipientCompromised && (
                <div className="text-red-600 dark:text-red-400">
                  {t('wallet:flag.compromised', 'Warning: This recipient is marked as compromised in your trusted list.')}
                </div>
              )}
              {recipientDeactivated && (
                <div className="text-amber-600 dark:text-amber-400">
                  {t('wallet:flag.deactivated', 'Note: This recipient is marked as deactivated in your trusted list.')}
                </div>
              )}
            </div>

            {preflight.loading && (
              <div className="text-xs text-gray-600 dark:text-gray-400 mb-2">{t('common:common.loading')}</div>
            )}
            {!!preflight.err && !preflight.loading && (
              <div className="text-xs text-red-600 mb-2">{preflight.err}</div>
            )}
            {preflight.activationRequired && assetKey==='XLM' && !preflight.loading && !preflight.err && (
              <div className="border rounded p-2 mb-2 text-xs">
                <div className="font-semibold mb-1">{t('common:payment.send.activateConfirm.title', 'Account activation required')}</div>
                <div className="mb-1">{t('common:payment.send.activateConfirm.info', 'The destination account is not active yet. A minimum amount is required to activate it.')}</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.activateConfirm.minReserve', 'Minimum (2 × base reserve)')}</div>
                  <div>{amountFmt.format(preflight.minReserve)} XLM</div>
                  <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.activateConfirm.yourAmount', 'Entered amount')}</div>
                  <div>{amountFmt.format(preflight.desired)} XLM</div>
                  {preflight.willBump && (
                    <>
                      <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.activateConfirm.adjustedAmount', 'Proposed amount (to activate)')}</div>
                      <div className="text-amber-600 dark:text-amber-400 font-medium">{amountFmt.format(preflight.adjusted)} XLM</div>
                    </>
                  )}
                </div>
                {preflight.willBump && (
                  <div className="mt-1 text-amber-600 dark:text-amber-400">{t('common:payment.send.activateConfirm.noteAdjust', 'Your amount is not sufficient for activation. If you continue, the minimum amount will be sent automatically.')}</div>
                )}
              </div>
            )}

            <div className="space-y-2">
              {[
                { key: 'job', label: t('multisig:confirm.options.job.title'), recommended: true },
                { key: 'local', label: t('multisig:confirm.options.local.title') },
                { key: 'xdr', label: t('multisig:confirm.options.xdr.title') },
              ].map((option) => (
                <label
                  key={option.key}
                  className={`flex items-center gap-3 border rounded p-3 cursor-pointer transition hover:border-blue-400 ${confirmChoice === option.key ? 'border-blue-500 ring-1 ring-blue-200 dark:ring-blue-800' : 'border-gray-200 dark:border-gray-700'}`}
                >
                  <input
                    type="radio"
                    name="multisig-flow-choice"
                    value={option.key}
                    checked={confirmChoice === option.key}
                    onChange={() => setConfirmChoice(option.key)}
                    className="form-radio text-blue-600 h-4 w-4"
                  />
                  <div className="flex items-center justify-between gap-3 w-full">
                    <span className="font-semibold">{option.label}</span>
                    {option.recommended && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-100">
                        {t('multisig:confirm.options.recommended')}
                      </span>
                    )}
                  </div>
                </label>
              ))}
            </div>

            <div className="flex justify-end mt-2">
              <button
                type="button"
                className="text-sm text-blue-700 dark:text-blue-200 hover:underline"
                onClick={()=>setShowOptionInfo(true)}
              >
                {t('multisig:confirm.options.infoButton')}
              </button>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-3 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={closeConfirmDialogs}
              >
                {t('common:option.cancel', 'Cancel')}
              </button>
              <button
                className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
                disabled={preflight.loading || !!preflight.err}
                onClick={handleConfirmProceed}
              >
                {t('multisig:confirm.options.proceed')}
              </button>
            </div>
          </div>
        </div>
      )}

      {reviewDialog.open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[54] overflow-y-auto p-4">
          <div className="bg-white dark:bg-gray-800 rounded p-4 w-full max-w-2xl my-auto max-h-[calc(100svh-2rem)] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="text-lg font-semibold">{t('common:payment.send.reviewTitle', 'Transaktion bestätigen')}</h3>
              <button
                type="button"
                className="p-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 disabled:opacity-50"
                onClick={closeReviewDialog}
                disabled={reviewProcessing}
                aria-label={t('common:close')}
              >
                ×
              </button>
            </div>

            <div className="space-y-2 text-sm mb-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-gray-600 dark:text-gray-400">{t('common:account.source', 'Quelle')}:</span>
                <span className="font-mono break-all text-right">{reviewDialog.snapshot?.source}</span>
              </div>
              <div className="flex items-start justify-between gap-2">
                <span className="text-gray-600 dark:text-gray-400">{t('common:payment.send.recipient')}:</span>
                <span className="font-mono break-all text-right">{reviewDialog.snapshot?.recipient}</span>
              </div>
              <div className="flex items-start justify-between gap-2">
                <span className="text-gray-600 dark:text-gray-400">{t('common:payment.send.amount')}:</span>
                <span className="text-right">
                  {reviewDialog.snapshot?.amountDisplay} {reviewDialog.snapshot?.assetLabel}
                  {reviewDialog.snapshot?.activationNotice && reviewDialog.snapshot?.amountToSend && (
                    <span className="ml-2 text-amber-600 dark:text-amber-400">→ {reviewDialog.snapshot?.amountToSend} XLM</span>
                  )}
                </span>
              </div>
              <div className="flex items-start justify-between gap-2">
                <span className="text-gray-600 dark:text-gray-400">{t('common:payment.send.memo')}:</span>
                <span className="text-right break-all">{reviewDialog.snapshot?.memo || '-'}</span>
              </div>
              {reviewDialog.snapshot?.network && (
                <div className="flex items-start justify-between gap-2">
                  <span className="text-gray-600 dark:text-gray-400">{t('common:networkLabel', 'Netzwerk')}:</span>
                  <span className="font-mono text-right">{formatNetworkLabel(reviewDialog.snapshot.network)}</span>
                </div>
              )}
              {reviewDialog.snapshot?.compromised && (
                <div className="text-red-600 dark:text-red-400">
                  {t('wallet:flag.compromised', 'Warning: This recipient is marked as compromised in your trusted list.')}
                </div>
              )}
              {reviewDialog.snapshot?.deactivated && (
                <div className="text-amber-600 dark:text-amber-400">
                  {t('wallet:flag.deactivated', 'Note: This recipient is marked as deactivated in your trusted list.')}
                </div>
              )}
            </div>

            {reviewDialog.preflight?.activationRequired && reviewDialog.snapshot?.assetLabel === 'XLM' && reviewDialog.preflight?.desired != null && (
              <div className="border rounded p-2 mb-3 text-xs">
                <div className="font-semibold mb-1">{t('common:payment.send.activateConfirm.title', 'Account activation required')}</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.activateConfirm.minReserve', 'Minimum (2 × base reserve)')}</div>
                  <div>{amountFmt.format(reviewDialog.preflight.minReserve)} XLM</div>
                  <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.activateConfirm.yourAmount', 'Entered amount')}</div>
                  <div>{amountFmt.format(reviewDialog.preflight.desired)} XLM</div>
                  {reviewDialog.preflight.willBump && (
                    <>
                      <div className="text-gray-600 dark:text-gray-400">{t('common:payment.send.activateConfirm.adjustedAmount', 'Proposed amount (to activate)')}</div>
                      <div className="text-amber-600 dark:text-amber-400 font-medium">{amountFmt.format(reviewDialog.preflight.adjusted)} XLM</div>
                    </>
                  )}
                </div>
                {reviewDialog.preflight.willBump && (
                  <div className="mt-1 text-amber-600 dark:text-amber-400">{t('common:payment.send.activateConfirm.noteAdjust', 'Your amount is not sufficient for activation. If you continue, the minimum amount will be sent automatically.')}</div>
                )}
              </div>
            )}

            {reviewError && (
              <div className="text-xs text-red-600 mb-2">{reviewError}</div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="px-3 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                onClick={closeReviewDialog}
                disabled={reviewProcessing}
              >
                {t('common:option.cancel', 'Cancel')}
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                onClick={handleReviewConfirm}
                disabled={reviewProcessing || !!ambiguousSubmission}
              >
                {reviewProcessing ? t('common:main.processing') : t('common:option.confirm.action.text', 'Bestätigen')}
              </button>
            </div>
          </div>
        </div>
      )}

      {memoMismatchDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[57] overflow-y-auto p-4">
          <div className="bg-white dark:bg-gray-800 rounded p-4 w-full max-w-lg my-auto max-h-[calc(100svh-2rem)] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="text-lg font-semibold">{t('common:payment.send.memoMismatch.title', 'Check federation memo')}</h3>
              <button
                type="button"
                className="p-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
                onClick={closeMemoMismatchDialog}
                aria-label={t('common:close')}
              >
                ×
              </button>
            </div>

            <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
              {memoMismatchDialog.mappable
                ? t('common:payment.send.memoMismatch.textMappable', 'The federation server expects the memo "{{expected}}", but your current memo is "{{current}}".', {
                    expected: memoMismatchDialog.expectedMemo,
                    current: memoMismatchDialog.currentMemo || t('common:payment.send.memoMismatch.empty', '(empty)'),
                  })
                : t('common:payment.send.memoMismatch.textUnmappable', 'The federation server expects a memo that could not be applied automatically. Your current memo is "{{current}}".', {
                    current: memoMismatchDialog.currentMemo || t('common:payment.send.memoMismatch.empty', '(empty)'),
                  })}
            </p>

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="px-3 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={closeMemoMismatchDialog}
              >
                {t('common:option.cancel', 'Cancel')}
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded border border-amber-500 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/30"
                onClick={sendAnywayDespiteMemoMismatch}
              >
                {t('common:payment.send.memoMismatch.sendAnyway', 'Send anyway')}
              </button>
              {memoMismatchDialog.mappable && (
                <button
                  type="button"
                  className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
                  onClick={acceptExpectedFederationMemo}
                >
                  {t('common:payment.send.memoMismatch.applyExpected', 'Apply federation memo')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {resultDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[55] overflow-y-auto p-4">
          <div className="bg-white dark:bg-gray-800 rounded p-4 w-full max-w-2xl my-auto max-h-[calc(100svh-2rem)] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="text-lg font-semibold">
                {resultDialog.type === 'job' && t('multisig:confirm.result.job.title')}
                {resultDialog.type === 'xdr' && t('multisig:confirm.result.xdr.title')}
                {resultDialog.type === 'sent' && t('multisig:confirm.result.sent.title')}
              </h3>
              <button
                type="button"
                className="p-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
                onClick={closeResultDialog}
                aria-label={t('common:close')}
              >
                ×
              </button>
            </div>

            {resultDialog.type === 'sent' && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-green-700 dark:text-green-300 mb-3">
                <span>{t('multisig:confirm.result.sent.status')}</span>
                <button
                  type="button"
                  className="px-2 py-1 rounded border border-blue-200 text-blue-700 dark:border-blue-800 dark:text-blue-100 hover:bg-blue-50 dark:hover:bg-blue-900"
                  onClick={() => handleCopySentDetails(resultDialog)}
                >
                  {copiedDetails
                    ? t('multisig:confirm.result.sent.copiedDetails', 'Kopiert')
                    : t('multisig:confirm.result.sent.copyDetails', 'Details kopieren')}
                </button>
              </div>
            )}
            {resultDialog.type === 'sent' && resultDialog.muxedActivationCapture && (
              <div className="text-sm text-green-800 dark:text-green-200 font-medium mb-3">
                {t('common:payment.send.muxedActivationCapture', 'Account was activated; an additional minimal transaction fee applied to also record the muxed ID on-chain.')}
              </div>
            )}
            {resultDialog.type === 'job' && (
              <div className="text-sm text-blue-700 dark:text-blue-200 mb-3">
                {t('multisig:confirm.result.job.status')}
              </div>
            )}
            {resultDialog.type === 'job' && resultDialog.muxedActivationCapture && (
              <div className="text-sm text-blue-700 dark:text-blue-200 font-medium mb-3">
                {t('common:payment.send.muxedActivationCaptureJob', 'This job contains two operations (account activation + muxed-ID capture), so it costs two operation fees.')}
              </div>
            )}
            {resultDialog.type === 'job' && (
              <div className="flex justify-end mb-3">
                <button
                  type="button"
                  className="px-3 py-1 text-sm rounded border border-blue-200 text-blue-700 dark:border-blue-800 dark:text-blue-100 hover:bg-blue-50 dark:hover:bg-blue-900"
                  onClick={() => setShowJobInfo((v) => !v)}
                  aria-expanded={showJobInfo}
                >
                  {t('multisig:confirm.result.job.infoButton')}
                </button>
              </div>
            )}
            {resultDialog.type === 'job' && showJobInfo && (
              <div className="border rounded p-3 mb-3 bg-blue-50 dark:bg-blue-900/30 text-sm text-gray-800 dark:text-gray-100">
                <div className="font-semibold mb-1">{t('multisig:confirm.result.job.infoTitle')}</div>
                <p className="mb-2 text-gray-700 dark:text-gray-200">{t('multisig:confirm.options.job.desc')}</p>
                <ul className="list-disc ml-5 space-y-1">
                  {[
                    t('multisig:confirm.options.job.infoBody.one'),
                    t('multisig:confirm.options.job.infoBody.two'),
                    t('multisig:confirm.options.job.infoBody.three'),
                    t('multisig:confirm.options.job.infoBody.four'),
                  ].map((line, idx) => (
                    <li key={idx}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
            {resultDialog.type === 'xdr' && (
              <div className="text-sm text-amber-700 dark:text-amber-300 mb-3 space-y-1">
                <div>{t('multisig:confirm.result.xdr.status')}</div>
                <div>{t('multisig:confirm.result.xdr.noJob')}</div>
                <div className="text-gray-700 dark:text-gray-200">{t('multisig:confirm.result.xdr.hint')}</div>
              </div>
            )}
            {resultDialog.type === 'xdr' && resultDialog.muxedActivationCapture && (
              <div className="text-sm text-amber-800 dark:text-amber-200 font-medium mb-3">
                {t('common:payment.send.muxedActivationCaptureXdr', 'This transaction contains two operations (account activation + muxed-ID capture), so it costs two operation fees.')}
              </div>
            )}

            {buildSummaryItems(resultDialog.summary).length > 0 && (
              <div className="border rounded p-3 mb-3 space-y-1">
                {buildSummaryItems(resultDialog.summary).map((item, idx) => (
                  <div key={idx} className="text-sm flex flex-wrap gap-2">
                    <span className="text-gray-600 dark:text-gray-400">{item.label}:</span>
                    <span className="font-mono break-all">{item.value}</span>
                  </div>
                ))}
              </div>
            )}

            {(resultDialog.jobId || resultDialog.hash) && (
              <div className="grid gap-2 mb-3">
                {resultDialog.jobId && (
                  <div className="flex flex-wrap gap-2 text-sm items-center">
                    <span className="text-gray-600 dark:text-gray-400">{t('multisig:confirm.result.job.jobIdLabel')}</span>
                    <span className="font-mono break-all">{resultDialog.jobId}</span>
                    <button
                      type="button"
                      className="px-2 py-1 rounded border border-blue-200 text-blue-700 dark:border-blue-800 dark:text-blue-100 hover:bg-blue-50 dark:hover:bg-blue-900"
                      onClick={() => handleCopyJobId(resultDialog.jobId)}
                    >
                      {copiedJobId ? t('multisig:confirm.result.job.copiedJobId') : t('multisig:confirm.result.job.copyJobId')}
                    </button>
                  </div>
                )}
                {resultDialog.hash && (
                  <div className="flex flex-wrap gap-2 text-sm items-center">
                    <span className="text-gray-600 dark:text-gray-400">
                      {resultDialog.type === 'sent'
                        ? t('multisig:confirm.result.sent.hashLabel')
                        : resultDialog.type === 'xdr'
                          ? t('multisig:confirm.result.xdr.hashLabel')
                          : t('multisig:confirm.result.job.hashLabel')}
                    </span>
                    <span className="font-mono break-all">{resultDialog.hash}</span>
                    {resultDialog.type === 'sent' && (
                      <div className="flex flex-wrap gap-2">
                        {buildExplorerUrl(txExplorers.stellarchain, resultDialog.hash, netLabel, { type: 'tx' }) && (
                          <a
                            className="px-2 py-1 rounded border border-blue-200 text-blue-700 dark:border-blue-800 dark:text-blue-100 hover:bg-blue-50 dark:hover:bg-blue-900"
                            href={buildExplorerUrl(txExplorers.stellarchain, resultDialog.hash, netLabel, { type: 'tx' })}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t('common:balance.explorer.stellarchain', 'Stellarchain.io')}
                          </a>
                        )}
                        {buildExplorerUrl(txExplorers.stellarExpert, resultDialog.hash, netLabel, { type: 'tx' }) && (
                          <a
                            className="px-2 py-1 rounded border border-blue-200 text-blue-700 dark:border-blue-800 dark:text-blue-100 hover:bg-blue-50 dark:hover:bg-blue-900"
                            href={buildExplorerUrl(txExplorers.stellarExpert, resultDialog.hash, netLabel, { type: 'tx' })}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t('common:balance.explorer.expert', 'stellar.expert')}
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {resultDialog.type === 'job' && (
              <div className="flex flex-wrap gap-2 mb-3">
                <button
                  type="button"
                  className="px-3 py-1 rounded border border-blue-200 text-blue-700 dark:border-blue-700 dark:text-blue-100 hover:bg-blue-50 dark:hover:bg-blue-900"
                  onClick={() => {
                    setLastResultDialog(resultDialog);
                    setResultDialog(null);
                    setCopiedXdr(false);
                    setCopiedJobId(false);
                    setShowJobInfo(false);
                    openSecretModal(false, 'job', 1, 'result');
                  }}
                >
                  {t('multisig:confirm.result.job.signNow', 'Jetzt signieren')}
                </button>
              </div>
            )}

            {resultDialog.type === 'xdr' && resultDialog.xdr && (
              <div className="border rounded p-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="text-sm text-gray-700 dark:text-gray-300">{t('multisig:prepare.xdrLabel')}</div>
                  <button
                    type="button"
                    className="px-3 py-1 rounded border border-blue-200 text-blue-700 dark:text-blue-200 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900"
                    onClick={() => handleCopyXdr(resultDialog.xdr)}
                  >
                    {copiedXdr ? t('multisig:prepare.copied', 'Kopiert') : t('multisig:confirm.result.copyXdr')}
                  </button>
                </div>
                <textarea
                  className="w-full h-32 text-xs font-mono bg-gray-50 dark:bg-gray-900 border rounded px-2 py-1"
                  readOnly
                  value={resultDialog.xdr || ''}
                />
              </div>
            )}

            {resultDialog.type === 'job' && (
              <div className="mt-3 text-sm space-y-1 text-amber-700 dark:text-amber-400">
                <p>{t('multisig:prepare.notSentHint')}</p>
                <p className="text-gray-700 dark:text-gray-300">{t('multisig:prepare.closeHint', 'Du kannst diesen Dialog schließen, sobald Du unterzeichnet hast und der Multisig-Auftrag erstellt wurde; der nächste Signer findet die Job-ID im Menü „Multisig-Jobs“.')}</p>
              </div>
            )}

	            <div className="mt-4 flex justify-end gap-2">
	              <button
	                type="button"
	                className="px-3 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-700"
	                onClick={closeResultDialog}
	              >
	                {t('common:close')}
	              </button>
	              {isMultisig === true && (
	                <button
	                  type="button"
	                  className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
	                  onClick={() => reopenSelection(resultDialog.type === 'sent' ? 'local' : resultDialog.type)}
	                >
	                  {t('common:option.back', 'Zurück')}
	                </button>
	              )}
	            </div>
	          </div>
	        </div>
	      )}

      {showOptionInfo && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] overflow-y-auto p-4">
          <div className="bg-white dark:bg-gray-800 rounded p-4 w-full max-w-2xl my-auto max-h-[calc(100svh-2rem)] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 mb-3">
              <h3 className="text-lg font-semibold">{t('multisig:confirm.options.infoDialog.title')}</h3>
              <button
                type="button"
                className="p-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
                onClick={()=>setShowOptionInfo(false)}
                aria-label={t('common:close')}
              >
                ×
              </button>
            </div>

            <div className="space-y-3 text-sm">
              {[
                {
                  key: 'job',
                  title: t('multisig:confirm.options.job.title'),
                  desc: t('multisig:confirm.options.job.desc'),
                  bullets: [
                    t('multisig:confirm.options.job.infoBody.one'),
                    t('multisig:confirm.options.job.infoBody.two'),
                    t('multisig:confirm.options.job.infoBody.three'),
                    t('multisig:confirm.options.job.infoBody.four'),
                  ],
                },
                {
                  key: 'local',
                  title: t('multisig:confirm.options.local.title'),
                  desc: t('multisig:confirm.options.local.desc'),
                  bullets: [
                    t('multisig:confirm.options.local.infoBody.one'),
                    t('multisig:confirm.options.local.infoBody.two'),
                    t('multisig:confirm.options.local.infoBody.three'),
                  ],
                },
                {
                  key: 'xdr',
                  title: t('multisig:confirm.options.xdr.title'),
                  desc: t('multisig:confirm.options.xdr.desc'),
                  bullets: [
                    t('multisig:confirm.options.xdr.infoBody.one'),
                    t('multisig:confirm.options.xdr.infoBody.two'),
                    t('multisig:confirm.options.xdr.infoBody.three'),
                  ],
                },
              ].map((section) => (
                <div key={section.key} className="border rounded p-3">
                  <div className="font-semibold">{section.title}</div>
                  <p className="text-gray-700 dark:text-gray-300 mt-1">{section.desc}</p>
                  <ul className="list-disc ml-5 mt-2 space-y-1 text-gray-700 dark:text-gray-300">
                    {section.bullets.map((line, idx) => (
                      <li key={idx}>{line}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="px-4 py-2 rounded border hover:bg-gray-100 dark:hover:bg-gray-700"
                onClick={()=>setShowOptionInfo(false)}
              >
                {t('common:close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSecretModal && (
        <SecretKeyModal
          initialSecretValues={secretModalPrefill}
          errorMessage={secretError}
          onCancel={closeSecretModal}
          thresholds={thresholdsForModal}
          signers={signersForModal}
          operationType="payment"
          requiredThreshold={requiredThreshold}
          forceSignerCount={forceSignerCount}
          allowedSigners={signersForModal}
          isProcessing={isProcessing}
          account={accountInfo}
          initialCollectAllSignaturesLocally={forceLocalFlow}
          secretContext={secretContext}
          onBackToSelection={isMultisig ? (() => {
            closeSecretModal();
            if (secretReturnTo === 'result' && lastResultDialog) {
              setResultDialog(lastResultDialog);
              setLastResultDialog(null);
              setSecretReturnTo('');
              return;
            }
            setShowOptionInfo(false);
            setShowConfirmModal(true);
          }) : null}
          onConfirm={async (collected, remember, options = {}) => {
            try {
              setError('');
              setStatus('');
              setIsProcessing(true);
              const primarySecret = collected?.[0]?.keypair?.secret?.();
              if (!primarySecret) {
                throw new Error('submitTransaction.failed:' + 'multisig.noKeysProvided');
              }
              const required = requiredThreshold || 0;
              const current = Array.isArray(collected)
                ? collected.reduce((acc, s) => acc + Number(s?.weight || 0), 0)
                : 0;
              const allFromSource = Array.isArray(collected)
                ? collected.every((s) => {
                    try { return s?.keypair?.publicKey() === publicKey; } catch { return false; }
                  })
                : false;
              if (secretContext === 'job') {
                if (masterWeight > 0) {
                  if (!allFromSource) {
                    throw new Error('submitTransaction.failed:' + 'multisig.notASigner');
                  }
                } else {
                  const activeKeys = new Set(
                    Array.isArray(signersForModal)
                      ? signersForModal
                          .filter((s) => (Number(s.weight || 0) > 0) && (s.public_key || s.publicKey || s.key))
                          .map((s) => s.public_key || s.publicKey || s.key)
                      : []
                  );
                  const allActive = Array.isArray(collected)
                    ? collected.every((s) => activeKeys.has(s?.keypair?.publicKey?.()))
                    : false;
                  if (!allActive || activeKeys.size === 0) {
                    throw new Error('submitTransaction.failed:' + 'multisig.notASigner');
                  }
                }
                if (current <= 0) {
                  throw new Error('submitTransaction.failed:' + 'multisig.noKeysProvided');
                }
              } else {
                if (current < required) {
                  throw new Error('submitTransaction.failed:' + 'multisig.insufficientWeight');
                }
                if (current <= 0) {
                  throw new Error('submitTransaction.failed:' + 'multisig.noKeysProvided');
                }
              }

              const jobToSign = secretContext === 'job'
                ? (resultDialog?.jobId && resultDialog?.xdr ? resultDialog : lastResultDialog)
                : null;
              // If we are signing an existing job from the result dialog, sign and merge, then exit.
              if (jobToSign?.jobId && jobToSign?.xdr) {
                try {
                  const netPass = netLabel === 'TESTNET' ? Networks.TESTNET : Networks.PUBLIC;
                  const tx = TransactionBuilder.fromXDR(jobToSign.xdr, netPass);
                  collected.forEach((s) => {
                    try { tx.sign(s.keypair); } catch { /* noop */ }
                  });
                  const clientCollected = collected.map((s) => {
                    const pk = s?.keypair?.publicKey?.() || '';
                    if (!pk) return null;
                    const meta = (signersForModal || []).find((x) => (x.public_key || x.publicKey || x.key) === pk);
                    const weight = Number(meta?.weight || 0);
                    return { publicKey: pk, weight };
                  }).filter(Boolean);
                  const signerMeta = (signersForModal || []).map((s) => ({
                    publicKey: s.public_key || s.publicKey || s.key || '',
                    weight: Number(s.weight || 0),
                  })).filter((s) => s.publicKey && s.weight > 0);
                  const merged = await mergeSignedXdr({
                    jobId: jobToSign.jobId,
                    signedXdr: tx.toXDR(),
                    clientCollected,
                    signers: signerMeta,
                  });
                  const status = merged?.status || 'pending_signatures';
                  const hash = merged?.txHash || jobToSign.hash || '';
                  const summary = merged?.summary || jobToSign.summary || null;
                  setResultDialog({
                    type: 'job',
                    jobId: jobToSign.jobId,
                    hash,
                    xdr: merged?.txXdrCurrent || merged?.txXdr || jobToSign.xdr,
                    summary,
                    status,
                  });
                  setSecretError('');
                  closeSecretModal();
                  setLastResultDialog(null);
                } catch (mergeErr) {
                  const detail = mergeErr?.message || 'multisig.jobs.merge_failed';
                  showErrorMessage(detail);
                } finally {
                  setIsProcessing(false);
                }
                return;
              }

              if (remember) {
                try {
                  await rememberSessionSecrets(publicKey, collected);
                  try { window.dispatchEvent(new CustomEvent('stm-session-secret-changed', { detail: { publicKey } })); } catch { /* noop */ }
                } catch (rememberErr) {
                  // Fail-closed: crypto.subtle is unavailable (non-secure origin),
                  // so the secret was NOT stored in plaintext - tell the user
                  // clearly instead of silently pretending "remember" worked.
                  if (rememberErr instanceof InsecureCryptoContextError) {
                    showErrorMessage(t('secretKey:remember.insecureContextError'));
                  }
                }
              }
              const collectLocally = !!options.collectAllSignaturesLocally;
              if (!isMultisig) {
                const preflightResult = pendingLocalPreflight || await runPreflight();
                if (preflightResult?.err) {
                  setSecretError(preflightResult.err);
                  return;
                }
                setPendingLocalPreflight(preflightResult);
                openReviewDialog(collected.map((s) => s.keypair), preflightResult);
                setSecretError('');
                closeSecretModal();
                return;
              }
              if (isMultisig && !collectLocally) {
                await handlePrepareMultisig(collected.map((s) => s.keypair));
                setSecretError('');
                closeSecretModal();
                return;
              }
              // Own try/catch/finally (mirroring the outer one) rather than relying on it:
              // this proceed may run right here, or later via sendAnywayDespiteMemoMismatch
              // (the memo-mismatch dialog's "send anyway" button), which awaits it unguarded.
              const proceedWithLocalSubmit = async () => {
                try {
                  setIsProcessing(true);
                  const result = await submitPayment(collected.map((s) => s.keypair));
                  applySendResult(result);
                  openSentResultDialog(result);
                  setSecretError('');
                  closeSecretModal();
                } catch (err) {
                  if (err instanceof AmbiguousSubmitResultError) {
                    setAmbiguousSubmission({ hash: err.hash });
                    closeSecretModal();
                  } else {
                    const detail = handlePaymentError(err);
                    setSecretError(detail);
                    if (detail) showErrorMessage(detail);
                  }
                } finally {
                  setIsProcessing(false);
                }
              };
              await runPreSubmitChecks(proceedWithLocalSubmit, (msg) => { setSecretError(msg); showErrorMessage(msg); });
            } catch (e) {
              if (e instanceof AmbiguousSubmitResultError) {
                setAmbiguousSubmission({ hash: e.hash });
                closeSecretModal();
              } else {
                const detail = handlePaymentError(e);
                setSecretError(detail);
                if (detail) showErrorMessage(detail);
              }
            } finally {
              setIsProcessing(false);
            }
          }}
        />
      )}
    </div>
  );
}
