import { reportUrl } from '../reportUrl.js';

describe('reportUrl (F11: kein Zugriffstoken im Bugreport)', () => {
  it('entfernt token aus der Query und behaelt den Rest', () => {
    expect(reportUrl('https://skm.example/multisig/jobs/abc?token=geheim&tab=signers#top'))
      .toBe('https://skm.example/multisig/jobs/abc?tab=signers#top');
  });

  it('entfernt auch Varianten wie accessToken und access_token, unabhaengig von der Gross-/Kleinschreibung', () => {
    const out = reportUrl('https://skm.example/x?accessToken=a&access_token=b&TOKEN=c&keep=1');
    expect(out).toBe('https://skm.example/x?keep=1');
    expect(out).not.toMatch(/token/i);
  });

  it('entfernt ein Fragment mit Token ganz', () => {
    expect(reportUrl('https://skm.example/multisig/jobs/abc#token=geheim')).toBe('https://skm.example/multisig/jobs/abc');
    expect(reportUrl('https://skm.example/a?x=1#/job/abc?token=geheim')).toBe('https://skm.example/a?x=1');
  });

  it('laesst eine Adresse ohne Token unveraendert', () => {
    expect(reportUrl('https://skm.example/wallet?net=TESTNET#abschnitt')).toBe('https://skm.example/wallet?net=TESTNET#abschnitt');
  });

  it('eine ungueltige Adresse mit Token wird nicht gesendet, ohne Token bleibt sie', () => {
    expect(reportUrl('kaputt?token=geheim')).toBe('');
    expect(reportUrl('kaputt')).toBe('kaputt');
  });

  it('nutzt ohne Angabe die aktuelle Adresse', () => {
    window.history.pushState({}, '', '/multisig/jobs/abc?token=geheim&x=1');
    expect(reportUrl()).not.toContain('token');
    expect(reportUrl()).toContain('x=1');
    window.history.pushState({}, '', '/');
  });
});
