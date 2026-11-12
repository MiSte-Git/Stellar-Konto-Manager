// Regression: "Meine Trustlines" stuerzte ab (localeCompare auf undefined), sobald das Konto
// Pool Shares hielt (Fix in loadTrustlines, 12.11.2026).
import { test, expect } from '@playwright/test';
import { readFixtures } from '../setup/fixtures.mjs';
import { openApp, loadAccount, openMenuItem, expectNoCrash } from '../helpers.mjs';

test('Meine Trustlines und Trustlines vergleichen laufen mit Pool-Shares-Konto', async ({ page }) => {
  const fx = readFixtures();
  await openApp(page);
  await loadAccount(page, fx.main.public);

  await openMenuItem(page, 'Meine Trustlines');
  await expectNoCrash(page);
  await expect(page.getByText('SKMA').first()).toBeVisible();
  await expect(page.getByText('SKMB').first()).toBeVisible();
  // Pool Shares gehoeren nicht in die Trustline-Liste.
  await expect(page.getByText(/liquidity_pool_shares/i)).toHaveCount(0);

  await openMenuItem(page, 'Trustlines vergleichen');
  await expectNoCrash(page);
});
