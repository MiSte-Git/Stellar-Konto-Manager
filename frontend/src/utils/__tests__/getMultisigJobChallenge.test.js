import { getMultisigJobChallenge } from '../multisigApi.js';

describe('getMultisigJobChallenge', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reicht bei 429 Status und retryAfter weiter (C2)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({ ok: false, error: 'too_many_requests', retryAfter: 17 }),
    })));
    await expect(getMultisigJobChallenge('job-1', 'GSIGNER')).rejects.toMatchObject({
      message: 'too_many_requests',
      status: 429,
      retryAfter: 17,
    });
  });

  it('laesst retryAfter weg, wenn der Server keinen liefert', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => { throw new Error('kein JSON'); } })));
    const err = await getMultisigJobChallenge('job-1', 'GSIGNER').catch((e) => e);
    expect(err.status).toBe(429);
    expect(err.retryAfter).toBeUndefined();
  });
});
