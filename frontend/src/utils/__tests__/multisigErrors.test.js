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

describe('fee_bump_not_supported (#15)', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });

  it('hat einen verstaendlichen Hinweis und ist ein anderer Text als der Code', () => {
    const text = backendErrorMessage('fee_bump_not_supported');
    expect(text).not.toBe('fee_bump_not_supported');
    expect(text).toMatch(/Fee-Bump/);
    expect(text).toMatch(/nicht vorgesehen/);
  });

  it('Anlegen eines Jobs: die Ablehnung des Backends erscheint als Hinweis, nicht als Rohcode', async () => {
    mockResponse(400, { ok: false, error: 'fee_bump_not_supported' });
    await expect(createMultisigJobFromXdr({ network: 'testnet', accountId: 'GA', txXdr: 'AAAA' }))
      .rejects.toThrow(/Fee-Bump-Transaktionen sind als Multisig-Job nicht vorgesehen/);
  });
});

// F-8: Ohne Signer-Daten legt kein Backend mehr einen Job an.
describe('horizon_unavailable und account_not_found beim Anlegen (F-8)', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });

  it('horizon_unavailable: Hinweis, dass Horizon nicht erreichbar ist und kein Job angelegt wurde', () => {
    const text = backendErrorMessage('horizon_unavailable');
    expect(text).not.toBe('horizon_unavailable');
    expect(text).toMatch(/Horizon/);
    expect(text).toMatch(/kein Job angelegt/);
  });

  it('account_not_found: Hinweis, dass das Konto im Netz nicht bekannt ist und kein Job angelegt wurde', () => {
    const text = backendErrorMessage('account_not_found');
    expect(text).not.toBe('account_not_found');
    expect(text).toMatch(/nicht bekannt/);
    expect(text).toMatch(/kein Job angelegt/);
  });

  it('createMultisigJobFromXdr wirft bei 503 den uebersetzten Hinweis, nicht den Rohcode', async () => {
    mockResponse(503, { ok: false, error: 'horizon_unavailable' });
    await expect(createMultisigJobFromXdr({ network: 'testnet', accountId: 'GA', txXdr: 'AAAA' }))
      .rejects.toThrow(/kein Job angelegt/);
  });

  it('createMultisigJobFromXdr wirft bei 400 account_not_found den uebersetzten Hinweis', async () => {
    mockResponse(400, { ok: false, error: 'account_not_found' });
    await expect(createMultisigJobFromXdr({ network: 'testnet', accountId: 'GA', txXdr: 'AAAA' }))
      .rejects.toThrow(/nicht bekannt/);
  });
});
