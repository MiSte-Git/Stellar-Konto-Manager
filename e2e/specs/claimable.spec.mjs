// Claimable Balances: Anzeige, Einloesen (XLM) und Batch-Convert (Assets ohne Trustline -> XLM).
import { test, expect } from '@playwright/test';
import {
  readFixtures, createClaimables, accountBalances, claimableCount, xlmOf,
} from '../setup/fixtures.mjs';
import { openApp, loadAccount, signWithKey, expectNoCrash, pollUntil } from '../helpers.mjs';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await createClaimables(readFixtures());
});

test('Claimable Balance einloesen (XLM)', async ({ page }) => {
  const fx = readFixtures();
  const before = xlmOf(await accountBalances(fx.cb.public));
  await openApp(page);
  await loadAccount(page, fx.cb.public);

  await expect(page.getByText('Claimable Balances').first()).toBeVisible();
  await expect(page.getByText(/Für Assets ohne Trustline/)).toBeVisible();
  await page.getByRole('button', { name: 'Einlösen', exact: true }).first().click();
  await signWithKey(page, fx.cb.secret);
  await expect(page.getByText(/XLM eingelöst/)).toBeVisible({ timeout: 30000 });
  await expectNoCrash(page);

  const after = await pollUntil(async () => {
    const x = xlmOf(await accountBalances(fx.cb.public));
    return x > before + 9 ? x : null;
  });
  expect(after).toBeGreaterThan(before + 9);
});

test('Batch-Convert loest SKMA und SKMB ein und wandelt nach XLM um', async ({ page }) => {
  const fx = readFixtures();
  const before = xlmOf(await accountBalances(fx.cb.public));
  await openApp(page);
  await loadAccount(page, fx.cb.public);

  await page.getByRole('button', { name: /Batch-Convert/ }).click();
  await page.getByRole('button', { name: 'Vorschau laden' }).click();
  await expect(page.getByText('100 SKMA')).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('100 SKMB')).toBeVisible();
  await page.getByRole('button', { name: /einlösen & umwandeln/ }).click();
  await signWithKey(page, fx.cb.secret);
  await expect(page.getByText(/2 Einträge umgewandelt/)).toBeVisible({ timeout: 40000 });

  // Netz: Claimables weg, temporaere Trustlines wieder entfernt, XLM gestiegen.
  const balances = await pollUntil(async () => {
    const b = await accountBalances(fx.cb.public);
    return xlmOf(b) > before + 150 ? b : null;
  });
  expect(balances.some((b) => b.asset_code === 'SKMA' || b.asset_code === 'SKMB')).toBe(false);
  expect(await claimableCount(fx.cb.public)).toBe(0);
});
