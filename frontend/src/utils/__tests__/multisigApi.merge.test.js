import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeSignedXdr } from '../multisigApi.js';

function mockResponse(status, body) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

afterEach(() => vi.unstubAllGlobals());

describe('mergeSignedXdr', () => {
  it('reicht Fehlercode und Status des Backends weiter', async () => {
    mockResponse(400, { ok: false, error: 'account_mismatch' });
    await expect(mergeSignedXdr({ jobId: 'j', signedXdr: 'x' })).rejects.toMatchObject({ message: 'account_mismatch', status: 400 });
  });

  it('faellt ohne Fehlercode auf merge_failed zurueck', async () => {
    mockResponse(500, {});
    await expect(mergeSignedXdr({ jobId: 'j', signedXdr: 'x' })).rejects.toMatchObject({ message: 'multisig.jobs.merge_failed', status: 500 });
  });

  it('sendet das Token als Header', async () => {
    mockResponse(200, { status: 'pending_signatures' });
    await mergeSignedXdr({ jobId: 'j', signedXdr: 'x', accessToken: 'tok' });
    expect(fetch.mock.calls[0][1].headers['x-job-token']).toBe('tok');
  });
});
