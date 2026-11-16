import { declineMultisigJob, deleteMultisigJob, getMultisigJobAccessToken } from '../multisigApi.js';

// Token, Ablehnen und Loeschen schicken die Nonce der Challenge im Feld challenge mit: Das Backend
// verbraucht nur genau diese, andere offene Challenges desselben Signers bleiben.
describe('Nonce im Body von Token, Ablehnen und Loeschen', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubFetch = (json) => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => json }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };
  const bodyOf = (fetchMock) => JSON.parse(fetchMock.mock.calls[0][1].body);

  it.each([
    ['token', (n) => getMultisigJobAccessToken('job-1', 'GSIGNER', 'sig', n), { accessToken: 'tok' }],
    ['decline', (n) => declineMultisigJob('job-1', 'GSIGNER', 'sig', n), { ok: true }],
    ['delete', (n) => deleteMultisigJob('job-1', 'GSIGNER', 'sig', n), { ok: true }],
  ])('%s: signer, signature und challenge', async (action, call, json) => {
    const fetchMock = stubFetch(json);
    await call('NONCE');
    expect(String(fetchMock.mock.calls[0][0])).toContain(`/multisig/jobs/job-1/${action}`);
    expect(bodyOf(fetchMock)).toEqual({ signer: 'GSIGNER', signature: 'sig', challenge: 'NONCE' });
  });

  it('ohne Nonce geht ein leerer String mit, das Backend lehnt dann mit challenge_missing_or_expired ab', async () => {
    const fetchMock = stubFetch({ ok: true });
    await declineMultisigJob('job-1', 'GSIGNER', 'sig');
    expect(bodyOf(fetchMock).challenge).toBe('');
  });
});
