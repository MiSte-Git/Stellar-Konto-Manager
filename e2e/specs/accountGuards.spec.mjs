// Konto erstellen: Schutz vor Verlust nicht gesicherter Schluessel (Menuewechsel, Netzwechsel,
// Verwerfen-Dialog). Es werden nur Zufallsschluessel erzeugt, nichts gesendet.
import { test, expect } from '@playwright/test';
import { openApp, openMenuItem } from '../helpers.mjs';

test('Konto erstellen: Guards fuer nicht gesicherte Schluessel', async ({ page }) => {
  await openApp(page);
  await openMenuItem(page, 'Neues Konto erstellen');
  await page.getByRole('button', { name: 'Schlüssel generieren' }).click();
  const keysShown = page.getByText('Schlüssel jetzt sichern!');
  await expect(keysShown).toBeVisible();

  // Menuewechsel: Rueckfrage, bei "Abbrechen" bleiben Seite und Schluessel.
  let message = '';
  page.once('dialog', (d) => { message = d.message(); d.dismiss(); });
  await openMenuItem(page, 'Wallet');
  await expect.poll(() => message).toContain('Trotzdem verlassen?');
  await expect(keysShown).toBeVisible();

  // Netzwechsel auf Mainnet: Testnet-Schluessel sind gesperrt, Hinweis erscheint.
  await page.getByRole('radio', { name: 'Mainnet' }).check();
  await expect(page.getByText(/gewählt ist jetzt Mainnet/)).toBeVisible();
  await page.getByRole('radio', { name: 'Testnet' }).check();

  // Verwerfen-Dialog: Escape und X lassen die Schluessel stehen.
  await page.getByRole('button', { name: 'Schlüssel verwerfen' }).click();
  await expect(page.getByText('Aktion bestätigen')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(keysShown).toBeVisible();

  // Bei "OK" im Rueckfrage-Dialog wird verlassen, die Schluessel sind weg.
  page.once('dialog', (d) => d.accept());
  await openMenuItem(page, 'Wallet');
  await expect(page.getByText('Konto + Multisig erstellen')).toHaveCount(0);
});
