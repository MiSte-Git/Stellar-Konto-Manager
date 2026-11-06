import React from 'react';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../i18n.js';
import { LiquidityResultDialog } from '../jobParts.jsx';

// Schwelle im Ergebnisdialog, wenn das Backend kein requiredWeight liefert (T-5).
const account = {
  thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
  signers: [{ key: 'GA', weight: 1, type: 'ed25519_public_key' }, { key: 'GB', weight: 1, type: 'ed25519_public_key' }],
};
const progress = (required) => i18n.t('multisig:confirm.result.job.progress', { collected: 0, required });

function renderDialog(result, operationType = 'changeTrust') {
  return render(
    <I18nextProvider i18n={i18n}>
      <LiquidityResultDialog type="job" result={{ id: 'j1', hash: 'h', xdr: 'AAAA', items: [], collectedSigners: [], ...result }} account={account} operationType={operationType} onClose={() => {}} />
    </I18nextProvider>
  );
}

describe('LiquidityResultDialog - Schwelle aus den Operationen', () => {
  it('nimmt das Maximum ueber result.operationTypes vor operationType', () => {
    renderDialog({ operationTypes: ['manageSellOffer', 'setOptions'] });
    expect(screen.getByText(progress(3))).toBeInTheDocument();
  });

  it('Gegenprobe: ohne operationTypes gilt operationType', () => {
    renderDialog({});
    expect(screen.getByText(progress(2))).toBeInTheDocument();
  });

  it('requiredWeight vom Backend hat Vorrang', () => {
    renderDialog({ operationTypes: ['setOptions'], requiredWeight: 2 });
    expect(screen.getByText(progress(2))).toBeInTheDocument();
  });
});
