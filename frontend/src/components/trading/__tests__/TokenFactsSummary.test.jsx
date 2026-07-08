import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../i18n.js';
import TokenFactsSummary from '../TokenFactsSummary.jsx';
import { EMPTY_ASSET_FACTS } from '../assetSearchUtils.js';

const ISSUER = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
const ASSET = { assetCode: 'FOO', assetIssuer: ISSUER };

function factsWithExpert(expert) {
  return {
    ...EMPTY_ASSET_FACTS,
    issuerAccount: {
      home_domain: 'example.org',
      flags: {},
      signers: [{ key: ISSUER, weight: 1 }],
      thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
    },
    toml: { ...EMPTY_ASSET_FACTS.toml, status: 'loaded', matches: [{ code: 'FOO', issuer: ISSUER }] },
    expert: { ...EMPTY_ASSET_FACTS.expert, ...expert },
  };
}

function renderSummary(facts) {
  return render(
    <I18nextProvider i18n={i18n}>
      <TokenFactsSummary facts={facts} asset={ASSET} includeRoute={false} />
    </I18nextProvider>
  );
}

describe('TokenFactsSummary - StellarExpert hint', () => {
  it('shows a red alert box when the issuer carries a malicious/unsafe directory tag', () => {
    renderSummary(factsWithExpert({ status: 'listed', name: 'Fake Anchor', tags: ['malicious'] }));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('StellarExpert');
    expect(alert.textContent).toContain('malicious');
  });

  it('shows no alert box for a listing with only descriptive tags', () => {
    renderSummary(factsWithExpert({ status: 'listed', name: 'Some Exchange', tags: ['exchange'] }));
    expect(screen.queryByRole('alert')).toBe(null);
  });

  it('shows no alert box when the issuer is simply not listed', () => {
    renderSummary(factsWithExpert({ status: 'notListed' }));
    expect(screen.queryByRole('alert')).toBe(null);
  });

  it('renders the "not listed" hint with wording that neither implies fraud nor safety', () => {
    renderSummary(factsWithExpert({ status: 'notListed' }));
    // German copy explicitly says absence proves nothing about authenticity.
    expect(screen.getByText(/sagt nichts über die Echtheit aus/)).toBeTruthy();
  });

  it('renders a benign listing without endorsement vocabulary (no "verifiziert"/"bestätigt"/"sicher")', () => {
    const { container } = renderSummary(
      factsWithExpert({ status: 'listed', name: 'Some Exchange', tags: ['exchange'] })
    );
    const text = container.textContent;
    expect(text).toContain('Some Exchange');
    expect(text).not.toMatch(/verifiziert|bestätigt als|als sicher/i);
  });

  it('renders the degraded state when StellarExpert was unreachable without blocking the other facts', () => {
    renderSummary(factsWithExpert({ status: 'unavailable' }));
    expect(screen.getByText(/StellarExpert nicht erreichbar/)).toBeTruthy();
    // The rest of the facts grid still renders (home domain row is present).
    expect(screen.getByText('example.org')).toBeTruthy();
  });
});
