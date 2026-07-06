import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Asset, Networks } from '@stellar/stellar-sdk';
import { getHorizonServer, loadTrustlines, resolveOrValidateAccount } from '../../utils/stellar/stellarUtils.js';
import SecretKeyModal from '../SecretKeyModal.jsx';
import { getRequiredThreshold } from '../../utils/getRequiredThreshold.js';
import { formatErrorForUi } from '../../utils/formatErrorForUi.js';
import { apiUrl } from '../../utils/apiBase.js';
import {
  buildChangeTrustAndPathPaymentStrictSendTransaction,
  buildChangeTrustTransaction,
  buildManageSellOfferTransaction,
  buildPathPaymentStrictSendTransaction,
  signTransactionWithCollectedSigners,
} from '../../utils/stellar/tradingTransactions.js';
import { submitTransactionSafely, AmbiguousSubmitResultError } from '../../utils/stellar/submitTransactionSafely.js';
import {
  DEFAULT_TRUSTLINE_LIMIT,
  EMPTY_ASSET_FACTS,
  assetResultKey,
  parseAssetSearchQuery,
  getStoredAccountInput,
  getStoredNetwork,
  normalizeAmount,
  calculateMinimumDestinationAmount,
  normalizeTrustlineLimit,
  formatAssetLabel,
  getAssetIssuer,
  getAssetCode,
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
  getOfferPriceNumber,
  sumOrderbookAmount,
  calculatePercentChange,
  getCollectedSignerWeight,
  getAccountFlag,
  getTrustlineReserveSummary,
} from './assetSearchUtils.js';
import HelpLabel from './HelpLabel.jsx';
import TokenFactsSummary from './TokenFactsSummary.jsx';
import LimitOrdersSection from './LimitOrdersSection.jsx';
import SwapSection from './SwapSection.jsx';
import TrustlineSection from './TrustlineSection.jsx';
import AssetSearchForm from './AssetSearchForm.jsx';
import AssetResultsTable from './AssetResultsTable.jsx';
import ConfirmActionModal from './ConfirmActionModal.jsx';
import useLimitOffers from './hooks/useLimitOffers.js';

