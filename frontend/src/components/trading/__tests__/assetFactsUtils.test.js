// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getAssetRiskWarnings, isExpertFlagged, getExpertWarningTags, expertStatusLabel } from '../assetFactsUtils.js';

const ISSUER = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
const OTHER_SIGNER = 'GBXOTHERKEY00000000000000000000000000000000000000000000';
const ASSET = { assetCode: 'FOO', assetIssuer: ISSUER };
const t = (key) => key;

function baseFacts(overrides = {}) {
  return {
    loading: false,
    error: '',
    issuerAccount: {
      home_domain: 'example.org',
      flags: {},
      signers: [{ key: ISSUER, weight: 1 }],
      thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
      ...overrides.issuerAccount,
    },
    toml: {
      status: 'loaded',
      matches: [{ code: 'FOO', issuer: ISSUER }],
      currencies: [{ code: 'FOO', issuer: ISSUER }],
      ...overrides.toml,
    },
  };
}

describe('getAssetRiskWarnings', () => {
  it('does not warn about an active (non-zero-weight) issuer master key - that is the normal case', () => {
    const warnings = getAssetRiskWarnings(baseFacts(), ASSET, t);
    expect(warnings).toEqual([]);
  });

  it('warns when the master key appears locked but replacement signers could still control the account', () => {
    const facts = baseFacts({
      issuerAccount: {
        signers: [
          { key: ISSUER, weight: 0 },
          { key: OTHER_SIGNER, weight: 1 },
        ],
        thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
      },
    });
    const warnings = getAssetRiskWarnings(facts, ASSET, t);
    expect(warnings).toContain('trading:assetSearch.risk.issuerAppearsLocked');
  });

  it('does not warn when the master key is genuinely fully locked', () => {
    const facts = baseFacts({
      issuerAccount: {
        signers: [{ key: ISSUER, weight: 0 }],
        thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
      },
    });
    const warnings = getAssetRiskWarnings(facts, ASSET, t);
    expect(warnings).not.toContain('trading:assetSearch.risk.issuerAppearsLocked');
  });

  it('warns about authRevocable separately from clawback and authRequired', () => {
    const facts = baseFacts({
      issuerAccount: {
        signers: [{ key: ISSUER, weight: 1 }],
        flags: { auth_revocable: true },
      },
    });
    const warnings = getAssetRiskWarnings(facts, ASSET, t);
    expect(warnings).toContain('trading:assetSearch.risk.authRevocable');
    expect(warnings).not.toContain('trading:assetSearch.risk.clawbackEnabled');
    expect(warnings).not.toContain('trading:assetSearch.risk.authRequired');
  });

  it('still warns about a missing stellar.toml listing independently of the lock status', () => {
    const facts = baseFacts({ toml: { status: 'loaded', matches: [], currencies: [] } });
    const warnings = getAssetRiskWarnings(facts, ASSET, t);
    expect(warnings).toContain('trading:assetSearch.risk.tomlAssetMissing');
  });
});

describe('StellarExpert directory helpers', () => {
  const expertFacts = (expert) => ({ ...baseFacts(), expert });

  it('flags a listed issuer whose tags include malicious or unsafe', () => {
    const facts = expertFacts({ status: 'listed', name: 'Fake', domain: '', tags: ['malicious', 'exchange'] });
    expect(isExpertFlagged(facts)).toBe(true);
    expect(getExpertWarningTags(facts)).toEqual(['malicious']);
  });

  it('does not flag a listed issuer with only descriptive tags like exchange/anchor', () => {
    const facts = expertFacts({ status: 'listed', name: 'Some Exchange', domain: '', tags: ['exchange'] });
    expect(isExpertFlagged(facts)).toBe(false);
  });

  it('does not flag when the entry is not listed, even if stale tags were somehow present', () => {
    const facts = expertFacts({ status: 'notListed', name: '', domain: '', tags: ['malicious'] });
    expect(isExpertFlagged(facts)).toBe(false);
  });

  it('tolerates facts objects without an expert section (older stubs)', () => {
    expect(isExpertFlagged(baseFacts())).toBe(false);
    expect(expertStatusLabel(baseFacts(), t)).toBe('trading:assetSearch.facts.expert.notChecked');
  });

  it('maps each status to its own label and appends tags to a listing', () => {
    expect(expertStatusLabel(expertFacts({ status: 'notListed', tags: [] }), t))
      .toBe('trading:assetSearch.facts.expert.notListed');
    expect(expertStatusLabel(expertFacts({ status: 'unavailable', tags: [] }), t))
      .toBe('trading:assetSearch.facts.expert.unavailable');
    expect(expertStatusLabel(expertFacts({ status: 'listed', name: 'X', tags: ['exchange'] }), t))
      .toBe('trading:assetSearch.facts.expert.listedAs (exchange)');
  });
});
