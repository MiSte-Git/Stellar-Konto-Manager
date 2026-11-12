import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getNetworkConfig, passphraseFor } from '../../config/networks.js';
import { useTranslation } from 'react-i18next';
import { Asset } from '@stellar/stellar-sdk';
import { getHorizonServerForNetwork, loadTrustlines } from '../../utils/stellar/stellarUtils.js';
import { assertTxMatchesFlow } from '../../utils/multisig/unsignedTx.js';
import SecretKeyModal from '../SecretKeyModal.jsx';
import { rememberSessionSecrets, InsecureCryptoContextError, SESSION_LOCKED_EVENT } from '../../utils/sessionSecrets.js';
import { formatErrorForUi } from '../../utils/formatErrorForUi.js';
import { apiUrl } from '../../utils/apiBase.js';
import {
  buildChangeTrustAndPathPaymentStrictSendTransaction,
  buildChangeTrustTransaction,
  buildManageSellOfferTransaction,
  buildPathPaymentStrictSendTransaction,
  signTransactionWithCollectedSigners,
} from '../../utils/stellar/tradingTransactions.js';
import { AmbiguousSubmitResultError } from '../../utils/stellar/submitTransactionSafely.js';
import { guardedSubmit, SendBlockedError } from '../../utils/submitGuard/guardedSubmit.js';
import { useAccountSendBlock } from '../../utils/submitGuard/useAccountSendBlock.js';
import AccountSendGuardNotice from '../wallet/AccountSendGuardNotice.jsx';
import {
  DEFAULT_TRUSTLINE_LIMIT,
  EMPTY_ASSET_FACTS,
  assetResultKey,
  parseAssetSearchQuery,
  normalizeAmount,
  calculateMinimumDestinationAmount,
  normalizeTrustlineLimit,
  formatAssetLabel,
  getAssetCode,
  getAssetIssuer,
  formatDetailedAssetPath,
  assetFromPathRecord,
  assetFromOfferSide,
  assetFromSearchResult,
  assetFromExactQuery,
  assetsEqual,
  parseHorizonNumber,
  getAssetTrustlineCount,
  getAssetTrustlineCountNumber,
  getAssetAmountNumber,
  getAssetTotalAmountNumber,
  getOfferPriceNumber,
  sumOrderbookAmount,
  calculatePercentChange,
  getCollectedSignerWeight,
  getAccountFlag,
  getTrustlineReserveSummary,
} from './assetSearchUtils.js';
import HelpLabel from './HelpLabel.jsx';
import TokenFactsSummary from './TokenFactsSummary.jsx';
import TokenExchangeRate from './TokenExchangeRate.jsx';
import LimitOrdersSection from './LimitOrdersSection.jsx';
import SwapSection from './SwapSection.jsx';
import TrustlineSection from './TrustlineSection.jsx';
import AssetSearchForm from './AssetSearchForm.jsx';
import AssetResultsTable from './AssetResultsTable.jsx';
import ConfirmActionModal from './ConfirmActionModal.jsx';
import useLimitOffers from './hooks/useLimitOffers.js';
import useSwapPreview from './hooks/useSwapPreview.js';
import useTrustlineStatus from './hooks/useTrustlineStatus.js';
import useAssetFacts from './hooks/useAssetFacts.js';
import useExchangeRate from './hooks/useExchangeRate.js';
import useAssetSearch from './hooks/useAssetSearch.js';
import useTradingAccount from './hooks/useTradingAccount.js';
import useTradingSubmit from './hooks/useTradingSubmit.js';
import useTradingMultisig, { JOB_DISABLED_TYPES, requiredWeightFor } from './hooks/useTradingMultisig.js';
import { LiquidityResultDialog, LiquiditySigningOptions } from '../liquidity/jobParts.jsx';
import { resolveFeePerOp } from '../../utils/stellar/fees.js';

// Gueltigkeit einer direkt gesendeten Trading-Transaktion (Standard der Builder in
// tradingTransactions.js), kleiner als MAX_SEND_VALIDITY_SECONDS des Sendeschutzes.
const TRADING_SUBMIT_TIMEOUT_SECONDS = 60;

