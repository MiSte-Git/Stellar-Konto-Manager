// Konto entfernen (Loeschen-Knopf im Kopf) verlaesst Konto-Ansichten wie Konto laden und Netzwechsel
// (HOME_ON_ACCOUNT_CHANGE). main.jsx ist fuer einen Seitentest zu schwer, deshalb Quelltextpruefung.
describe('main.jsx: Konto entfernen fuehrt zur Startseite', () => {
  it('der Loeschen-Knopf ruft leaveAccountView nach unloadActiveWallet auf', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(`${globalThis.process.cwd()}/src/main.jsx`, 'utf8');
    expect(src).toContain("onClick={() => { setWalletHeaderInput(''); unloadActiveWallet(); leaveAccountView(); }}");
    expect(src).toMatch(/HOME_ON_ACCOUNT_CHANGE = Object\.freeze\(\[\s*'tradingAssets', 'assetDetail'/);
  });
});