export default function AssetSearch() {
  const { t, i18n } = useTranslation(['trading', 'common']);
  const [assetQuery, setAssetQuery] = useState('');
  const [assetResults, setAssetResults] = useState([]);
  const [assetResultFacts, setAssetResultFacts] = useState({});
  const [assetSort, setAssetSort] = useState({ field: 'quality', direction: 'desc' });
  const [assetError, setAssetError] = useState('');
  const [assetLoading, setAssetLoading] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [tokenFactsExpanded, setTokenFactsExpanded] = useState(false);
  const [accountInput, setAccountInput] = useState(() => getStoredAccountInput());
  const [accountId, setAccountId] = useState('');
  const [accountStatus, setAccountStatus] = useState({ loading: false, error: '' });
  const [accountInfo, setAccountInfo] = useState(null);
  const [network, setNetwork] = useState(() => getStoredNetwork());
  const [trustlineStatus, setTrustlineStatus] = useState({ loading: false, state: 'unknown', error: '', balance: null, limit: null, isAuthorized: null, isAuthorizedToMaintainLiabilities: null });
  const [trustlineLimit, setTrustlineLimit] = useState(DEFAULT_TRUSTLINE_LIMIT);
  const [assetFacts, setAssetFacts] = useState(EMPTY_ASSET_FACTS);
  const [trustlineRefreshToken, setTrustlineRefreshToken] = useState(0);
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [showTrustlineConfirm, setShowTrustlineConfirm] = useState(false);
  const [showTrustlineSwapConfirm, setShowTrustlineSwapConfirm] = useState(false);
  const [showSwapConfirm, setShowSwapConfirm] = useState(false);
  const [modalAction, setModalAction] = useState('');
  const [modalError, setModalError] = useState('');
  const [isSubmittingTrustline, setIsSubmittingTrustline] = useState(false);
  const [isSubmittingSwap, setIsSubmittingSwap] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [swapAmount, setSwapAmount] = useState('10');
  const [swapSlippage, setSwapSlippage] = useState('0.5');
  const [swapDirection, setSwapDirection] = useState('xlm-to-token');
  const [swapTargetQuery, setSwapTargetQuery] = useState('');
  const [swapTargetResults, setSwapTargetResults] = useState([]);
  const [swapTargetError, setSwapTargetError] = useState('');
  const [swapTargetLoading, setSwapTargetLoading] = useState(false);
  const [selectedSwapTargetAsset, setSelectedSwapTargetAsset] = useState(null);
  const [swapPreview, setSwapPreview] = useState({ loading: false, error: '', path: null, loadedAt: null, refreshComparison: null });
  const swapPreviewRequestRef = useRef(0);
  const [marketData, setMarketData] = useState({ loading: false, error: '', orderbook: null, liquidityPools: [], loadedAt: null });
  const [targetAssetFacts, setTargetAssetFacts] = useState(EMPTY_ASSET_FACTS);
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
  const [pendingAmbiguousSubmission, setPendingAmbiguousSubmission] = useState(null); // { hash } - set when a submit's outcome could not be confirmed

  const parsedQuery = useMemo(() => parseAssetSearchQuery(assetQuery), [assetQuery]);
  const parsedSwapTarget = useMemo(() => parseAssetSearchQuery(swapTargetQuery), [swapTargetQuery]);
  const modalOperationType = modalAction === 'swap'
    ? 'payment'
    : modalAction === 'trustlineSwap'
      ? 'payment'
    : (modalAction === 'offer' || modalAction === 'cancelOffer')
      ? 'manageOffer'
      : 'changeTrust';
  const requiredThreshold = useMemo(
    () => {
      if (modalAction === 'trustlineSwap') {
        const thresholds = accountInfo?.thresholds || null;
        return Math.max(
          getRequiredThreshold('changeTrust', thresholds),
          getRequiredThreshold('payment', thresholds)
        );
      }
      return getRequiredThreshold(modalOperationType, accountInfo?.thresholds || null);
    },
    [accountInfo, modalAction, modalOperationType]
  );
  const selectedStellarAsset = useMemo(
    () => (selectedAsset ? assetFromSearchResult(selectedAsset) : null),
    [selectedAsset]
  );
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
    const value = getAssetAmountNumber(asset);
    return value == null ? '—' : amountFormatter.format(value);
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

  useEffect(() => {
    const syncAccount = (event) => {
      const next = String(event?.detail?.address || getStoredAccountInput() || '').trim();
      setAccountInput(next);
    };
    const syncNetwork = (event) => {
      const next = typeof event?.detail === 'string' ? event.detail : getStoredNetwork();
      setNetwork(next === 'TESTNET' ? 'TESTNET' : 'PUBLIC');
    };
    window.addEventListener('stm:accountSelected', syncAccount);
    window.addEventListener('stm:accountChanged', syncAccount);
    window.addEventListener('stm-network-changed', syncNetwork);
    return () => {
      window.removeEventListener('stm:accountSelected', syncAccount);
      window.removeEventListener('stm:accountChanged', syncAccount);
      window.removeEventListener('stm-network-changed', syncNetwork);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const input = String(accountInput || '').trim();
    setAccountId('');
    setAccountInfo(null);
    setTrustlineStatus({ loading: false, state: 'unknown', error: '', balance: null, limit: null, isAuthorized: null, isAuthorizedToMaintainLiabilities: null });
    if (!input) {
      setAccountStatus({ loading: false, error: '' });
      return () => { cancelled = true; };
    }
    setAccountStatus({ loading: true, error: '' });
    resolveOrValidateAccount(input)
      .then((resolved) => {
        if (cancelled) return;
        setAccountId(resolved.accountId || '');
        setAccountStatus({ loading: false, error: '' });
      })
      .catch(() => {
        if (cancelled) return;
        setAccountId('');
        setAccountStatus({ loading: false, error: t('trading:assetSearch.account.invalid') });
      });
    return () => { cancelled = true; };
  }, [accountInput, t]);

  useEffect(() => {
    let cancelled = false;
    if (!accountId) {
      setAccountInfo(null);
      return () => { cancelled = true; };
    }
    const server = getHorizonServer(network === 'TESTNET' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org');
    server.loadAccount(accountId)
      .then((account) => {
        if (!cancelled) setAccountInfo(account);
      })
      .catch(() => {
        if (!cancelled) setAccountInfo(null);
      });
    return () => { cancelled = true; };
  }, [accountId, network, trustlineRefreshToken]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedAsset || !accountId) {
      setTrustlineStatus({ loading: false, state: accountId ? 'unknown' : 'noAccount', error: '', balance: null, limit: null, isAuthorized: null, isAuthorizedToMaintainLiabilities: null });
      return () => { cancelled = true; };
    }

    setTrustlineStatus({ loading: true, state: 'loading', error: '', balance: null, limit: null, isAuthorized: null, isAuthorizedToMaintainLiabilities: null });
    const server = getHorizonServer(network === 'TESTNET' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org');
    loadTrustlines(accountId, server, { includeOps: false, ttlMs: 10000 })
      .then((trustlines) => {
        if (cancelled) return;
        const match = trustlines.find((tl) =>
          tl.assetCode === selectedAsset.assetCode &&
          tl.assetIssuer === selectedAsset.assetIssuer
        );
        if (match) {
          setTrustlineStatus({
            loading: false,
            state: 'present',
            error: '',
            balance: match.assetBalance,
            limit: match.limit,
            isAuthorized: match.isAuthorized,
            isAuthorizedToMaintainLiabilities: match.isAuthorizedToMaintainLiabilities,
          });
        } else {
          setTrustlineStatus({ loading: false, state: 'missing', error: '', balance: null, limit: null, isAuthorized: null, isAuthorizedToMaintainLiabilities: null });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setTrustlineStatus({
          loading: false,
          state: 'error',
          error: err?.message || 'error.loadTrustlines',
          balance: null,
          limit: null,
          isAuthorized: null,
          isAuthorizedToMaintainLiabilities: null,
        });
      });
    return () => { cancelled = true; };
  }, [accountId, network, selectedAsset, trustlineRefreshToken]);

  useEffect(() => {
    setSwapPreview({ loading: false, error: '', path: null, loadedAt: null, refreshComparison: null });
    setMarketData({ loading: false, error: '', orderbook: null, liquidityPools: [], loadedAt: null });
  }, [selectedAsset, network, swapDirection, swapTargetQuery, selectedSwapTargetAsset]);

  useEffect(() => {
    setTrustlineLimit(DEFAULT_TRUSTLINE_LIMIT);
    setShowTrustlineConfirm(false);
    setShowTrustlineSwapConfirm(false);
    setSwapDirection('xlm-to-token');
    setTokenFactsExpanded(false);
  }, [selectedAsset, network]);

  // pendingOfferAction/showOfferConfirm are part of the modalAction
  // confirm/submit dispatch pipeline (step 6 territory) - useLimitOffers
  // resets its own limitOfferAmount/limitOfferPrice fields itself.
  useEffect(() => {
    setPendingOfferAction(null);
    setShowOfferConfirm(false);
  }, [selectedAsset, network]);

  const loadAssetFactsForIdentity = useCallback(async ({ code, issuer }) => {
    const params = new URLSearchParams({ code, issuer, network });
    const response = await fetch(`${apiUrl('trade/assets/facts')}?${params.toString()}`);
    const facts = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(facts?.error || 'assetFacts.failed:generic');
    return {
      loading: false,
      error: '',
      issuerAccount: facts?.issuerAccount || null,
      toml: {
        status: facts?.toml?.status || 'notChecked',
        url: facts?.toml?.url || '',
        currencies: Array.isArray(facts?.toml?.currencies) ? facts.toml.currencies : [],
        matches: Array.isArray(facts?.toml?.matches) ? facts.toml.matches : [],
        error: facts?.toml?.error || '',
      },
    };
  }, [network]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedAsset?.assetIssuer) {
      setAssetFacts(EMPTY_ASSET_FACTS);
      return () => { cancelled = true; };
    }

    const loadFacts = async () => {
      setAssetFacts({ ...EMPTY_ASSET_FACTS, loading: true });
      try {
        const facts = await loadAssetFactsForIdentity({
          code: selectedAsset.assetCode,
          issuer: selectedAsset.assetIssuer,
        });
        if (cancelled) return;
        setAssetFacts(facts);
      } catch (error) {
        if (!cancelled) {
          setAssetFacts({
            ...EMPTY_ASSET_FACTS,
            loading: false,
            error: error?.message || 'issuerLoadFailed',
          });
        }
      }
    };

    loadFacts();
    return () => { cancelled = true; };
  }, [loadAssetFactsForIdentity, selectedAsset]);

  useEffect(() => {
    let cancelled = false;
    const code = getAssetCode(targetStellarAsset);
    const issuer = getAssetIssuer(targetStellarAsset);
    if (swapDirection !== 'token-to-token' || !code || !issuer) {
      setTargetAssetFacts(EMPTY_ASSET_FACTS);
      return () => { cancelled = true; };
    }

    const loadFacts = async () => {
      setTargetAssetFacts({ ...EMPTY_ASSET_FACTS, loading: true });
      try {
        const facts = await loadAssetFactsForIdentity({ code, issuer });
        if (!cancelled) setTargetAssetFacts(facts);
      } catch (error) {
        if (!cancelled) {
          setTargetAssetFacts({
            ...EMPTY_ASSET_FACTS,
            loading: false,
            error: error?.message || 'issuerLoadFailed',
          });
        }
      }
    };

    loadFacts();
    return () => { cancelled = true; };
  }, [loadAssetFactsForIdentity, targetStellarAsset, swapDirection]);

  useEffect(() => {
    let cancelled = false;
    if (!assetResults.length) {
      setAssetResultFacts({});
      return () => { cancelled = true; };
    }

    const initialFacts = {};
    assetResults.forEach((asset) => {
      initialFacts[assetResultKey(asset)] = { loading: true, homeDomain: false, tomlListed: false, error: '' };
    });
    setAssetResultFacts(initialFacts);

    const loadFactsForAsset = async (asset) => {
      const key = assetResultKey(asset);
      try {
        const params = new URLSearchParams({
          code: asset.assetCode,
          issuer: asset.assetIssuer,
          network,
        });
        const response = await fetch(`${apiUrl('trade/assets/facts')}?${params.toString()}`);
        const facts = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(facts?.error || 'assetFacts.failed:generic');
        if (cancelled) return;
        const homeDomain = Boolean(facts?.issuerAccount?.homeDomain || facts?.issuerAccount?.home_domain);
        const tomlListed = facts?.toml?.status === 'loaded' && Array.isArray(facts?.toml?.matches) && facts.toml.matches.length > 0;
        setAssetResultFacts((current) => ({
          ...current,
          [key]: { loading: false, homeDomain, tomlListed, error: '' },
        }));
      } catch (error) {
        if (cancelled) return;
        setAssetResultFacts((current) => ({
          ...current,
          [key]: { loading: false, homeDomain: false, tomlListed: false, error: error?.message || 'assetFacts.failed:generic' },
        }));
      }
    };

    const queue = [...assetResults];
    const workerCount = Math.min(4, queue.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (queue.length && !cancelled) {
        const asset = queue.shift();
        await loadFactsForAsset(asset);
      }
    });
    Promise.all(workers).catch(() => {});

    return () => { cancelled = true; };
  }, [assetResults, network]);

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

  const trustlineActionLabel = (asset) => {
    const isSelected = selectedAsset?.assetCode === asset.assetCode && selectedAsset?.assetIssuer === asset.assetIssuer;
    if (!isSelected) return t('trading:assetSearch.actions.trustline', 'Trustline');
    if (trustlineStatus.loading) return t('common:loading', 'Loading...');
    if (trustlineStatus.state === 'present') return t('trading:assetSearch.actions.trustlinePresent', 'Trustline exists');
    if (trustlineStatus.state === 'missing') return t('trading:assetSearch.actions.trustlineAdd', 'Add trustline');
    return t('trading:assetSearch.actions.trustline', 'Trustline');
  };

  const canAddTrustlineFor = (asset) => {
    const isSelected = selectedAsset?.assetCode === asset.assetCode && selectedAsset?.assetIssuer === asset.assetIssuer;
    return !!accountId && isSelected && trustlineStatus.state === 'missing' && !trustlineStatus.loading && !isSubmittingTrustline && !pendingAmbiguousSubmission;
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

  const findTrustlineForAsset = async (server, asset, ttlMs = 10000) => {
    if (!accountId || !asset || asset.isNative?.()) return null;
    const trustlines = await loadTrustlines(accountId, server, { includeOps: false, ttlMs });
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
      const server = getHorizonServer(network === 'TESTNET' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org');
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
      const server = getHorizonServer(network === 'TESTNET' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org');
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
      setSwapTargetLoading(false);
    }
  };

  const submitChangeTrustTx = async ({ asset, limit, collectedSigners }) => {
    if (!accountId) throw new Error('submitTransaction.failed:trustlines.invalidInput');
    const server = getHorizonServer(network === 'TESTNET' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org');
    const accountPromise = server.loadAccount(accountId);
    const feeStatsPromise = server.feeStats();
    const account = await accountPromise;
    const thresholds = account?.thresholds || {};
    const required = getRequiredThreshold('changeTrust', thresholds);
    const horizonSigners = account?.signers || [];
    const signers = Array.isArray(collectedSigners) ? collectedSigners : [];
    const current = getCollectedSignerWeight(signers, horizonSigners);
    if (current <= 0) throw new Error('submitTransaction.failed:multisig.noKeysProvided');
    if (current < required) throw new Error('submitTransaction.failed:multisig.insufficientWeight');

    const feeStats = await feeStatsPromise;
    const fee = String(Number(feeStats?.fee_charged?.mode || 100));
    const tx = buildChangeTrustTransaction({
      account,
      asset,
      limit,
      fee,
      networkPassphrase: network === 'TESTNET' ? Networks.TESTNET : Networks.PUBLIC,
    });
    return submitTransactionSafely(server, signTransactionWithCollectedSigners(tx, signers));
  };

  const submitSwapTx = async ({ collectedSigners }) => {
    if (!accountId || !selectedAsset || !swapPreview.path) throw new Error('submitTransaction.failed:trustlines.invalidInput');
    const sendAmount = normalizeAmount(swapAmount);
    if (!sendAmount) throw new Error(t('trading:assetSearch.swapPreview.invalidAmount', { asset: swapSourceLabel }));
    const slippage = Number(String(swapSlippage || '').replace(',', '.'));
    if (!Number.isFinite(slippage) || slippage < 0 || slippage > 50) {
      throw new Error(t('trading:assetSearch.swapPreview.invalidSlippage'));
    }
    const pairError = validateSwapPair();
    if (pairError) throw new Error(pairError);

    const server = getHorizonServer(network === 'TESTNET' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org');
    const feeStatsPromise = server.feeStats();
    const account = await server.loadAccount(accountId);
    const thresholds = account?.thresholds || {};
    const required = getRequiredThreshold('payment', thresholds);
    const horizonSigners = account?.signers || [];
    const signers = Array.isArray(collectedSigners) ? collectedSigners : [];
    const current = getCollectedSignerWeight(signers, horizonSigners);
    if (current <= 0) throw new Error('submitTransaction.failed:multisig.noKeysProvided');
    if (current < required) throw new Error('submitTransaction.failed:multisig.insufficientWeight');

    if (!swapDestinationAsset.isNative()) {
      const destinationTrustline = await findTrustlineForAsset(server, swapDestinationAsset, 0);
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
    const feeStats = await feeStatsPromise;
    const fee = String(Number(feeStats?.fee_charged?.mode || 100));
    const tx = buildPathPaymentStrictSendTransaction({
      account,
      sendAsset: swapSourceAsset,
      sendAmount,
      destination: accountId,
      destAsset: swapDestinationAsset,
      destMin: confirmedMinimumDestinationAmount,
      path,
      fee,
      networkPassphrase: network === 'TESTNET' ? Networks.TESTNET : Networks.PUBLIC,
    });
    return submitTransactionSafely(server, signTransactionWithCollectedSigners(tx, signers));
  };

  const submitTrustlineAndSwapTx = async ({ collectedSigners }) => {
    if (!accountId || !selectedStellarAsset || !swapPreview.path) throw new Error('submitTransaction.failed:trustlines.invalidInput');
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

    const server = getHorizonServer(network === 'TESTNET' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org');
    const feeStatsPromise = server.feeStats();
    const account = await server.loadAccount(accountId);
    const thresholds = account?.thresholds || {};
    const required = Math.max(
      getRequiredThreshold('changeTrust', thresholds),
      getRequiredThreshold('payment', thresholds)
    );
    const horizonSigners = account?.signers || [];
    const signers = Array.isArray(collectedSigners) ? collectedSigners : [];
    const current = getCollectedSignerWeight(signers, horizonSigners);
    if (current <= 0) throw new Error('submitTransaction.failed:multisig.noKeysProvided');
    if (current < required) throw new Error('submitTransaction.failed:multisig.insufficientWeight');

    const existingTrustline = await findTrustlineForAsset(server, selectedStellarAsset, 0);
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
    const feeStats = await feeStatsPromise;
    const fee = String(Number(feeStats?.fee_charged?.mode || 100));
    const tx = buildChangeTrustAndPathPaymentStrictSendTransaction({
      account,
      trustAsset: selectedStellarAsset,
      trustLimit,
      sendAsset: Asset.native(),
      sendAmount,
      destination: accountId,
      destAsset: selectedStellarAsset,
      destMin: confirmedMinimumDestinationAmount,
      path,
      fee,
      networkPassphrase: network === 'TESTNET' ? Networks.TESTNET : Networks.PUBLIC,
    });
    return submitTransactionSafely(server, signTransactionWithCollectedSigners(tx, signers));
  };

  const submitManageSellOfferTx = async ({ selling, buying, amount, price, offerId = '0', collectedSigners }) => {
    if (!accountId || !selling || !buying) throw new Error('submitTransaction.failed:trustlines.invalidInput');
    const server = getHorizonServer(network === 'TESTNET' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org');
    const feeStatsPromise = server.feeStats();
    const account = await server.loadAccount(accountId);
    const thresholds = account?.thresholds || {};
    const required = getRequiredThreshold('manageOffer', thresholds);
    const horizonSigners = account?.signers || [];
    const signers = Array.isArray(collectedSigners) ? collectedSigners : [];
    const current = getCollectedSignerWeight(signers, horizonSigners);
    if (current <= 0) throw new Error('submitTransaction.failed:multisig.noKeysProvided');
    if (current < required) throw new Error('submitTransaction.failed:multisig.insufficientWeight');

    const feeStats = await feeStatsPromise;
    const fee = String(Number(feeStats?.fee_charged?.mode || 100));
    const tx = buildManageSellOfferTransaction({
      account,
      selling,
      buying,
      amount,
      price,
      offerId,
      fee,
      networkPassphrase: network === 'TESTNET' ? Networks.TESTNET : Networks.PUBLIC,
    });
    return submitTransactionSafely(server, signTransactionWithCollectedSigners(tx, signers));
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
    setModalAction('trustline');
    setModalError('');
    setActionMessage('');
    setShowTrustlineConfirm(false);
    setShowSecretModal(true);
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
    setModalAction('trustlineSwap');
    setModalError('');
    setActionMessage('');
    setShowTrustlineSwapConfirm(false);
    setShowSecretModal(true);
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
    setModalAction('swap');
    setModalError('');
    setActionMessage('');
    setShowSwapConfirm(false);
    setShowSecretModal(true);
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
    setModalAction(pendingOfferAction?.type === 'cancel' ? 'cancelOffer' : 'offer');
    setModalError('');
    setActionMessage('');
    setShowOfferConfirm(false);
    setShowSecretModal(true);
  };

  const handleCreateTrustline = async (collectedSigners) => {
    try {
      if (!selectedAsset) throw new Error('submitTransaction.failed:trustlines.invalidInput');
      setIsSubmittingTrustline(true);
      setModalError('');
      setActionMessage('');
      const stellarAsset = new Asset(selectedAsset.assetCode, selectedAsset.assetIssuer);
      const limit = normalizeTrustlineLimit(trustlineLimit);
      if (!limit) throw new Error(t('trading:assetSearch.trustlineFlow.invalidLimit'));
      await submitChangeTrustTx({
        asset: stellarAsset,
        limit,
        collectedSigners,
      });
      setActionMessage(t('trading:assetSearch.trustlineStatus.added'));
      setShowSecretModal(false);
      setTrustlineRefreshToken((value) => value + 1);
    } catch (error) {
      if (error instanceof AmbiguousSubmitResultError) {
        setPendingAmbiguousSubmission({ hash: error.hash });
        setShowSecretModal(false);
        setModalAction('');
      } else {
        const formatted = formatErrorForUi(t, error);
        setModalError(formatted);
        setActionMessage(formatted);
      }
    } finally {
      setIsSubmittingTrustline(false);
    }
  };

  const handleExecuteSwap = async (collectedSigners) => {
    try {
      setIsSubmittingSwap(true);
      setModalError('');
      setActionMessage('');
      const result = await submitSwapTx({ collectedSigners });
      const hash = result?.hash || result?.id || '';
      setActionMessage(hash
        ? `${t('trading:assetSearch.swapPreview.success')} ${hash}`
        : t('trading:assetSearch.swapPreview.success'));
      setShowSecretModal(false);
      setModalAction('');
      setSwapPreview({ loading: false, error: '', path: null, loadedAt: null, refreshComparison: null });
      setTrustlineRefreshToken((value) => value + 1);
    } catch (error) {
      if (error instanceof AmbiguousSubmitResultError) {
        setPendingAmbiguousSubmission({ hash: error.hash });
        setShowSecretModal(false);
        setModalAction('');
      } else {
        const formatted = formatErrorForUi(t, error);
        setModalError(formatted);
        setActionMessage(formatted);
      }
    } finally {
      setIsSubmittingSwap(false);
    }
  };

  const handleExecuteTrustlineSwap = async (collectedSigners) => {
    try {
      setIsSubmittingSwap(true);
      setModalError('');
      setActionMessage('');
      const result = await submitTrustlineAndSwapTx({ collectedSigners });
      const hash = result?.hash || result?.id || '';
      setActionMessage(hash
        ? `${t('trading:assetSearch.trustlineFlow.combinedSuccess')} ${hash}`
        : t('trading:assetSearch.trustlineFlow.combinedSuccess'));
      setShowSecretModal(false);
      setModalAction('');
      setSwapPreview({ loading: false, error: '', path: null, loadedAt: null, refreshComparison: null });
      setTrustlineRefreshToken((value) => value + 1);
    } catch (error) {
      if (error instanceof AmbiguousSubmitResultError) {
        setPendingAmbiguousSubmission({ hash: error.hash });
        setShowSecretModal(false);
        setModalAction('');
      } else {
        const formatted = formatErrorForUi(t, error);
        setModalError(formatted);
        setActionMessage(formatted);
      }
    } finally {
      setIsSubmittingSwap(false);
    }
  };

  const handleSubmitOfferAction = async (collectedSigners) => {
    try {
      if (!pendingOfferAction) throw new Error('submitTransaction.failed:trustlines.invalidInput');
      setIsSubmittingOffer(true);
      setModalError('');
      setActionMessage('');
      const result = await submitManageSellOfferTx({
        ...pendingOfferAction,
        collectedSigners,
      });
      const hash = result?.hash || result?.id || '';
      const successKey = pendingOfferAction.type === 'cancel'
        ? 'trading:assetSearch.limitOffer.cancelSuccess'
        : 'trading:assetSearch.limitOffer.createSuccess';
      setActionMessage(hash ? `${t(successKey)} ${hash}` : t(successKey));
      setShowSecretModal(false);
      setModalAction('');
      setPendingOfferAction(null);
      setLimitOfferAmount('');
      setLimitOfferPrice('');
      setLimitOfferRefreshToken((value) => value + 1);
      setTrustlineRefreshToken((value) => value + 1);
    } catch (error) {
      if (error instanceof AmbiguousSubmitResultError) {
        setPendingAmbiguousSubmission({ hash: error.hash });
        setShowSecretModal(false);
        setModalAction('');
      } else {
        const formatted = formatErrorForUi(t, error);
        setModalError(formatted);
        setActionMessage(formatted);
      }
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
        pendingAmbiguousSubmission={pendingAmbiguousSubmission}
        onAcknowledgeAmbiguous={() => setPendingAmbiguousSubmission(null)}
        actionMessage={actionMessage}
        modalError={modalError}
      />

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
        canAddTrustlineFor={canAddTrustlineFor}
        onOpenTrustlineModal={openTrustlineModal}
        trustlineActionLabel={trustlineActionLabel}
      />

      {selectedAsset && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black bg-opacity-50 p-4">
          <div className="my-6 w-full max-w-5xl rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm shadow-lg dark:border-blue-900 dark:bg-blue-950">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">
                  {selectedAsset.assetCode}
                </h2>
                <span className="rounded bg-white px-2 py-1 text-xs text-blue-800 dark:bg-blue-900 dark:text-blue-100">
                  {t('trading:assetSearch.detail.status.ledgerKnown', 'Known in Horizon')}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAsset(null)}
                className="rounded border border-blue-300 px-3 py-1 text-xs font-semibold text-blue-900 hover:bg-white dark:border-blue-800 dark:text-blue-100 dark:hover:bg-blue-900"
              >
                {t('common:close', 'Close')}
              </button>
            </div>
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
              </div>
            </div>
            <div>
              <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.trustlineStatus.label')} helpKey='trading:assetSearch.help.trustlineStatus' /></dt>
              <dd>
                <span className={`inline-flex rounded px-2 py-1 text-xs font-semibold ${
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
            <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
              {t('trading:assetSearch.swapPreview.destinationTrustlineUnauthorized')}
            </p>
          )}
          <section className="mt-4 rounded border border-gray-200 bg-white p-3 dark:border-blue-900 dark:bg-blue-900/40">
            <button
              type="button"
              onClick={() => setTokenFactsExpanded((value) => !value)}
              aria-expanded={tokenFactsExpanded}
              className="flex w-full items-center justify-between gap-3 text-left text-sm font-semibold"
            >
              <span>{t('trading:assetSearch.facts.title')}</span>
              <span className="rounded border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700 dark:border-blue-800 dark:text-blue-100">
                {tokenFactsExpanded
                  ? t('trading:assetSearch.facts.collapse')
                  : t('trading:assetSearch.facts.expand')}
              </span>
            </button>
            {tokenFactsExpanded && (
              <div className="mt-3">
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
      {showSecretModal && (
        <SecretKeyModal
          onConfirm={(collected) => {
            if (modalAction === 'swap') return handleExecuteSwap(collected);
            if (modalAction === 'trustlineSwap') return handleExecuteTrustlineSwap(collected);
            if (modalAction === 'offer' || modalAction === 'cancelOffer') return handleSubmitOfferAction(collected);
            if (modalAction === 'trustline') return handleCreateTrustline(collected);
            // Unknown/empty modalAction (e.g. a stale re-render) must not silently
            // fall through to a trustline change the user never confirmed.
            const message = t('errors:unknown', 'Unbekannter Fehler');
            setModalError(message);
            setActionMessage(message);
            setShowSecretModal(false);
            return undefined;
          }}
          onCancel={() => {
            setShowSecretModal(false);
            setModalAction('');
            setModalError('');
          }}
          errorMessage={modalError}
          isProcessing={isSubmittingTrustline || isSubmittingSwap || isSubmittingOffer}
          thresholds={accountInfo?.thresholds || null}
          signers={accountInfo?.signers || []}
          operationType={modalOperationType}
          requiredThreshold={requiredThreshold}
          account={accountInfo}
        />
      )}
    </section>
  );
}
