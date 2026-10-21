// Tests for services/federationService.js (SEP-2 via backend, Backlog P1.2).
// The request cases live in test/assets/federationCases.json and are run
// unchanged by test/federationService.test.php against the PHP twin, so both
// backends are held to exactly the same behavior.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const fed = require('../services/federationService.js');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'federationCases.json'), 'utf8'));

function canonicalUrl(raw) {
  const url = new URL(raw);
  const params = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  const query = params.map(([k, v]) => `${k}=${v}`).join('&');
  return `${url.origin}${url.pathname}${query ? `?${query}` : ''}`;
}

function fakeFetch(responses, calls) {
  const byUrl = new Map(Object.entries(responses).map(([k, v]) => [canonicalUrl(k), v]));
  return async (url) => {
    calls.push(url);
    assert.ok(url.startsWith('https://'), `only https is ever requested (${url})`);
    const response = byUrl.get(canonicalUrl(url));
    if (!response) throw new Error('connection_error');
    if (response.error) throw new Error(response.error);
    if (response.json !== undefined) return JSON.stringify(response.json);
    return response.text;
  };
}

function homeDomainLoader(value) {
  return async () => {
    if (value && typeof value === 'object' && value.error) throw new Error(value.error);
    return value ?? '';
  };
}

for (const c of fixture.cases) {
  test(`shared case: ${c.description}`, async () => {
    const calls = [];
    const result = await fed.handleFederationRequest(c.query, {
      fetchText: fakeFetch(c.responses, calls),
      loadHomeDomain: homeDomainLoader(c.homeDomain),
    });
    assert.deepEqual(result, c.expect);
  });
}

test('shared account id cases match the SDK strkey check', () => {
  const StellarSdk = require('@stellar/stellar-sdk');
  for (const id of fixture.accounts.valid) assert.equal(StellarSdk.StrKey.isValidEd25519PublicKey(id), true, id);
  for (const id of fixture.accounts.invalid) assert.equal(StellarSdk.StrKey.isValidEd25519PublicKey(id), false, id);
});

test('reverse lookup never asks for a stellar.toml other than the home_domain one', async () => {
  const c = fixture.cases.find((x) => x.description.startsWith('reverse: stellar_address on another domain'));
  const calls = [];
  await fed.handleFederationRequest(c.query, { fetchText: fakeFetch(c.responses, calls), loadHomeDomain: homeDomainLoader(c.homeDomain) });
  assert.equal(calls.some((u) => u.includes('evil.com')), false);
});

test('reverse lookup takes home_domain from the loader (Horizon), the network query param is not trusted for it', async () => {
  let asked = null;
  const result = await fed.handleFederationRequest(
    { type: 'id', q: fixture.accounts.valid[0], home_domain: 'evil.com' },
    { fetchText: async () => { throw new Error('unreachable'); }, loadHomeDomain: async (id) => { asked = id; return ''; } },
  );
  assert.equal(asked, fixture.accounts.valid[0]);
  assert.deepEqual(result.body, { ok: true, found: false });
});

test('query params must be strings (Express can hand over arrays)', async () => {
  const result = await fed.handleFederationRequest({ type: 'name', q: ['alice*example.com'] }, { fetchText: async () => '' });
  assert.deepEqual(result, { status: 400, body: { ok: false, error: 'federation.invalidInput' } });
});

test('safeFetchText refuses http before any connection attempt', async () => {
  await assert.rejects(fed.safeFetchText('http://example.com/.well-known/stellar.toml', { accept: '*/*', maxBytes: 10 }), /ssrf\.blocked:scheme/);
  await assert.rejects(fed.safeFetchText('ftp://example.com/x', { accept: '*/*', maxBytes: 10 }), /ssrf\.blocked:scheme/);
});

test('safeFetchText refuses private and loopback IP literals', async () => {
  await assert.rejects(fed.safeFetchText('https://127.0.0.1/x', { accept: '*/*', maxBytes: 10 }), /ssrf\.blocked:privateAddress/);
  await assert.rejects(fed.safeFetchText('https://169.254.169.254/x', { accept: '*/*', maxBytes: 10 }), /ssrf\.blocked:privateAddress/);
});

test('limits: 5 s timeout per request, small response caps', () => {
  assert.equal(fed.FEDERATION_FETCH_TIMEOUT_MS, 5000);
  assert.equal(fed.MAX_TOML_BYTES, 256 * 1024);
  assert.equal(fed.MAX_FEDERATION_RESPONSE_BYTES, 64 * 1024);
});

test('PHP twin uses the same hostname pattern, limits and memo types', () => {
  const php = fs.readFileSync(path.join(__dirname, '..', 'api', 'federationService.php'), 'utf8');
  const m = php.match(/const FEDERATION_HOSTNAME_RE = '\/(.*)\/';/);
  assert.ok(m);
  assert.equal(m[1], fed.HOSTNAME_RE.source);
  assert.match(php, /const FEDERATION_FETCH_TIMEOUT_SECONDS = 5;/);
  assert.match(php, /const FEDERATION_MAX_TOML_BYTES = 256 \* 1024;/);
  assert.match(php, /const FEDERATION_MAX_RESPONSE_BYTES = 64 \* 1024;/);
  assert.match(php, /'httpsOnly' => true,\s*'maxRedirects' => 0,/);
});

test('server.js exposes /api/federation with its own rate limit, api/.htaccess routes it to PHP', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /app\.get\('\/api\/federation', refuseFederationHop, federationLimiter, /);
  assert.match(server, /const federationLimiter = rateLimit\(\{\s*windowMs: 60 \* 1000,\s*limit: 30,/);
  const htaccess = fs.readFileSync(path.join(__dirname, '..', 'api', '.htaccess'), 'utf8');
  assert.match(htaccess, /RewriteRule \^federation\$ \/api\/federation\.php \[L,QSA\]/);
  const endpoint = fs.readFileSync(path.join(__dirname, '..', 'api', 'federation.php'), 'utf8');
  assert.match(endpoint, /federation_rate_limit_check_and_record\(/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'api', 'federationService.php'), 'utf8'), /const FEDERATION_RATE_LIMIT_MAX = 30;/);
});

test('loop guard: an incoming request marked as a federation hop is refused without any lookup', async () => {
  let fetched = false;
  const result = await fed.handleFederationRequest({ type: 'name', q: 'alice*example.com' }, {
    incomingHop: true,
    fetchText: async () => { fetched = true; return ''; },
  });
  assert.deepEqual(result, { status: 508, body: { ok: false, error: 'federation.loopDetected' } });
  assert.equal(fetched, false);
});

test('loop guard: outbound requests carry the hop header, server.js checks it before the rate limit', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'federationService.js'), 'utf8');
  assert.match(src, /headers: \{ accept, \[HOP_HEADER\]: '1' \}/);
  assert.equal(fed.HOP_HEADER, 'x-skm-federation-hop');
  const php = fs.readFileSync(path.join(__dirname, '..', 'api', 'federationService.php'), 'utf8');
  assert.match(php, /const FEDERATION_HOP_HEADER = 'X-SKM-Federation-Hop';/);
  assert.match(php, /'headers' => \[FEDERATION_HOP_HEADER \. ': 1'\]/);
  const endpoint = fs.readFileSync(path.join(__dirname, '..', 'api', 'federation.php'), 'utf8');
  assert.ok(endpoint.indexOf("HTTP_X_SKM_FEDERATION_HOP") < endpoint.indexOf('federation_rate_limit_check_and_record('), 'PHP: hop check before rate limit');
});
