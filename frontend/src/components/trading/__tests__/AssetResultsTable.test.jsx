import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../i18n.js';
import AssetResultsTable from '../AssetResultsTable.jsx';

const ISSUER_A = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
const ISSUER_B = 'GBXOTHERKEY0000000000000000000000000000000000000000000A';

const noop = () => {};
const countFormatter = { format: (n) => String(n) };

function baseProps(overrides = {}) {
  const assetResults = overrides.assetResults || [];
  return {
    assetResults,
    assetError: '',
    assetLoading: false,
    countFormatter,
    sortedAssetResults: assetResults,
    assetResultFacts: {},
    toggleAssetSort: noop,
    sortIndicator: () => '',
    formatTrustlineCount: () => '—',
    onSelectAsset: noop,
    canAddTrustlineFor: () => true,
    onOpenTrustlineModal: noop,
    trustlineActionLabel: () => 'Trustline',
    ...overrides,
  };
}

function renderTable(props) {
  return render(
    <I18nextProvider i18n={i18n}>
      <AssetResultsTable {...props} />
    </I18nextProvider>
  );
}

describe('AssetResultsTable', () => {
  it('shows no duplicate-code warning when every result has a distinct code', () => {
    renderTable(baseProps({
      assetResults: [
        { assetCode: 'FOO', assetIssuer: ISSUER_A },
        { assetCode: 'BAR', assetIssuer: ISSUER_B },
      ],
    }));
    expect(screen.queryByText(/unterschiedlichen Ausstellern/i)).toBe(null);
  });

  it('warns and badges rows when multiple results share the same asset code with different issuers', () => {
    renderTable(baseProps({
      assetResults: [
        { assetCode: 'USDC', assetIssuer: ISSUER_A },
        { assetCode: 'USDC', assetIssuer: ISSUER_B },
      ],
    }));
    // The banner mentions the duplicated code.
    expect(screen.getByText(/USDC/, { selector: 'div' })).toBeTruthy();
    // Each duplicated row gets a "2x" badge.
    const badges = screen.getAllByText('2×');
    expect(badges.length).toBe(2);
  });

  it('does not badge a code that only appears once even if other codes in the list are duplicated', () => {
    renderTable(baseProps({
      assetResults: [
        { assetCode: 'USDC', assetIssuer: ISSUER_A },
        { assetCode: 'USDC', assetIssuer: ISSUER_B },
        { assetCode: 'UNIQUE', assetIssuer: ISSUER_A },
      ],
    }));
    expect(screen.getAllByText('2×').length).toBe(2);
    expect(screen.queryByText('1×')).toBe(null);
  });

  it('renders the issuer cell with the same font-weight emphasis as the code cell, not as secondary info', () => {
    renderTable(baseProps({
      assetResults: [{ assetCode: 'FOO', assetIssuer: ISSUER_A }],
    }));
    const codeCell = screen.getByText('FOO');
    const issuerCell = screen.getByTitle(ISSUER_A);
    expect(codeCell.className).toContain('font-semibold');
    expect(issuerCell.className).toContain('font-semibold');
  });
});
