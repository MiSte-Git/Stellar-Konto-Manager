// Hinweiskasten fuer die Sperre pro Konto bei unklarem Sendestatus (und der Hinweis nach der
// Klaerung), gemeinsam fuer alle Seiten mit Sendewegen: Trading, Liquidity, Claimable Balances,
// Sammel-Tausch. guard ist das Ergebnis von useAccountSendBlock bzw. useSharedSendBlock.
import React from 'react';
import { useTranslation } from 'react-i18next';
import { getNetworkConfig } from '../../config/networks.js';
import { buildExplorerUrl } from '../../utils/stellar/accountUtils.js';
import { useSettings } from '../../utils/useSettings.js';
import SendAmbiguousPanel, { SendResolvedNotice } from './SendAmbiguousPanel.jsx';

export default function AccountSendGuardNotice({ guard, network }) {
  const { t, i18n } = useTranslation(['common', 'batchPayment']);
  const { explorers } = useSettings();
  if (!guard) return null;
  const explorerLinks = (hash) => {
    const list = explorers || [];
    const find = (key) => list.find((exp) => (exp.key || exp.id) === key) || null;
    return [
      { href: buildExplorerUrl(find('stellar_expert'), hash, network, { type: 'tx' }), label: t('common:balance.explorer.expert', 'stellar.expert') },
      { href: buildExplorerUrl(find('stellarchain'), hash, network, { type: 'tx' }), label: t('common:balance.explorer.stellarchain', 'Stellarchain.io') },
    ].filter((l) => l.href);
  };
  return (
    <>
      <SendAmbiguousPanel
        guard={guard}
        t={t}
        language={i18n.language}
        networkLabel={getNetworkConfig(network).label}
        explorerLinks={explorerLinks}
      />
      <SendResolvedNotice notice={guard.notice} t={t} onDismiss={guard.dismissNotice} />
    </>
  );
}
