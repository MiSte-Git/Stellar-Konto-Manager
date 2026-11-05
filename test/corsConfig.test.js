const test = require('node:test');
const assert = require('node:assert/strict');
const { createCorsMiddleware, ALLOWED_APP_ORIGINS, normalizeOrigin, buildAllowedOrigins } = require('../services/corsConfig.js');

function makeReqRes({ origin, method = 'GET' } = {}) {
  const headersSet = {};
  let statusSent = null;
  let jsonSent;
  const req = { headers: origin === undefined ? {} : { origin }, method };
  const res = {
    header(name, value) { headersSet[name] = value; },
    removeHeader(name) { delete headersSet[name]; },
    sendStatus(code) { statusSent = code; return res; },
    status(code) { statusSent = code; return res; },
    json(body) { jsonSent = body; return res; },
  };
  return { req, res, headersSet, getStatus: () => statusSent, getJson: () => jsonSent };
}

test('createCorsMiddleware sets Access-Control-Allow-Origin for an allowlisted origin', () => {
  const mw = createCorsMiddleware({ methods: ['GET'], headers: ['Content-Type'] });
  const { req, res, headersSet } = makeReqRes({ origin: 'http://localhost:5173' });
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  assert.equal(headersSet['Access-Control-Allow-Origin'], 'http://localhost:5173');
  assert.equal(headersSet['Vary'], 'Origin');
  assert.equal(nextCalled, true);
});

test('createCorsMiddleware rejects a disallowed origin with 403 forbidden_origin and no CORS header (G3)', () => {
  const mw = createCorsMiddleware({ methods: ['GET'], headers: ['Content-Type'], credentials: true });
  for (const method of ['GET', 'POST', 'OPTIONS']) {
    for (const origin of ['https://evil.example', 'https://evil.steei.de', 'null', '', 'https://skm.steei.de/']) {
      const { req, res, headersSet, getStatus, getJson } = makeReqRes({ origin, method });
      headersSet['Access-Control-Allow-Origin'] = '*'; // a reflected header from earlier must go
      let nextCalled = false;
      mw(req, res, () => { nextCalled = true; });
      assert.equal(nextCalled, false, `${method} ${origin}: next() must not run`);
      assert.equal(getStatus(), 403, `${method} ${origin}`);
      assert.deepEqual(getJson(), { ok: false, error: 'forbidden_origin' });
      assert.equal(headersSet['Access-Control-Allow-Origin'], undefined);
      assert.equal(headersSet['Access-Control-Allow-Credentials'], undefined);
    }
  }
});

test('createCorsMiddleware passes requests without Origin header through unchanged', () => {
  const mw = createCorsMiddleware({ methods: ['GET'], headers: ['Content-Type'], credentials: true });
  const { req, res, headersSet, getStatus } = makeReqRes({ method: 'POST' });
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(getStatus(), null);
  assert.equal(headersSet['Access-Control-Allow-Origin'], undefined);
});

test('createCorsMiddleware only sets Access-Control-Allow-Credentials when configured', () => {
  const withCreds = createCorsMiddleware({ methods: ['GET'], headers: ['Content-Type'], credentials: true });
  const withoutCreds = createCorsMiddleware({ methods: ['GET'], headers: ['Content-Type'] });
  const a = makeReqRes({ origin: 'http://localhost:5173' });
  withCreds(a.req, a.res, () => {});
  assert.equal(a.headersSet['Access-Control-Allow-Credentials'], 'true');

  const b = makeReqRes({ origin: 'http://localhost:5173' });
  withoutCreds(b.req, b.res, () => {});
  assert.equal(b.headersSet['Access-Control-Allow-Credentials'], undefined);
});

test('createCorsMiddleware short-circuits OPTIONS preflight with 200 and skips next()', () => {
  const mw = createCorsMiddleware({ methods: ['GET', 'POST'], headers: ['Content-Type'] });
  const { req, res, getStatus } = makeReqRes({ origin: 'http://localhost:5173', method: 'OPTIONS' });
  let nextCalled = false;
  mw(req, res, () => { nextCalled = true; });
  assert.equal(getStatus(), 200);
  assert.equal(nextCalled, false);
});

test('ALLOWED_APP_ORIGINS includes the known dev origins', () => {
  assert.equal(ALLOWED_APP_ORIGINS.has('http://localhost:5173'), true);
  assert.equal(ALLOWED_APP_ORIGINS.has('http://127.0.0.1:5173'), true);
});

