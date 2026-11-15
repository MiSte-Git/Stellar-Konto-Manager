// F-7 (Node): SSRF-Schutz an einer Stelle (services/ssrfGuard.js, Gegenstueck zu api/ssrfGuard.php), gegen die
// gemeinsame Fixture test/assets/ssrf-addresses.json (gleiche Faelle in test/ssrfGuard.test.php).
// - Adressen werden binaer geprueft (net.isIP plus Bytes), nicht per Text.
// - IPv4-mapped und IPv4-compatible gelten wie ihre IPv4-Adresse, auch in Hex-Schreibweise.
// - 100.64.0.0/10, 198.18.0.0/15, 64:ff9b::/96 und 64:ff9b:1::/48 sind gesperrt.
// - Gilt fuer literale Hosts (assertSafeScheme) und fuer DNS-Ergebnisse (ssrfSafeLookup), auch im
//   Federation-Abruf (gleiches Modul).
// - stellar.toml und jede von Hand verfolgte Weiterleitung nur ueber https.
const test = require('node:test');
const assert = require('node:assert/strict');
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const StellarSdk = require('@stellar/stellar-sdk');
const guard = require('../services/ssrfGuard.js');
const tradeService = require('../services/tradeService.js');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'ssrf-addresses.json'), 'utf8'));
const urlFor = (address) => (address.includes(':') ? `https://[${address}]/x` : `https://${address}/x`);
const lookupAsync = (hostname) => new Promise((resolve, reject) => {
  guard.ssrfSafeLookup(hostname, {}, (err, addresses) => (err ? reject(err) : resolve(addresses)));
});

test('Fixture enthaelt die geforderten Faelle', () => {
  const addresses = new Set(fixture.addresses.map((c) => c.address));
  for (const a of ['::ffff:127.0.0.1', '::ffff:7f00:1', '::7f00:1', '64:ff9b::7f00:1', '100.64.0.1', '198.18.0.1', '169.254.169.254',
    '::ffff:169.254.169.254', 'fe80::1', 'fc00::1', '::1', '::', '0.0.0.0', '8.8.8.8', '2606:4700::1111', '::ffff:8.8.8.8']) {
    assert.ok(addresses.has(a), a);
  }
});

for (const c of fixture.addresses) {
  test(`F-7 Adresse ${JSON.stringify(c.address)} -> ${c.blocked ? 'gesperrt' : 'erlaubt'}`, async (t) => {
    assert.equal(guard.isBlockedAddress(c.address), c.blocked, 'isBlockedAddress');
    if (c.url !== false) {
      if (c.blocked) assert.throws(() => guard.assertSafeScheme(urlFor(c.address)), /ssrf\.blocked:privateAddress/, 'literaler Host');
      else assert.doesNotThrow(() => guard.assertSafeScheme(urlFor(c.address)), 'literaler Host');
    }
    // Dieselbe Adresse als DNS-Ergebnis (ssrfSafeLookup, gilt auch fuer Federation).
    t.mock.method(dns, 'lookup', (host, options, callback) => callback(null, [{ address: c.address, family: c.address.includes(':') ? 6 : 4 }]));
    if (c.blocked) await assert.rejects(() => lookupAsync('target.example'), /ssrf\.blocked:privateAddress/);
    else assert.equal((await lookupAsync('target.example'))[0].address, c.address);
  });
}

for (const r of fixture.redirects) {
  test(`F-7 Weiterleitung ${r.current} + ${JSON.stringify(r.location)} -> ${r.result || r.error}`, () => {
    if (r.result) assert.equal(guard.nextRedirectUrl(r.current, r.location), r.result);
    else assert.throws(() => guard.nextRedirectUrl(r.current, r.location), r.error === 'scheme' ? /ssrf\.blocked:scheme/ : /ssrf\.blocked:redirectWithoutLocation/);
  });
}

test('F-7: assertSafeScheme normalisiert Hex und Dezimal im Host, bevor geprueft wird', () => {
  for (const url of ['http://[::ffff:127.0.0.1]:8080/x', 'https://[::ffff:7f00:1]/x', 'https://2130706433/x', 'https://0x7f.1/x', 'https://[64:ff9b::a9fe:a9fe]/x']) {
    assert.throws(() => guard.assertSafeScheme(url), /ssrf\.blocked:privateAddress/, url);
  }
});

test('F-7: tradeService und federationService nutzen dieselbe Stelle (services/ssrfGuard.js)', () => {
  assert.equal(tradeService.assertSafeScheme, guard.assertSafeScheme);
  assert.equal(tradeService.ssrfSafeLookup, guard.ssrfSafeLookup);
  assert.equal(tradeService.ssrfSafeAgent, guard.ssrfSafeAgent);
  const federationSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'federationService.js'), 'utf8');
  assert.match(federationSource, /require\('\.\/ssrfGuard\.js'\)/);
  assert.doesNotMatch(federationSource, /require\('\.\/tradeService\.js'\)/);
});

// --- stellar.toml nur ueber https, auch nach Weiterleitungen ---

const makeFactsHorizon = (issuer) => ({
  loadAccount: async () => ({ account_id: issuer, home_domain: 'issuer.example', flags: {}, signers: [{ key: issuer, weight: 1 }], thresholds: {} }),
});
const tomlBody = (issuer) => `ACCOUNTS=["${issuer}"]\n\n[[CURRENCIES]]\ncode="USDC"\nissuer="${issuer}"\n`;
const redirectResponse = (location) => ({ ok: false, status: 302, headers: { get: (h) => (h.toLowerCase() === 'location' ? location : null) } });
const okResponse = (body) => ({ ok: true, status: 200, headers: { get: () => null }, async text() { return body; } });

test('F-7: Weiterleitung der stellar.toml auf http wird gesperrt (blocked), kein zweiter Abruf', async (t) => {
  const issuer = StellarSdk.Keypair.random().publicKey();
  const previous = global.fetch;
  t.after(() => { global.fetch = previous; });
  const calls = [];
  global.fetch = async (url) => { calls.push(String(url)); return redirectResponse('http://issuer.example/.well-known/stellar.toml'); };
  const facts = await tradeService.fetchAssetFacts({ assetCode: 'USDC', issuer, horizon: makeFactsHorizon(issuer) });
  assert.equal(facts.toml.status, 'failed');
  assert.equal(facts.toml.error, 'blocked');
  assert.deepEqual(calls, ['https://issuer.example/.well-known/stellar.toml']);
});

test('F-7 Gegenprobe: Weiterleitung auf https wird verfolgt', async (t) => {
  const issuer = StellarSdk.Keypair.random().publicKey();
  const previous = global.fetch;
  t.after(() => { global.fetch = previous; });
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return calls.length === 1 ? redirectResponse('https://cdn.example/stellar.toml') : okResponse(tomlBody(issuer));
  };
  const facts = await tradeService.fetchAssetFacts({ assetCode: 'USDC', issuer, horizon: makeFactsHorizon(issuer) });
  assert.equal(facts.toml.status, 'loaded');
  assert.deepEqual(calls, ['https://issuer.example/.well-known/stellar.toml', 'https://cdn.example/stellar.toml']);
});

test('F-7: Weiterleitung ohne Location gilt als blocked (wie PHP redirect_without_location)', async (t) => {
  const issuer = StellarSdk.Keypair.random().publicKey();
  const previous = global.fetch;
  t.after(() => { global.fetch = previous; });
  global.fetch = async () => redirectResponse(null);
  const facts = await tradeService.fetchAssetFacts({ assetCode: 'USDC', issuer, horizon: makeFactsHorizon(issuer) });
  assert.equal(facts.toml.error, 'blocked');
});
