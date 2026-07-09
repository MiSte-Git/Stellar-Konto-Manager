const test = require('node:test');
const assert = require('node:assert/strict');
const dns = require('dns');
const StellarSdk = require('@stellar/stellar-sdk');
const {
  searchAssets,
  fetchAssetFacts,
  fetchExpertDirectoryEntry,
  parseCurrencySectionsFromToml,
  assertSafeScheme,
  ssrfSafeLookup,
  readTextWithLimit,
  MAX_TOML_RESPONSE_BYTES,
  classifyTomlError,
} = require('../services/tradeService.js');

function lookupAsync(hostname) {
  return new Promise((resolve, reject) => {
    ssrfSafeLookup(hostname, {}, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });
}

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

function makeFactsHorizon({ issuer, homeDomain = 'example.org', flags = {}, signerWeight = 0, signers, thresholds }) {
  return {
    async loadAccount(accountId) {
      assert.equal(accountId, issuer);
      return {
        account_id: issuer,
        home_domain: homeDomain,
        flags,
        signers: signers || [{ key: issuer, weight: signerWeight }],
        thresholds: thresholds || { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
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
    claimableBalancesAmount: '',
    liquidityPoolsAmount: '',
    contractsAmount: '',
    pagingToken: 'abc',
  }]);
});

test('searchAssets captures claimable-balance, liquidity-pool, and contract amounts from the Horizon record (not just the trustline total)', async () => {
  const issuer = makeIssuer();
  const horizon = makeAssetSearchHorizon([
    {
      asset_code: 'USDC',
      asset_issuer: issuer,
      amount: '1000.0000000',
      num_accounts: 12,
      claimable_balances_amount: '50.0000000',
      liquidity_pools_amount: '20.0000000',
      contracts_amount: '5.0000000',
      paging_token: 'abc',
    },
  ]);

  const result = await searchAssets({ assetCode: 'USDC', horizon, limit: 30 });

  assert.equal(result[0].claimableBalancesAmount, '50.0000000');
  assert.equal(result[0].liquidityPoolsAmount, '20.0000000');
  assert.equal(result[0].contractsAmount, '5.0000000');
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
  assert.deepEqual(facts.issuerAccount.thresholds, { low_threshold: 1, med_threshold: 2, high_threshold: 3 });
  assert.equal(facts.toml.status, 'loaded');
  assert.equal(facts.toml.currencies.length, 1);
  assert.equal(facts.toml.matches.length, 1);
  assert.deepEqual(facts.toml.matches[0].conditions, ['one', 'two # stays inside']);
});

test('fetchAssetFacts matches stellar.toml CURRENCIES case-sensitively (Stellar asset codes are case-sensitive)', async (t) => {
  const issuer = makeIssuer();
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  global.fetch = async () => ({
    ok: true,
    async text() {
      return `
        [[CURRENCIES]]
        code = "usdc"
        issuer = "${issuer}"
      `;
    },
  });

  const facts = await fetchAssetFacts({
    assetCode: 'USDC',
    issuer,
    horizon: makeFactsHorizon({ issuer }),
  });

  assert.equal(facts.toml.status, 'loaded');
  assert.equal(facts.toml.currencies.length, 1, 'the toml entry is still parsed and listed');
  assert.equal(facts.toml.matches.length, 0, 'but "usdc" must not confirm a search for "USDC" - they are different assets');
});

test('fetchAssetFacts passes through the issuer account thresholds unchanged', async (t) => {
  const issuer = makeIssuer();
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  global.fetch = async () => {
    throw new Error('fetch should not be called');
  };

  const facts = await fetchAssetFacts({
    assetCode: 'USDC',
    issuer,
    horizon: makeFactsHorizon({
      issuer,
      homeDomain: '',
      thresholds: { low_threshold: 5, med_threshold: 10, high_threshold: 20 },
    }),
  });

  assert.deepEqual(facts.issuerAccount.thresholds, { low_threshold: 5, med_threshold: 10, high_threshold: 20 });
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

test('fetchAssetFacts reports TOML fetch failure as fact, classified as "notFound" for a 404', async (t) => {
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
  assert.equal(facts.toml.error, 'notFound');
});

test('fetchAssetFacts classifies a non-404 HTTP failure as "httpError"', async (t) => {
  const issuer = makeIssuer();
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  global.fetch = async () => ({
    ok: false,
    status: 500,
    async text() { return ''; },
  });

  const facts = await fetchAssetFacts({
    assetCode: 'USDC',
    issuer,
    horizon: makeFactsHorizon({ issuer }),
  });

  assert.equal(facts.toml.status, 'failed');
  assert.equal(facts.toml.error, 'httpError');
});

test('fetchAssetFacts classifies an HTML error/block page served instead of the TOML as "invalidFormat"', async (t) => {
  const issuer = makeIssuer();
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    async text() { return '<!DOCTYPE html><html><body>Blocked</body></html>'; },
  });

  const facts = await fetchAssetFacts({
    assetCode: 'USDC',
    issuer,
    horizon: makeFactsHorizon({ issuer }),
  });

  assert.equal(facts.toml.status, 'failed');
  assert.equal(facts.toml.error, 'invalidFormat');
});

test('fetchAssetFacts classifies genuinely malformed (non-HTML) TOML content as "invalidFormat"', async (t) => {
  const issuer = makeIssuer();
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    async text() { return 'this is not [valid toml at all ==='; },
  });

  const facts = await fetchAssetFacts({
    assetCode: 'USDC',
    issuer,
    horizon: makeFactsHorizon({ issuer }),
  });

  assert.equal(facts.toml.status, 'failed');
  assert.equal(facts.toml.error, 'invalidFormat');
});