export default function AssetSearch() {
  const { t, i18n } = useTranslation(['trading', 'common', 'liquidity', 'secretKey']);
  const [tokenFactsExpanded, setTokenFactsExpanded] = useState(false);
  const {
    accountInput,
    accountId,
    accountStatus,
    accountInfo,
    setAccountInfo,
    network,
  } = useTradingAccount({ t });
  const {
    assetQuery,
    setAssetQuery,
    assetResults,
    setAssetResults,
    assetResultFacts,
    setAssetResultFacts,
    assetSort,
    setAssetSort,
    assetError,
    setAssetError,
    assetLoading,
    setAssetLoading,
    selectedAsset,
    setSelectedAsset,
  } = useAssetSearch({ network });
  const {
    trustlineStatus,
    trustlineLimit,
    setTrustlineLimit,
    trustlineRefreshToken,
    setTrustlineRefreshToken,
  } = useTrustlineStatus({ accountId, network, accountInput, selectedAsset });
  const {
    pendingAction,
    setPendingAction,
    showSecretModal,
    setShowSecretModal,
    beginAction,
  } = useTradingSubmit();
  // Multisig-Ablauf (ADR 0007): Auswahl Job/lokal/XDR nur, wenn kein einzelner Signer reicht
  const bumpGuardRef = useRef(null);
  const submitInFlightRef = useRef(false);
  // Sperren (Schloss, Inaktivitaet) zaehlt hoch: Eine Aktion, die vor der Sperre bestaetigt wurde,
  // signiert danach nicht mehr (siehe submitSignedTx). flowRef: Netz und Konto der letzten Bestaetigung,
  // unter diesem Konto wird der Key gemerkt.
  const lockEpochRef = useRef(0);
  const flowRef = useRef(null);
  useEffect(() => {
    const onLocked = () => { lockEpochRef.current += 1; };
    window.addEventListener(SESSION_LOCKED_EVENT, onLocked);
    return () => window.removeEventListener(SESSION_LOCKED_EVENT, onLocked);
  }, []);
  const multisig = useTradingMultisig({
    onBlocked: () => bumpGuardRef.current?.(),
    network,
    accountId,
    accountInfo,
    beginAction,
    closeSecretModal: () => {
      setShowSecretModal(false);
      setPendingAction(null);
      setModalError('');
    },
    t,
  });
  // Unklarer Sendestatus pro Konto und Netz (gespeichert, gilt auch fuer "Zahlung senden" und die
  // Sammelzahlung). Freigabe nur ueber Horizon, siehe utils/submitGuard/.
  const sendGuard = useAccountSendBlock({
    network,
    account: accountId,
    onApplied: () => setTrustlineRefreshToken((value) => value + 1),
  });
  bumpGuardRef.current = sendGuard.bump;
  // Solange fuer das Konto ein unklarer Eintrag besteht, sind alle Sendeaktionen gesperrt.
  const pendingAmbiguousSubmission = sendGuard.block ? { hash: sendGuard.block.entry?.hash || '' } : null;
  const [showTrustlineConfirm, setShowTrustlineConfirm] = useState(false);
  const [showTrustlineSwapConfirm, setShowTrustlineSwapConfirm] = useState(false);
  const [showSwapConfirm, setShowSwapConfirm] = useState(false);
  const [modalError, setModalError] = useState('');
  const [isSubmittingTrustline, setIsSubmittingTrustline] = useState(false);
  const [isSubmittingSwap, setIsSubmittingSwap] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const swapTargetRequestRef = useRef(0);
  const {
    swapAmount,
    setSwapAmount,
    swapSlippage,
    setSwapSlippage,
    swapDirection,
    setSwapDirection,
    swapTargetQuery,
    setSwapTargetQuery,
    swapTargetResults,
    setSwapTargetResults,
    swapTargetError,
    setSwapTargetError,
    swapTargetLoading,
    setSwapTargetLoading,
    selectedSwapTargetAsset,
    setSelectedSwapTargetAsset,
    swapPreview,
    setSwapPreview,
    swapPreviewRequestRef,
    marketData,
    setMarketData,
  } = useSwapPreview({ selectedAsset, network });
  const {
    limitOfferDirection,
    setLimitOfferDirection,
    limitOfferAmount,
    setLimitOfferAmount,
    limitOfferPrice,
    setLimitOfferPrice,
    limitOfferStatus,
    setLimitOfferRefreshToken,
  } = useLimitOffers({ selectedAsset, accountId, network });
  const [pendingOfferAction, setPendingOfferAction] = useState(null);
  const [showOfferConfirm, setShowOfferConfirm] = useState(false);
  const [isSubmittingOffer, setIsSubmittingOffer] = useState(false);

  const parsedQuery = useMemo(() => parseAssetSearchQuery(assetQuery), [assetQuery]);
  const parsedSwapTarget = useMemo(() => parseAssetSearchQuery(swapTargetQuery), [swapTargetQuery]);
  // Swap ist pathPaymentStrictSend (Medium), nicht payment (siehe TRADING_OPERATION_TYPES).
  const modalOperationType = (pendingAction?.type === 'swap' || pendingAction?.type === 'trustlineSwap')
    ? 'pathPaymentStrictSend'
    : (pendingAction?.type === 'offer' || pendingAction?.type === 'cancelOffer')
      ? 'manageSellOffer'
      : 'changeTrust';
  const requiredThreshold = useMemo(
    () => requiredWeightFor(pendingAction?.type || 'trustline', accountInfo?.thresholds || null),
    [accountInfo, pendingAction?.type]
  );
  const selectedStellarAsset = useMemo(
    () => (selectedAsset ? assetFromSearchResult(selectedAsset) : null),
    [selectedAsset]
  );
  const exchangeRate = useExchangeRate({
    selectedStellarAsset,
    network,
    enabled: tokenFactsExpanded,
  });
  const numberLocale = i18n.resolvedLanguage || i18n.language || undefined;
  const countFormatter = useMemo(
    () => new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 0 }),
    [numberLocale]
  );
  const amountFormatter = useMemo(
    () => new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 7 }),
    [numberLocale]
  );
  const ratioFormatter = useMemo(
    () => new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 7 }),
    [numberLocale]
  );
  const formatTrustlineCount = (asset) => {
    const raw = getAssetTrustlineCount(asset);
    const value = parseHorizonNumber(raw);
    return value == null ? '—' : countFormatter.format(value);
  };
  const formatAssetAmount = (asset) => {
    const value = getAssetTotalAmountNumber(asset);
    return value == null ? '—' : amountFormatter.format(value);
  };
  // Only shown when at least one non-trustline component is non-zero, so the
  // common case (everything on trustlines) doesn't get a clutter breakdown.
  const getAssetAmountBreakdown = (asset) => {
    const trustlines = getAssetAmountNumber(asset);
    const claimable = parseHorizonNumber(asset?.claimableBalancesAmount);
    const pools = parseHorizonNumber(asset?.liquidityPoolsAmount);
    const contracts = parseHorizonNumber(asset?.contractsAmount);
    if (!(claimable > 0) && !(pools > 0) && !(contracts > 0)) return null;
    return {
      trustlines: trustlines == null ? '—' : amountFormatter.format(trustlines),
      claimable: claimable > 0 ? amountFormatter.format(claimable) : null,
      pools: pools > 0 ? amountFormatter.format(pools) : null,
      contracts: contracts > 0 ? amountFormatter.format(contracts) : null,
    };
  };
  const toggleAssetSort = (field) => {
    setAssetSort((current) => ({
      field,
      direction: current.field === field && current.direction === 'desc' ? 'asc' : 'desc',
    }));
  };
  const sortIndicator = (field) => {
    if (assetSort.field !== field) return '';
    return assetSort.direction === 'desc' ? ' ↓' : ' ↑';
  };
  const targetStellarAsset = useMemo(() => {
    if (swapDirection !== 'token-to-token') return null;
    if (selectedSwapTargetAsset) return assetFromSearchResult(selectedSwapTargetAsset);
    if (parsedSwapTarget.error || parsedSwapTarget.mode !== 'exact') return null;
    return assetFromExactQuery(parsedSwapTarget);
  }, [parsedSwapTarget, selectedSwapTargetAsset, swapDirection]);
  const { assetFacts, targetAssetFacts } = useAssetFacts({
    selectedAsset,
    network,
    targetStellarAsset,
    swapDirection,
  });
  const swapSourceAsset = useMemo(() => {
    if (!selectedStellarAsset) return Asset.native();
    if (swapDirection === 'xlm-to-token') return Asset.native();
    return selectedStellarAsset;
  }, [selectedStellarAsset, swapDirection]);
  const swapDestinationAsset = useMemo(() => {
    if (!selectedStellarAsset) return Asset.native();
    if (swapDirection === 'token-to-xlm') return Asset.native();
    if (swapDirection === 'token-to-token') return targetStellarAsset || Asset.native();
    return selectedStellarAsset;
  }, [selectedStellarAsset, swapDirection, targetStellarAsset]);
  const swapSourceLabel = formatAssetLabel(swapSourceAsset);
  const swapDestinationLabel = formatAssetLabel(swapDestinationAsset);
  const selectedAssetFactsTitleKey = swapDirection === 'xlm-to-token'
    ? 'trading:assetSearch.facts.destinationTitle'
    : 'trading:assetSearch.facts.sourceTitle';
  const limitOfferSellingAsset = useMemo(
    () => (limitOfferDirection === 'sell-token-for-xlm' ? selectedStellarAsset : Asset.native()),
    [limitOfferDirection, selectedStellarAsset]
  );
  const limitOfferBuyingAsset = useMemo(
    () => (limitOfferDirection === 'sell-token-for-xlm' ? Asset.native() : selectedStellarAsset),
    [limitOfferDirection, selectedStellarAsset]
  );
  const limitOfferSellingLabel = formatAssetLabel(limitOfferSellingAsset);
  const limitOfferBuyingLabel = formatAssetLabel(limitOfferBuyingAsset);
  const trustlineLimitAmount = normalizeTrustlineLimit(trustlineLimit);
  const selectedAssetAuthRequired = getAccountFlag(assetFacts.issuerAccount, 'auth_required', 'authRequired');
  const selectedAssetNeedsAuthorization = selectedAssetAuthRequired && trustlineStatus.state !== 'present';
  const selectedTrustlineUnauthorized = trustlineStatus.state === 'present' && trustlineStatus.isAuthorized === false;
  const trustlineReserveSummary = useMemo(() => getTrustlineReserveSummary(accountInfo), [accountInfo]);
  const canPreviewTrustlineSwap = Boolean(
    selectedAsset &&
    accountId &&
    trustlineStatus.state === 'missing' &&
    swapDirection === 'xlm-to-token' &&
    !assetFacts.loading &&
    !selectedAssetAuthRequired
  );
  const sortedAssetResults = useMemo(() => {
    const scoreFacts = (facts) => {
      if (facts.homeDomain && facts.tomlListed) return 3;
      if (facts.tomlListed) return 2;
      if (facts.homeDomain) return 1;
      return 0;
    };
    const compareQuality = (left, right) => {
      const leftFacts = assetResultFacts[assetResultKey(left)] || {};
      const rightFacts = assetResultFacts[assetResultKey(right)] || {};
      const factDiff = scoreFacts(rightFacts) - scoreFacts(leftFacts);
      if (factDiff !== 0) return factDiff;
      const trustlineDiff = getAssetTrustlineCountNumber(right) - getAssetTrustlineCountNumber(left);
      if (trustlineDiff !== 0) return trustlineDiff;
      return String(left.assetCode || '').localeCompare(String(right.assetCode || ''));
    };

    return [...assetResults].sort((left, right) => {
      if (assetSort.field === 'trustlines') {
        const diff = getAssetTrustlineCountNumber(left) - getAssetTrustlineCountNumber(right);
        if (diff !== 0) return assetSort.direction === 'asc' ? diff : -diff;
        return compareQuality(left, right);
      }
      return compareQuality(left, right);
    });
  }, [assetResultFacts, assetResults, assetSort]);

  // The event-listener sync effect and the accountInput-resolution effect
  // now live in useTradingAccount (trustlineStatus's immediate reset to
  // 'unknown' moved into useTrustlineStatus itself, keyed on accountInput -
  // see that hook's comment). This accountInfo-loading effect stays here: it
  // needs trustlineRefreshToken (owned by useTrustlineStatus) and accountId/
  // network (owned by useTradingAccount) together, which would make either
  // hook depend on the other's output - a real cycle. Coordinating effects
  // that straddle two hooks' state belong at the composition level.
  useEffect(() => {
    let cancelled = false;
    if (!accountId) {
      setAccountInfo(null);
      return () => { cancelled = true; };
    }
    const server = getHorizonServerForNetwork(network);
    server.loadAccount(accountId)
      .then((account) => {
        if (!cancelled) setAccountInfo(account);
      })
      .catch(() => {
        if (!cancelled) setAccountInfo(null);
      });
    return () => { cancelled = true; };
  }, [accountId, network, trustlineRefreshToken, setAccountInfo]);

  // Trustline status loading and its trustlineLimit reset now live in
  // useTrustlineStatus; swapPreview/marketData reset and swapDirection reset
  // live in useSwapPreview. showTrustlineConfirm/showTrustlineSwapConfirm are
  // container-level confirm-dialog visibility state; tokenFactsExpanded is a
  // plain expand/collapse toggle with no data-fetch effect of its own. Both
  // stay here permanently.
  useEffect(() => {
    setShowTrustlineConfirm(false);
    setShowTrustlineSwapConfirm(false);
    setTokenFactsExpanded(false);
  }, [selectedAsset, network]);

  // pendingOfferAction/showOfferConfirm are the offer confirm-dialog's own
  // state (feeds beginAction's payload once confirmed) - useLimitOffers
  // resets its own limitOfferAmount/limitOfferPrice fields itself.
  useEffect(() => {
    setPendingOfferAction(null);
    setShowOfferConfirm(false);
  }, [selectedAsset, network]);

  const describeSearchMode = (mode) => {
    if (mode === 'issuer') return t('trading:assetSearch.mode.issuer', 'Issuer search');
    if (mode === 'exact') return t('trading:assetSearch.mode.exact', 'Exact asset');
    if (mode === 'code') return t('trading:assetSearch.mode.code', 'Asset code search');
    return '';
  };

  const translateInputError = (code) => {
    if (code === 'queryMissing') return t('trading:assetSearch.invalidInput.queryMissing');
    if (code === 'codeInvalid') return t('trading:assetSearch.invalidInput.codeInvalid');
    if (code === 'issuerInvalid') return t('trading:assetSearch.invalidInput.issuerInvalid');
    return t('trading:assetSearch.invalidInput.queryInvalid');
  };

  const trustlineStatusLabel = () => {
    if (accountStatus.loading) return t('trading:assetSearch.account.loading');
    if (!accountInput) return t('trading:assetSearch.account.missing');
    if (accountStatus.error) return accountStatus.error;
    if (trustlineStatus.loading) return t('trading:assetSearch.trustlineStatus.loading');
    if (trustlineStatus.state === 'present') return t('trading:assetSearch.trustlineStatus.present');
    if (trustlineStatus.state === 'missing') return t('trading:assetSearch.trustlineStatus.missing');
    if (trustlineStatus.state === 'error') return t('trading:assetSearch.trustlineStatus.error');
    return t('trading:assetSearch.trustlineStatus.unknown');
  };

  const bestDestinationAmount = swapPreview.path?.destination_amount || '';
  const minimumDestinationAmount = useMemo(() => {
    return calculateMinimumDestinationAmount(bestDestinationAmount, swapSlippage);
  }, [bestDestinationAmount, swapSlippage]);
  const quoteDetails = useMemo(() => {
    const sourceAmount = Number(normalizeAmount(swapAmount));
    const destinationAmount = Number(bestDestinationAmount || 0);
    const minimumAmount = Number(minimumDestinationAmount || 0);
    if (!Number.isFinite(sourceAmount) || sourceAmount <= 0 || !Number.isFinite(destinationAmount) || destinationAmount <= 0) {
      return null;
    }
    const effectiveRate = destinationAmount / sourceAmount;
    const minimumRate = minimumAmount > 0 ? minimumAmount / sourceAmount : null;
    const slippageBuffer = minimumAmount > 0 ? destinationAmount - minimumAmount : null;
    const hops = (Array.isArray(swapPreview.path?.path) ? swapPreview.path.path.length : 0) + 1;
    return {
      effectiveRate,
      minimumRate,
      slippageBuffer,
      hops,
      ageSeconds: swapPreview.loadedAt ? Math.max(0, Math.floor((Date.now() - swapPreview.loadedAt) / 1000)) : null,
      detailedRoute: formatDetailedAssetPath(swapPreview.path?.path, swapSourceAsset, swapDestinationAsset),
    };
  }, [bestDestinationAmount, minimumDestinationAmount, swapAmount, swapDestinationAsset, swapPreview.loadedAt, swapPreview.path, swapSourceAsset]);
  const formatQuoteAge = (seconds) => {
    if (seconds == null) return t('trading:assetSearch.swapPreview.notAvailable');
    if (seconds < 60) return t('trading:assetSearch.swapPreview.ageSeconds', { count: seconds });
    return t('trading:assetSearch.swapPreview.ageMinutes', { count: Math.floor(seconds / 60) });
  };
  const formatPercent = (value) => (
    value == null || !Number.isFinite(value)
      ? '—'
      : `${ratioFormatter.format(value)}%`
  );
  const marketQuality = useMemo(() => {
    const orderbook = marketData.orderbook || {};
    const bids = Array.isArray(orderbook.bids) ? orderbook.bids : [];
    const asks = Array.isArray(orderbook.asks) ? orderbook.asks : [];
    const bestBid = getOfferPriceNumber(bids[0]);
    const bestAsk = getOfferPriceNumber(asks[0]);
    const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null;
    const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
    const spreadPercent = spread != null && mid && mid > 0 ? (spread / mid) * 100 : null;
    const topBidDepth = sumOrderbookAmount(bids);
    const topAskDepth = sumOrderbookAmount(asks);
    const sourceAmount = Number(normalizeAmount(swapAmount));
    const estimatedImpactPercent = quoteDetails?.effectiveRate && bestBid != null && bestBid > 0
      ? ((quoteDetails.effectiveRate - bestBid) / bestBid) * 100
      : null;
    const topAskCoversSource = Number.isFinite(sourceAmount) && sourceAmount > 0 && topAskDepth > 0
      ? topAskDepth >= sourceAmount
      : null;
    const poolCount = Array.isArray(marketData.liquidityPools) ? marketData.liquidityPools.length : 0;
    return {
      bestBid,
      bestAsk,
      spread,
      spreadPercent,
      topBidDepth,
      topAskDepth,
      estimatedImpactPercent,
      topAskCoversSource,
      poolCount,
      ageSeconds: marketData.loadedAt ? Math.max(0, Math.floor((Date.now() - marketData.loadedAt) / 1000)) : null,
    };
  }, [marketData, quoteDetails, swapAmount]);
  const selectedRelatedOffers = useMemo(() => {
    if (!selectedStellarAsset) return [];
    return limitOfferStatus.offers.filter((offer) => {
      const selling = assetFromOfferSide(offer, 'selling');
      const buying = assetFromOfferSide(offer, 'buying');
      return assetsEqual(selling, selectedStellarAsset) || assetsEqual(buying, selectedStellarAsset);
    });
  }, [limitOfferStatus.offers, selectedStellarAsset]);

  const findTrustlineForAsset = async (server, asset, ttlMs = 10000, owner = accountId) => {
    if (!owner || !asset || asset.isNative?.()) return null;
    const trustlines = await loadTrustlines(owner, server, { includeOps: false, ttlMs });
    return trustlines.find((tl) =>
      tl.assetCode === asset.code && tl.assetIssuer === asset.issuer
    ) || null;
  };

  const validateSwapPair = () => {
    if (swapDirection === 'token-to-token') {
      if (parsedSwapTarget.error || parsedSwapTarget.mode !== 'exact' || !targetStellarAsset) {
        return t('trading:assetSearch.swapPreview.invalidTarget');
      }
      if (assetsEqual(selectedStellarAsset, targetStellarAsset)) {
        return t('trading:assetSearch.swapPreview.sameAsset');
      }
    }
    return '';
  };

  const handleSwapPreview = async ({ allowMissingDestinationTrustline = false } = {}) => {
    if (!selectedAsset) return;
    const sourceAmount = normalizeAmount(swapAmount);
    if (!sourceAmount) {
      setSwapPreview({ loading: false, error: t('trading:assetSearch.swapPreview.invalidAmount', { asset: swapSourceLabel }), path: null, loadedAt: null, refreshComparison: null });
      return;
    }
    const slippage = Number(String(swapSlippage || '').replace(',', '.'));
    if (!Number.isFinite(slippage) || slippage < 0 || slippage > 50) {
      setSwapPreview({ loading: false, error: t('trading:assetSearch.swapPreview.invalidSlippage'), path: null, loadedAt: null, refreshComparison: null });
      return;
    }
    const pairError = validateSwapPair();
    if (pairError) {
      setSwapPreview({ loading: false, error: pairError, path: null, loadedAt: null, refreshComparison: null });
      return;
    }

    const requestId = ++swapPreviewRequestRef.current;
    const isStale = () => swapPreviewRequestRef.current !== requestId;

    setSwapPreview({ loading: true, error: '', path: null, loadedAt: null, refreshComparison: null });
    try {
      const server = getHorizonServerForNetwork(network);
      if (accountId && !swapDestinationAsset.isNative()) {
        const destinationTrustline = await findTrustlineForAsset(server, swapDestinationAsset, 10000);
        if (isStale()) return;
        if (!destinationTrustline && !allowMissingDestinationTrustline) {
          setSwapPreview({ loading: false, error: t('trading:assetSearch.swapPreview.destinationTrustlineMissing'), path: null, loadedAt: null, refreshComparison: null });
          return;
        }
        if (destinationTrustline?.isAuthorized === false) {
          setSwapPreview({ loading: false, error: t('trading:assetSearch.swapPreview.destinationTrustlineUnauthorized'), path: null, loadedAt: null, refreshComparison: null });
          return;
        }
      }
      const response = await server
        .strictSendPaths(swapSourceAsset, sourceAmount, [swapDestinationAsset])
        .call();
      if (isStale()) return;
      const records = Array.isArray(response?.records) ? response.records : [];
      if (!records.length) {
        setSwapPreview({ loading: false, error: t('trading:assetSearch.swapPreview.noRoute'), path: null, loadedAt: null, refreshComparison: null });
        return;
      }
      const best = [...records].sort((a, b) => Number(b.destination_amount || 0) - Number(a.destination_amount || 0))[0];
      setSwapPreview({ loading: false, error: '', path: best, loadedAt: Date.now(), refreshComparison: null });
    } catch {
      if (isStale()) return;
      setSwapPreview({ loading: false, error: t('trading:assetSearch.swapPreview.failed'), path: null, loadedAt: null, refreshComparison: null });
    }
  };

  const handleLoadMarketData = async () => {
    if (!selectedAsset) return;
    const pairError = validateSwapPair();
    if (pairError) {
      setMarketData({ loading: false, error: pairError, orderbook: null, liquidityPools: [], loadedAt: null });
      return;
    }

    setMarketData({ loading: true, error: '', orderbook: null, liquidityPools: [], loadedAt: null });
    try {
      const server = getHorizonServerForNetwork(network);
      const [orderbook, pools] = await Promise.all([
        server.orderbook(swapSourceAsset, swapDestinationAsset).call(),
        server.liquidityPools().forAssets(swapSourceAsset, swapDestinationAsset).call(),
      ]);
      setMarketData({
        loading: false,
        error: '',
        orderbook,
        liquidityPools: Array.isArray(pools?.records) ? pools.records : [],
        loadedAt: Date.now(),
      });
    } catch {
      setMarketData({
        loading: false,
        error: t('trading:assetSearch.market.failed'),
        orderbook: null,
        liquidityPools: [],
        loadedAt: null,
      });
    }
  };

  const handleSwapTargetSearch = async () => {
    const query = parseAssetSearchQuery(swapTargetQuery);
    if (query.error) {
      setSwapTargetError(translateInputError(query.error));
      return;
    }
    const requestId = ++swapTargetRequestRef.current;
    setSwapTargetError('');
    setSwapTargetResults([]);
    setSelectedSwapTargetAsset(null);
    setSwapTargetLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.code) params.set('code', query.code);
      if (query.issuer) params.set('issuer', query.issuer);
      params.set('limit', '15');
      params.set('network', network);
      const response = await fetch(`${apiUrl('trade/assets/search')}?${params.toString()}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'assetSearch.failed:generic');
      if (swapTargetRequestRef.current !== requestId) return;
      const items = Array.isArray(data?.items) ? data.items : [];
      setSwapTargetResults(items);
      if (query.mode === 'exact') {
        const exact = items.find((item) =>
          String(item.assetCode || '').toUpperCase() === String(query.code || '').toUpperCase() &&
          item.assetIssuer === query.issuer
        );
        if (exact) setSelectedSwapTargetAsset(exact);
      }
    } catch (error) {
      if (swapTargetRequestRef.current !== requestId) return;
      const msg = error?.message || '';
      if (msg.startsWith('assetSearch.invalidInput:queryMissing')) {
        setSwapTargetError(t('trading:assetSearch.invalidInput.queryMissing'));
      } else if (msg.startsWith('assetSearch.invalidInput:codeInvalid')) {
        setSwapTargetError(t('trading:assetSearch.invalidInput.codeInvalid'));
      } else if (msg.startsWith('assetSearch.invalidInput:issuerInvalid')) {
        setSwapTargetError(t('trading:assetSearch.invalidInput.issuerInvalid'));
      } else {
        setSwapTargetError(t('trading:assetSearch.failed.generic'));
      }
    } finally {
      if (swapTargetRequestRef.current === requestId) setSwapTargetLoading(false);
    }
  };

  // Loeschen-Button im Ziel-Token-Picker; eine laufende Suche wird verworfen.
  const handleSwapTargetClear = () => {
    swapTargetRequestRef.current += 1;
    setSwapTargetQuery('');
    setSwapTargetResults([]);
    setSelectedSwapTargetAsset(null);
    setSwapTargetError('');
    setSwapTargetLoading(false);
  };

  // Jede Aktion baut ihre Transaktion frisch: Konto und Sequence vom Server des Ablaufnetzes
  // (server kommt von getHorizonServerForNetwork(network)), Passphrase aus demselben Netz.
  // flow: { network, accountId } der Bestaetigung (aus der Aktion, nie aus dem aktuellen
  // Zustand). checkAccount: Gewichtspruefung direkt nach dem Laden des Kontos (nur beim
  // lokalen Signieren). deferred/timeoutSeconds: Fee und Gueltigkeit fuer Job und XDR.
  // adjustAccount (nur Direktversand): Konto vor dem Bauen anpassen (Pin der Sequence einer
  // frueheren, nicht ausgefuehrten Transaktion dieses Kontos, siehe guardedSubmit).
  const loadAccountAndFee = async (server, { flow, checkAccount, deferred = false, adjustAccount = null }) => {
    if (!flow?.accountId || !flow?.network) throw new Error('submitTransaction.failed:trustlines.invalidInput');
    const feePromise = resolveFeePerOp(server, { deferred });
    const loaded = await server.loadAccount(flow.accountId);
    checkAccount?.(loaded);
    const account = adjustAccount ? adjustAccount(loaded) : loaded;
    return { account, feePromise };
  };

  const prepareChangeTrustTx = async ({ server, flow, asset, limit, checkAccount, deferred, timeoutSeconds, adjustAccount }) => {
    const { account, feePromise } = await loadAccountAndFee(server, { flow, checkAccount, deferred, adjustAccount });
    const tx = buildChangeTrustTransaction({
      account,
      asset,
      limit,
      fee: await feePromise,
      networkPassphrase: passphraseFor(flow.network),
      timeoutSeconds,
    });
    return { account, tx };
  };

  const prepareSwapTx = async ({ server, flow, checkAccount, deferred, timeoutSeconds, adjustAccount }) => {
    if (!flow?.accountId || !selectedAsset || !swapPreview.path) throw new Error('submitTransaction.failed:trustlines.invalidInput');
    const sendAmount = normalizeAmount(swapAmount);
    if (!sendAmount) throw new Error(t('trading:assetSearch.swapPreview.invalidAmount', { asset: swapSourceLabel }));
    const slippage = Number(String(swapSlippage || '').replace(',', '.'));
    if (!Number.isFinite(slippage) || slippage < 0 || slippage > 50) {
      throw new Error(t('trading:assetSearch.swapPreview.invalidSlippage'));
    }
    const pairError = validateSwapPair();
    if (pairError) throw new Error(pairError);

    const { account, feePromise } = await loadAccountAndFee(server, { flow, checkAccount, deferred, adjustAccount });

    if (!swapDestinationAsset.isNative()) {
      const destinationTrustline = await findTrustlineForAsset(server, swapDestinationAsset, 0, flow.accountId);
      if (!destinationTrustline) throw new Error(t('trading:assetSearch.swapPreview.destinationTrustlineMissing'));
      if (destinationTrustline.isAuthorized === false) throw new Error(t('trading:assetSearch.swapPreview.destinationTrustlineUnauthorized'));
    }

    const latestPathResponse = await server
      .strictSendPaths(swapSourceAsset, sendAmount, [swapDestinationAsset])
      .call();
    const latestRecords = Array.isArray(latestPathResponse?.records) ? latestPathResponse.records : [];
    if (!latestRecords.length) throw new Error(t('trading:assetSearch.swapPreview.noRoute'));
    const latestBest = [...latestRecords].sort((a, b) => Number(b.destination_amount || 0) - Number(a.destination_amount || 0))[0];
    const confirmedDestinationAmount = swapPreview.path?.destination_amount || '';
    const confirmedMinimumDestinationAmount = minimumDestinationAmount;
    const refreshComparison = {
      previousDestinationAmount: confirmedDestinationAmount,
      latestDestinationAmount: latestBest?.destination_amount || '',
      deltaPercent: calculatePercentChange(latestBest?.destination_amount, confirmedDestinationAmount),
      checkedAt: Date.now(),
    };
    if (!confirmedMinimumDestinationAmount) throw new Error(t('trading:assetSearch.swapPreview.minimumMissing'));
    if (Number(latestBest?.destination_amount || 0) < Number(confirmedMinimumDestinationAmount)) {
      setSwapPreview((current) => ({ ...current, loading: false, error: '', refreshComparison }));
      throw new Error(t('trading:assetSearch.swapPreview.quoteWorseThanMinimum'));
    }
    setSwapPreview((current) => ({ ...current, loading: false, error: '', path: latestBest, loadedAt: Date.now(), refreshComparison }));

    const path = Array.isArray(latestBest.path) ? latestBest.path.map(assetFromPathRecord) : [];
    const tx = buildPathPaymentStrictSendTransaction({
      account,
      sendAsset: swapSourceAsset,
      sendAmount,
      destination: flow.accountId,
      destAsset: swapDestinationAsset,
      destMin: confirmedMinimumDestinationAmount,
      path,
      fee: await feePromise,
      networkPassphrase: passphraseFor(flow.network),
      timeoutSeconds,
    });
    return { account, tx };
  };

  const prepareTrustlineAndSwapTx = async ({ server, flow, checkAccount, deferred, timeoutSeconds, adjustAccount }) => {
    if (!flow?.accountId || !selectedStellarAsset || !swapPreview.path) throw new Error('submitTransaction.failed:trustlines.invalidInput');
    if (swapDirection !== 'xlm-to-token') throw new Error(t('trading:assetSearch.trustlineFlow.combinedOnlyXlm'));
    if (assetFacts.loading) throw new Error(t('trading:assetSearch.facts.loading'));
    if (selectedAssetAuthRequired) throw new Error(t('trading:assetSearch.trustlineFlow.authRequiredCombinedBlocked'));
    const trustLimit = normalizeTrustlineLimit(trustlineLimit);
    if (!trustLimit) throw new Error(t('trading:assetSearch.trustlineFlow.invalidLimit'));
    const sendAmount = normalizeAmount(swapAmount);
    if (!sendAmount) throw new Error(t('trading:assetSearch.swapPreview.invalidAmount', { asset: swapSourceLabel }));
    const slippage = Number(String(swapSlippage || '').replace(',', '.'));
    if (!Number.isFinite(slippage) || slippage < 0 || slippage > 50) {
      throw new Error(t('trading:assetSearch.swapPreview.invalidSlippage'));
    }

    const { account, feePromise } = await loadAccountAndFee(server, { flow, checkAccount, deferred, adjustAccount });

    const existingTrustline = await findTrustlineForAsset(server, selectedStellarAsset, 0, flow.accountId);
    if (existingTrustline?.isAuthorized === false) throw new Error(t('trading:assetSearch.swapPreview.destinationTrustlineUnauthorized'));
    if (existingTrustline) throw new Error(t('trading:assetSearch.trustlineFlow.alreadyPresent'));

    const latestPathResponse = await server
      .strictSendPaths(Asset.native(), sendAmount, [selectedStellarAsset])
      .call();
    const latestRecords = Array.isArray(latestPathResponse?.records) ? latestPathResponse.records : [];
    if (!latestRecords.length) throw new Error(t('trading:assetSearch.swapPreview.noRoute'));
    const latestBest = [...latestRecords].sort((a, b) => Number(b.destination_amount || 0) - Number(a.destination_amount || 0))[0];
    const confirmedDestinationAmount = swapPreview.path?.destination_amount || '';
    const confirmedMinimumDestinationAmount = minimumDestinationAmount;
    const refreshComparison = {
      previousDestinationAmount: confirmedDestinationAmount,
      latestDestinationAmount: latestBest?.destination_amount || '',
      deltaPercent: calculatePercentChange(latestBest?.destination_amount, confirmedDestinationAmount),
      checkedAt: Date.now(),
    };
    if (!confirmedMinimumDestinationAmount) throw new Error(t('trading:assetSearch.swapPreview.minimumMissing'));
    if (Number(latestBest?.destination_amount || 0) < Number(confirmedMinimumDestinationAmount)) {
      setSwapPreview((current) => ({ ...current, loading: false, error: '', refreshComparison }));
      throw new Error(t('trading:assetSearch.swapPreview.quoteWorseThanMinimum'));
    }
    if (Number(latestBest?.destination_amount || 0) > Number(trustLimit)) {
      throw new Error(t('trading:assetSearch.trustlineFlow.limitBelowExpected'));
    }
    setSwapPreview((current) => ({ ...current, loading: false, error: '', path: latestBest, loadedAt: Date.now(), refreshComparison }));

    const path = Array.isArray(latestBest.path) ? latestBest.path.map(assetFromPathRecord) : [];
    const tx = buildChangeTrustAndPathPaymentStrictSendTransaction({
      account,
      trustAsset: selectedStellarAsset,
      trustLimit,
      sendAsset: Asset.native(),
      sendAmount,
      destination: flow.accountId,
      destAsset: selectedStellarAsset,
      destMin: confirmedMinimumDestinationAmount,
      path,
      fee: await feePromise,
      networkPassphrase: passphraseFor(flow.network),
      timeoutSeconds,
    });
    return { account, tx };
  };

  const prepareManageSellOfferTx = async ({ server, flow, selling, buying, amount, price, offerId = '0', checkAccount, deferred, timeoutSeconds, adjustAccount }) => {
    if (!flow?.accountId || !selling || !buying) throw new Error('submitTransaction.failed:trustlines.invalidInput');
    const { account, feePromise } = await loadAccountAndFee(server, { flow, checkAccount, deferred, adjustAccount });
    const tx = buildManageSellOfferTransaction({
      account,
      selling,
      buying,
      amount,
      price,
      offerId,
      fee: await feePromise,
      networkPassphrase: passphraseFor(flow.network),
      timeoutSeconds,
    });
    return { account, tx };
  };

  // Lokal signieren und senden (direkter Weg und "Alle Signaturen lokal"): Gewicht der
  // gesammelten Keys gegen die Schwelle der Aktion, nach den Horizon-Aufrufen Pruefung von
  // Quelle, Passphrase und globalem Netz. flow (Netz, Konto) kommt aus der Aktion.
  // Gesendet wird nach den Regeln der Sammelzahlung (guardedSubmit): exklusiv pro Netz, gesperrt
  // bei unklarem Eintrag des Kontos (aus jedem Sendeweg), Eintrag vor dem Submit, Pin der
  // Sequence nach "nicht ausgefuehrt". Freigabe nur ueber Horizon, nie durch einen Knopf.
  // actionText: Beschreibung der Aktion fuer die Anzeige des unklaren Eintrags.
  const submitSignedTx = async (type, prepare, collectedSigners, flow, actionText = '') => {
    if (!flow?.network || !flow?.accountId) throw new Error('submitTransaction.failed:trustlines.invalidInput');
    const server = getHorizonServerForNetwork(flow.network);
    const signers = Array.isArray(collectedSigners) ? collectedSigners : [];
    const checkAccount = (account) => {
      const required = requiredWeightFor(type, account?.thresholds || {});
      const current = getCollectedSignerWeight(signers, account?.signers || []);
      if (current <= 0) throw new Error('submitTransaction.failed:multisig.noKeysProvided');
      if (current < required) {
        throw Object.assign(new Error('submitTransaction.failed:multisig.insufficientWeight'), { required, current });
      }
    };
    const { res } = await guardedSubmit({
      network: flow.network,
      account: flow.accountId,
      server,
      networkPassphrase: passphraseFor(flow.network),
      // Trading hat kein fremdes Ziel (Swap sendet an das eigene Konto): keine Memo-Pruefung (SEP-29).
      skipMemoRequiredCheck: true,
      buildTx: async ({ adjustAccount }) => {
        const { tx } = await prepare({ server, flow, checkAccount, adjustAccount, timeoutSeconds: TRADING_SUBMIT_TIMEOUT_SECONDS });
        // Nach den Horizon-Aufrufen: passt die Transaktion zur Aktion, gilt das Netz noch?
        assertTxMatchesFlow(tx, flow, 'createAccount:networkChanged.funderAborted');
        // Gesperrt seit der Bestaetigung: nichts signieren (der Key kam vor der Sperre aus der Sitzung).
        if (flow.lockEpoch !== undefined && flow.lockEpoch !== lockEpochRef.current) {
          throw new Error('submitTransaction.failed:sessionLocked');
        }
        return { tx: signTransactionWithCollectedSigners(tx, signers) };
      },
      entryData: () => ({ origin: 'trade', summary: { action: actionText } }),
    });
    return res;
  };

  // Fehler eines Sendeversuchs: unklarer Ausgang oder Schutz (Eintrag steht, der Kasten oben
  // zeigt Status und Ausweg) bzw. eindeutiger Fehler (Meldung im Dialog).
  const handleSubmitFailure = (error) => {
    if (error instanceof AmbiguousSubmitResultError) {
      setShowSecretModal(false);
      setPendingAction(null);
      sendGuard.bump();
      return;
    }
    if (error instanceof SendBlockedError) {
      const msg = t(`common:payment.send.ambiguousResult.blockedReason.${error.reason}`);
      setModalError(msg);
      setActionMessage(msg);
      if (error.reason === 'blocked' || error.reason === 'pinConsumed' || error.reason === 'badSeq') {
        setShowSecretModal(false);
        setPendingAction(null);
      }
      sendGuard.bump();
      return;
    }
    // Gewicht reicht laut frisch geladenem Konto nicht (oder kein Signer): die Kontodaten der Seite
    // waren veraltet. Neu laden, damit der naechste Versuch Dialog bzw. Auswahl zeigt statt wieder
    // automatisch zu signieren.
    if (/multisig\.(insufficientWeight|noKeysProvided)$/.test(String(error?.message || ''))) {
      setTrustlineRefreshToken((value) => value + 1);
    }
    const formatted = formatErrorForUi(t, error);
    setModalError(formatted);
    setActionMessage(formatted);
  };

  // Zusammenfassung fuer Auswahl und Ergebnis der Multisig-Wege. Jedes Asset mit Code und
  // vollstaendigem Issuer (wie im Bestaetigungsdialog); Netz und Konto aus der Aktion.
  const assetWithIssuer = (asset) => {
    const issuer = getAssetIssuer(asset);
    return issuer
      ? t('trading:assetSearch.multisig.assetWithIssuer', { code: getAssetCode(asset), issuer })
      : formatAssetLabel(asset);
  };
  const describeTradingDetails = (type, payload) => {
    const s = (key) => t(`trading:assetSearch.multisig.summary.${key}`);
    if (type === 'trustline') {
      return [
        { label: s('asset'), value: assetWithIssuer(selectedStellarAsset) },
        { label: s('limit'), value: normalizeTrustlineLimit(trustlineLimit) || '' },
      ];
    }
    if (type === 'swap' || type === 'trustlineSwap') {
      const source = type === 'trustlineSwap' ? Asset.native() : swapSourceAsset;
      const destination = type === 'trustlineSwap' ? selectedStellarAsset : swapDestinationAsset;
      return [
        { label: s('sendAsset'), value: assetWithIssuer(source) },
        { label: s('sendAmount'), value: normalizeAmount(swapAmount) || '' },
        { label: s('destAsset'), value: assetWithIssuer(destination) },
        { label: s('destMin'), value: minimumDestinationAmount || '' },
        ...(type === 'trustlineSwap' ? [{ label: s('limit'), value: normalizeTrustlineLimit(trustlineLimit) || '' }] : []),
      ];
    }
    return [
      ...(type === 'cancelOffer' ? [{ label: s('offerId'), value: String(payload?.offerId || '') }] : []),
      { label: s('selling'), value: assetWithIssuer(payload?.selling) },
      { label: s('buying'), value: assetWithIssuer(payload?.buying) },
      ...(type === 'cancelOffer' ? [] : [
        { label: s('amount'), value: String(payload?.amount || '') },
        { label: s('price'), value: String(payload?.price || '') },
      ]),
    ];
  };
  const multisigItems = (description, details, type, flow) => (tx) => [
    { label: t('liquidity:job.source'), value: flow.accountId, wrap: true },
    { label: t('liquidity:job.network'), value: getNetworkConfig(flow.network).label },
    { label: t('trading:assetSearch.multisig.action'), value: description, wrap: true },
    ...details.map((d) => ({ label: d.label, value: d.value, wrap: true })),
    { label: t('liquidity:job.maxFee'), hint: t('liquidity:job.maxFeeHint'), value: `${amountFormatter.format(Number(tx.fee) / 1e7)} XLM` },
    // Swap als Job bewusst gesperrt (docs/adr/0011-kein-swap-als-multisig-job.md); beim XDR
    // der Hinweis, dass der Swap bis zum Senden am Kurs scheitern kann.
    ...(JOB_DISABLED_TYPES.includes(type)
      ? [{ label: t('trading:assetSearch.multisig.noteLabel'), value: t('trading:assetSearch.multisig.swapXdrNote'), note: true }]
      : []),
  ];
  const multisigRows = (description, details, flow) => [
    [t('trading:assetSearch.multisig.action'), description, { wrap: true }],
    ...details.map((d) => [d.label, d.value, { wrap: true }]),
    [t('liquidity:job.network'), getNetworkConfig(flow.network).label],
  ];
  const describeTradingAction = (type, payload) => {
    if (type === 'trustline') {
      return t('trading:assetSearch.multisig.actions.trustline', { asset: formatAssetLabel(selectedStellarAsset), limit: normalizeTrustlineLimit(trustlineLimit) });
    }
    if (type === 'swap' || type === 'trustlineSwap') {
      return t(`trading:assetSearch.multisig.actions.${type}`, {
        amount: normalizeAmount(swapAmount), source: swapSourceLabel, min: minimumDestinationAmount, destination: swapDestinationLabel,
      });
    }
    if (type === 'cancelOffer') return t('trading:assetSearch.multisig.actions.cancelOffer', { offerId: payload?.offerId || '' });
    return t('trading:assetSearch.multisig.actions.offer', {
      amount: payload?.amount, selling: formatAssetLabel(payload?.selling), buying: formatAssetLabel(payload?.buying), price: payload?.price,
    });
  };
  // Netz und Konto der Bestaetigung gehen in die Aktion; alle Wege (direkt, lokal, Job, XDR)
  // bauen und pruefen nur gegen diese Werte.
  const startTradingAction = (type, payload, execute, prepare) => {
    const flow = { network, accountId, lockEpoch: lockEpochRef.current };
    flowRef.current = flow;
    const description = describeTradingAction(type, payload);
    const details = describeTradingDetails(type, payload);
    multisig.start({
      type,
      network: flow.network,
      accountId: flow.accountId,
      payload,
      // Ein Sendevorgang gleichzeitig: ein zweiter Aufruf (Doppelklick, noch bevor die Oberflaeche
      // gesperrt ist) wird ignoriert, nicht an den Lock gehaengt und danach nochmals gesendet.
      execute: async (collected) => {
        if (submitInFlightRef.current) return undefined;
        submitInFlightRef.current = true;
        try {
          return await execute(collected, flow);
        } finally {
          submitInFlightRef.current = false;
        }
      },
      prepare,
      rows: multisigRows(description, details, flow),
      items: multisigItems(description, details, type, flow),
    });
  };

  const openTrustlineModal = (asset) => {
    setSelectedAsset(asset);
    setModalError('');
    setActionMessage('');
    if (!normalizeTrustlineLimit(trustlineLimit)) {
      setActionMessage(t('trading:assetSearch.trustlineFlow.invalidLimit'));
      return;
    }
    setShowTrustlineConfirm(true);
  };

  const handleConfirmTrustline = () => {
    setModalError('');
    setActionMessage('');
    setShowTrustlineConfirm(false);
    const asset = selectedAsset ? new Asset(selectedAsset.assetCode, selectedAsset.assetIssuer) : null;
    const limit = normalizeTrustlineLimit(trustlineLimit);
    startTradingAction('trustline', null, handleCreateTrustline, (opts) => prepareChangeTrustTx({ ...opts, asset, limit }));
  };

  const openTrustlineSwapModal = () => {
    if (!canPreviewTrustlineSwap) {
      const message = selectedAssetAuthRequired
        ? t('trading:assetSearch.trustlineFlow.authRequiredCombinedBlocked')
        : t('trading:assetSearch.trustlineFlow.combinedOnlyXlm');
      setModalError(message);
      setActionMessage(message);
      return;
    }
    if (!normalizeTrustlineLimit(trustlineLimit)) {
      const message = t('trading:assetSearch.trustlineFlow.invalidLimit');
      setModalError(message);
      setActionMessage(message);
      return;
    }
    if (!swapPreview.path) {
      const message = t('trading:assetSearch.swapPreview.previewRequired');
      setModalError(message);
      setActionMessage(message);
      return;
    }
    if (!minimumDestinationAmount) {
      const message = t('trading:assetSearch.swapPreview.minimumMissing');
      setModalError(message);
      setActionMessage(message);
      return;
    }
    if (Number(bestDestinationAmount || 0) > Number(normalizeTrustlineLimit(trustlineLimit))) {
      const message = t('trading:assetSearch.trustlineFlow.limitBelowExpected');
      setModalError(message);
      setActionMessage(message);
      return;
    }
    setModalError('');
    setActionMessage('');
    setShowTrustlineSwapConfirm(true);
  };

  const handleConfirmTrustlineSwap = () => {
    setModalError('');
    setActionMessage('');
    setShowTrustlineSwapConfirm(false);
    startTradingAction('trustlineSwap', null, handleExecuteTrustlineSwap, prepareTrustlineAndSwapTx);
  };

  const openSwapModal = () => {
    if (!swapPreview.path) {
      setActionMessage(t('trading:assetSearch.swapPreview.previewRequired'));
      return;
    }
    if (!minimumDestinationAmount) {
      setActionMessage(t('trading:assetSearch.swapPreview.minimumMissing'));
      return;
    }
    setShowSwapConfirm(true);
  };

  const handleConfirmSwap = () => {
    setModalError('');
    setActionMessage('');
    setShowSwapConfirm(false);
    startTradingAction('swap', null, handleExecuteSwap, prepareSwapTx);
  };

  const openCreateOfferModal = () => {
    const amount = normalizeAmount(limitOfferAmount);
    const price = normalizeAmount(limitOfferPrice);
    if (!selectedAsset || !limitOfferSellingAsset || !limitOfferBuyingAsset) {
      const message = t('trading:assetSearch.limitOffer.invalidPair');
      setModalError(message);
      setActionMessage(message);
      return;
    }
    if (!amount) {
      const message = t('trading:assetSearch.limitOffer.invalidAmount', { asset: limitOfferSellingLabel });
      setModalError(message);
      setActionMessage(message);
      return;
    }
    if (!price) {
      const message = t('trading:assetSearch.limitOffer.invalidPrice');
      setModalError(message);
      setActionMessage(message);
      return;
    }
    setPendingOfferAction({
      type: 'create',
      selling: limitOfferSellingAsset,
      buying: limitOfferBuyingAsset,
      amount,
      price,
      offerId: '0',
    });
    setModalError('');
    setActionMessage('');
    setShowOfferConfirm(true);
  };

  const openCancelOfferModal = (offer) => {
    const selling = assetFromOfferSide(offer, 'selling');
    const buying = assetFromOfferSide(offer, 'buying');
    setPendingOfferAction({
      type: 'cancel',
      selling,
      buying,
      amount: '0',
      price: offer?.price || '1',
      offerId: offer?.id || '0',
      offer,
    });
    setModalError('');
    setActionMessage('');
    setShowOfferConfirm(true);
  };

  const handleConfirmOffer = () => {
    setModalError('');
    setActionMessage('');
    setShowOfferConfirm(false);
    const offer = pendingOfferAction;
    startTradingAction(
      offer?.type === 'cancel' ? 'cancelOffer' : 'offer',
      offer,
      handleSubmitOfferAction,
      (opts) => {
        if (!offer) throw new Error('submitTransaction.failed:trustlines.invalidInput');
        return prepareManageSellOfferTx({ ...opts, ...offer });
      }
    );
  };

  const handleCreateTrustline = async (collectedSigners, flow) => {
    try {
      if (!selectedAsset) throw new Error('submitTransaction.failed:trustlines.invalidInput');
      setIsSubmittingTrustline(true);
      setModalError('');
      setActionMessage('');
      const stellarAsset = new Asset(selectedAsset.assetCode, selectedAsset.assetIssuer);
      const limit = normalizeTrustlineLimit(trustlineLimit);
      if (!limit) throw new Error(t('trading:assetSearch.trustlineFlow.invalidLimit'));
      await submitSignedTx('trustline', (opts) => prepareChangeTrustTx({ ...opts, asset: stellarAsset, limit }), collectedSigners, flow, describeTradingAction('trustline'));
      setActionMessage(t('trading:assetSearch.trustlineStatus.added'));
      setShowSecretModal(false);
      setTrustlineRefreshToken((value) => value + 1);
      return true;
    } catch (error) {
      handleSubmitFailure(error);
    } finally {
      setIsSubmittingTrustline(false);
    }
  };

  const handleExecuteSwap = async (collectedSigners, flow) => {
    try {
      setIsSubmittingSwap(true);
      setModalError('');
      setActionMessage('');
      const result = await submitSignedTx('swap', prepareSwapTx, collectedSigners, flow, describeTradingAction('swap'));
      const hash = result?.hash || result?.id || '';
      setActionMessage(hash
        ? `${t('trading:assetSearch.swapPreview.success')} ${hash}`
        : t('trading:assetSearch.swapPreview.success'));
      setShowSecretModal(false);
      setPendingAction(null);
      setSwapPreview({ loading: false, error: '', path: null, loadedAt: null, refreshComparison: null });
      setTrustlineRefreshToken((value) => value + 1);
      return true;
    } catch (error) {
      handleSubmitFailure(error);
    } finally {
      setIsSubmittingSwap(false);
    }
  };

  const handleExecuteTrustlineSwap = async (collectedSigners, flow) => {
    try {
      setIsSubmittingSwap(true);
      setModalError('');
      setActionMessage('');
      const result = await submitSignedTx('trustlineSwap', prepareTrustlineAndSwapTx, collectedSigners, flow, describeTradingAction('trustlineSwap'));
      const hash = result?.hash || result?.id || '';
      setActionMessage(hash
        ? `${t('trading:assetSearch.trustlineFlow.combinedSuccess')} ${hash}`
        : t('trading:assetSearch.trustlineFlow.combinedSuccess'));
      setShowSecretModal(false);
      setPendingAction(null);
      setSwapPreview({ loading: false, error: '', path: null, loadedAt: null, refreshComparison: null });
      setTrustlineRefreshToken((value) => value + 1);
      return true;
    } catch (error) {
      handleSubmitFailure(error);
    } finally {
      setIsSubmittingSwap(false);
    }
  };

  const handleSubmitOfferAction = async (collectedSigners, flow) => {
    try {
      if (!pendingOfferAction) throw new Error('submitTransaction.failed:trustlines.invalidInput');
      setIsSubmittingOffer(true);
      setModalError('');
      setActionMessage('');
      const offer = pendingOfferAction;
      const result = await submitSignedTx(
        offer.type === 'cancel' ? 'cancelOffer' : 'offer',
        (opts) => prepareManageSellOfferTx({ ...opts, ...offer }),
        collectedSigners,
        flow,
        describeTradingAction(offer.type === 'cancel' ? 'cancelOffer' : 'offer', offer)
      );
      const hash = result?.hash || result?.id || '';
      const successKey = pendingOfferAction.type === 'cancel'
        ? 'trading:assetSearch.limitOffer.cancelSuccess'
        : 'trading:assetSearch.limitOffer.createSuccess';
      setActionMessage(hash ? `${t(successKey)} ${hash}` : t(successKey));
      setShowSecretModal(false);
      setPendingAction(null);
      setPendingOfferAction(null);
      setLimitOfferAmount('');
      setLimitOfferPrice('');
      setLimitOfferRefreshToken((value) => value + 1);
      setTrustlineRefreshToken((value) => value + 1);
      // Horizon liefert die Offers-Liste manchmal erst nach dem Submit-Ergebnis: einmal nachladen.
      setTimeout(() => setLimitOfferRefreshToken((value) => value + 1), 3000);
      return true;
    } catch (error) {
      handleSubmitFailure(error);
    } finally {
      setIsSubmittingOffer(false);
    }
  };

  const handleAssetSearch = async (e) => {
    e.preventDefault();
    const query = parseAssetSearchQuery(assetQuery);
    if (query.error) {
      setAssetError(translateInputError(query.error));
      return;
    }
    setAssetError('');
    setAssetResults([]);
    setAssetResultFacts({});
    setSelectedAsset(null);
    setAssetLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.code) params.set('code', query.code);
      if (query.issuer) params.set('issuer', query.issuer);
      params.set('limit', '30');
      params.set('network', network);
      const searchUrl = `${apiUrl('trade/assets/search')}?${params.toString()}`;
      const resp = await fetch(searchUrl);
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const message = data?.error || 'assetSearch.failed:generic';
        throw new Error(message);
      }
      setAssetResults(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      const msg = err?.message || '';
      if (msg.startsWith('assetSearch.invalidInput:queryMissing')) {
        setAssetError(t('trading:assetSearch.invalidInput.queryMissing'));
      } else if (msg.startsWith('assetSearch.invalidInput:codeInvalid')) {
        setAssetError(t('trading:assetSearch.invalidInput.codeInvalid'));
      } else if (msg.startsWith('assetSearch.invalidInput:issuerInvalid')) {
        setAssetError(t('trading:assetSearch.invalidInput.issuerInvalid'));
      } else {
        setAssetError(t('trading:assetSearch.failed.generic'));
      }
    } finally {
      setAssetLoading(false);
    }
  };

  // 'available' | 'unavailable' | 'notChecked' - passed to TokenFactsSummary's
  // includeRoute block instead of it reading swapPreview directly.
  const swapRouteStatus = swapPreview.path ? 'available' : swapPreview.error ? 'unavailable' : 'notChecked';

  return (
    <section className="space-y-4">
      <AssetSearchForm
        accountInput={accountInput}
        network={network}
        assetQuery={assetQuery}
        onQueryChange={(value) => {
          setAssetQuery(value);
          if (assetError) setAssetError('');
        }}
        onSubmit={handleAssetSearch}
        assetLoading={assetLoading}
        parsedQuery={parsedQuery}
        describeSearchMode={describeSearchMode}
        assetError={assetError}
        actionMessage={actionMessage}
        modalError={modalError}
      />
      <AccountSendGuardNotice guard={sendGuard} network={network} />

      <AssetResultsTable
        assetResults={assetResults}
        assetError={assetError}
        assetLoading={assetLoading}
        countFormatter={countFormatter}
        sortedAssetResults={sortedAssetResults}
        assetResultFacts={assetResultFacts}
        toggleAssetSort={toggleAssetSort}
        sortIndicator={sortIndicator}
        formatTrustlineCount={formatTrustlineCount}
        onSelectAsset={setSelectedAsset}
      />

      {selectedAsset && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <div className="my-6 w-full max-w-5xl rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm shadow-lg dark:border-blue-900 dark:bg-blue-950">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">
                  {selectedAsset.assetCode}
                </h2>
                <span className="rounded-sm bg-white px-2 py-1 text-xs text-blue-800 dark:bg-blue-900 dark:text-blue-100">
                  {t('trading:assetSearch.detail.status.ledgerKnown', 'Known in Horizon')}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAsset(null)}
                className="rounded-sm border border-blue-300 px-3 py-1 text-xs font-semibold text-blue-900 hover:bg-white dark:border-blue-800 dark:text-blue-100 dark:hover:bg-blue-900"
              >
                {t('common:close', 'Close')}
              </button>
            </div>
          {multisig.error && (
            <p role="alert" data-testid="trading-job-error" className="mb-2 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {multisig.error}
            </p>
          )}
          <dl className="grid gap-2">
            <div>
              <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.result.columns.issuer')} helpKey='trading:assetSearch.help.issuer' /></dt>
              <dd className="break-all font-mono">{selectedAsset.assetIssuer}</dd>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.result.columns.numAccounts', 'Trustlines')} helpKey='trading:assetSearch.help.trustlines' /></dt>
                <dd>{formatTrustlineCount(selectedAsset)}</dd>
              </div>
              <div>
                <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.result.columns.amount', 'Amount')} helpKey='trading:assetSearch.help.totalAmount' /></dt>
                <dd>{formatAssetAmount(selectedAsset)}</dd>
                {(() => {
                  const breakdown = getAssetAmountBreakdown(selectedAsset);
                  if (!breakdown) return null;
                  return (
                    <dd className="mt-1 text-xs text-gray-600 dark:text-blue-200">
                      {t('trading:assetSearch.facts.amountBreakdown.trustlines', { amount: breakdown.trustlines })}
                      {breakdown.claimable && <>, {t('trading:assetSearch.facts.amountBreakdown.claimable', { amount: breakdown.claimable })}</>}
                      {breakdown.pools && <>, {t('trading:assetSearch.facts.amountBreakdown.pools', { amount: breakdown.pools })}</>}
                      {breakdown.contracts && <>, {t('trading:assetSearch.facts.amountBreakdown.contracts', { amount: breakdown.contracts })}</>}
                    </dd>
                  );
                })()}
              </div>
            </div>
            <div>
              <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.trustlineStatus.label')} helpKey='trading:assetSearch.help.trustlineStatus' /></dt>
              <dd>
                <span className={`inline-flex rounded-sm px-2 py-1 text-xs font-semibold ${
                  trustlineStatus.state === 'present'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
                    : trustlineStatus.state === 'missing'
                      ? 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100'
                      : trustlineStatus.state === 'error' || accountStatus.error
                        ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100'
                        : 'bg-white text-blue-800 dark:bg-blue-900 dark:text-blue-100'
                }`}>
                  {trustlineStatusLabel()}
                </span>
              </dd>
            </div>
            {trustlineStatus.state === 'present' && (
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.trustlineStatus.balance')} helpKey='trading:assetSearch.help.trustlineBalance' /></dt>
                  <dd>{trustlineStatus.balance ?? '—'}</dd>
                </div>
                <div>
                  <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.trustlineStatus.limit')} helpKey='trading:assetSearch.help.trustlineLimit' /></dt>
                  <dd>{trustlineStatus.limit ?? '—'}</dd>
                </div>
                <div>
                  <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.trustlineStatus.authorization')} helpKey='trading:assetSearch.help.authorization' /></dt>
                  <dd>
                    {trustlineStatus.isAuthorized === false
                      ? t('trading:assetSearch.trustlineStatus.unauthorized')
                      : t('trading:assetSearch.trustlineStatus.authorized')}
                  </dd>
                </div>
              </div>
            )}
          </dl>
          <p className="mt-3 text-xs text-blue-900 dark:text-blue-100">
            {t('trading:assetSearch.detail.nextStepHint', 'Known in Horizon only. Check issuer and trust before signing a trustline or swap.')}
          </p>
          {selectedTrustlineUnauthorized && (
            <p className="mt-3 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
              {t('trading:assetSearch.swapPreview.destinationTrustlineUnauthorized')}
            </p>
          )}
          <section className="mt-4 rounded-sm border border-gray-200 bg-white p-3 dark:border-blue-900 dark:bg-blue-900/40">
            <button
              type="button"
              onClick={() => setTokenFactsExpanded((value) => !value)}
              aria-expanded={tokenFactsExpanded}
              className="flex w-full items-center justify-between gap-3 text-left text-sm font-semibold"
            >
              <span>{t('trading:assetSearch.facts.title')}</span>
              <span className="rounded-sm border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700 dark:border-blue-800 dark:text-blue-100">
                {tokenFactsExpanded
                  ? t('trading:assetSearch.facts.collapse')
                  : t('trading:assetSearch.facts.expand')}
              </span>
            </button>
            {tokenFactsExpanded && (
              <div className="mt-3">
                {selectedStellarAsset && !selectedStellarAsset.isNative() && (
                  <TokenExchangeRate
                    tokenLabel={formatAssetLabel(selectedStellarAsset)}
                    exchangeRate={exchangeRate}
                    ratioFormatter={ratioFormatter}
                    formatQuoteAge={formatQuoteAge}
                  />
                )}
                <TokenFactsSummary facts={assetFacts} asset={selectedAsset} includeDisclaimer routeStatus={swapRouteStatus} />
              </div>
            )}
          </section>
          {trustlineStatus.state === 'missing' && accountId && (
            <TrustlineSection
              trustlineLimit={trustlineLimit}
              onLimitChange={setTrustlineLimit}
              trustlineReserveSummary={trustlineReserveSummary}
              amountFormatter={amountFormatter}
              selectedAssetNeedsAuthorization={selectedAssetNeedsAuthorization}
              onAddTrustline={() => openTrustlineModal(selectedAsset)}
              isSubmittingTrustline={isSubmittingTrustline}
              pendingAmbiguousSubmission={pendingAmbiguousSubmission}
              swapAmount={swapAmount}
              onSwapAmountChange={setSwapAmount}
              swapSlippage={swapSlippage}
              onSwapSlippageChange={setSwapSlippage}
              onPreviewCombined={() => handleSwapPreview({ allowMissingDestinationTrustline: canPreviewTrustlineSwap })}
              swapPreview={swapPreview}
              canPreviewTrustlineSwap={canPreviewTrustlineSwap}
              selectedAssetAuthRequired={selectedAssetAuthRequired}
              bestDestinationAmount={bestDestinationAmount}
              swapDestinationLabel={swapDestinationLabel}
              minimumDestinationAmount={minimumDestinationAmount}
              quoteDetails={quoteDetails}
              swapSourceAsset={swapSourceAsset}
              swapDestinationAsset={swapDestinationAsset}
              onOpenTrustlineSwapModal={openTrustlineSwapModal}
              isSubmittingSwap={isSubmittingSwap}
            />
          )}
          {trustlineStatus.state === 'present' && (
            <>
            <SwapSection
              swapDirection={swapDirection}
              onDirectionChange={setSwapDirection}
              swapTargetQuery={swapTargetQuery}
              onTargetQueryChange={(value) => {
                setSwapTargetQuery(value);
                setSelectedSwapTargetAsset(null);
                setSwapTargetError('');
              }}
              onSearchTarget={handleSwapTargetSearch}
              onClearTarget={handleSwapTargetClear}
              swapTargetLoading={swapTargetLoading}
              swapTargetError={swapTargetError}
              selectedSwapTargetAsset={selectedSwapTargetAsset}
              onSelectTarget={(item) => {
                setSelectedSwapTargetAsset(item);
                setSwapTargetQuery(`${item.assetCode}:${item.assetIssuer}`);
                setSwapTargetError('');
              }}
              targetStellarAsset={targetStellarAsset}
              targetAssetFacts={targetAssetFacts}
              swapRouteStatus={swapRouteStatus}
              swapTargetResults={swapTargetResults}
              formatTrustlineCount={formatTrustlineCount}
              swapSourceLabel={swapSourceLabel}
              swapDestinationLabel={swapDestinationLabel}
              swapAmount={swapAmount}
              onAmountChange={setSwapAmount}
              swapSlippage={swapSlippage}
              onSlippageChange={setSwapSlippage}
              onPreview={() => handleSwapPreview()}
              swapPreview={swapPreview}
              selectedTrustlineUnauthorized={selectedTrustlineUnauthorized}
              minimumDestinationAmount={minimumDestinationAmount}
              quoteDetails={quoteDetails}
              ratioFormatter={ratioFormatter}
              amountFormatter={amountFormatter}
              countFormatter={countFormatter}
              formatQuoteAge={formatQuoteAge}
              formatPercent={formatPercent}
              onOpenSwapModal={openSwapModal}
              isSubmittingSwap={isSubmittingSwap}
              pendingAmbiguousSubmission={pendingAmbiguousSubmission}
              onLoadMarketData={handleLoadMarketData}
              marketData={marketData}
              marketQuality={marketQuality}
              swapSourceAsset={swapSourceAsset}
              swapDestinationAsset={swapDestinationAsset}
            />
            <LimitOrdersSection
              limitOfferStatus={limitOfferStatus}
              onRefresh={() => setLimitOfferRefreshToken((value) => value + 1)}
              limitOfferDirection={limitOfferDirection}
              onDirectionChange={(value) => {
                setLimitOfferDirection(value);
                setModalError('');
                setActionMessage('');
              }}
              limitOfferAmount={limitOfferAmount}
              onAmountChange={(value) => {
                setLimitOfferAmount(value);
                setModalError('');
                setActionMessage('');
              }}
              limitOfferPrice={limitOfferPrice}
              onPriceChange={(value) => {
                setLimitOfferPrice(value);
                setModalError('');
                setActionMessage('');
              }}
              selectedStellarAsset={selectedStellarAsset}
              limitOfferSellingLabel={limitOfferSellingLabel}
              limitOfferBuyingLabel={limitOfferBuyingLabel}
              onCreateOffer={openCreateOfferModal}
              isSubmittingOffer={isSubmittingOffer}
              pendingAmbiguousSubmission={pendingAmbiguousSubmission}
              selectedRelatedOffers={selectedRelatedOffers}
              onCancelOffer={openCancelOfferModal}
            />
            </>
          )}
          </div>
        </div>
      )}
      {showTrustlineConfirm && selectedAsset && (
        <ConfirmActionModal
          kind="trustline"
          onCancel={() => setShowTrustlineConfirm(false)}
          onConfirm={handleConfirmTrustline}
          selectedAsset={selectedAsset}
          trustlineLimitAmount={trustlineLimitAmount}
          trustlineLimit={trustlineLimit}
          trustlineReserveSummary={trustlineReserveSummary}
          amountFormatter={amountFormatter}
          assetFacts={assetFacts}
          swapRouteStatus={swapRouteStatus}
        />
      )}
      {showTrustlineSwapConfirm && selectedAsset && swapPreview.path && (
        <ConfirmActionModal
          kind="trustlineSwap"
          onCancel={() => setShowTrustlineSwapConfirm(false)}
          onConfirm={handleConfirmTrustlineSwap}
          selectedAsset={selectedAsset}
          trustlineLimitAmount={trustlineLimitAmount}
          trustlineLimit={trustlineLimit}
          swapAmount={swapAmount}
          swapPreview={swapPreview}
          swapDestinationLabel={swapDestinationLabel}
          minimumDestinationAmount={minimumDestinationAmount}
          quoteDetails={quoteDetails}
          swapSourceAsset={swapSourceAsset}
          swapDestinationAsset={swapDestinationAsset}
        />
      )}
      {showSwapConfirm && selectedAsset && swapPreview.path && (
        <ConfirmActionModal
          kind="swap"
          onCancel={() => setShowSwapConfirm(false)}
          onConfirm={handleConfirmSwap}
          selectedAsset={selectedAsset}
          swapAmount={swapAmount}
          swapPreview={swapPreview}
          swapSourceLabel={swapSourceLabel}
          swapDestinationLabel={swapDestinationLabel}
          minimumDestinationAmount={minimumDestinationAmount}
          swapSlippage={swapSlippage}
          swapDirection={swapDirection}
          targetStellarAsset={targetStellarAsset}
          targetAssetFacts={targetAssetFacts}
          swapSourceAsset={swapSourceAsset}
          swapDestinationAsset={swapDestinationAsset}
          quoteDetails={quoteDetails}
          ratioFormatter={ratioFormatter}
          formatQuoteAge={formatQuoteAge}
          formatPercent={formatPercent}
          selectedAssetFactsTitleKey={selectedAssetFactsTitleKey}
          assetFacts={assetFacts}
          swapRouteStatus={swapRouteStatus}
        />
      )}
      {showOfferConfirm && pendingOfferAction && (
        <ConfirmActionModal
          kind="offer"
          onCancel={() => setShowOfferConfirm(false)}
          onConfirm={handleConfirmOffer}
          pendingOfferAction={pendingOfferAction}
        />
      )}
      <LiquiditySigningOptions
        open={!!multisig.options}
        choice={multisig.choice}
        onChoiceChange={multisig.setChoice}
        onProceed={multisig.proceed}
        onCancel={multisig.cancelOptions}
        rows={multisig.options?.rows || []}
        disabledOptions={multisig.jobDisabled ? ['job'] : []}
        // Swap als Job bewusst gesperrt, siehe docs/adr/0011-kein-swap-als-multisig-job.md.
        notes={multisig.jobDisabled ? [t('trading:assetSearch.multisig.swapJobDisabled')] : []}
      />
      <LiquidityResultDialog
        type="job"
        result={multisig.preparedJob}
        account={accountInfo}
        operationType="changeTrust"
        onClose={multisig.clearPreparedJob}
      />
      <LiquidityResultDialog
        type="xdr"
        result={multisig.exportedXdr}
        account={accountInfo}
        operationType="changeTrust"
        onClose={multisig.clearExportedXdr}
      />
      {showSecretModal && (
        <SecretKeyModal
          onConfirm={async (collected, remember) => {
            if (pendingAction?.execute) {
              const done = await pendingAction.execute(collected);
              // Merken (Haken im Dialog) erst nach erfolgreichem Senden, wie bei Claimable Balances.
              if (done === true && remember) {
                try {
                  await rememberSessionSecrets(flowRef.current?.accountId || accountId, collected);
                } catch (rememberErr) {
                  if (rememberErr instanceof InsecureCryptoContextError) {
                    setActionMessage((prev) => `${prev} ${t('secretKey:remember.insecureContextError')}`.trim());
                  }
                }
              }
              return done;
            }
            // No/unknown pendingAction (e.g. a stale re-render) must not silently
            // fall through to a trustline change the user never confirmed.
            const message = t('errors:unknown', 'Unbekannter Fehler');
            setModalError(message);
            setActionMessage(message);
            setShowSecretModal(false);
            return undefined;
          }}
          onCancel={() => {
            setShowSecretModal(false);
            setPendingAction(null);
            setModalError('');
            multisig.clearLocal();
          }}
          errorMessage={modalError}
          isProcessing={isSubmittingTrustline || isSubmittingSwap || isSubmittingOffer}
          thresholds={accountInfo?.thresholds || null}
          signers={accountInfo?.signers || []}
          accountId={accountId}
          operationType={modalOperationType}
          requiredThreshold={requiredThreshold}
          account={accountInfo}
          {...multisig.localModalProps}
        />
      )}
    </section>
  );
}
