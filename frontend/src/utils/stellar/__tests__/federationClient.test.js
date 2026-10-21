// Federation in the browser only talks to our own backend (/api/federation),
// never to arbitrary domains - that keeps the CSP's connect-src narrow
// (Backlog P1.2). Also covers the dev-only SKM_HORIZON_URL override.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { resolveFederationAddress, reverseFederationLookup, getHorizonServer } from '../stellarUtils.js';

const A = Keypair.random().publicKey();
const B = Keypair.random().publicKey();

function stubFetch(status, body) {
  const fetchMock = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

describe('resolveFederationAddress', () => {
  it('queries the own backend with type=name and returns account and memo', async () => {
    const fetchMock = stubFetch(200, { ok: true, stellar_address: 'alice*example.com', account_id: A, memo_type: 'id', memo: '42' });
    await expect(resolveFederationAddress(' alice*example.com ')).resolves.toEqual({ accountId: A, memo: '42', memoType: 'id' });
    const url = new URL(fetchMock.mock.calls[0][0], 'http://localhost');
    expect(url.pathname).toBe('/api/federation');
    expect(url.searchParams.get('type')).toBe('name');
    expect(url.searchParams.get('q')).toBe('alice*example.com');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'omit' });
  });

  it.each([
    ['backend 404', 404, { ok: false, error: 'federation.notFound' }],
    ['backend 502', 502, { ok: false, error: 'federation.unavailable' }],
    ['invalid account_id', 200, { ok: true, account_id: 'GNOTVALID' }],
    ['missing account_id', 200, { ok: true }],
  ])('throws error.noFederationId on %s', async (_label, status, body) => {
    stubFetch(status, body);
    await expect(resolveFederationAddress('alice*example.com')).rejects.toThrow('error.noFederationId');
  });

  it('throws error.noFederationId when the backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(resolveFederationAddress('alice*example.com')).rejects.toThrow('error.noFederationId');
  });
});

describe('reverseFederationLookup', () => {
  it('returns name and domain from the backend', async () => {
    const fetchMock = stubFetch(200, { ok: true, found: true, stellar_address: 'alice*example.com', domain: 'example.com' });
    await expect(reverseFederationLookup(A, 'TESTNET')).resolves.toEqual({ stellarAddress: 'alice*example.com', domain: 'example.com' });
    const url = new URL(fetchMock.mock.calls[0][0], 'http://localhost');
    expect(url.pathname).toBe('/api/federation');
    expect(url.searchParams.get('type')).toBe('id');
    expect(url.searchParams.get('q')).toBe(A);
    expect(url.searchParams.get('network')).toBe('TESTNET');
  });

  it('defensively drops a name whose domain differs from the reported domain', async () => {
    stubFetch(200, { ok: true, found: true, stellar_address: 'alice*evil.com', domain: 'example.com' });
    await expect(reverseFederationLookup(A)).resolves.toBeNull();
  });

  it.each([
    ['found false', 200, { ok: true, found: false }],
    ['backend error', 502, { ok: false, error: 'federation.unavailable' }],
    ['malformed name', 200, { ok: true, found: true, stellar_address: 'alice', domain: 'example.com' }],
    ['non-ASCII lookalike name', 200, { ok: true, found: true, stellar_address: 'support\uff0alobstr.co*example.com', domain: 'example.com' }],
    ['bidi override in name', 200, { ok: true, found: true, stellar_address: '\u202eoc.rtsbol*example.com', domain: 'example.com' }],
    ['two asterisks', 200, { ok: true, found: true, stellar_address: 'a*b*example.com', domain: 'example.com' }],
  ])('returns null on %s', async (_label, status, body) => {
    stubFetch(status, body);
    await expect(reverseFederationLookup(B)).resolves.toBeNull();
  });

  it('returns null without a request for an invalid account id', async () => {
    const fetchMock = stubFetch(200, {});
    await expect(reverseFederationLookup('GNOTVALID')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never throws, even if fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom'); }));
    await expect(reverseFederationLookup(A)).resolves.toBeNull();
  });
});

describe('SKM_HORIZON_URL override', () => {
  const CUSTOM = 'https://horizon.custom.example';
  const serverUrl = (server) => String(server.serverURL);

  it('is honoured in dev mode', () => {
    vi.stubEnv('DEV', true);
    window.localStorage.setItem('SKM_HORIZON_URL', CUSTOM);
    expect(serverUrl(getHorizonServer(''))).toContain('horizon.custom.example');
  });

  it('is ignored outside dev mode', () => {
    vi.stubEnv('DEV', false);
    window.localStorage.setItem('SKM_HORIZON_URL', CUSTOM);
    expect(serverUrl(getHorizonServer(''))).not.toContain('horizon.custom.example');
  });
});
