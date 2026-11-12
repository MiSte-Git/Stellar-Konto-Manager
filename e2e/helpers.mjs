// Gemeinsame Helfer fuer die E2E-Specs. Alle Selektoren nutzen sichtbare deutsche Texte der UI.
// Aendert sich ein Text oder Ablauf, schlaegt der Test fehl: dann Spec UND docs/testing.md anpassen.
import { expect } from '@playwright/test';

export const CRASH_TEXT = 'Etwas ist schiefgelaufen';

// App oeffnen, Testnet vorwaehlen. Secret Keys werden nirgends vorbelegt.
export async function openApp(page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
      window.localStorage.setItem('SKM_NET_INIT', '1');
    } catch { /* noop */ }
  });
  await page.goto('/');
  await expect(page.getByText('Testnet').first()).toBeVisible();
}

// Konto ueber den Public Key laden (nur ansehen). Wartet, bis das XLM-Guthaben erscheint.
export async function loadAccount(page, publicKey) {
  const input = page.getByPlaceholder(/Public Key oder eine Föderationsadresse/).first();
  await input.click();
  await input.fill(publicKey);
  await input.press('Enter');
  const loaded = page.getByText(/XLM:\s*[\d']/).first();
  try {
    await expect(loaded).toBeVisible({ timeout: 8000 });
  } catch {
    // Enter reicht nicht immer: Eintrag aus dem Verlauf-Dropdown waehlen.
    await page.getByText(publicKey, { exact: true }).first().click();
    await expect(loaded).toBeVisible({ timeout: 15000 });
  }
}

// Seitenmenue oeffnen und einen Eintrag waehlen (das Menue ist ein Drawer links).
export async function openMenuItem(page, name) {
  await page.locator('header button').first().click();
  await page.getByRole('button', { name, exact: true }).click();
}

// Secret-Key-Dialog: Key eintragen und "Senden". Nur fuer Testnet-Keys aus den Fixtures.
export async function signWithKey(page, secret) {
  const input = page.locator('input[type=password]').first();
  await expect(input).toBeVisible({ timeout: 15000 });
  await input.fill(secret);
  await page.getByRole('button', { name: 'Senden', exact: true }).click();
}

export async function expectNoCrash(page) {
  await expect(page.getByText(CRASH_TEXT)).toHaveCount(0);
}

// Wartet, bis der Zustand im Netz sichtbar ist (Horizon braucht ein paar Sekunden).
export async function pollUntil(fn, { timeout = 30000, interval = 1500 } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error('pollUntil: Zeitueberschreitung');
}
