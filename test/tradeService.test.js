const test = require('node:test');
const assert = require('node:assert/strict');
const StellarSdk = require('@stellar/stellar-sdk');
const {
  searchAssets,
  fetchAssetFacts,
  parseCurrencySectionsFromToml,
} = require('../services/tradeService.js');

function makeIssuer() {
  return StellarSdk.Keypair.random().publicKey();
}

function makeAssetSearchHorizon(recordsOrResolver) {
  const calls = [];
  return {
    calls,
    assets() {
      const state = { limit: null, code: '', issuer: '' };
      return {
        limit(value) {
          state.limit = value;
          calls.push(['limit', value]);
          return this;
        },
        forCode(value) {
          state.code = value;
          calls.push(['forCode', value]);
          return this;
        },
        forIssuer(value) {
          state.issuer = value;
          calls.push(['forIssuer', value]);
          return this;
        },
        async call() {
          const records = typeof recordsOrResolver === 'function'
            ? recordsOrResolver(state)
            : recordsOrResolver;
          return { records };
        },
      };
    },
  };
}

function makeFactsHorizon({ issuer, homeDomain = 'example.org', flags = {}, signerWeight = 0 }) {
  return {
    async loadAccount(accountId) {
      assert.equal(accountId, issuer);
      return {
        account_id: issuer,
        home_domain: homeDomain,
        flags,
        signers: [{ key: issuer, weight: signerWeight }],
      };
    },
  };
}

test('searchAssets searches by asset code', async () => {
  const issuer = makeIssuer();
  const horizon = makeAssetSearchHorizon([
    {
      asset_code: 'USDC',
      asset_issuer: issuer,
      amount: '1000.0000000',
      num_accounts: 12,
      paging_token: 'abc',
    },
  ]);

  const result = await searchAssets({ assetCode: 'USDC', horizon, limit: 30 });

  assert.deepEqual(horizon.calls, [['limit', 30], ['forCode', 'USDC'], ['limit', 30], ['forCode', 'usdc']]);
  assert.deepEqual(result, [{
    assetCode: 'USDC',
    assetIssuer: issuer,
    amount: '1000.0000000',
    numAccounts: 12,
    pagingToken: 'abc',
  }]);
});

test('searchAssets searches by issuer address', async () => {
  const issuer = makeIssuer();
  const horizon = makeAssetSearchHorizon([]);

  await searchAssets({ issuer, horizon, limit: 5 });

  assert.deepEqual(horizon.calls, [['limit', 5], ['forIssuer', issuer]]);
});

test('searchAssets searches asset codes case-insensitively and deduplicates results', async () => {
  const upperIssuer = makeIssuer();
  const lowerIssuer = makeIssuer();
  const horizon = makeAssetSearchHorizon(({ code }) => {
    if (code === 'USDC') {
      return [
        {
          asset_code: 'USDC',
          asset_issuer: upperIssuer,
          amount: '1000.0000000',
          num_accounts: 12,
          paging_token: 'upper',
        },
      ];
    }
    if (code === 'usdc') {
      return [
        {
          asset_code: 'usdc',
          asset_issuer: lowerIssuer,
          amount: '5.0000000',
          num_accounts: 2,
          paging_token: 'lower',
        },
        {
          asset_code: 'USDC',
          asset_issuer: upperIssuer,
          amount: '1000.0000000',
          num_accounts: 12,
          paging_token: 'upper-duplicate',
        },
      ];
    }
    return [];
  });

  const result = await searchAssets({ assetCode: 'usdc', horizon, limit: 30 });

  assert.deepEqual(horizon.calls, [['limit', 30], ['forCode', 'usdc'], ['limit', 30], ['forCode', 'USDC']]);
  assert.deepEqual(result.map((item) => `${item.assetCode}:${item.assetIssuer}`), [
    `usdc:${lowerIssuer}`,
    `USDC:${upperIssuer}`,
  ]);
});

test('searchAssets formats split Horizon amount objects', async () => {
  const issuer = makeIssuer();
  const horizon = makeAssetSearchHorizon([
    {
      asset_code: 'USDC',
      asset_issuer: issuer,
      amount: {
        authorized: '10.5000000',
        authorized_to_maintain_liabilities: '2.2500000',
        unauthorized: '1.0000000',
      },
      num_accounts: {
        authorized: 10,
        authorized_to_maintain_liabilities: 2,
        unauthorized: 1,
      },
      paging_token: 'split',
    },
  ]);

  const result = await searchAssets({ assetCode: 'USDC', horizon, limit: 10 });

  assert.equal(result[0].amount, '13.75');
  assert.equal(result[0].numAccounts, 13);
});

test('searchAssets accepts Horizon balances fallback and zero split values', async () => {
  const issuer = makeIssuer();
  const horizon = makeAssetSearchHorizon([
    {
      asset_code: 'EURC',
      asset_issuer: issuer,
      balances: {
        authorized: '0.0000000',
        authorized_to_maintain_liabilities: '0.0000000',
        unauthorized: '0.0000000',
      },
      accounts: {
        authorized: 0,
        authorized_to_maintain_liabilities: 0,
        unauthorized: 0,
      },
      paging_token: 'zero',
    },
  ]);

  const result = await searchAssets({ assetCode: 'EURC', horizon, limit: 10 });

  assert.equal(result[0].amount, '0');
  assert.equal(result[0].numAccounts, 0);
});

