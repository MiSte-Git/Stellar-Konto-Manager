// Regression 12.11.2026: Im Swap-Bestaetigungsdialog stand bei "Quelle" immer der Issuer des
// ausgewaehlten Assets, bei XLM -> Token also der Issuer des Ziel-Tokens.
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Asset } from '@stellar/stellar-sdk';
import i18n from '../../../i18n.js';
import ConfirmActionModal from '../ConfirmActionModal.jsx';
import { EMPTY_ASSET_FACTS } from '../assetSearchUtils.js';

const ISSUER = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
const ISSUER_2 = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI';

function renderSwap({ direction, source, destination, selected }) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ConfirmActionModal
        kind="swap"
        onCancel={() => {}}
        onConfirm={() => {}}
        selectedAsset={selected}
        swapAmount="10"
        swapPreview={{ path: { destination_amount: '20', path: [] } }}
        swapSourceLabel={source === Asset.native() ? 'XLM' : 'FOO'}
        swapDestinationLabel="BAR"
        minimumDestinationAmount="19"
        swapSlippage="1"
        swapDirection={direction}
        swapSourceAsset={source}
        swapDestinationAsset={destination}
        quoteDetails={null}
        assetFacts={EMPTY_ASSET_FACTS}
        targetAssetFacts={EMPTY_ASSET_FACTS}
        targetStellarAsset={destination}
        selectedAssetFactsTitleKey="trading:assetSearch.swapPreview.factsTitle"
        ratioFormatter={() => ''}
        formatQuoteAge={() => ''}
        formatPercent={() => ''}
      />
    </I18nextProvider>
  );
}

describe('ConfirmActionModal swap - Quelle und Ziel', () => {
  it('XLM -> Token: Quelle ist XLM, Ziel ist der Token mit seinem Issuer', () => {
    const foo = new Asset('FOO', ISSUER);
    renderSwap({ direction: 'xlm-to-token', source: Asset.native(), destination: foo, selected: { assetCode: 'FOO', assetIssuer: ISSUER } });
    expect(screen.getByTestId('swap-confirm-source').textContent).toBe('XLM');
    expect(screen.getByTestId('swap-confirm-destination').textContent).toBe(`FOO: ${ISSUER}`);
  });

  it('Token -> XLM: Quelle ist der Token, Ziel ist XLM', () => {
    const foo = new Asset('FOO', ISSUER);
    renderSwap({ direction: 'token-to-xlm', source: foo, destination: Asset.native(), selected: { assetCode: 'FOO', assetIssuer: ISSUER } });
    expect(screen.getByTestId('swap-confirm-source').textContent).toBe(`FOO: ${ISSUER}`);
    expect(screen.getByTestId('swap-confirm-destination').textContent).toBe('XLM');
  });

  it('Token -> Token: beide mit eigenem Issuer', () => {
    const foo = new Asset('FOO', ISSUER);
    const bar = new Asset('BAR', ISSUER_2);
    renderSwap({ direction: 'token-to-token', source: foo, destination: bar, selected: { assetCode: 'FOO', assetIssuer: ISSUER } });
    expect(screen.getByTestId('swap-confirm-source').textContent).toBe(`FOO: ${ISSUER}`);
    expect(screen.getByTestId('swap-confirm-destination').textContent).toBe(`BAR: ${ISSUER_2}`);
  });
});
