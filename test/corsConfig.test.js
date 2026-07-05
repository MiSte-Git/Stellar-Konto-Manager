const test = require('node:test');
const assert = require('node:assert/strict');
const { createCorsMiddleware, ALLOWED_APP_ORIGINS } = require('../services/corsConfig.js');

function makeReqRes({ origin, method = 'GET' } = {}) {
  const headersSet = {};
  let statusSent = null;
  const req = { headers: { origin }, method };
  const res = {
    header(name, value) { headersSet[name] = value; },
    removeHeader(name) { delete headersSet[name]; },
    sendStatus(code) { statusSent = code; return res; },
  };
  return { req, res, headersSet, getStatus: () => statusSent };
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

test('createCorsMiddleware removes any Access-Control-Allow-Origin for a disallowed origin', () => {
  const mw = createCorsMiddleware({ methods: ['GET'], headers: ['Content-Type'] });
  const { req, res, headersSet } = makeReqRes({ origin: 'https://evil.example' });
  mw(req, res, () => {});
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