test('fetchAssetFacts classifies a home_domain pointing at a private/internal address as "blocked" (SSRF guard), without ever calling fetch', async (t) => {
  const issuer = makeIssuer();
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  global.fetch = async () => {
    throw new Error('fetch should not be called - assertSafeScheme must reject first');
  };

  const facts = await fetchAssetFacts({
    assetCode: 'USDC',
    issuer,
    horizon: makeFactsHorizon({ issuer, homeDomain: '169.254.169.254' }),
  });

  assert.equal(facts.toml.status, 'failed');
  assert.equal(facts.toml.error, 'blocked');
});

test('fetchAssetFacts classifies a connection-level failure (e.g. connection refused) as "connectionError"', async (t) => {
  const issuer = makeIssuer();
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  global.fetch = async () => {
    const err = new TypeError('fetch failed');
    err.cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    throw err;
  };

  const facts = await fetchAssetFacts({
    assetCode: 'USDC',
    issuer,
    horizon: makeFactsHorizon({ issuer }),
  });

  assert.equal(facts.toml.status, 'failed');
  assert.equal(facts.toml.error, 'connectionError');
});

test('fetchAssetFacts classifies an aborted (timed-out) fetch as "timeout"', async (t) => {
  const issuer = makeIssuer();
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  global.fetch = async () => {
    const err = new Error('This operation was aborted');
    err.name = 'AbortError';
    throw err;
  };

  const facts = await fetchAssetFacts({
    assetCode: 'USDC',
    issuer,
    horizon: makeFactsHorizon({ issuer }),
  });

  assert.equal(facts.toml.status, 'failed');
  assert.equal(facts.toml.error, 'timeout');
});

// --- classifyTomlError() unit coverage: every branch in isolation, without
// needing to drive a full fetchAssetFacts() call per case. --------------

