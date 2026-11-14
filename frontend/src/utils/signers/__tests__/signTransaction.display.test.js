import { describe, expect, it } from 'vitest';
import i18n from '../../../i18n.js';
import { formatErrorForUi } from '../../formatErrorForUi.js';
import { NO_KEYS_ERROR, SIGNING_FAILED_ERROR } from '../signTransaction.js';

// K3: Aufrufer mit formatErrorForUi (ListTrustlines, Trading, Liquidity, Sammelzahlung u. a.) zeigen
// den Signierfehler uebersetzt an, nicht als rohen Schluessel.
describe('Anzeige der Fehler aus attachSignatures', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });

  it.each([
    [SIGNING_FAILED_ERROR, 'errors:submitTransaction.failed.signingFailed'],
    [NO_KEYS_ERROR, 'errors:submitTransaction.failed.multisig.noKeysProvided'],
  ])('%s wird uebersetzt', (message, key) => {
    const translated = i18n.t(key);
    expect(translated).not.toBe(key.split(':')[1]);
    const text = formatErrorForUi(i18n.t.bind(i18n), new Error(message));
    expect(text).toContain(translated);
    expect(text).not.toContain('submitTransaction.failed');
  });
});
