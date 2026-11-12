// Sendesperre ueber Tabs: Ist der Lock belegt, wartet "Zahlung senden", "Warten abbrechen"
// sendet nichts. Der Lock wird per Web Lock gehalten, wie ihn ein zweiter Tab halten wuerde.
import { test, expect } from '@playwright/test';
import { readFixtures, accountBalances, xlmOf } from '../setup/fixtures.mjs';
import { openApp, loadAccount, openMenuItem } from '../helpers.mjs';

test('Warten auf belegte Sendesperre abbrechen sendet nichts', async ({ page }) => {
  const fx = readFixtures();
  const before = xlmOf(await accountBalances(fx.main.public));
  await openApp(page);
  await loadAccount(page, fx.main.public);
  await openMenuItem(page, 'Zahlung senden');

  await page.evaluate(() => {
    window.__release = [];
    ['TESTNET', 'testnet', 'Testnet'].forEach((n) => {
      navigator.locks.request(`skm-batch-send-${n}`, () => new Promise((res) => window.__release.push(res)));
    });
  });

  await page.getByPlaceholder('G... oder user*domain').fill(fx.main.public);
  await page.getByLabel('Betrag').first().fill('1');
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
  await page.getByRole('button', { name: 'Bist du sicher?' }).click();

  await expect(page.getByText(/Wartet auf einen anderen Sendevorgang/)).toBeVisible();
  await page.getByRole('button', { name: 'Warten abbrechen' }).click();
  await expect(page.getByText('Warten abgebrochen. Nicht gesendet.')).toBeVisible();

  await page.evaluate(() => window.__release.forEach((r) => r()));
  expect(xlmOf(await accountBalances(fx.main.public))).toBe(before);
});
