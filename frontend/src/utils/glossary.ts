import type { TFunction } from 'i18next';

export const glossaryAliases: Record<string, string> = {
  multiSignature: 'multisig',
};

export const glossaryAliasIndex = Object.entries(glossaryAliases).reduce<Record<string, string[]>>(
  (acc, [alias, canonical]) => {
    if (!acc[canonical]) acc[canonical] = [];
    acc[canonical].push(alias);
    return acc;
  },
  {},
);

export const glossaryGroups = [
  {
    id: 'accountsKeys',
    slugs: ['account', 'addressG', 'publicKey', 'privateKey', 'addressFederation', 'addressMuxed', 'muxedAccountsUseCases', 'signing', 'sequenceNumber', 'baseReserve'],
  },
  {
    id: 'multisigSecurity',
    slugs: ['multisig', 'multisigCorporate', 'signer', 'thresholds', 'masterWeight', 'accountConfig'],
  },
  {
    id: 'walletsCustody',
    slugs: ['wallet', 'seedPhrase', 'selfCustody', 'custodian', 'hardwareWallet', 'hotWallet', 'coldWallet'],
  },
  {
    id: 'tokensAssets',
    slugs: [
      'token',
      'asset',
      'trustline',
      'xlm',
      'stablecoin',
      'utilityToken',
      'securityToken',
      'governanceToken',
      'liquidityToken',
      'nft',
      'cbdc',
      'cryptocurrency',
      'altcoin',
      'coin',
      'coinVsToken',
      'nativeCoin',
      'fungibility',
      'wrappedToken',
      'syntheticAsset',
      'memeCoin',
      'stellarAsset',
      'issuedAsset',
    ],
  },
  {
    id: 'transactionsFees',
    slugs: [
      'transaction',
      'transactionStatus',
      'memo',
      'fee',
      'operations',
      'pathPayment',
      'clawback',
      'sponsor',
      'gasFee',
      'onChain',
      'offChain',
      'balanceClaimable',
    ],
  },
  {
    id: 'marketsTrading',
    slugs: [
      'exchange',
      'dex',
      'liquidityPool',
      'cex',
      'orderBook',
      'limitOrder',
      'marketOrder',
      'offer',
      'slippage',
      'impermanentLoss',
      'amm',
      'bullBearMarket',
      'hodl',
      'dca',
      'portfolio',
      'tvl',
      'liquidity',
      'spread',
      'priceDiscovery',
      'marketCap',
      'circulatingSupply',
      'volatility',
      'anchor',
    ],
  },
  {
    id: 'networkProtocol',
    slugs: [
      'ledger',
      'horizon',
      'horizonHistory',
      'scp',
      'validator',
      'quorumSet',
      'sac',
      'protocolUpdate',
      'networkCongestion',
      'mainnet',
      'testnet',
    ],
  },
  {
    id: 'defi',
    slugs: ['defi', 'yield', 'staking', 'yieldFarming', 'dao', 'dapp', 'oracle'],
  },
  {
    id: 'onrampOfframp',
    slugs: ['onramp', 'offramp', 'kyc'],
  },
  {
    id: 'smartContracts',
    slugs: ['soroban', 'smartContract', 'programmableLogic'],
  },
  {
    id: 'blockchainBasics',
    slugs: [
      'blockchain',
      'distributedNetwork',
      'node',
      'block',
      'mining',
      'proofOfWork',
      'proofOfStake',
      'fork',
      'layer1Layer2',
      'bridge',
      'interoperability',
      'whitepaper',
      'ico',
      'airdrop',
      'consensusMechanism',
      'finality',
      'immutability',
      'decentralization',
      'publicBlockchain',
      'privateBlockchain',
      'permissionlessBlockchain',
      'permissionedBlockchain',
      'blockchainTypes',
      'paymentBlockchain',
      'smartContractBlockchain',
      'blockchainComparison',
      'stellarVsBitcoinVsEthereum',
    ],
  },
  {
    id: 'moneyFinance',
    slugs: ['money', 'fiatCurrency', 'centralBank', 'inflation', 'currency'],
  },
  {
    id: 'cryptography',
    slugs: ['cryptography', 'hash', 'encryption', 'digitalSignature', 'publicKeyCryptography', 'keyPair', 'zkp'],
  },
  {
    id: 'security',
    slugs: ['phishing', 'scam', 'walletWatcher', 'rugPull', 'ponzi', 'twoFactorAuth', 'socialEngineering'],
  },
] as const;

export function resolveGlossarySlug(slug: string) {
  return glossaryAliases[slug] || slug;
}

export function getGroupedGlossarySlugs() {
  return glossaryGroups.map((group) => {
    const seen = new Set<string>();
    const slugs = group.slugs.map(resolveGlossarySlug).filter((slug) => {
      if (seen.has(slug)) return false;
      seen.add(slug);
      return true;
    });
    return { ...group, slugs };
  });
}

/**
 * getGlossaryParts: returns the translated title and the English original for a given glossary slug.
 * Throws if the required title key is missing, so the UI can translate the error.
 */
export function getGlossaryParts(slug: string, t: TFunction) {
  const titleKey = `${slug}.title`;
  const originalKey = `${slug}.original`;

  // Do NOT pass a default for title so a missing de.json key becomes visible
  const title = t(titleKey) as string;
  if (!title || title === titleKey) {
    // Fallback gracefully to the slug to avoid crashing the page if a key is missing
    try { console.warn('Missing glossary key', slug); } catch { /* noop */ }
    return { title: slug, original: undefined } as const;
  }
  // original can be missing; then we simply do not show the parenthetical
  // We do pass a blank default to avoid echoing the key on screen
  const original = t(originalKey, '') as string;
  return { title, original: original?.trim() || undefined } as const;
}

/**
 * getGlossaryDisplayTitle: "Übersetzung (Englisch)" or just "Übersetzung" when original is missing.
 * Safe to use for aria-labels, tooltip titles, etc.
 */
export function getGlossaryDisplayTitle(slug: string, t: TFunction) {
  const { title, original } = getGlossaryParts(slug, t);
  const normalize = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  const lang = (t as any)?.i18n?.language || '';
  const sameValue = original && normalize(original) === normalize(title);
  const showOriginal = !!(original && !sameValue && !String(lang).startsWith('en'));
  return showOriginal ? `${title} (${original})` : title;
}