// Gleiche Faelle wie in test/corsReject.test.php (cors_normalize_origin).
const NORMALIZE_CASES = [
  ['https://skm.steei.de', 'https://skm.steei.de'],
  ['https://skm.steei.de/', 'https://skm.steei.de'],
  ['https://skm.steei.de/pfad/unter?x=1#y', 'https://skm.steei.de'],
  ['HTTPS://SKM.Steei.DE', 'https://skm.steei.de'],
  ['  https://skm.steei.de  ', 'https://skm.steei.de'],
  ['https://skm.steei.de:443', 'https://skm.steei.de'],
  ['http://localhost:80/', 'http://localhost'],
  ['https://skm.steei.de:8443/', 'https://skm.steei.de:8443'],
  ['http://localhost:05173', 'http://localhost:5173'],
  ['http://[::1]:5173', 'http://[::1]:5173'],
  ['skm.steei.de', null],
  ['https:skm.steei.de', null],
  ['ftp://skm.steei.de', null],
  ['https://', null],
  ['https://user@skm.steei.de', null],
  ['https://exa mple.de', null],
  ['https://bücher.de', null],
  ['https://skm.steei.de:0', null],
  ['https://skm.steei.de:70000', null],
  ['https://skm.steei.de:', null],
  ['null', null],
  ['', null],
];

test('normalizeOrigin: wie der Browser serialisiert, Unsinn ergibt null (G4-2)', () => {
  for (const [input, expected] of NORMALIZE_CASES) {
    assert.equal(normalizeOrigin(input), expected, JSON.stringify(input));
  }
  assert.equal(normalizeOrigin(undefined), null);
});

test('buildAllowedOrigins: https://skm.steei.de ist ohne Env-Variable erlaubt', () => {
  const logs = [];
  const set = buildAllowedOrigins({}, (m) => logs.push(m));
  assert.deepEqual([...set].sort(), ['http://127.0.0.1:5173', 'http://localhost:5173', 'https://skm.steei.de']);
  assert.deepEqual(logs, []);
});

test('buildAllowedOrigins: PROD_ORIGIN mit Slash, Pfad oder Grossbuchstaben wird normalisiert', () => {
  for (const raw of ['https://admin.example.test/', 'https://admin.example.test/skm/app', 'https://ADMIN.Example.Test', 'https://admin.example.test:443']) {
    const set = buildAllowedOrigins({ PROD_ORIGIN: raw }, () => {});
    assert.equal(set.has('https://admin.example.test'), true, raw);
    assert.equal(set.has(raw), raw === 'https://admin.example.test', raw);
  }
});

test('buildAllowedOrigins: ungueltiges PROD_ORIGIN wird ignoriert und einmal geloggt', () => {
  const logs = [];
  const set = buildAllowedOrigins({ PROD_ORIGIN: 'skm.example.test' }, (m) => logs.push(m));
  assert.equal(set.size, 3);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /PROD_ORIGIN/);
});

test('buildAllowedOrigins: leeres PROD_ORIGIN wird still ignoriert', () => {
  const logs = [];
  buildAllowedOrigins({ PROD_ORIGIN: '  ' }, (m) => logs.push(m));
  assert.deepEqual(logs, []);
});

test('buildAllowedOrigins: Node nimmt die Origin aus PROD_API_URL auf (nur Node, siehe api/cors.php)', () => {
  const set = buildAllowedOrigins({ PROD_API_URL: 'https://API.example.test/api' }, () => {});
  assert.equal(set.has('https://api.example.test'), true);
});

test('createCorsMiddleware: erlaubte Origin aus einer eigenen Liste setzt CORS-Header', () => {
  const allowedOrigins = buildAllowedOrigins({ PROD_ORIGIN: 'https://Admin.Example.Test/pfad/' }, () => {});
  const mw = createCorsMiddleware({ methods: ['GET'], headers: ['Content-Type'], credentials: true, allowedOrigins });
  const { req, res, headersSet, getStatus } = makeReqRes({ origin: 'https://admin.example.test', method: 'OPTIONS' });
  mw(req, res, () => {});
  assert.equal(getStatus(), 200);
  assert.equal(headersSet['Access-Control-Allow-Origin'], 'https://admin.example.test');
  assert.equal(headersSet['Access-Control-Allow-Credentials'], 'true');
});
