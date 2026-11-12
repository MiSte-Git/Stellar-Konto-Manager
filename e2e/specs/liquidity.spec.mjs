// Liquidity Pools: Pool per ID laden, einzahlen, abheben (100 %), Pool-Trustline wird entfernt.
import { test, expect } from '@playwright/test';
import { readFixtures, accountBalances } from '../setup/fixtures.mjs';
import { openApp, loadAccount, openMenuItem, signWithKey, pollUntil, inputAfterLabel } from '../helpers.mjs';

test.describe.configure({ mode: 'serial' });

const poolShares = (balances) => balances.filter((b) => b.asset_type === 'liquidity_pool_shares');

test('Einzahlen und Abheben im Pool XLM/SKMA', async ({ page }) => {
  const fx = readFixtures();
  await openApp(page);
  await loadAccount(page, fx.lp.public);
  await openMenuItem(page, 'Liquidity Pools');

  // Pool per Pool-ID laden.
  await page.getByRole('tab', { name: 'Pool-ID', exact: true }).click();
  await page.locator('input[type=text]').last().fill(fx.poolId);
  await page.getByRole('button', { name: 'Pool laden' }).click();
  await expect(page.getByText(/Pool-Fakten: XLM \/ SKMA/)).toBeVisible({ timeout: 20000 });

  // Einzahlen: Vorschau, dann signieren.
  await page.getByRole('button', { name: 'Einzahlen', exact: true }).last().click();
  await inputAfterLabel(page, 'Betrag XLM').fill('5');
  await expect(page.getByText(/Erwartete Pool Shares/)).toBeVisible();
  await page.getByRole('button', { name: 'Operationen prüfen' }).click();
  await expect(page.getByText(/Liquidität einzahlen in Pool/)).toBeVisible();
  await page.getByRole('button', { name: 'Signieren und senden' }).click();
  await signWithKey(page, fx.lp.secret);
  await expect(page.getByText('Transaktion erfolgreich gesendet.')).toBeVisible({ timeout: 40000 });
  await pollUntil(async () => poolShares(await accountBalances(fx.lp.public)).length === 1);
  await page.getByRole('button', { name: 'Schließen' }).first().click();

  // Danach ist die Seite nicht gesperrt: Position sichtbar, Abheben moeglich.
  await expect(page.getByText('Meine Positionen')).toBeVisible();
  await page.getByRole('button', { name: 'Abheben', exact: true }).first().click();
  await page.getByRole('button', { name: '100 %' }).click();
  await page.getByRole('button', { name: 'Operationen prüfen' }).click();
  await expect(page.getByText(/Trustline für Pool .* entfernen/)).toBeVisible();
  await page.getByRole('button', { name: 'Signieren und senden' }).click();
  await signWithKey(page, fx.lp.secret);
  await expect(page.getByText('Transaktion erfolgreich gesendet.')).toBeVisible({ timeout: 40000 });
  await pollUntil(async () => poolShares(await accountBalances(fx.lp.public)).length === 0);
});