test('searchAssets prefers modern Horizon accounts and balances over legacy fields', async () => {
  const issuer = makeIssuer();
  const horizon = makeAssetSearchHorizon([
    {
      asset_code: 'USDC',
      asset_issuer: issuer,
      amount: '0.0000000',
      num_accounts: 20,
      balances: {
        authorized: '20000000.0000000',
        authorized_to_maintain_liabilities: '125.0000000',
        unauthorized: '5.0000000',
      },
      accounts: {
        authorized: 2000000,
        authorized_to_maintain_liabilities: 20,
        unauthorized: 3,
      },
      paging_token: 'modern',
    },
  ]);

  const result = await searchAssets({ assetCode: 'USDC', horizon, limit: 10 });

  assert.equal(result[0].amount, '20000130');
  assert.equal(result[0].numAccounts, 2000023);
});

test('fetchAssetFacts loads issuer facts and matches stellar.toml currency', async (t) => {
  const issuer = makeIssuer();
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  global.fetch = async (url) => {
    assert.equal(url, 'https://example.org/.well-known/stellar.toml');
    return {
      ok: true,
      async text() {
        return `
          [[CURRENCIES]]
          code = "USDC"
          issuer = "${issuer}"
          conditions = ["one", "two # stays inside"]
        `;
      },
    };
  };

  const facts = await fetchAssetFacts({
    assetCode: 'USDC',
    issuer,
    horizon: makeFactsHorizon({
      issuer,
      flags: { auth_required: true, auth_clawback_enabled: true },
      signerWeight: 0,
    }),
  });

  assert.equal(facts.issuerAccount.homeDomain, 'example.org');
  assert.equal(facts.issuerAccount.issuerMasterWeight, 0);
  assert.equal(facts.issuerAccount.flags.auth_required, true);
  assert.equal(facts.issuerAccount.flags.auth_clawback_enabled, true);
  assert.equal(facts.toml.status, 'loaded');
  assert.equal(facts.toml.currencies.length, 1);
  assert.equal(facts.toml.matches.length, 1);
  assert.deepEqual(facts.toml.matches[0].conditions, ['one', 'two # stays inside']);
});

test('fetchAssetFacts reports loaded TOML without asset match', async (t) => {
  const issuer = makeIssuer();
  const otherIssuer = makeIssuer();
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  global.fetch = async () => ({
    ok: true,
    async text() {
      return `
        [[CURRENCIES]]
        code = "EURC"
        issuer = "${otherIssuer}"
      `;
    },
  });

  const facts = await fetchAssetFacts({
    assetCode: 'USDC',
    issuer,
    horizon: makeFactsHorizon({ issuer }),
  });

  assert.equal(facts.toml.status, 'loaded');
  assert.equal(facts.toml.currencies.length, 1);
  assert.equal(facts.toml.matches.length, 0);
});

test('fetchAssetFacts reports noHomeDomain without fetching TOML', async (t) => {
  const issuer = makeIssuer();
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  global.fetch = async () => {
    throw new Error('fetch should not be called');
  };

  const facts = await fetchAssetFacts({
    assetCode: 'USDC',
    issuer,
    horizon: makeFactsHorizon({ issuer, homeDomain: '' }),
  });

  assert.equal(facts.issuerAccount.homeDomain, '');
  assert.equal(facts.toml.status, 'noHomeDomain');
  assert.equal(facts.toml.url, '');
});

test('fetchAssetFacts reports TOML fetch failure as fact', async (t) => {
  const issuer = makeIssuer();
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  global.fetch = async () => ({
    ok: false,
    status: 404,
    async text() {
      return '';
    },
  });

  const facts = await fetchAssetFacts({
    assetCode: 'USDC',
    issuer,
    horizon: makeFactsHorizon({ issuer }),
  });

  assert.equal(facts.toml.status, 'failed');
  assert.equal(facts.toml.error, 'HTTP 404');
});

test('fetchAssetFacts rejects invalid issuer address', async () => {
  await assert.rejects(
    () => fetchAssetFacts({
      assetCode: 'USDC',
      issuer: 'not-an-issuer',
      horizon: makeFactsHorizon({ issuer: makeIssuer() }),
    }),
    /assetSearch\.invalidInput:issuerInvalid/
  );
});

test('parseCurrencySectionsFromToml parses real TOML structures', () => {
  const issuer = makeIssuer();
  const currencies = parseCurrencySectionsFromToml(`
    [[CURRENCIES]]
    code = "USDC"
    issuer = "${issuer}"
    is_asset_anchored = true
    conditions = ["one", "two # inside"]

    [DOCUMENTATION]
    ORG_NAME = "Example"
  `);

  assert.equal(currencies.length, 1);
  assert.equal(currencies[0].code, 'USDC');
  assert.equal(currencies[0].issuer, issuer);
  assert.equal(currencies[0].is_asset_anchored, true);
  assert.deepEqual(currencies[0].conditions, ['one', 'two # inside']);
});
