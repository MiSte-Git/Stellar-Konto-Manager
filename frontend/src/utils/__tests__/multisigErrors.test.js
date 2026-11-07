import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n.js';
import { backendErrorMessage, SAVE_FAILED_AFTER_SUBMIT } from '../multisigErrors.js';
import { createMultisigJobFromXdr, mergeSignedXdr } from '../multisigApi.js';

function mockResponse(status, body) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

afterEach(() => vi.unstubAllGlobals());

const expectedText = () => i18n.t(SAVE_FAILED_AFTER_SUBMIT);

describe('save_failed_after_submit (B3-1)', () => {
  it('hat einen uebersetzten Text mit Hinweis auf Netz-Pruefung und nicht erneut senden', () => {
    const text = expectedText();
    expect(text).not.toBe(SAVE_FAILED_AFTER_SUBMIT);
    expect(text).toMatch(/möglicherweise gesendet/);
    expect(text).toMatch(/nicht erneut senden/);
  });

  it('backendErrorMessage uebersetzt nur diesen Code, andere Codes bleiben unveraendert', () => {
    expect(backendErrorMessage(SAVE_FAILED_AFTER_SUBMIT)).toBe(expectedText());
    expect(backendErrorMessage('multisig.jobs.merge_failed')).toBe('multisig.jobs.merge_failed');
    expect(backendErrorMessage(undefined, 'fallback')).toBe('fallback');
  });

  it('mergeSignedXdr wirft den uebersetzten Text mit Status 500', async () => {
    mockResponse(500, { ok: false, error: SAVE_FAILED_AFTER_SUBMIT });
    await expect(mergeSignedXdr({ jobId: 'j', signedXdr: 'x' })).rejects.toMatchObject({ message: expectedText(), status: 500 });
  });

  it('createMultisigJobFromXdr wirft den uebersetzten Text', async () => {
    mockResponse(500, { ok: false, error: SAVE_FAILED_AFTER_SUBMIT });
    await expect(createMultisigJobFromXdr({ network: 'testnet', accountId: 'G', txXdr: 'x' })).rejects.toThrow(expectedText());
  });
});
