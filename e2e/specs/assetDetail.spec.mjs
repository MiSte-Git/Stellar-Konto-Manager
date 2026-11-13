// Wallet-Assets: Pool-Anteile mit Gegenwert, Filter. Asset-Detailseite: Wallet -> Details zu SKMA zeigt Saldo und Fakten, Handeln oeffnet Token suchen
// und handeln mit vorbelegtem SKMA (Detailansicht offen, nichts gesendet). Ein kaputter Link zeigt
// einen Hinweis statt eines Absturzes. Das Backend fehlt im E2E-Lauf: Asset-Suche und Fakten sind
// wie in trading.spec.mjs nachgebildet, das Konto kommt echt vom Testnet.
import { test, expect } from '@playwright/test';
import { readFixtures } from '../setup/fixtures.mjs';
import { openApp, loadAccount, expectNoCrash } from '../helpers.mjs';

test.setTimeout(180000);

async function mockAssetBackend(page, fx) {
  const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/trade/assets/search*', (route) => route.fulfill(json({
    items: [{ assetCode: 'SKMA', assetIssuer: fx.issuer.public, amount: '1000', numAccounts: 2, pagingToken: `SKMA_${fx.issuer.public}_credit_alphanum4` }],
  })));
  await page.route('**/api/trade/assets/facts*', (route) => route.fulfill(json({
    issuerAccount: { homeDomain: 'skm-e2e.example' },
    toml: { status: 'notChecked', url: '', currencies: [], matches: [], error: '' },
  })));
  await page.route('**/api/trade/assets/expert*', (route) => route.fulfill(json({ status: 'unavailable' })));
}

test('Wallet: Details zu SKMA, dann Handeln mit vorbelegtem Asset', async ({ page }) => {
  const fx = readFixtures();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockAssetBackend(page, fx);
  await openApp(page);
  await loadAccount(page, fx.main.public);

  const assets = page.getByTestId('wallet-home-assets');
  await expect(assets).toBeVisible({ timeout: 30000 });
  if (await page.getByTestId('wallet-home-assets-collapsed').count()) {
    await assets.locator('button[aria-controls="wallet-home-asset-list"]').click();
  }
  await page.getByRole('button', { name: 'Details zu SKMA' }).click();

  await expect(page).toHaveURL(new RegExp(`/assets/SKMA-${fx.issuer.public}$`));
  await expect(page.getByTestId('asset-detail-code')).toHaveText('SKMA');
  await expect(page.getByTestId('asset-detail-balance-value')).toContainText('SKMA', { timeout: 30000 });
  await expect(page.getByText('skm-e2e.example')).toBeVisible();
  await expectNoCrash(page);

  await page.getByTestId('asset-detail-trade').click();
  await expect(page).toHaveURL(/\/trading\/assets$/);
  await expect(page.getByPlaceholder('USDC, G... oder USDC:G...')).toHaveValue(`SKMA:${fx.issuer.public}`);
  await expect(page.getByText('Trustline vorhanden').first()).toBeVisible({ timeout: 30000 });
  await expectNoCrash(page);
  expect(errors).toEqual([]);
});

test('Wallet: Pool-Anteile mit Gegenwert, Filter nach Code', async ({ page }) => {
  const fx = readFixtures();
  await openApp(page);
  await loadAccount(page, fx.main.public);
  const assets = page.getByTestId('wallet-home-assets');
  await expect(assets).toBeVisible({ timeout: 30000 });
  if (await page.getByTestId('wallet-home-assets-collapsed').count()) {
    await assets.locator('button[aria-controls="wallet-home-asset-list"]').click();
  }
  // main haelt Pool Shares XLM/SKMA (Fixture): Paar und Gegenwert beider Assets. Der Text steht
  // auch in der Aktivitaet (Einzahlung der Fixture), deshalb auf die Asset-Liste eingrenzen.
  const list = page.locator('#wallet-home-asset-list');
  await expect(list.getByText('Pool XLM / SKMA')).toBeVisible({ timeout: 30000 });
  // Die Einzahlung der Fixture erscheint in der Aktivitaet mit Paar statt als namenlose Aktion
  await expect(page.getByText('In Pool eingezahlt').first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('activity-pool-label').first()).toHaveText('Pool XLM / SKMA');
  await expect(page.getByTestId('wallet-home-pool-value').first()).toContainText(/Gegenwert ≈ .* XLM \+ .* SKMA/);
  await page.getByTestId('wallet-home-asset-search').fill('SKMB');
  await expect(list).toContainText('SKMB');
  await expect(list).not.toContainText('Stellar Lumens');
  await expect(list).not.toContainText('Pool XLM / SKMA');
  await expectNoCrash(page);
});

test('Kaputter Asset-Link zeigt einen Hinweis', async ({ page }) => {
  await openApp(page);
  await page.goto('/assets/SKMA-GKAPUTT');
  await expect(page.getByTestId('asset-detail-invalid')).toBeVisible();
  await expectNoCrash(page);
});
