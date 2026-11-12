// Einstellungen: Loeschen mit Rueckfrage (Abbrechen loescht nichts, Ja loescht gezielt).
import { test, expect } from '@playwright/test';
import { openApp } from '../helpers.mjs';

test('Eingabeverlaeufe loeschen: Abbrechen behaelt, Ja loescht gezielt', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    localStorage.setItem('stm.hist.recipients', '["GTEST"]');
    localStorage.setItem('stm.decimalsMode', '4');
  });
  await page.goto('/settings');

  await page.getByRole('button', { name: 'Alle Textfeld-Verläufe löschen' }).click();
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  expect(await page.evaluate(() => localStorage.getItem('stm.hist.recipients'))).not.toBeNull();

  await page.getByRole('button', { name: 'Alle Textfeld-Verläufe löschen' }).click();
  await page.getByRole('button', { name: 'Ja', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('stm.hist.recipients'))).toBeNull();
  // Einstellungen bleiben erhalten.
  expect(await page.evaluate(() => localStorage.getItem('stm.decimalsMode'))).toBe('4');
});

test('Scam-Simulator-Statistik zuruecksetzen loescht nur den Scam-Teil', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    localStorage.setItem('skm.learn.progress.v1', JSON.stringify({ 'scam-simulator': { played: 3 }, quiz: { done: 2 } }));
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Scam-Simulator' }).last().click();
  await page.getByRole('button', { name: 'Zurücksetzen' }).click();
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  expect(await page.evaluate(() => localStorage.getItem('skm.learn.progress.v1'))).toContain('scam-simulator');

  await page.getByRole('button', { name: 'Zurücksetzen' }).click();
  await page.getByRole('button', { name: 'Ja', exact: true }).click();
  await expect(page.getByText('Statistiken wurden zurückgesetzt.')).toBeVisible();
  const raw = await page.evaluate(() => localStorage.getItem('skm.learn.progress.v1'));
  expect(raw).not.toContain('scam-simulator');
  expect(raw).toContain('quiz');
});
