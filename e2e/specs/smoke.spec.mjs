// Smoke-Crawl: oeffnet jeden Menuepunkt mit Konten, die Trustlines, Pool Shares und Offers halten,
// und prueft, dass die Seite nicht abstuerzt (ErrorBoundary-Text, unbehandelte Fehler im Browser).
// Hintergrund: "Meine Trustlines" stuerzte bei Pool Shares ab und fiel nur beim manuellen Durchklicken auf.
import { test, expect } from '@playwright/test';
import { readFixtures } from '../setup/fixtures.mjs';
import { openApp, loadAccount, expectNoCrash } from '../helpers.mjs';

test.setTimeout(240000);

async function menuIds(page) {
  await page.locator('header button').first().click();
  const ids = await page.locator('[data-nav-id]').evaluateAll((els) => els.map((el) => el.getAttribute('data-nav-id')));
  await page.keyboard.press('Escape');
  return [...new Set(ids.filter(Boolean))];
}

for (const who of ['main', 'issuer']) {
  test(`Alle Menuepunkte oeffnen ohne Absturz (Konto ${who})`, async ({ page }) => {
    const fx = readFixtures();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await openApp(page);
    await loadAccount(page, fx[who].public);

    const ids = await menuIds(page);
    expect(ids.length, 'Menuepunkte gefunden').toBeGreaterThan(5);

    for (const id of ids) {
      // Drawer oeffnen, Eintrag per DOM-Klick ausloesen (auch eingeklappte Untereintraege).
      if (await page.locator(`[data-nav-id="${id}"]`).count() === 0) {
        await page.locator('header button').first().click();
      }
      const item = page.locator(`[data-nav-id="${id}"]`).first();
      if (await item.count() === 0) continue;
      await item.evaluate((el) => el.click());
      await page.waitForTimeout(800);
      await expectNoCrash(page);
      expect(errors, `Browser-Fehler nach Menuepunkt ${id}`).toEqual([]);
    }
  });
}
