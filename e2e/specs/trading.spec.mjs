// Trading mit gemerktem Session-Key: Der Key-Dialog kommt beim ersten Signieren, danach signieren
// Limit-Order und Swap nach der Bestaetigung ohne Dialog. Ohne Haken "merken" fragt der Dialog wieder.
import { test, expect } from '@playwright/test';
import { readFixtures, accountBalances, HORIZON } from '../setup/fixtures.mjs';
import { openApp, loadAccount, signWithKey, expectNoCrash, pollUntil } from '../helpers.mjs';

test.setTimeout(240000);

const REMEMBER = 'Secret Key für diese Sitzung merken';
const PASSWORD = 'input[type=password]';

async function offerCount(publicKey) {
  const res = await fetch(`${HORIZON}/accounts/${publicKey}/offers?limit=50`);
  return (await res.json())._embedded.records.length;
}

async function skmaOf(publicKey) {
  const b = (await accountBalances(publicKey)).find((x) => x.asset_code === 'SKMA');
  return Number(b?.balance || 0);
}

// Konto laden, Trading oeffnen, SKMA suchen und auswaehlen.
async function openTradingWithSkma(page, fx) {
  await openApp(page);
  await loadAccount(page, fx.main.public);
  await page.locator('header button').first().click();
  await page.locator('[data-nav-id="tradingAssets"]').first().evaluate((el) => el.click());
  await page.getByPlaceholder('USDC, G... oder USDC:G...').fill(`SKMA:${fx.issuer.public}`);
  await page.getByRole('button', { name: 'Suchen', exact: true }).click();
  await page.getByRole('button', { name: 'Details', exact: true }).first().click();
  await expect(page.getByText('Trustline vorhanden').first()).toBeVisible({ timeout: 30000 });
}

const limitSection = (page) => page.getByText('Limit-Orders', { exact: true }).first().locator('xpath=ancestor::section[1]');
const swapSection = (page) => page.getByText('Swap-Preview', { exact: true }).first().locator('xpath=ancestor::section[1]');

// Preis 5 XLM je SKMA liegt ueber dem Gebot des Issuers (1): die Order bleibt offen und fuellt sich nicht.
async function placeOffer(page) {
  const section = limitSection(page);
  const boxes = section.getByRole('textbox');
  await boxes.nth(0).fill('5');
  await boxes.nth(1).fill('5');
  await section.getByRole('button', { name: 'Limit-Order platzieren' }).click();
  await expect(page.getByText('Limit-Order bestätigen')).toBeVisible();
  await page.getByRole('button', { name: 'Weiter zur Signatur' }).click();
}

test('Key im Dialog merken: Limit-Order und Swap danach ohne Key-Dialog', async ({ page }) => {
  const fx = readFixtures();
  const offersBefore = await offerCount(fx.main.public);
  await openTradingWithSkma(page, fx);

  // Erste Limit-Order: Key-Dialog, Merken ist vorbelegt.
  await placeOffer(page);
  await signWithKey(page, fx.main.secret);
  await expect(page.getByText(/Limit-Order wurde platziert/)).toBeVisible({ timeout: 40000 });
  await pollUntil(async () => (await offerCount(fx.main.public)) >= offersBefore + 1);

  // Zweite Limit-Order: kein Key-Dialog, das Netz zeigt zwei Offers.
  await placeOffer(page);
  await expect(page.getByText(/Limit-Order wurde platziert/)).toBeVisible({ timeout: 40000 });
  await expect(page.locator(PASSWORD)).toHaveCount(0);
  await pollUntil(async () => (await offerCount(fx.main.public)) >= offersBefore + 2);

  // Swap Token -> XLM: ebenfalls ohne Key-Dialog, SKMA sinkt um den gesendeten Betrag.
  const before = await skmaOf(fx.main.public);
  const swap = swapSection(page);
  await swap.getByRole('button', { name: 'Token -> XLM' }).click();
  await swap.getByRole('textbox').nth(0).fill('5');
  await swap.getByRole('button', { name: 'Preis prüfen' }).click();
  await expect(swap.getByText('Geschätzt erhalten')).toBeVisible({ timeout: 30000 });
  await swap.getByRole('button', { name: 'Swap ausführen' }).click();
  await page.getByRole('button', { name: 'Weiter zur Signatur' }).click();
  await expect(page.getByText(/Swap wurde ausgeführt/)).toBeVisible({ timeout: 40000 });
  await expect(page.locator(PASSWORD)).toHaveCount(0);
  await expectNoCrash(page);
  const after = await pollUntil(async () => {
    const x = await skmaOf(fx.main.public);
    return x <= before - 4.9 ? x : null;
  });
  expect(after).toBeLessThanOrEqual(before - 4.9);
});

test('Gegenprobe: Haken Merken aus, der Key-Dialog kommt wieder', async ({ page }) => {
  const fx = readFixtures();
  await openTradingWithSkma(page, fx);

  await placeOffer(page);
  await page.getByLabel(REMEMBER).uncheck();
  await signWithKey(page, fx.main.secret);
  await expect(page.getByText(/Limit-Order wurde platziert/)).toBeVisible({ timeout: 40000 });

  await placeOffer(page);
  await expect(page.locator(PASSWORD)).toBeVisible({ timeout: 15000 });
});
