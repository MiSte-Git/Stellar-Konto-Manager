// Sammelzahlung auf Testnet: Liste pruefen, senden, Ergebnis; Anhalten nach der laufenden Zahlung.
// Die Liste wird wie von der App gespeichert vorbelegt (localStorage, ohne Secret Key), damit der Test nicht an
// den Eingabefeldern haengt. Empfaenger sind Fixture-Konten, Betraege klein, Memo je Zeile verschieden.
import { test, expect } from '@playwright/test';
import { readFixtures, accountBalances, xlmOf } from '../setup/fixtures.mjs';
import { openApp, loadAccount, openMenuItem, signWithKey, pollUntil } from '../helpers.mjs';

const STORAGE_KEY = 'skm_batch_payment_v1';

function rows(fx, tag) {
  return [fx.lp.public, fx.cb.public].map((dest, i) => ({
    id: `e2e${tag}${i}`, source: fx.main.public, dest, assetKey: 'XLM', amount: '1', memoType: 'text', memoVal: `e2e-${tag}-${i}-${Date.now() % 100000}`,
  }));
}

async function openBatch(page, fx, list) {
  await page.addInitScript(([key, value]) => {
    try { window.localStorage.setItem(key, value); } catch { /* noop */ }
  }, [STORAGE_KEY, JSON.stringify({ version: 1, networks: { TESTNET: list } })]);
  await openApp(page);
  await loadAccount(page, fx.main.public);
  await openMenuItem(page, 'Zahlung senden');
  await page.getByRole('button', { name: 'Sammelzahlung', exact: true }).click();
  await page.getByRole('button', { name: 'Prüfen', exact: true }).click();
  await expect(page.getByRole('button', { name: '2 Zahlungen senden' })).toBeEnabled({ timeout: 60000 });
}

test('Sammelzahlung: zwei Zahlungen senden, beide im Ergebnis, Empfaenger erhalten XLM', async ({ page }) => {
  test.setTimeout(180000);
  const fx = readFixtures();
  const lpBefore = xlmOf(await accountBalances(fx.lp.public));
  const cbBefore = xlmOf(await accountBalances(fx.cb.public));
  await openBatch(page, fx, rows(fx, 'a'));
  await page.getByRole('button', { name: '2 Zahlungen senden' }).click();
  await signWithKey(page, fx.main.secret);
  await expect(page.getByTestId('batch-summary')).toContainText('2 von 2 Zahlungen gesendet', { timeout: 90000 });
  await pollUntil(async () => xlmOf(await accountBalances(fx.lp.public)) >= lpBefore + 1 && xlmOf(await accountBalances(fx.cb.public)) >= cbBefore + 1);
});

test('Sammelzahlung anhalten: laufende Zahlung endet, die zweite wird nicht gesendet', async ({ page }) => {
  test.setTimeout(180000);
  const fx = readFixtures();
  const cbBefore = xlmOf(await accountBalances(fx.cb.public));
  // Erstes Senden an Horizon festhalten, bis angehalten wurde (Review AH-6: kein festes Zeitfenster), hoechstens 30 s.
  let posts = 0;
  let releaseFirst;
  const held = new Promise((r) => { releaseFirst = r; });
  await page.route('**/transactions', async (route) => {
    if (route.request().method() === 'POST') {
      posts += 1;
      if (posts === 1) await Promise.race([held, new Promise((r) => setTimeout(r, 30000))]);
    }
    await route.continue();
  });
  await openBatch(page, fx, rows(fx, 'b'));
  await page.getByRole('button', { name: '2 Zahlungen senden' }).click();
  await signWithKey(page, fx.main.secret);
  const stop = page.getByTestId('batch-stop');
  await expect(stop).toBeVisible({ timeout: 30000 });
  // Erst klicken, wenn die erste Zahlung wirklich an Horizon geht (POST festgehalten). Ein Klick waehrend des
  // Kontoladens haelt schon vor der ersten Zahlung an (gewollt, erster Lauf 19.11.: 0 von 2).
  await expect.poll(() => posts, { timeout: 30000 }).toBe(1);
  await stop.click();
  await expect(stop).toBeDisabled();
  await expect(stop).toHaveText('Wird angehalten. Eine Zahlung, die schon an das Netz geht, läuft zu Ende.');
  releaseFirst();
  await expect(page.getByTestId('batch-summary')).toContainText('1 von 2 Zahlungen gesendet', { timeout: 90000 });
  await expect(page.getByText(/Von dir angehalten, nicht gesendet/)).toBeVisible();
  // Belastbar ist die Zahl der POSTs; der Saldo zusaetzlich nach kurzer Wartezeit (Horizon hinkt nach).
  expect(posts).toBe(1);
  await page.waitForTimeout(5000);
  expect(xlmOf(await accountBalances(fx.cb.public))).toBe(cbBefore);
});
