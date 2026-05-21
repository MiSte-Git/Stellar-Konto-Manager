import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Asset, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { getHorizonServer, loadTrustlines, resolveOrValidateAccount } from '../../utils/stellar/stellarUtils.js';
import SecretKeyModal from '../SecretKeyModal.jsx';
import { getRequiredThreshold } from '../../utils/getRequiredThreshold.js';
import { formatErrorForUi } from '../../utils/formatErrorForUi.js';
import { apiUrl } from '../../utils/apiBase.js';

const STELLAR_PUBLIC_KEY_RE = /^G[A-Z2-7]{55}$/;
const ASSET_CODE_RE = /^[A-Za-z0-9]{1,12}$/;
const AMOUNT_RE = /^\d+(?:\.\d{1,7})?$/;
const EMPTY_ASSET_FACTS = {
  loading: false,
  error: '',
  issuerAccount: null,
  toml: {
    status: 'notChecked',
    url: '',
    currencies: [],
    matches: [],
    error: '',
  },
};

function shortenKey(value = '') {
  if (!value || value.length <= 16) return value;
  return `${value.slice(0, 8)}...${value.slice(-8)}`;
}

function assetResultKey(asset) {
  return `${asset?.assetCode || ''}:${asset?.assetIssuer || ''}`;
}

function parseAssetSearchQuery(raw) {
  const value = String(raw || '').trim();
  if (!value) return { error: 'queryMissing' };

  if (value.includes(':')) {
    const parts = value.split(':').map((part) => part.trim()).filter(Boolean);
    if (parts.length !== 2) return { error: 'queryInvalid' };
    const [code, issuer] = parts;
    if (!ASSET_CODE_RE.test(code)) return { error: 'codeInvalid' };
    if (!STELLAR_PUBLIC_KEY_RE.test(issuer)) return { error: 'issuerInvalid' };
    return { code, issuer, mode: 'exact' };
  }

  if (STELLAR_PUBLIC_KEY_RE.test(value)) {
    return { issuer: value, mode: 'issuer' };
  }

  if (!ASSET_CODE_RE.test(value)) {
    return { error: 'queryInvalid' };
  }

  return { code: value, mode: 'code' };
}

function getStoredAccountInput() {
  if (typeof window === 'undefined') return '';
  try {
    return (
      window.sessionStorage?.getItem('stm.currentAccount') ||
      window.localStorage?.getItem('SKM_LAST_ACCOUNT') ||
      ''
    ).trim();
  } catch {
    return '';
  }
}

function getStoredNetwork() {
  if (typeof window === 'undefined') return 'PUBLIC';
  try {
    return window.localStorage?.getItem('SKM_NETWORK') === 'TESTNET' ? 'TESTNET' : 'PUBLIC';
  } catch {
    return 'PUBLIC';
  }
}

function normalizeAmount(value) {
  const trimmed = String(value || '').trim().replace(',', '.');
  if (!AMOUNT_RE.test(trimmed)) return '';
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return '';
  return trimmed;
}

function calculateMinimumDestinationAmount(destinationAmount, slippageValue) {
  const received = Number(destinationAmount || 0);
  const slippage = Number(String(slippageValue || '').replace(',', '.'));
  if (!Number.isFinite(received) || received <= 0 || !Number.isFinite(slippage) || slippage < 0 || slippage > 50) return '';
  const min = received * (1 - (slippage / 100));
  return min > 0 ? min.toFixed(7).replace(/\.?0+$/, '') : '';
}

function formatAssetLabel(asset) {
  if (!asset || asset.isNative?.() || asset.asset_type === 'native') return 'XLM';
  return asset.assetCode || asset.code || asset.asset_code || 'Asset';
}

function formatAssetPath(path = [], sourceAsset = Asset.native(), destinationAsset = Asset.native()) {
  const sourceLabel = formatAssetLabel(sourceAsset);
  const destinationLabel = formatAssetLabel(destinationAsset);
  const intermediate = Array.isArray(path) ? path.map((asset) => {
    if (!asset || asset.asset_type === 'native') return 'XLM';
    return asset.asset_code || 'Asset';
  }) : [];
  return [sourceLabel, ...intermediate, destinationLabel].join(' -> ');
}

