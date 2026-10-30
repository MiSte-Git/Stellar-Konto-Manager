import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS, loadGroupfundPrefs, saveGroupfundPrefs } from '../groupfundPrefs.js';

const KEY = 'skm.groupfund.v1:PUBLIC:GA';

describe('Groupfund-Einstellungen', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('speichert je Konto und Netz getrennt', () => {
    saveGroupfundPrefs('PUBLIC', 'GA', { ...DEFAULT_PREFS, mode: 'memo', memo: 'GF', bufferXlm: '2', dismissed: [{ opId: '12', outflow: '9.0000000' }], manual: [{ opId: '34', txHash: 'h', createdAt: 't', to: 'G', outflow: '1.0000000', balanceAfter: '2.0000000' }] });
    expect(loadGroupfundPrefs('PUBLIC', 'GA')).toMatchObject({
      mode: 'memo', memo: 'GF', bufferXlm: '2',
      dismissed: [{ opId: '12', outflow: '9.0000000' }],
      manual: [{ opId: '34', outflow: '1.0000000', balanceAfter: '2.0000000' }],
    });
    expect(loadGroupfundPrefs('TESTNET', 'GA')).toEqual(DEFAULT_PREFS);
    expect(loadGroupfundPrefs('PUBLIC', 'GB')).toEqual(DEFAULT_PREFS);
  });

  it('faellt bei kaputten Daten auf Standardwerte zurueck', () => {
    window.localStorage.setItem(KEY, '{kaputt');
    expect(loadGroupfundPrefs('PUBLIC', 'GA')).toEqual(DEFAULT_PREFS);
    window.localStorage.setItem(KEY, JSON.stringify({ mode: 'x', dismissed: [{ opId: '1' }, 2, { opId: 'a' }], manual: [{ opId: 'x' }, { opId: '5' }] }));
    expect(loadGroupfundPrefs('PUBLIC', 'GA')).toMatchObject({ mode: 'muxed', dismissed: [{ opId: '1' }], manual: [{ opId: '5' }] });
  });

  it('uebersteht einen gesperrten Speicher', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(loadGroupfundPrefs('PUBLIC', 'GA')).toEqual(DEFAULT_PREFS);
    expect(() => saveGroupfundPrefs('PUBLIC', 'GA', DEFAULT_PREFS)).not.toThrow();
  });
});
