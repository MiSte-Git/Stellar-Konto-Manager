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
  shortenKey,
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
  formatAssetLabelWithIssuer,
  formatAssetPath,
  formatDetailedAssetPath,
  assetFromPathRecord,
  assetFromOfferSide,
  assetFromSearchResult,
  assetFromExactQuery,
  assetsEqual,
  formatReserveAsset,
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
import { factValue } from './assetFactsUtils.js';
import HelpLabel from './HelpLabel.jsx';
import TokenFactsSummary from './TokenFactsSummary.jsx';

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
  const [limitOfferDirection, setLimitOfferDirection] = useState('sell-token-for-xlm');
  const [limitOfferAmount, setLimitOfferAmount] = useState('');
  const [limitOfferPrice, setLimitOfferPrice] = useState('');
  const [limitOfferStatus, setLimitOfferStatus] = useState({ loading: false, error: '', offers: [] });
  const [limitOfferRefreshToken, setLimitOfferRefreshToken] = useState(0);
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

  useEffect(() => {
    setLimitOfferAmount('');
    setLimitOfferPrice('');
    setPendingOfferAction(null);
    setShowOfferConfirm(false);
  }, [selectedAsset, network]);

  useEffect(() => {
    let cancelled = false;
    if (!accountId || !selectedAsset) {
      setLimitOfferStatus({ loading: false, error: '', offers: [] });
      return () => { cancelled = true; };
    }

    const loadOffers = async () => {
      setLimitOfferStatus((current) => ({ ...current, loading: true, error: '' }));
      try {
        const server = getHorizonServer(network === 'TESTNET' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org');
        const response = await server.offers().forAccount(accountId).limit(30).call();
        if (!cancelled) {
          setLimitOfferStatus({
            loading: false,
            error: '',
            offers: Array.isArray(response?.records) ? response.records : [],
          });
        }
      } catch (error) {
        if (!cancelled) {
          setLimitOfferStatus({
            loading: false,
            error: error?.message || 'offerLoadFailed',
            offers: [],
          });
        }
      }
    };

    loadOffers();
    return () => { cancelled = true; };
  }, [accountId, limitOfferRefreshToken, network, selectedAsset]);

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

  const renderFactMark = (checked, loading, label) => (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-sm font-bold ${
        loading
          ? 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500'
          : checked
            ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-100'
            : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-100'
      }`}
      title={label}
      aria-label={`${label}: ${checked ? t('trading:assetSearch.facts.yes') : t('trading:assetSearch.facts.no')}`}
    >
      {loading ? '...' : checked ? '✓' : '×'}
    </span>
  );

  // 'available' | 'unavailable' | 'notChecked' - passed to TokenFactsSummary's
  // includeRoute block instead of it reading swapPreview directly.
  const swapRouteStatus = swapPreview.path ? 'available' : swapPreview.error ? 'unavailable' : 'notChecked';

  return (
    <section className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {t('trading:assetSearch.description', 'Suche nach Asset-Code, Issuer-Adresse oder CODE:ISSUER.')}
      </p>
      <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
        <div>
          <span className="font-semibold">{t('trading:assetSearch.account.active', 'Active account')}:</span>{' '}
          {accountInput ? <span className="font-mono break-all">{accountInput}</span> : <span>{t('trading:assetSearch.account.none', 'No account loaded')}</span>}
        </div>
        <div>
          <span className="font-semibold">{t('trading:assetSearch.account.network', 'Network')}:</span>{' '}
          <span>{network}</span>
        </div>
      </div>
      <form className="space-y-3" onSubmit={handleAssetSearch}>
        <label className="block text-sm font-semibold" htmlFor="asset-query-input">
          {t('trading:assetSearch.form.query.label')}
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            id="asset-query-input"
            className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
            value={assetQuery}
            onChange={(e) => {
              setAssetQuery(e.target.value);
              if (assetError) setAssetError('');
            }}
            placeholder={t('trading:assetSearch.form.query.placeholder', 'USDC, G... oder USDC:G...')}
          />
          <button
            type="submit"
            disabled={assetLoading}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {assetLoading ? t('common:loading', 'Loading…') : t('trading:assetSearch.form.submit')}
          </button>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-gray-600 dark:text-gray-300">
          <span>{t('trading:assetSearch.examples.label', 'Examples')}:</span>
          <code>USDC</code>
          <code>G...</code>
          <code>USDC:G...</code>
          {!parsedQuery.error && parsedQuery.mode && (
            <span className="rounded bg-gray-100 px-2 py-0.5 dark:bg-gray-800">
              {describeSearchMode(parsedQuery.mode)}
            </span>
          )}
        </div>
        {assetError && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {assetError}
          </div>
        )}
      </form>

      {pendingAmbiguousSubmission && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <div className="font-semibold">{t('trading:assetSearch.ambiguousResult.title', 'Status unklar – nicht erneut senden')}</div>
          <div className="mt-1 text-xs">
            {t('trading:assetSearch.ambiguousResult.body', 'Die letzte Transaktion konnte serverseitig nicht eindeutig bestätigt werden (Zeitüberschreitung oder Serverfehler). Bitte prüfen Sie den Transaktions-Hash im Explorer, bevor Sie es erneut versuchen.')}
          </div>
          {pendingAmbiguousSubmission.hash && (
            <div className="mt-1 break-all font-mono text-xs">{pendingAmbiguousSubmission.hash}</div>
          )}
          <button
            type="button"
            className="mt-2 rounded border border-amber-400 px-2 py-1 text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-900"
            onClick={() => setPendingAmbiguousSubmission(null)}
          >
            {t('trading:assetSearch.ambiguousResult.acknowledge', 'Status geprüft – Aktionen wieder freigeben')}
          </button>
        </div>
      )}

      {actionMessage && (
        <div className={`rounded border px-3 py-2 text-sm ${
          modalError
            ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200'
            : 'border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-100'
        }`}>
          {actionMessage}
        </div>
      )}

      <div className="rounded border border-gray-200 dark:border-gray-700">
        {assetResults.length === 0 && !assetError && !assetLoading && (
          <div className="px-3 py-2 text-sm text-gray-600 dark:text-gray-300">
            {t('trading:assetSearch.result.empty')}
          </div>
        )}
        {assetResults.length > 0 && (
          <>
            <div className="border-b border-gray-200 px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">
              <div>{t('trading:assetSearch.result.count', { count: countFormatter.format(assetResults.length) })}</div>
              <div className="mt-1">{t('trading:assetSearch.result.qualityHint')}</div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="py-2 pr-3">{t('trading:assetSearch.result.columns.code')}</th>
                    <th className="py-2 pr-3">{t('trading:assetSearch.result.columns.issuer')}</th>
                    <th className="py-2 pr-3" title={t('trading:assetSearch.result.columnHelp.numAccounts')}>
                      <button
                        type="button"
                        onClick={() => toggleAssetSort('trustlines')}
                        className="font-semibold hover:text-blue-700 dark:hover:text-blue-300"
                        aria-label={t('trading:assetSearch.result.sort.numAccounts')}
                      >
                        {t('trading:assetSearch.result.columns.numAccounts', 'Trustlines')}{sortIndicator('trustlines')}
                      </button>
                    </th>
                    <th className="py-2 pr-3">{t('trading:assetSearch.result.columns.domain')}</th>
                    <th className="py-2 pr-3">{t('trading:assetSearch.result.columns.toml')}</th>
                    <th className="py-2 pr-3">{t('trading:assetSearch.result.columns.actions', 'Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAssetResults.map((r, idx) => {
                    const rowFacts = assetResultFacts[assetResultKey(r)] || {};
                    return (
                      <tr key={`${r.assetCode}-${r.assetIssuer}-${idx}`} className="border-t border-gray-200 dark:border-gray-700">
                        <td className="py-2 pl-3 pr-3 font-mono font-semibold">{r.assetCode}</td>
                        <td className="py-2 pr-3 font-mono" title={r.assetIssuer || ''}>
                          {shortenKey(r.assetIssuer || '') || '—'}
                        </td>
                        <td className="py-2 pr-3">{formatTrustlineCount(r)}</td>
                        <td className="py-2 pr-3">
                          {renderFactMark(
                            rowFacts.homeDomain,
                            rowFacts.loading,
                            t('trading:assetSearch.result.factLabels.domain')
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          {renderFactMark(
                            rowFacts.tomlListed,
                            rowFacts.loading,
                            t('trading:assetSearch.result.factLabels.toml')
                          )}
                        </td>
                        <td className="py-2 pr-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => setSelectedAsset(r)}
                              className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
                            >
                              {t('trading:assetSearch.actions.details', 'Details')}
                            </button>
                            <button
                              type="button"
                              disabled={!canAddTrustlineFor(r)}
                              onClick={() => openTrustlineModal(r)}
                              className={`rounded border px-2 py-1 text-xs ${
                                canAddTrustlineFor(r)
                                  ? 'border-green-300 text-green-800 hover:bg-green-50 dark:border-green-700 dark:text-green-200 dark:hover:bg-green-900'
                                  : 'border-gray-200 text-gray-400 dark:border-gray-800'
                              }`}
                              title={t('trading:assetSearch.actions.trustlineNext', 'Next step: create trustline from search result')}
                            >
                              {trustlineActionLabel(r)}
                            </button>
                            <button
                              type="button"
                              onClick={() => setSelectedAsset(r)}
                              className="rounded border border-blue-300 px-2 py-1 text-xs text-blue-800 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-200 dark:hover:bg-blue-900"
                              title={t('trading:assetSearch.actions.swapNext', 'Select asset and open swap preview')}
                            >
                              {t('trading:assetSearch.actions.swap', 'Swap')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

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
            <section className="mt-4 rounded border border-gray-200 bg-white p-3 dark:border-blue-900 dark:bg-blue-900/40">
              <h3 className="mb-3 text-sm font-semibold">
                {t('trading:assetSearch.trustlineFlow.title')}
              </h3>
              <label className="block text-xs font-semibold" htmlFor="trustline-limit-input">
                <HelpLabel label={t('trading:assetSearch.trustlineConfirm.limit')} helpKey='trading:assetSearch.help.trustlineLimit' />
              </label>
              <input
                id="trustline-limit-input"
                type="text"
                inputMode="decimal"
                value={trustlineLimit}
                onChange={(event) => setTrustlineLimit(event.target.value)}
                className="mt-1 w-full max-w-xs rounded border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
              />
              <p className="mt-2 text-xs text-gray-700 dark:text-blue-100">
                {t('trading:assetSearch.trustlineFlow.limitHelp')}
              </p>
              {trustlineReserveSummary && (
                <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.trustlineFlow.reserveIncrease')} helpKey='trading:assetSearch.help.reserveIncrease' /></dt>
                    <dd>{amountFormatter.format(trustlineReserveSummary.extraReserve)} XLM</dd>
                  </div>
                  <div>
                    <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.trustlineFlow.reserveAfter')} helpKey='trading:assetSearch.help.reserveAfter' /></dt>
                    <dd>{amountFormatter.format(trustlineReserveSummary.afterTrustlineMinimum)} XLM</dd>
                  </div>
                  <div>
                    <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.trustlineFlow.spendableAfter')} helpKey='trading:assetSearch.help.spendableAfter' /></dt>
                    <dd>
                      {trustlineReserveSummary.spendableAfterTrustline == null
                        ? t('trading:assetSearch.swapPreview.notAvailable')
                        : `${amountFormatter.format(trustlineReserveSummary.spendableAfterTrustline)} XLM`}
                    </dd>
                  </div>
                </dl>
              )}
              {selectedAssetNeedsAuthorization && (
                <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
                  {t('trading:assetSearch.trustlineFlow.authRequiredHint')}
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => openTrustlineModal(selectedAsset)}
                disabled={isSubmittingTrustline || !!pendingAmbiguousSubmission}
                className="rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                {isSubmittingTrustline
                  ? t('common:main.processing')
                  : t('trading:assetSearch.actions.trustlineAdd', 'Add trustline')}
              </button>
              </div>
              <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-700">
                <h4 className="mb-2 text-sm font-semibold">{t('trading:assetSearch.trustlineFlow.combinedTitle')}</h4>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block text-xs">
                    <span className="mb-1 block font-semibold">{t('trading:assetSearch.swapPreview.sendAmount', { asset: 'XLM' })}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={swapAmount}
                      onChange={(event) => setSwapAmount(event.target.value)}
                      className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
                    />
                  </label>
                  <label className="block text-xs">
                    <span className="mb-1 block font-semibold">{t('trading:assetSearch.swapPreview.slippage')}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={swapSlippage}
                      onChange={(event) => setSwapSlippage(event.target.value)}
                      className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
                    />
                  </label>
                  <div className="flex items-end gap-2">
                    <button
                      type="button"
                      onClick={() => handleSwapPreview({ allowMissingDestinationTrustline: canPreviewTrustlineSwap })}
                      disabled={swapPreview.loading || !canPreviewTrustlineSwap}
                      className="rounded border border-blue-300 px-3 py-2 text-xs font-semibold text-blue-800 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-700 dark:text-blue-100 dark:hover:bg-blue-900"
                    >
                      {swapPreview.loading ? t('common:loading', 'Loading...') : t('trading:assetSearch.swapPreview.check')}
                    </button>
                  </div>
                </div>
                {!canPreviewTrustlineSwap && (
                  <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
                    {selectedAssetAuthRequired
                      ? t('trading:assetSearch.trustlineFlow.authRequiredCombinedBlocked')
                      : t('trading:assetSearch.trustlineFlow.combinedOnlyXlm')}
                  </p>
                )}
                {swapPreview.error && (
                  <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                    {swapPreview.error}
                  </div>
                )}
                {swapPreview.path && (
                  <div className="mt-3 rounded border border-blue-100 bg-blue-50 p-3 text-xs text-blue-950 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100">
                    <dl className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <dt className="font-semibold">{t('trading:assetSearch.swapPreview.expected')}</dt>
                        <dd className="font-mono">{bestDestinationAmount} {swapDestinationLabel}</dd>
                      </div>
                      <div>
                        <dt className="font-semibold">{t('trading:assetSearch.swapPreview.minimum')}</dt>
                        <dd className="font-mono">{minimumDestinationAmount || '—'} {swapDestinationLabel}</dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="font-semibold">{t('trading:assetSearch.swapPreview.routeDetailed')}</dt>
                        <dd className="break-all font-mono">{quoteDetails?.detailedRoute || formatDetailedAssetPath(swapPreview.path.path, swapSourceAsset, swapDestinationAsset)}</dd>
                      </div>
                    </dl>
                    <button
                      type="button"
                      onClick={openTrustlineSwapModal}
                      disabled={isSubmittingSwap || !canPreviewTrustlineSwap || !!pendingAmbiguousSubmission}
                      className="mt-3 rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {isSubmittingSwap
                        ? t('common:main.processing')
                        : t('trading:assetSearch.trustlineFlow.combinedAction')}
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}
          {trustlineStatus.state === 'present' && (
            <>
            <section className="mt-4 rounded border border-gray-200 bg-white p-3 dark:border-blue-900 dark:bg-blue-900/40">
              <h3 className="mb-3 text-sm font-semibold">
                {t('trading:assetSearch.swapPreview.title')}
              </h3>
              <div className="mb-3 grid gap-2 sm:grid-cols-3">
                {[
                  ['xlm-to-token', t('trading:assetSearch.swapPreview.direction.xlmToToken')],
                  ['token-to-xlm', t('trading:assetSearch.swapPreview.direction.tokenToXlm')],
                  ['token-to-token', t('trading:assetSearch.swapPreview.direction.tokenToToken')],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSwapDirection(value)}
                    className={`rounded border px-3 py-2 text-xs font-semibold ${
                      swapDirection === value
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {swapDirection === 'token-to-token' && (
                <div className="mb-3 rounded border border-gray-200 p-3 dark:border-gray-700">
                  <label className="block text-xs">
                    <span className="mb-1 block font-semibold">{t('trading:assetSearch.swapPreview.targetAsset')}</span>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        value={swapTargetQuery}
                        onChange={(event) => {
                          setSwapTargetQuery(event.target.value);
                          setSelectedSwapTargetAsset(null);
                          setSwapTargetError('');
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            handleSwapTargetSearch();
                          }
                        }}
                        className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
                        placeholder={t('trading:assetSearch.swapPreview.targetPlaceholder')}
                      />
                      <button
                        type="button"
                        onClick={handleSwapTargetSearch}
                        disabled={swapTargetLoading}
                        className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {swapTargetLoading
                          ? t('common:loading', 'Loading...')
                          : t('trading:assetSearch.swapPreview.targetSearch')}
                      </button>
                    </div>
                  </label>
                  {swapTargetError && (
                    <div className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                      {swapTargetError}
                    </div>
                  )}
                  {selectedSwapTargetAsset && (
                    <div className="mt-2 rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100">
                      <div className="font-semibold">{t('trading:assetSearch.swapPreview.targetSelected')}</div>
                      <div className="font-mono">{selectedSwapTargetAsset.assetCode}</div>
                      <div className="break-all font-mono">{selectedSwapTargetAsset.assetIssuer}</div>
                    </div>
                  )}
                  {targetStellarAsset && (
                    <div className="mt-3 rounded border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
                      <h4 className="mb-2 text-xs font-semibold">
                        {t('trading:assetSearch.facts.destinationTitle')}
                      </h4>
                      <TokenFactsSummary facts={targetAssetFacts} asset={targetStellarAsset} includeRoute={false} />
                    </div>
                  )}
                  {swapTargetResults.length > 0 && (
                    <div className="mt-3 max-h-56 overflow-y-auto rounded border border-gray-200 dark:border-gray-700">
                      {swapTargetResults.map((item, index) => (
                        <button
                          key={`${item.assetCode}-${item.assetIssuer}-${index}`}
                          type="button"
                          onClick={() => {
                            setSelectedSwapTargetAsset(item);
                            setSwapTargetQuery(`${item.assetCode}:${item.assetIssuer}`);
                            setSwapTargetError('');
                          }}
                          className={`grid w-full grid-cols-[90px_1fr_auto] gap-2 border-t border-gray-100 px-3 py-2 text-left text-xs first:border-t-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800 ${
                            selectedSwapTargetAsset?.assetCode === item.assetCode && selectedSwapTargetAsset?.assetIssuer === item.assetIssuer
                              ? 'bg-blue-50 dark:bg-blue-950'
                              : ''
                          }`}
                        >
                          <span className="font-mono font-semibold">{item.assetCode}</span>
                          <span className="truncate font-mono" title={item.assetIssuer || ''}>
                            {shortenKey(item.assetIssuer || '')}
                          </span>
                          <span>{formatTrustlineCount(item)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-[1fr_140px_auto]">
                <label className="text-xs">
                  <span className="mb-1 block font-semibold">
                    {t('trading:assetSearch.swapPreview.sendAmount', { asset: swapSourceLabel })}
                  </span>
                  <input
                    value={swapAmount}
                    onChange={(event) => setSwapAmount(event.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
                    inputMode="decimal"
                  />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block font-semibold">{t('trading:assetSearch.swapPreview.slippage')}</span>
                  <input
                    value={swapSlippage}
                    onChange={(event) => setSwapSlippage(event.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
                    inputMode="decimal"
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => handleSwapPreview()}
                    disabled={swapPreview.loading || selectedTrustlineUnauthorized}
                    className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {swapPreview.loading
                      ? t('common:loading', 'Loading...')
                      : t('trading:assetSearch.swapPreview.check')}
                  </button>
                </div>
              </div>
              <div className="mt-3 text-xs text-gray-700 dark:text-blue-100">
                {swapPreview.error && (
                  <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                    {swapPreview.error}
                  </div>
                )}
                {swapPreview.path && (
                  <dl className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.swapPreview.expected')} helpKey='trading:assetSearch.help.expected' /></dt>
                      <dd className="font-mono">{swapPreview.path.destination_amount} {swapDestinationLabel}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.swapPreview.minimum')} helpKey='trading:assetSearch.help.minimum' /></dt>
                      <dd className="font-mono">{minimumDestinationAmount || '—'} {swapDestinationLabel}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.swapPreview.route')} helpKey='trading:assetSearch.help.route' /></dt>
                      <dd className="font-mono">{formatAssetPath(swapPreview.path.path, swapSourceAsset, swapDestinationAsset)}</dd>
                    </div>
                    {quoteDetails && (
                      <>
                        <div>
                          <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.swapPreview.effectiveRate')} helpKey='trading:assetSearch.help.effectiveRate' /></dt>
                          <dd className="font-mono">
                            1 {swapSourceLabel} = {ratioFormatter.format(quoteDetails.effectiveRate)} {swapDestinationLabel}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.swapPreview.minimumRate')} helpKey='trading:assetSearch.help.minimumRate' /></dt>
                          <dd className="font-mono">
                            {quoteDetails.minimumRate ? `1 ${swapSourceLabel} = ${ratioFormatter.format(quoteDetails.minimumRate)} ${swapDestinationLabel}` : '—'}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.swapPreview.slippageBuffer')} helpKey='trading:assetSearch.help.slippageBuffer' /></dt>
                          <dd className="font-mono">
                            {quoteDetails.slippageBuffer != null ? `${amountFormatter.format(Math.max(0, quoteDetails.slippageBuffer))} ${swapDestinationLabel}` : '—'}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.swapPreview.hops')} helpKey='trading:assetSearch.help.hops' /></dt>
                          <dd className="font-mono">{quoteDetails.hops}</dd>
                        </div>
                        <div>
                          <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.swapPreview.quoteAge')} helpKey='trading:assetSearch.help.quoteAge' /></dt>
                          <dd className="font-mono">{formatQuoteAge(quoteDetails.ageSeconds)}</dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.swapPreview.routeDetailed')} helpKey='trading:assetSearch.help.routeDetailed' /></dt>
                          <dd className="break-all font-mono">{quoteDetails.detailedRoute}</dd>
                        </div>
                        {swapPreview.refreshComparison && (
                          <div className="sm:col-span-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-900 dark:bg-blue-950">
                            <dt className="font-semibold">{t('trading:assetSearch.swapPreview.refreshComparison')}</dt>
                            <dd className="font-mono">
                              {swapPreview.refreshComparison.previousDestinationAmount} {'->'} {swapPreview.refreshComparison.latestDestinationAmount} {swapDestinationLabel}
                              {' '}({formatPercent(swapPreview.refreshComparison.deltaPercent)})
                            </dd>
                          </div>
                        )}
                      </>
                    )}
                    <div className="sm:col-span-2">
                      <button
                        type="button"
                        onClick={openSwapModal}
                        disabled={isSubmittingSwap || !minimumDestinationAmount || selectedTrustlineUnauthorized || !!pendingAmbiguousSubmission}
                        className="rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        {isSubmittingSwap
                          ? t('trading:assetSearch.swapPreview.executing')
                          : t('trading:assetSearch.swapPreview.execute')}
                      </button>
                    </div>
                  </dl>
                )}
              </div>
              <div className="mt-4 border-t border-gray-200 pt-3 dark:border-blue-900">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h4 className="text-sm font-semibold">{t('trading:assetSearch.market.title')}</h4>
                  <button
                    type="button"
                    onClick={handleLoadMarketData}
                    disabled={marketData.loading}
                    className="rounded border border-gray-300 px-3 py-2 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    {marketData.loading
                      ? t('common:loading', 'Loading...')
                      : t('trading:assetSearch.market.load')}
                  </button>
                </div>
                {marketData.error && (
                  <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                    {marketData.error}
                  </div>
                )}
                {(marketData.orderbook || marketData.liquidityPools.length > 0) && (
                  <div className="mt-3 space-y-3">
                  <dl className="grid gap-2 rounded border border-gray-200 p-3 text-xs dark:border-gray-700 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.market.spread')} helpKey='trading:assetSearch.help.spread' /></dt>
                      <dd className="font-mono">{marketQuality.spreadPercent == null ? '—' : formatPercent(marketQuality.spreadPercent)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.market.priceImpact')} helpKey='trading:assetSearch.help.priceImpact' /></dt>
                      <dd className="font-mono">{marketQuality.estimatedImpactPercent == null ? '—' : formatPercent(marketQuality.estimatedImpactPercent)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.market.topDepth')} helpKey='trading:assetSearch.help.topDepth' /></dt>
                      <dd className="font-mono">{amountFormatter.format(marketQuality.topAskDepth)} {swapSourceLabel}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.market.marketAge')} helpKey='trading:assetSearch.help.marketAge' /></dt>
                      <dd className="font-mono">{formatQuoteAge(marketQuality.ageSeconds)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.market.bestBid')} helpKey='trading:assetSearch.help.bestBid' /></dt>
                      <dd className="font-mono">{marketQuality.bestBid == null ? '—' : ratioFormatter.format(marketQuality.bestBid)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.market.bestAsk')} helpKey='trading:assetSearch.help.bestAsk' /></dt>
                      <dd className="font-mono">{marketQuality.bestAsk == null ? '—' : ratioFormatter.format(marketQuality.bestAsk)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.market.depthCoversAmount')} helpKey='trading:assetSearch.help.depthCoversAmount' /></dt>
                      <dd>{marketQuality.topAskCoversSource == null ? '—' : factValue(marketQuality.topAskCoversSource, t)}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold"><HelpLabel label={t('trading:assetSearch.market.poolCount')} helpKey='trading:assetSearch.help.poolCount' /></dt>
                      <dd className="font-mono">{countFormatter.format(marketQuality.poolCount)}</dd>
                    </div>
                  </dl>
                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="rounded border border-gray-200 p-3 dark:border-gray-700">
                      <h5 className="mb-2 text-xs font-semibold">{t('trading:assetSearch.market.orderbook')}</h5>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {[
                          ['bids', t('trading:assetSearch.market.bids')],
                          ['asks', t('trading:assetSearch.market.asks')],
                        ].map(([side, label]) => (
                          <div key={side}>
                            <div className="mb-1 text-xs font-semibold">{label}</div>
                            {(marketData.orderbook?.[side] || []).slice(0, 5).length === 0 && (
                              <div className="text-xs text-gray-500 dark:text-gray-300">
                                {t('trading:assetSearch.market.empty')}
                              </div>
                            )}
                            {(marketData.orderbook?.[side] || []).slice(0, 5).map((item, index) => (
                              <div key={`${side}-${index}`} className="grid grid-cols-2 gap-2 border-t border-gray-100 py-1 text-xs dark:border-gray-800">
                                <span className="font-mono">{item.price}</span>
                                <span className="text-right font-mono">{item.amount}</span>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded border border-gray-200 p-3 dark:border-gray-700">
                      <h5 className="mb-2 text-xs font-semibold">{t('trading:assetSearch.market.amm')}</h5>
                      {marketData.liquidityPools.length === 0 && (
                        <div className="text-xs text-gray-500 dark:text-gray-300">
                          {t('trading:assetSearch.market.empty')}
                        </div>
                      )}
                      {marketData.liquidityPools.slice(0, 5).map((pool) => (
                        <div key={pool.id} className="border-t border-gray-100 py-2 text-xs dark:border-gray-800">
                          <div className="font-mono">{shortenKey(pool.id || '')}</div>
                          {(pool.reserves || []).map((reserve) => (
                            <div key={reserve.asset} className="mt-1 flex justify-between gap-3">
                              <span>{formatReserveAsset(reserve.asset)}</span>
                              <span className="font-mono">{reserve.amount}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                  </div>
                )}
              </div>
            </section>
            <section className="mt-4 rounded border border-gray-200 bg-white p-3 dark:border-blue-900 dark:bg-blue-900/40">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="text-sm font-semibold">
                  {t('trading:assetSearch.limitOffer.title')}
                </h3>
                <button
                  type="button"
                  onClick={() => setLimitOfferRefreshToken((value) => value + 1)}
                  disabled={limitOfferStatus.loading}
                  className="rounded border border-gray-300 px-3 py-2 text-xs font-semibold hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
                >
                  {limitOfferStatus.loading
                    ? t('common:loading', 'Loading...')
                    : t('trading:assetSearch.limitOffer.refresh')}
                </button>
              </div>
              <p className="mb-3 text-xs text-gray-700 dark:text-blue-100">
                {t('trading:assetSearch.limitOffer.description')}
              </p>
              <div className="grid gap-3 lg:grid-cols-[180px_1fr_1fr_auto]">
                <label className="text-xs">
                  <span className="mb-1 block font-semibold"><HelpLabel label={t('trading:assetSearch.limitOffer.direction.label')} helpKey='trading:assetSearch.help.limitOfferDirection' /></span>
                  <select
                    value={limitOfferDirection}
                    onChange={(event) => {
                      setLimitOfferDirection(event.target.value);
                      setModalError('');
                      setActionMessage('');
                    }}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                  >
                    <option value="sell-token-for-xlm">{t('trading:assetSearch.limitOffer.direction.sellTokenForXlm', { asset: formatAssetLabel(selectedStellarAsset) })}</option>
                    <option value="sell-xlm-for-token">{t('trading:assetSearch.limitOffer.direction.sellXlmForToken', { asset: formatAssetLabel(selectedStellarAsset) })}</option>
                  </select>
                </label>
                <label className="text-xs">
                  <span className="mb-1 block font-semibold">
                    <HelpLabel label={t('trading:assetSearch.limitOffer.amount', { asset: limitOfferSellingLabel })} helpKey='trading:assetSearch.help.limitOfferAmount' />
                  </span>
                  <input
                    value={limitOfferAmount}
                    onChange={(event) => {
                      setLimitOfferAmount(event.target.value);
                      setModalError('');
                      setActionMessage('');
                    }}
                    className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
                    inputMode="decimal"
                  />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block font-semibold">
                    <HelpLabel label={t('trading:assetSearch.limitOffer.price', { selling: limitOfferSellingLabel, buying: limitOfferBuyingLabel })} helpKey='trading:assetSearch.help.limitOfferPrice' />
                  </span>
                  <input
                    value={limitOfferPrice}
                    onChange={(event) => {
                      setLimitOfferPrice(event.target.value);
                      setModalError('');
                      setActionMessage('');
                    }}
                    className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
                    inputMode="decimal"
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={openCreateOfferModal}
                    disabled={isSubmittingOffer || !!pendingAmbiguousSubmission}
                    className="w-full rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {isSubmittingOffer
                      ? t('common:main.processing')
                      : t('trading:assetSearch.limitOffer.create')}
                  </button>
                </div>
              </div>
              <div className="mt-4 border-t border-gray-200 pt-3 dark:border-blue-900">
                <h4 className="mb-2 text-sm font-semibold">{t('trading:assetSearch.limitOffer.openOffers')}</h4>
                {limitOfferStatus.error && (
                  <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                    {t('trading:assetSearch.limitOffer.loadFailed')}
                  </div>
                )}
                {!limitOfferStatus.error && selectedRelatedOffers.length === 0 && (
                  <div className="text-xs text-gray-600 dark:text-blue-100">
                    {limitOfferStatus.loading
                      ? t('common:loading', 'Loading...')
                      : t('trading:assetSearch.limitOffer.noOffers')}
                  </div>
                )}
                {selectedRelatedOffers.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="text-left">
                          <th className="py-2 pr-3">{t('trading:assetSearch.limitOffer.columns.selling')}</th>
                          <th className="py-2 pr-3">{t('trading:assetSearch.limitOffer.columns.buying')}</th>
                          <th className="py-2 pr-3">{t('trading:assetSearch.limitOffer.columns.amount')}</th>
                          <th className="py-2 pr-3">{t('trading:assetSearch.limitOffer.columns.price')}</th>
                          <th className="py-2 pr-3">{t('trading:assetSearch.limitOffer.columns.actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedRelatedOffers.map((offer) => {
                          const selling = assetFromOfferSide(offer, 'selling');
                          const buying = assetFromOfferSide(offer, 'buying');
                          return (
                            <tr key={offer.id} className="border-t border-gray-200 dark:border-gray-700">
                              <td className="py-2 pr-3 font-mono">{formatAssetLabelWithIssuer(selling)}</td>
                              <td className="py-2 pr-3 font-mono">{formatAssetLabelWithIssuer(buying)}</td>
                              <td className="py-2 pr-3 font-mono">{offer.amount}</td>
                              <td className="py-2 pr-3 font-mono">{offer.price}</td>
                              <td className="py-2 pr-3">
                                <button
                                  type="button"
                                  onClick={() => openCancelOfferModal(offer)}
                                  disabled={isSubmittingOffer || !!pendingAmbiguousSubmission}
                                  className="rounded border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-200 dark:hover:bg-red-950"
                                >
                                  {t('trading:assetSearch.limitOffer.cancel')}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
            </>
          )}
          </div>
        </div>
      )}
      {showTrustlineConfirm && selectedAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black bg-opacity-50 p-4">
          <div className="my-auto w-full max-w-2xl rounded-lg bg-white p-5 shadow-lg dark:bg-gray-800">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
              {t('trading:assetSearch.trustlineConfirm.title')}
            </h2>
            <dl className="grid gap-3 text-sm text-gray-800 dark:text-gray-100 sm:grid-cols-2">
              <div>
                <dt className="font-semibold">{t('trading:assetSearch.result.columns.code')}</dt>
                <dd className="font-mono">{selectedAsset.assetCode}</dd>
              </div>
              <div>
                <dt className="font-semibold">{t('trading:assetSearch.trustlineConfirm.limit')}</dt>
                <dd className="font-mono">{trustlineLimitAmount || trustlineLimit} {selectedAsset.assetCode}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-semibold">{t('trading:assetSearch.result.columns.issuer')}</dt>
                <dd className="break-all font-mono">{selectedAsset.assetIssuer}</dd>
              </div>
            </dl>
            {trustlineReserveSummary && (
              <dl className="mt-4 grid gap-3 rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 sm:grid-cols-2">
                <div>
                  <dt className="font-semibold">{t('trading:assetSearch.trustlineFlow.reserveIncrease')}</dt>
                  <dd>{amountFormatter.format(trustlineReserveSummary.extraReserve)} XLM</dd>
                </div>
                <div>
                  <dt className="font-semibold">{t('trading:assetSearch.trustlineFlow.reserveAfter')}</dt>
                  <dd>{amountFormatter.format(trustlineReserveSummary.afterTrustlineMinimum)} XLM</dd>
                </div>
              </dl>
            )}
            <section className="mt-4 rounded border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
              <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
                {t('trading:assetSearch.facts.title')}
              </h3>
              <TokenFactsSummary facts={assetFacts} asset={selectedAsset} includeDisclaimer routeStatus={swapRouteStatus} />
            </section>
            <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
              {t('trading:assetSearch.trustlineConfirm.warning')}
            </p>
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowTrustlineConfirm(false)}
                className="rounded border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                {t('common:cancel', 'Cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmTrustline}
                className="rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
              >
                {t('trading:assetSearch.trustlineConfirm.continue')}
              </button>
            </div>
          </div>
        </div>
      )}
      {showTrustlineSwapConfirm && selectedAsset && swapPreview.path && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black bg-opacity-50 p-4">
          <div className="my-auto w-full max-w-2xl rounded-lg bg-white p-5 shadow-lg dark:bg-gray-800">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
              {t('trading:assetSearch.trustlineFlow.combinedConfirmTitle')}
            </h2>
            <dl className="grid gap-3 text-sm text-gray-800 dark:text-gray-100">
              <div className="grid gap-1">
                <dt className="font-semibold">{t('trading:assetSearch.trustlineConfirm.limit')}</dt>
                <dd className="font-mono">{trustlineLimitAmount || trustlineLimit} {selectedAsset.assetCode}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="font-semibold">{t('trading:assetSearch.swapConfirm.send')}</dt>
                <dd className="font-mono">{normalizeAmount(swapAmount) || swapAmount} XLM</dd>
              </div>
              <div className="grid gap-1">
                <dt className="font-semibold">{t('trading:assetSearch.swapConfirm.receive')}</dt>
                <dd className="font-mono">{swapPreview.path.destination_amount} {swapDestinationLabel}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="font-semibold">{t('trading:assetSearch.swapConfirm.minimum')}</dt>
                <dd className="font-mono">{minimumDestinationAmount} {swapDestinationLabel}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="font-semibold">{t('trading:assetSearch.swapPreview.routeDetailed')}</dt>
                <dd className="break-all font-mono">{quoteDetails?.detailedRoute || formatDetailedAssetPath(swapPreview.path.path, swapSourceAsset, swapDestinationAsset)}</dd>
              </div>
            </dl>
            <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
              {t('trading:assetSearch.trustlineFlow.combinedWarning')}
            </p>
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowTrustlineSwapConfirm(false)}
                className="rounded border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                {t('common:cancel', 'Cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmTrustlineSwap}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                {t('trading:assetSearch.trustlineFlow.combinedContinue')}
              </button>
            </div>
          </div>
        </div>
      )}
      {showSwapConfirm && selectedAsset && swapPreview.path && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black bg-opacity-50 p-4">
          <div className="my-auto w-full max-w-2xl rounded-lg bg-white p-5 shadow-lg dark:bg-gray-800">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
              {t('trading:assetSearch.swapConfirm.title')}
            </h2>
            <dl className="grid gap-3 text-sm text-gray-800 dark:text-gray-100">
              <div className="grid gap-1">
                <dt className="font-semibold">{t('trading:assetSearch.swapConfirm.send')}</dt>
                <dd className="font-mono">{normalizeAmount(swapAmount) || swapAmount} {swapSourceLabel}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="font-semibold">{t('trading:assetSearch.swapConfirm.receive')}</dt>
                <dd className="font-mono">{swapPreview.path.destination_amount} {swapDestinationLabel}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="font-semibold">{t('trading:assetSearch.swapConfirm.minimum')}</dt>
                <dd className="font-mono">{minimumDestinationAmount} {swapDestinationLabel}</dd>
              </div>
              <div className="grid gap-1">
                <dt className="font-semibold">{t('trading:assetSearch.swapPreview.slippage')}</dt>
                <dd className="font-mono">{String(swapSlippage || '').replace(',', '.')}%</dd>
              </div>
              <div className="grid gap-1">
                <dt className="font-semibold">{t('trading:assetSearch.swapConfirm.source')}</dt>
                <dd className="break-all font-mono">{selectedAsset.assetIssuer}</dd>
              </div>
              {swapDirection === 'token-to-token' && targetStellarAsset && (
                <div className="grid gap-1">
                  <dt className="font-semibold">{t('trading:assetSearch.swapConfirm.destination')}</dt>
                  <dd className="break-all font-mono">{targetStellarAsset.issuer}</dd>
                </div>
              )}
              <div className="grid gap-1">
                <dt className="font-semibold">{t('trading:assetSearch.swapPreview.route')}</dt>
                <dd className="font-mono">{formatAssetPath(swapPreview.path.path, swapSourceAsset, swapDestinationAsset)}</dd>
              </div>
              {quoteDetails && (
                <>
                  <div className="grid gap-1">
                    <dt className="font-semibold">{t('trading:assetSearch.swapPreview.effectiveRate')}</dt>
                    <dd className="font-mono">1 {swapSourceLabel} = {ratioFormatter.format(quoteDetails.effectiveRate)} {swapDestinationLabel}</dd>
                  </div>
                  <div className="grid gap-1">
                    <dt className="font-semibold">{t('trading:assetSearch.swapPreview.quoteAge')}</dt>
                    <dd className="font-mono">{formatQuoteAge(quoteDetails.ageSeconds)}</dd>
                  </div>
                  <div className="grid gap-1">
                    <dt className="font-semibold">{t('trading:assetSearch.swapPreview.routeDetailed')}</dt>
                    <dd className="break-all font-mono">{quoteDetails.detailedRoute}</dd>
                  </div>
                  {swapPreview.refreshComparison && (
                    <div className="grid gap-1">
                      <dt className="font-semibold">{t('trading:assetSearch.swapPreview.refreshComparison')}</dt>
                      <dd className="font-mono">
                        {swapPreview.refreshComparison.previousDestinationAmount} {'->'} {swapPreview.refreshComparison.latestDestinationAmount} {swapDestinationLabel}
                        {' '}({formatPercent(swapPreview.refreshComparison.deltaPercent)})
                      </dd>
                    </div>
                  )}
                </>
              )}
            </dl>
            <section className="mt-4 rounded border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
              <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
                {t(selectedAssetFactsTitleKey)}
              </h3>
              <TokenFactsSummary facts={assetFacts} asset={selectedAsset} includeDisclaimer routeStatus={swapRouteStatus} />
            </section>
            {swapDirection === 'token-to-token' && targetStellarAsset && (
              <section className="mt-4 rounded border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
                <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
                  {t('trading:assetSearch.facts.destinationTitle')}
                </h3>
                <TokenFactsSummary facts={targetAssetFacts} asset={targetStellarAsset} includeRoute={false} />
              </section>
            )}
            <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
              {t('trading:assetSearch.swapConfirm.routeRefresh')}
            </p>
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowSwapConfirm(false)}
                className="rounded border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                {t('common:cancel', 'Cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmSwap}
                className="rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
              >
                {t('trading:assetSearch.swapConfirm.continue')}
              </button>
            </div>
          </div>
        </div>
      )}
      {showOfferConfirm && pendingOfferAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black bg-opacity-50 p-4">
          <div className="my-auto w-full max-w-2xl rounded-lg bg-white p-5 shadow-lg dark:bg-gray-800">
            <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
              {pendingOfferAction.type === 'cancel'
                ? t('trading:assetSearch.limitOffer.cancelTitle')
                : t('trading:assetSearch.limitOffer.confirmTitle')}
            </h2>
            <dl className="grid gap-3 text-sm text-gray-800 dark:text-gray-100 sm:grid-cols-2">
              <div>
                <dt className="font-semibold">{t('trading:assetSearch.limitOffer.columns.selling')}</dt>
                <dd className="font-mono">{formatAssetLabelWithIssuer(pendingOfferAction.selling)}</dd>
              </div>
              <div>
                <dt className="font-semibold">{t('trading:assetSearch.limitOffer.columns.buying')}</dt>
                <dd className="font-mono">{formatAssetLabelWithIssuer(pendingOfferAction.buying)}</dd>
              </div>
              <div>
                <dt className="font-semibold">{t('trading:assetSearch.limitOffer.columns.amount')}</dt>
                <dd className="font-mono">
                  {pendingOfferAction.type === 'cancel'
                    ? t('trading:assetSearch.limitOffer.cancelAmount')
                    : `${pendingOfferAction.amount} ${formatAssetLabel(pendingOfferAction.selling)}`}
                </dd>
              </div>
              <div>
                <dt className="font-semibold">{t('trading:assetSearch.limitOffer.columns.price')}</dt>
                <dd className="font-mono">{pendingOfferAction.price}</dd>
              </div>
            </dl>
            <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
              {pendingOfferAction.type === 'cancel'
                ? t('trading:assetSearch.limitOffer.cancelWarning')
                : t('trading:assetSearch.limitOffer.warning')}
            </p>
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowOfferConfirm(false)}
                className="rounded border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                {t('common:cancel', 'Cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmOffer}
                className="rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
              >
                {t('trading:assetSearch.limitOffer.continue')}
              </button>
            </div>
          </div>
        </div>
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