test('classifyTomlError maps every known internal failure to its public category', () => {
  assert.equal(classifyTomlError(Object.assign(new Error('aborted'), { name: 'AbortError' })), 'timeout');
  assert.equal(classifyTomlError(Object.assign(new Error('bad syntax'), { name: 'SyntaxError' })), 'invalidFormat');
  assert.equal(classifyTomlError(new Error('toml.invalidFormat')), 'invalidFormat');
  assert.equal(classifyTomlError(new Error('HTTP 404')), 'notFound');
  assert.equal(classifyTomlError(new Error('HTTP 500')), 'httpError');
  assert.equal(classifyTomlError(new Error('HTTP 403')), 'httpError');
  assert.equal(classifyTomlError(new Error('ssrf.blocked:privateAddress')), 'blocked');
  assert.equal(classifyTomlError(new Error('ssrf.blocked:scheme')), 'blocked');
  assert.equal(classifyTomlError(new Error('ssrf.blocked:invalidUrl')), 'blocked');
  assert.equal(classifyTomlError(new Error('ssrf.blocked:tooManyRedirects')), 'blocked');
  assert.equal(classifyTomlError(new Error('ssrf.blocked:responseTooLarge')), 'blocked');
  assert.equal(classifyTomlError(new Error('ssrf.blocked:localhost')), 'blocked');
  assert.equal(classifyTomlError(new Error('ssrf.blocked:dnsLookupFailed')), 'connectionError');
  assert.equal(classifyTomlError(new Error('ssrf.blocked:noAddress')), 'connectionError');

  const dnsViaFetchFailed = new TypeError('fetch failed');
  dnsViaFetchFailed.cause = new Error('ssrf.blocked:dnsLookupFailed');
  assert.equal(classifyTomlError(dnsViaFetchFailed), 'connectionError');

  const privateAddressViaFetchFailed = new TypeError('fetch failed');
  privateAddressViaFetchFailed.cause = new Error('ssrf.blocked:privateAddress');
  assert.equal(classifyTomlError(privateAddressViaFetchFailed), 'blocked');

  const connRefused = new TypeError('fetch failed');
  connRefused.cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
  assert.equal(classifyTomlError(connRefused), 'connectionError');

  const timedOut = new TypeError('fetch failed');
  timedOut.cause = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' });
  assert.equal(classifyTomlError(timedOut), 'timeout');

  assert.equal(classifyTomlError(new TypeError('fetch failed')), 'connectionError');
  assert.equal(classifyTomlError(new Error('something unexpected')), 'fetchFailed');
  assert.equal(classifyTomlError(undefined), 'fetchFailed');
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

// --- N1: literal-IP hosts bypass DNS resolution entirely (net.isIP()
// short-circuits before a custom connect.lookup ever runs), so they must be
// validated in assertSafeScheme() instead of relying on ssrfSafeLookup(). ---

test('assertSafeScheme rejects an invalid URL', () => {
  assert.throws(() => assertSafeScheme('not a url'), /ssrf\.blocked:invalidUrl/);
});

test('assertSafeScheme rejects a non-http(s) scheme', () => {
  assert.throws(() => assertSafeScheme('file:///etc/passwd'), /ssrf\.blocked:scheme/);
});

test('assertSafeScheme rejects a literal loopback IPv4 host', () => {
  assert.throws(() => assertSafeScheme('http://127.0.0.1/x'), /ssrf\.blocked:privateAddress/);
});

test('assertSafeScheme rejects a literal cloud-metadata IPv4 host', () => {
  assert.throws(() => assertSafeScheme('http://169.254.169.254/latest/meta-data/'), /ssrf\.blocked:privateAddress/);
});

test('assertSafeScheme rejects a literal bracketed IPv6 loopback host', () => {
  assert.throws(() => assertSafeScheme('http://[::1]/x'), /ssrf\.blocked:privateAddress/);
});

test('assertSafeScheme accepts a literal public IPv4 host', () => {
  assert.doesNotThrow(() => assertSafeScheme('http://203.0.113.10/x'));
});

test('assertSafeScheme accepts a normal hostname-based https URL', () => {
  assert.doesNotThrow(() => assertSafeScheme('https://example.org/.well-known/stellar.toml'));
});

// --- N1: SSRF-safe lookup is the single resolution point (no DNS-rebinding
// TOCTOU gap between a "check" lookup and a separate "connect" lookup) -----

test('ssrfSafeLookup rejects "localhost" in any spelling without ever calling dns.lookup', async (t) => {
  let called = false;
  t.mock.method(dns, 'lookup', () => { called = true; });
  await assert.rejects(() => lookupAsync('localhost'), /ssrf\.blocked:localhost/);
  await assert.rejects(() => lookupAsync('sub.localhost'), /ssrf\.blocked:localhost/);
  assert.equal(called, false);
});

test('ssrfSafeLookup performs exactly one dns.lookup call and rejects a private resolved address', async (t) => {
  let callCount = 0;
  t.mock.method(dns, 'lookup', (host, options, callback) => {
    callCount += 1;
    callback(null, [{ address: '169.254.169.254', family: 4 }]); // cloud metadata address
  });

  await assert.rejects(() => lookupAsync('rebinding.example'), /ssrf\.blocked:privateAddress/);
  assert.equal(callCount, 1, 'exactly one resolution happens - there is no separate check-lookup to rebind against');
});

test('ssrfSafeLookup passes through a validated public address as the sole result used for the connection', async (t) => {
  let callCount = 0;
  t.mock.method(dns, 'lookup', (host, options, callback) => {
    callCount += 1;
    callback(null, [{ address: '203.0.113.10', family: 4 }]);
  });

  const addresses = await lookupAsync('good.example');
  assert.equal(callCount, 1);
  assert.deepEqual(addresses, [{ address: '203.0.113.10', family: 4 }]);
});

test('ssrfSafeLookup rejects if any of several resolved addresses is private, even if others are public', async (t) => {
  t.mock.method(dns, 'lookup', (host, options, callback) => {
    callback(null, [
      { address: '203.0.113.10', family: 4 },
      { address: '10.0.0.5', family: 4 }, // private - poisons the whole result
    ]);
  });

  await assert.rejects(() => lookupAsync('mixed.example'), /ssrf\.blocked:privateAddress/);
});

test('ssrfSafeLookup rejects an IPv6 loopback/link-local resolved address', async (t) => {
  t.mock.method(dns, 'lookup', (host, options, callback) => {
    callback(null, [{ address: '::1', family: 6 }]);
  });
  await assert.rejects(() => lookupAsync('v6.example'), /ssrf\.blocked:privateAddress/);
});

test('ssrfSafeLookup surfaces a DNS resolution failure as a blocked error, not a raw exception', async (t) => {
  t.mock.method(dns, 'lookup', (host, options, callback) => {
    callback(new Error('ENOTFOUND'));
  });
  await assert.rejects(() => lookupAsync('missing.example'), /ssrf\.blocked:dnsLookupFailed/);
});

// --- N2: response size limit on TOML/JSON fetches --------------------------

function makeStreamedResponse(chunks, { contentLength } = {}) {
  let index = 0;
  return {
    ok: true,
    headers: { get: (name) => (name === 'content-length' ? contentLength : null) },
    body: {
      getReader() {
        return {
          async read() {
            if (index >= chunks.length) return { done: true, value: undefined };
            const value = chunks[index];
            index += 1;
            return { done: false, value };
          },
          async cancel() { index = chunks.length; },
        };
      },
    },
    async text() { throw new Error('text() should not be used when a streaming body is present'); },
  };
}

test('readTextWithLimit rejects upfront based on a declared Content-Length over the limit', async () => {
  const response = makeStreamedResponse([], { contentLength: String(MAX_TOML_RESPONSE_BYTES + 1) });
  await assert.rejects(() => readTextWithLimit(response, MAX_TOML_RESPONSE_BYTES), /ssrf\.blocked:responseTooLarge/);
});

test('readTextWithLimit rejects a streamed body that exceeds the limit even without Content-Length', async () => {
  const bigChunk = Buffer.alloc(1000, 'a');
  const response = makeStreamedResponse([bigChunk, bigChunk]); // no content-length header at all
  await assert.rejects(() => readTextWithLimit(response, 1500), /ssrf\.blocked:responseTooLarge/);
});

test('readTextWithLimit returns the full text when under the limit', async () => {
  const response = makeStreamedResponse([Buffer.from('hello '), Buffer.from('world')]);
  const text = await readTextWithLimit(response, MAX_TOML_RESPONSE_BYTES);
  assert.equal(text, 'hello world');
});

test('readTextWithLimit falls back to response.text() for a response with no streaming body (e.g. a simple mock)', async () => {
  const response = { ok: true, async text() { return 'plain body'; } };
  const text = await readTextWithLimit(response, MAX_TOML_RESPONSE_BYTES);
  assert.equal(text, 'plain body');
});

// --- StellarExpert directory hint -------------------------------------------
// Note: the service keeps a module-level cache keyed by issuer, and the test
// runner shares module state across files (--test-isolation=none), so every
// test below uses its own freshly generated issuer key.

test('fetchExpertDirectoryEntry returns a listed entry with normalized tags (leading # stripped, lowercased)', async (t) => {
  const issuer = makeIssuer();
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  global.fetch = async (url) => {
    assert.equal(url, `https://api.stellar.expert/explorer/directory/${issuer}`);
    return {
      ok: true,
      status: 200,
      async json() {
        return { address: issuer, name: 'Fake Anchor', domain: 'fake.example', tags: ['#Malicious', '#unsafe'] };
      },
    };
  };

  const entry = await fetchExpertDirectoryEntry({ issuer, network: 'PUBLIC' });

  assert.equal(entry.status, 'listed');
  assert.equal(entry.name, 'Fake Anchor');
  assert.equal(entry.domain, 'fake.example');
  assert.deepEqual(entry.tags, ['malicious', 'unsafe']);
});

test('fetchExpertDirectoryEntry treats HTTP 200 with an empty object as "not listed", not "listed" - this is how the real API actually answers for unlisted accounts (verified live against api.stellar.expert), not with a 404', async (t) => {
  const issuer = makeIssuer();
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  global.fetch = async () => ({ ok: true, status: 200, async json() { return {}; } });

  const entry = await fetchExpertDirectoryEntry({ issuer, network: 'PUBLIC' });

  assert.equal(entry.status, 'notListed');
  assert.equal(entry.name, '');
  assert.deepEqual(entry.tags, []);
});

test('fetchExpertDirectoryEntry treats a 404 as the normal "not listed" answer, not a failure', async (t) => {
  const issuer = makeIssuer();
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  global.fetch = async () => ({ ok: false, status: 404, async json() { return {}; } });

  const entry = await fetchExpertDirectoryEntry({ issuer, network: 'PUBLIC' });

  assert.equal(entry.status, 'notListed');
  assert.deepEqual(entry.tags, []);
});

test('fetchExpertDirectoryEntry degrades to "unavailable" on a rate-limit response instead of throwing', async (t) => {
  const issuer = makeIssuer();
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  global.fetch = async () => ({ ok: false, status: 429, async json() { return {}; } });

  const entry = await fetchExpertDirectoryEntry({ issuer, network: 'PUBLIC' });

  assert.equal(entry.status, 'unavailable');
});

test('fetchExpertDirectoryEntry degrades to "unavailable" on a network error instead of throwing', async (t) => {
  const issuer = makeIssuer();
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  global.fetch = async () => { throw new Error('ECONNRESET'); };

  const entry = await fetchExpertDirectoryEntry({ issuer, network: 'PUBLIC' });

  assert.equal(entry.status, 'unavailable');
});

test('fetchExpertDirectoryEntry skips the upstream call entirely on testnet (directory covers the public network only)', async (t) => {
  const issuer = makeIssuer();
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  global.fetch = async () => { throw new Error('fetch should not be called for TESTNET'); };

  const entry = await fetchExpertDirectoryEntry({ issuer, network: 'TESTNET' });

  assert.equal(entry.status, 'notChecked');
});

test('fetchExpertDirectoryEntry rejects an invalid issuer address', async () => {
  await assert.rejects(
    () => fetchExpertDirectoryEntry({ issuer: 'not-an-issuer', network: 'PUBLIC' }),
    /assetSearch\.invalidInput:issuerInvalid/
  );
});

test('fetchExpertDirectoryEntry serves repeat lookups for the same issuer from the cache (one upstream call)', async (t) => {
  const issuer = makeIssuer();
  const previousFetch = global.fetch;
  t.after(() => { global.fetch = previousFetch; });
  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;
    return { ok: false, status: 404, async json() { return {}; } };
  };

  const first = await fetchExpertDirectoryEntry({ issuer, network: 'PUBLIC' });
  const second = await fetchExpertDirectoryEntry({ issuer, network: 'PUBLIC' });

  assert.equal(first.status, 'notListed');
  assert.equal(second.status, 'notListed');
  assert.equal(callCount, 1);
});
