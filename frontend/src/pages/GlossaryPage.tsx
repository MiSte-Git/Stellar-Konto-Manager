import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import GlossaryTermCard from '../components/GlossaryTermCard.tsx';
import { getGlossaryDisplayTitle } from '../utils/glossary.ts';
import GlossaryToc from '../components/glossary/GlossaryToc.tsx';

// GlossaryPage: Einsteiger-Glossar mit Suche und Grid-Ansicht.
// Alle Texte kommen aus i18n (glossary.*). Fallbacks sind einfache englische Sätze.
function GlossaryPage() {
  const { t } = useTranslation(['navigation', 'glossary', 'common']);
  const [query, setQuery] = useState('');
  const [showBackToTop, setShowBackToTop] = useState(false);
  // Back-to-top visibility based on the overlay scroll container
  React.useEffect(() => {
    const getContainer = () => {
      try {
        return document.getElementById('stm-glossary-overlay') || window;
      } catch { return window; }
    };
    const container = getContainer();
    const onScroll = () => {
      try {
        const top = (container instanceof Window) ? window.scrollY : (container?.scrollTop || 0);
        setShowBackToTop(top > 200);
      } catch { /* noop */ }
    };
    // initialize state
    onScroll();
    (container as any).addEventListener('scroll', onScroll);
    return () => (container as any).removeEventListener('scroll', onScroll);
  }, []);
  const backHref = React.useMemo(() => {
    try {
      const ref = (typeof document !== 'undefined' ? document.referrer : '') || '';
      const sameOrigin = typeof window !== 'undefined' && ref.startsWith(window.location.origin);
      return sameOrigin ? ref : undefined;
    } catch {
      return undefined;
    }
  }, []);

  const goBack = React.useCallback(() => {
    try {
      // Wenn wir über die App ins Glossar kamen, wieder auf den gemerkten Pfad zurück
      const prev = (typeof window !== 'undefined' && window.sessionStorage)
        ? window.sessionStorage.getItem('STM_PREV_PATH')
        : '';
      if (prev) {
        window.history.pushState({}, '', prev);
        try { window.dispatchEvent(new PopStateEvent('popstate')); } catch { /* noop */ }
        return;
      }
      // Falls Referrer verfügbar ist: bei gleicher Origin ohne Reload wechseln, sonst echter Redirect
      if (backHref) {
        try {
          const url = new URL(backHref, window.location.origin);
          if (url.origin === window.location.origin) {
            window.history.pushState({}, '', url.pathname + url.search + url.hash);
            try { window.dispatchEvent(new PopStateEvent('popstate')); } catch { /* noop */ }
            return;
          }
        } catch { /* noop */ }
        window.location.assign(backHref);
        return;
      }
      // Letzter Fallback: back + PopState Event
      window.history.back();
      setTimeout(() => {
        try { window.dispatchEvent(new PopStateEvent('popstate')); } catch { /* noop */ }
      }, 0);
    } catch {
      /* noop */
    }
  }, [backHref]);

  // Liste der Begriffe. Jeder hat .title und .desc in i18n
  const termKeys = [
    'blockchain',
    'wallet',
    'account',
    'addressG',
    'publicKey',
    'privateKey',
    'addressFederation',
    'addressMuxed',
    'multisig',
    'trustline',
    'token',
    'asset',
    'xlm',
    'mainnet',
    'testnet',
    'memo',
    'transaction',
    'fee',
    'ledger',
    'horizon',
    'anchor',
    'exchange',
    'dex',
    'liquidityPool',
    'balanceClaimable',
    'protocolUpdate',
    'soroban',
  ] as const;

  // Fallback englische Texte (kurz, kein Marketing)
  const fallback: Record<string, { title: string; desc: string }> = {
    blockchain: {
      title: 'Blockchain',
      desc: 'A blockchain is a shared digital ledger. Many computers store the same records. No one can secretly change them.'
    },
    wallet: {
      title: 'Wallet',
      desc: 'A wallet is your digital purse. It manages the keys you need to access your account and send transactions.'
    },
    account: {
      title: 'Account',
      desc: 'An account holds your assets on the blockchain. It has a public address that starts with G.'
    },
    addressG: {
      title: 'G-address',
      desc: 'The main address of a Stellar account. It starts with G. Share it so others can send you assets.'
    },
    publicKey: {
      title: 'Public key',
      desc: 'The address you can share. On Stellar this is the G-address. Others use it to send you money.'
    },
    privateKey: {
      title: 'Secret key',
      desc: 'Your password for the account. Whoever has it can move your funds. Never share it.'
    },
    addressFederation: {
      title: 'Federation address',
      desc: 'Looks like an email. Example: name*domain.com. It points to a normal G-address. Easier to remember.'
    },
    addressMuxed: {
      title: 'Muxed account (M-address)',
      desc: 'An M-address points to a base Stellar account and adds its own ID. It helps separate users under one G-address.'
    },
    multisig: {
      title: 'Multi-sig',
      desc: 'Important actions need more than one signature. Example: two keys must approve before sending.'
    },
    trustline: {
      title: 'Trustline',
      desc: 'Saying yes, I accept this token from this issuer. Without a trustline you cannot receive that token.'
    },
    token: {
      title: 'Token',
      desc: 'A digital unit on the blockchain. It can be money, points, or credit for a service.'
    },
    asset: {
      title: 'Asset',
      desc: 'On Stellar a token is called an asset. It is always linked to an issuer account.'
    },
    xlm: {
      title: 'XLM',
      desc: 'The native currency of Stellar. You need it for fees and to start a new account.'
    },
    mainnet: {
      title: 'Mainnet',
      desc: 'The real Stellar network with real value. Transactions are final and fees are paid in real XLM.'
    },
    testnet: {
      title: 'Testnet',
      desc: 'A public practice network. Tokens have no real value. Use it to learn and test without risk.'
    },
    memo: {
      title: 'Memo',
      desc: 'A small note you can send with a transaction. Exchanges often require a specific memo.'
    },
    transaction: {
      title: 'Transaction',
      desc: 'An action on the blockchain. For example sending money or creating a trustline.'
    },
    fee: {
      title: 'Fee',
      desc: 'A very small amount you pay for each transaction. On Stellar fees are very low.'
    },
    ledger: {
      title: 'Ledger',
      desc: 'The chain of confirmed data. It shows balances and what happened. Everyone can verify it.'
    },
    horizon: {
      title: 'Horizon',
      desc: 'The service that apps use to talk to the Stellar network. We query Horizon for balances and transactions.'
    },
    anchor: {
      title: 'Anchor',
      desc: 'A company that bridges real money, like EUR or USD, to Stellar. You give them fiat and get a token on Stellar.'
    },
    exchange: {
      title: 'Exchange',
      desc: 'A place to buy or sell tokens. Many exchanges require KYC to withdraw to fiat.'
    },
    dex: {
      title: 'DEX',
      desc: 'Decentralized exchange. People trade directly on the blockchain. Stellar has a built-in DEX.'
    },
    liquidityPool: {
      title: 'Liquidity pool',
      desc: 'A shared pot with two tokens. People deposit both tokens. Others swap instantly. Depositors earn small fees.'
    },
    balanceClaimable: {
      title: 'Claimable balance',
      desc: 'Money reserved for you. You must claim it before it moves into your account.'
    },
    protocolUpdate: {
      title: 'Protocol update',
      desc: 'An upgrade of the rules in the Stellar network. All nodes must use the same rules.'
    },
    soroban: {
      title: 'Soroban',
      desc: 'Stellar’s smart contract system. Code runs on-chain and can enforce rules automatically.'
    },
  };

  const items = useMemo(() => {
    return termKeys.map((key) => {
      const def = fallback[key];
      // visible display title (with original in parens if present)
      const display = getGlossaryDisplayTitle(key, t);
      const desc = t(`glossary.${key}.desc`, def?.desc || '');
      const short = t(`glossary.${key}.short`, '');
      return { key, display, desc, short };
    });
  }, [t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(({ key, display, desc, short }) => {
      const title = t(`glossary.${key}.title`, '');
      const original = t(`glossary.${key}.original`, '');
      return (
        display.toLowerCase().includes(q) ||
        title.toLowerCase().includes(q) ||
        original.toLowerCase().includes(q) ||
        short.toLowerCase().includes(q) ||
        desc.toLowerCase().includes(q)
      );
    });
  }, [items, query]);

  return (
    <div className="max-w-5xl mx-auto p-4">
      <header className="mb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="shrink-0">
            <button
              type="button"
              onClick={goBack}
              className="inline-flex items-center gap-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 text-sm font-medium px-3 py-1.5 rounded"
            >
              ← {t('navigation:back', 'Zurück')}
            </button>
          </div>
          <h1 className="text-2xl font-bold text-center flex-1">
            {t('glossary:pageTitle', 'Glossary')}
          </h1>
          <div className="w-[76px] shrink-0" aria-hidden />
        </div>
        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300 text-center">
          {t('common:glossary.pageIntro',
            'Here you find key words from the blockchain world and the Stellar network. Simple explanations.'
          )}
        </p>
      </header>

      <section className="mb-6">
        <label className="block text-sm font-medium mb-1" htmlFor="glossary-search">
          {t('glossary:searchLabel', 'Search term')}
        </label>
        <input
          id="glossary-search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('glossary:searchPlaceholder', 'e.g., Wallet, Trustline, Memo …')}
          className="w-full border border-gray-300 dark:border-gray-700 rounded p-2"
        />
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          {t('glossary:searchHint', 'Search matches words and explanations.')}
        </p>
      </section>

      {/* Inhaltsverzeichnis */}
      <GlossaryToc className="mb-6" slugs={items.map((it) => it.key)} idPrefix="g-" />

      {filtered.length === 0 ? (
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {t('glossary:noResults', 'No results.')}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {filtered.map((it) => (
            <section key={it.key} id={`g-${it.key}`}>
              <GlossaryTermCard titleNode={<span className="whitespace-nowrap">{it.display}</span>} titleAttr={it.display} desc={it.desc} />
            </section>
          ))}
        </div>
      )}

      {showBackToTop && (
        <button
          onClick={() => {
            try {
              const container = document.getElementById('stm-glossary-overlay');
              if (container) {
                container.scrollTo({ top: 0, behavior: 'smooth' });
              } else {
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            } catch { /* noop */ }
          }}
          className="fixed right-4 bottom-4 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow focus:outline-none focus:ring-2 focus:ring-blue-400"
                aria-label={t('navigation:backToTop', 'Back to top')}
      title={t('navigation:backToTop', 'Back to top')}
    >
      ↑ {t('navigation:backToTop', 'Back to top')}

        </button>
      )}
    </div>
  );
}

export default GlossaryPage;