function assetFromPathRecord(asset) {
  if (!asset || asset.asset_type === 'native') return Asset.native();
  return new Asset(asset.asset_code, asset.asset_issuer);
}

function assetFromSearchResult(asset) {
  return new Asset(asset.assetCode, asset.assetIssuer);
}

function assetFromExactQuery(query) {
  if (!query?.code || !query?.issuer) return null;
  return new Asset(query.code, query.issuer);
}

function assetsEqual(left, right) {
  if (!left || !right) return false;
  if (left.isNative?.() || right.isNative?.()) return Boolean(left.isNative?.() && right.isNative?.());
  return left.code === right.code && left.issuer === right.issuer;
}

function formatReserveAsset(value = '') {
  if (!value || value === 'native') return 'XLM';
  const [code] = String(value).split(':');
  return code || value;
}

function parseHorizonNumber(value) {
  if (value === '' || value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const number = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function sumHorizonSplitValue(value) {
  if (!value || typeof value !== 'object') return null;
  let hasNumber = false;
  const total = [
    value.authorized,
    value.authorized_to_maintain_liabilities,
    value.unauthorized,
  ].reduce((sum, item) => {
    const number = parseHorizonNumber(item);
    if (number == null) return sum;
    hasNumber = true;
    return sum + number;
  }, 0);
  return hasNumber ? total : null;
}

function getAssetTrustlineCount(asset) {
  const value = asset?.accounts ?? asset?.numAccounts ?? asset?.num_accounts ?? '';
  if (value && typeof value === 'object') {
    const total = sumHorizonSplitValue(value);
    if (total != null) return total;
    return Object.values(value).find((item) => typeof item === 'string' || typeof item === 'number') ?? null;
  }
  return value === '' || value == null ? null : value;
}

function getAssetTrustlineCountNumber(asset) {
  return parseHorizonNumber(getAssetTrustlineCount(asset)) ?? 0;
}

function getAssetAmountNumber(asset) {
  const value = asset?.balances ?? asset?.amount ?? asset?.totalAmount ?? asset?.total_amount ?? asset?.balance ?? '';
  if (value && typeof value === 'object') {
    const total = sumHorizonSplitValue(value);
    if (total != null) return total;
    const fallback = Object.values(value).find((item) => typeof item === 'string' || typeof item === 'number');
    return parseHorizonNumber(fallback);
  }
  return parseHorizonNumber(value);
}

function getCollectedSignerWeight(collectedSigners, horizonSigners) {
  const signers = Array.isArray(collectedSigners) ? collectedSigners : [];
  const knownSigners = Array.isArray(horizonSigners) ? horizonSigners : [];
  return signers.reduce((acc, signer) => {
    try {
      const publicKey = signer.keypair?.publicKey?.();
      const match = knownSigners.find((item) => item.key === publicKey || item.public_key === publicKey);
      const weight = Number(match?.weight || 0);
      return acc + (weight > 0 ? weight : 0);
    } catch {
      return acc;
    }
  }, 0);
}

function getIssuerMasterWeight(account, issuer) {
  const signers = Array.isArray(account?.signers) ? account.signers : [];
  const master = signers.find((signer) => signer.key === issuer || signer.public_key === issuer);
  return master ? Number(master.weight || 0) : null;
}

function getAccountFlag(account, snakeKey, camelKey) {
  const flags = account?.flags || {};
  return Boolean(flags[snakeKey] ?? flags[camelKey] ?? false);
}

export default function AssetSearch() {
  const { t, i18n } = useTranslation(['trading', 'common']);
  const [assetQuery, setAssetQuery] = useState('');
  const [assetResults, setAssetResults] = useState([]);
  const [assetResultFacts, setAssetResultFacts] = useState({});
  const [assetSort, setAssetSort] = useState({ field: 'quality', direction: 'desc' });
  const [assetError, setAssetError] = useState('');
  const [assetLoading, setAssetLoading] = useState(false);
  const [selectedAsset, setSelectedAsset] = useState(null);
  const [accountInput, setAccountInput] = useState(() => getStoredAccountInput());
  const [accountId, setAccountId] = useState('');
  const [accountStatus, setAccountStatus] = useState({ loading: false, error: '' });
  const [accountInfo, setAccountInfo] = useState(null);
  const [network, setNetwork] = useState(() => getStoredNetwork());
  const [trustlineStatus, setTrustlineStatus] = useState({ loading: false, state: 'unknown', error: '', balance: null, limit: null });
  const [assetFacts, setAssetFacts] = useState(EMPTY_ASSET_FACTS);
  const [trustlineRefreshToken, setTrustlineRefreshToken] = useState(0);
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [showTrustlineConfirm, setShowTrustlineConfirm] = useState(false);
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
  const [swapPreview, setSwapPreview] = useState({ loading: false, error: '', path: null });
  const [marketData, setMarketData] = useState({ loading: false, error: '', orderbook: null, liquidityPools: [] });

  const parsedQuery = useMemo(() => parseAssetSearchQuery(assetQuery), [assetQuery]);
  const parsedSwapTarget = useMemo(() => parseAssetSearchQuery(swapTargetQuery), [swapTargetQuery]);
  const modalOperationType = modalAction === 'swap' ? 'payment' : 'changeTrust';
  const requiredThreshold = useMemo(
    () => getRequiredThreshold(modalOperationType, accountInfo?.thresholds || null),
    [accountInfo, modalOperationType]
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
    setTrustlineStatus({ loading: false, state: 'unknown', error: '', balance: null, limit: null });
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
      setTrustlineStatus({ loading: false, state: accountId ? 'unknown' : 'noAccount', error: '', balance: null, limit: null });
      return () => { cancelled = true; };
    }

    setTrustlineStatus({ loading: true, state: 'loading', error: '', balance: null, limit: null });
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
          });
        } else {
          setTrustlineStatus({ loading: false, state: 'missing', error: '', balance: null, limit: null });
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
        });
      });
    return () => { cancelled = true; };
  }, [accountId, network, selectedAsset, trustlineRefreshToken]);

  useEffect(() => {
    setSwapPreview({ loading: false, error: '', path: null });
    setMarketData({ loading: false, error: '', orderbook: null, liquidityPools: [] });
  }, [selectedAsset, network, swapDirection, swapTargetQuery, selectedSwapTargetAsset]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedAsset?.assetIssuer) {
      setAssetFacts(EMPTY_ASSET_FACTS);
      return () => { cancelled = true; };
    }

    const loadFacts = async () => {
      setAssetFacts({ ...EMPTY_ASSET_FACTS, loading: true });
      try {
        const params = new URLSearchParams({
          code: selectedAsset.assetCode,
          issuer: selectedAsset.assetIssuer,
          network,
        });
        const response = await fetch(`${apiUrl('trade/assets/facts')}?${params.toString()}`);
        const facts = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(facts?.error || 'assetFacts.failed:generic');
        if (cancelled) return;
        setAssetFacts({
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
        });
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
  }, [selectedAsset, network]);

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
    return !!accountId && isSelected && trustlineStatus.state === 'missing' && !trustlineStatus.loading && !isSubmittingTrustline;
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

  const factValue = (value) => (value ? t('trading:assetSearch.facts.yes') : t('trading:assetSearch.facts.no'));

  const tomlStatusLabel = () => {
    if (assetFacts.toml.status === 'loading') return t('trading:assetSearch.facts.toml.loading');
    if (assetFacts.toml.status === 'loaded') return t('trading:assetSearch.facts.toml.loaded');
    if (assetFacts.toml.status === 'failed') return t('trading:assetSearch.facts.toml.failed');
    if (assetFacts.toml.status === 'noHomeDomain') return t('trading:assetSearch.facts.toml.noHomeDomain');
    return t('trading:assetSearch.facts.notChecked');
  };

  const bestDestinationAmount = swapPreview.path?.destination_amount || '';
  const minimumDestinationAmount = useMemo(() => {
    return calculateMinimumDestinationAmount(bestDestinationAmount, swapSlippage);
  }, [bestDestinationAmount, swapSlippage]);

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

  const handleSwapPreview = async () => {
    if (!selectedAsset) return;
    const sourceAmount = normalizeAmount(swapAmount);
    if (!sourceAmount) {
      setSwapPreview({ loading: false, error: t('trading:assetSearch.swapPreview.invalidAmount', { asset: swapSourceLabel }), path: null });
      return;
    }
    const slippage = Number(String(swapSlippage || '').replace(',', '.'));
    if (!Number.isFinite(slippage) || slippage < 0 || slippage > 50) {
      setSwapPreview({ loading: false, error: t('trading:assetSearch.swapPreview.invalidSlippage'), path: null });
      return;
    }
    const pairError = validateSwapPair();
    if (pairError) {
      setSwapPreview({ loading: false, error: pairError, path: null });
      return;
    }

    setSwapPreview({ loading: true, error: '', path: null });
    try {
      const server = getHorizonServer(network === 'TESTNET' ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org');
      if (accountId && !swapDestinationAsset.isNative()) {
        const trustlines = await loadTrustlines(accountId, server, { includeOps: false, ttlMs: 10000 });
        const hasDestinationTrustline = trustlines.some((tl) =>
          tl.assetCode === swapDestinationAsset.code && tl.assetIssuer === swapDestinationAsset.issuer
        );
        if (!hasDestinationTrustline) {
          setSwapPreview({ loading: false, error: t('trading:assetSearch.swapPreview.destinationTrustlineMissing'), path: null });
          return;
        }
      }
      const response = await server
        .strictSendPaths(swapSourceAsset, sourceAmount, [swapDestinationAsset])
        .call();
      const records = Array.isArray(response?.records) ? response.records : [];
      if (!records.length) {
        setSwapPreview({ loading: false, error: t('trading:assetSearch.swapPreview.noRoute'), path: null });
        return;
      }
      const best = [...records].sort((a, b) => Number(b.destination_amount || 0) - Number(a.destination_amount || 0))[0];
      setSwapPreview({ loading: false, error: '', path: best });
    } catch {
      setSwapPreview({ loading: false, error: t('trading:assetSearch.swapPreview.failed'), path: null });
    }
  };

  const handleLoadMarketData = async () => {
    if (!selectedAsset) return;
    const pairError = validateSwapPair();
    if (pairError) {
      setMarketData({ loading: false, error: pairError, orderbook: null, liquidityPools: [] });
      return;
    }

    setMarketData({ loading: true, error: '', orderbook: null, liquidityPools: [] });
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
      });
    } catch {
      setMarketData({
        loading: false,
        error: t('trading:assetSearch.market.failed'),
        orderbook: null,
        liquidityPools: [],
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
          item.assetCode === query.code && item.assetIssuer === query.issuer
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
    const account = await server.loadAccount(accountId);
    const thresholds = account?.thresholds || {};
    const required = getRequiredThreshold('changeTrust', thresholds);
    const horizonSigners = account?.signers || [];
    const signers = Array.isArray(collectedSigners) ? collectedSigners : [];
    const current = getCollectedSignerWeight(signers, horizonSigners);
    if (current <= 0) throw new Error('submitTransaction.failed:multisig.noKeysProvided');
    if (current < required) throw new Error('submitTransaction.failed:multisig.insufficientWeight');

    const feeStats = await server.feeStats();
    const fee = String(Number(feeStats?.fee_charged?.mode || 100));
    const tx = new TransactionBuilder(account, {
      fee,
      networkPassphrase: network === 'TESTNET' ? Networks.TESTNET : Networks.PUBLIC,
    })
      .addOperation(Operation.changeTrust({ asset, limit }))
      .setTimeout(60)
      .build();

    signers.forEach((signer) => {
      try { tx.sign(signer.keypair); } catch (error) { console.debug?.('sign failed', error); }
    });
    return server.submitTransaction(tx);
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
    const account = await server.loadAccount(accountId);
    const thresholds = account?.thresholds || {};
    const required = getRequiredThreshold('payment', thresholds);
    const horizonSigners = account?.signers || [];
    const signers = Array.isArray(collectedSigners) ? collectedSigners : [];
    const current = getCollectedSignerWeight(signers, horizonSigners);
    if (current <= 0) throw new Error('submitTransaction.failed:multisig.noKeysProvided');
    if (current < required) throw new Error('submitTransaction.failed:multisig.insufficientWeight');

    if (!swapDestinationAsset.isNative()) {
      const trustlines = await loadTrustlines(accountId, server, { includeOps: false, ttlMs: 0 });
      const hasDestinationTrustline = trustlines.some((tl) =>
        tl.assetCode === swapDestinationAsset.code && tl.assetIssuer === swapDestinationAsset.issuer
      );
      if (!hasDestinationTrustline) throw new Error(t('trading:assetSearch.swapPreview.destinationTrustlineMissing'));
    }

    const latestPathResponse = await server
      .strictSendPaths(swapSourceAsset, sendAmount, [swapDestinationAsset])
      .call();
    const latestRecords = Array.isArray(latestPathResponse?.records) ? latestPathResponse.records : [];
    if (!latestRecords.length) throw new Error(t('trading:assetSearch.swapPreview.noRoute'));
    const latestBest = [...latestRecords].sort((a, b) => Number(b.destination_amount || 0) - Number(a.destination_amount || 0))[0];
    const latestMinimumDestinationAmount = calculateMinimumDestinationAmount(latestBest?.destination_amount, swapSlippage);
    if (!latestMinimumDestinationAmount) throw new Error(t('trading:assetSearch.swapPreview.minimumMissing'));
    setSwapPreview({ loading: false, error: '', path: latestBest });

    const path = Array.isArray(latestBest.path) ? latestBest.path.map(assetFromPathRecord) : [];
    const feeStats = await server.feeStats();
    const fee = String(Number(feeStats?.fee_charged?.mode || 100));
    const tx = new TransactionBuilder(account, {
      fee,
      networkPassphrase: network === 'TESTNET' ? Networks.TESTNET : Networks.PUBLIC,
    })
      .addOperation(Operation.pathPaymentStrictSend({
        sendAsset: swapSourceAsset,
        sendAmount,
        destination: accountId,
        destAsset: swapDestinationAsset,
        destMin: latestMinimumDestinationAmount,
        path,
      }))
      .setTimeout(60)
      .build();

    signers.forEach((signer) => {
      try { tx.sign(signer.keypair); } catch (error) { console.debug?.('sign failed', error); }
    });
    return server.submitTransaction(tx);
  };

  const openTrustlineModal = (asset) => {
    setSelectedAsset(asset);
    setModalError('');
    setActionMessage('');
    setShowTrustlineConfirm(true);
  };

  const handleConfirmTrustline = () => {
    setModalAction('trustline');
    setModalError('');
    setActionMessage('');
    setShowTrustlineConfirm(false);
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

  const handleCreateTrustline = async (collectedSigners) => {
    try {
      if (!selectedAsset) throw new Error('submitTransaction.failed:trustlines.invalidInput');
      setIsSubmittingTrustline(true);
      setModalError('');
      setActionMessage('');
      const stellarAsset = new Asset(selectedAsset.assetCode, selectedAsset.assetIssuer);
      await submitChangeTrustTx({
        asset: stellarAsset,
        limit: '1000000',
        collectedSigners,
      });
      setActionMessage(t('trading:assetSearch.trustlineStatus.added'));
      setShowSecretModal(false);
      setTrustlineRefreshToken((value) => value + 1);
    } catch (error) {
      const formatted = formatErrorForUi(t, error);
      setModalError(formatted);
      setActionMessage(formatted);
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
      setSwapPreview({ loading: false, error: '', path: null });
      setTrustlineRefreshToken((value) => value + 1);
    } catch (error) {
      const formatted = formatErrorForUi(t, error);
      setModalError(formatted);
      setActionMessage(formatted);
    } finally {
      setIsSubmittingSwap(false);
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

  const issuerHomeDomain = assetFacts.issuerAccount?.home_domain || assetFacts.issuerAccount?.homeDomain || '';
  const issuerMasterWeight = selectedAsset
    ? getIssuerMasterWeight(assetFacts.issuerAccount, selectedAsset.assetIssuer)
    : null;
  const tomlContainsAsset = assetFacts.toml.status === 'loaded' && assetFacts.toml.matches.length > 0;
  const tomlCurrencyCount = Array.isArray(assetFacts.toml.currencies) ? assetFacts.toml.currencies.length : 0;
  const authRequired = getAccountFlag(assetFacts.issuerAccount, 'auth_required', 'authRequired');
  const authRevocable = getAccountFlag(assetFacts.issuerAccount, 'auth_revocable', 'authRevocable');
  const authImmutable = getAccountFlag(assetFacts.issuerAccount, 'auth_immutable', 'authImmutable');
  const clawbackEnabled = getAccountFlag(assetFacts.issuerAccount, 'auth_clawback_enabled', 'authClawbackEnabled');

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

  const renderTokenFactsSummary = ({ includeDisclaimer = false } = {}) => (
    <>
      {includeDisclaimer && (
        <p className="mb-3 text-xs text-gray-700 dark:text-blue-100">
          {t('trading:assetSearch.facts.disclaimer')}
        </p>
      )}
      {assetFacts.loading && (
        <div className="text-xs text-gray-700 dark:text-blue-100">
          {t('trading:assetSearch.facts.loading')}
        </div>
      )}
      {assetFacts.error && (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {t('trading:assetSearch.facts.issuerLoadFailed')}
        </div>
      )}
      {!assetFacts.loading && !assetFacts.error && (
        <dl className="grid gap-2 text-xs sm:grid-cols-2">
          <div>
            <dt className="font-semibold">{t('trading:assetSearch.facts.homeDomain')}</dt>
            <dd className="break-all font-mono">{issuerHomeDomain || t('trading:assetSearch.facts.notAvailable')}</dd>
          </div>
          <div>
            <dt className="font-semibold">{t('trading:assetSearch.facts.issuerMasterWeight')}</dt>
            <dd className="font-mono">{issuerMasterWeight === null ? t('trading:assetSearch.facts.notAvailable') : issuerMasterWeight}</dd>
          </div>
          <div>
            <dt className="font-semibold">{t('trading:assetSearch.facts.issuerLocked')}</dt>
            <dd>{issuerMasterWeight === null ? t('trading:assetSearch.facts.notAvailable') : factValue(issuerMasterWeight === 0)}</dd>
          </div>
          <div>
            <dt className="font-semibold">{t('trading:assetSearch.facts.toml.status')}</dt>
            <dd>{tomlStatusLabel()}</dd>
          </div>
          {assetFacts.toml.url && (
            <div className="sm:col-span-2">
              <dt className="font-semibold">{t('trading:assetSearch.facts.toml.url')}</dt>
              <dd className="break-all font-mono">{assetFacts.toml.url}</dd>
            </div>
          )}
          <div>
            <dt className="font-semibold">{t('trading:assetSearch.facts.toml.assetListed')}</dt>
            <dd>{assetFacts.toml.status === 'loaded' ? factValue(tomlContainsAsset) : t('trading:assetSearch.facts.notAvailable')}</dd>
          </div>
          <div>
            <dt className="font-semibold">{t('trading:assetSearch.facts.toml.currencyCount')}</dt>
            <dd className="font-mono">{assetFacts.toml.status === 'loaded' ? tomlCurrencyCount : t('trading:assetSearch.facts.notAvailable')}</dd>
          </div>
          <div>
            <dt className="font-semibold">{t('trading:assetSearch.facts.flags.authRequired')}</dt>
            <dd>{factValue(authRequired)}</dd>
          </div>
          <div>
            <dt className="font-semibold">{t('trading:assetSearch.facts.flags.authRevocable')}</dt>
            <dd>{factValue(authRevocable)}</dd>
          </div>
          <div>
            <dt className="font-semibold">{t('trading:assetSearch.facts.flags.authImmutable')}</dt>
            <dd>{factValue(authImmutable)}</dd>
          </div>
          <div>
            <dt className="font-semibold">{t('trading:assetSearch.facts.flags.clawbackEnabled')}</dt>
            <dd>{factValue(clawbackEnabled)}</dd>
          </div>
          <div>
            <dt className="font-semibold">{t('trading:assetSearch.facts.liquidityRoute')}</dt>
            <dd>
              {swapPreview.path
                ? t('trading:assetSearch.facts.routeAvailable')
                : swapPreview.error
                  ? t('trading:assetSearch.facts.routeUnavailable')
                  : t('trading:assetSearch.facts.notChecked')}
            </dd>
          </div>
        </dl>
      )}
    </>
  );

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
              <dt className="font-semibold">{t('trading:assetSearch.result.columns.issuer')}</dt>
              <dd className="break-all font-mono">{selectedAsset.assetIssuer}</dd>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="font-semibold">{t('trading:assetSearch.result.columns.numAccounts', 'Trustlines')}</dt>
                <dd>{formatTrustlineCount(selectedAsset)}</dd>
              </div>
              <div>
                <dt className="font-semibold" title={t('trading:assetSearch.result.columnHelp.amount')}>
                  {t('trading:assetSearch.result.columns.amount', 'Amount')}
                </dt>
                <dd>{formatAssetAmount(selectedAsset)}</dd>
              </div>
            </div>
            <div>
              <dt className="font-semibold">{t('trading:assetSearch.trustlineStatus.label')}</dt>
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
                  <dt className="font-semibold">{t('trading:assetSearch.trustlineStatus.balance')}</dt>
                  <dd>{trustlineStatus.balance ?? '—'}</dd>
                </div>
                <div>
                  <dt className="font-semibold">{t('trading:assetSearch.trustlineStatus.limit')}</dt>
                  <dd>{trustlineStatus.limit ?? '—'}</dd>
                </div>
              </div>
            )}
          </dl>
          <p className="mt-3 text-xs text-blue-900 dark:text-blue-100">
            {t('trading:assetSearch.detail.nextStepHint', 'Known in Horizon only. Check issuer and trust before signing a trustline or swap.')}
          </p>
          <section className="mt-4 rounded border border-gray-200 bg-white p-3 dark:border-blue-900 dark:bg-blue-900/40">
            <h3 className="mb-3 text-sm font-semibold">
              {t('trading:assetSearch.facts.title')}
            </h3>
            {renderTokenFactsSummary({ includeDisclaimer: true })}
          </section>
          {trustlineStatus.state === 'missing' && accountId && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => openTrustlineModal(selectedAsset)}
                disabled={isSubmittingTrustline}
                className="rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                {isSubmittingTrustline
                  ? t('common:main.processing')
                  : t('trading:assetSearch.actions.trustlineAdd', 'Add trustline')}
              </button>
            </div>
          )}
          {trustlineStatus.state === 'present' && (
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
                    onClick={handleSwapPreview}
                    disabled={swapPreview.loading}
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
                      <dt className="font-semibold">{t('trading:assetSearch.swapPreview.expected')}</dt>
                      <dd className="font-mono">{swapPreview.path.destination_amount} {swapDestinationLabel}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold">{t('trading:assetSearch.swapPreview.minimum')}</dt>
                      <dd className="font-mono">{minimumDestinationAmount || '—'} {swapDestinationLabel}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="font-semibold">{t('trading:assetSearch.swapPreview.route')}</dt>
                      <dd className="font-mono">{formatAssetPath(swapPreview.path.path, swapSourceAsset, swapDestinationAsset)}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <button
                        type="button"
                        onClick={openSwapModal}
                        disabled={isSubmittingSwap || !minimumDestinationAmount}
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
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
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
                )}
              </div>
            </section>
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
                <dd className="font-mono">1000000 {selectedAsset.assetCode}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-semibold">{t('trading:assetSearch.result.columns.issuer')}</dt>
                <dd className="break-all font-mono">{selectedAsset.assetIssuer}</dd>
              </div>
            </dl>
            <section className="mt-4 rounded border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
              <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
                {t('trading:assetSearch.facts.title')}
              </h3>
              {renderTokenFactsSummary({ includeDisclaimer: true })}
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
            </dl>
            <section className="mt-4 rounded border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
              <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
                {t('trading:assetSearch.facts.title')}
              </h3>
              {renderTokenFactsSummary({ includeDisclaimer: true })}
            </section>
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
      {showSecretModal && (
        <SecretKeyModal
          onConfirm={(collected) => (modalAction === 'swap' ? handleExecuteSwap(collected) : handleCreateTrustline(collected))}
          onCancel={() => {
            setShowSecretModal(false);
            setModalAction('');
            setModalError('');
          }}
          errorMessage={modalError}
          isProcessing={isSubmittingTrustline || isSubmittingSwap}
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
