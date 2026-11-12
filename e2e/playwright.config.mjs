import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// Ergebnisse, Bericht und Traces liegen unter e2e/.results/ (nicht versioniert).
const RESULTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.results');

// E2E gegen das Testnet (siehe docs/testing.md). Frontend lokal, Backend wird nicht gebraucht.
// Start:  npm run test:e2e   (legt Fixtures an, startet Vite falls noetig, schreibt e2e/.last-run.json)
export default defineConfig({
  testDir: './specs',
  // E2E_OFFLINE=1: nur Specs, die kein Testnet brauchen (Konto-Guards, Einstellungen).
  testMatch: process.env.E2E_OFFLINE ? /(accountGuards|settings)\.spec\.mjs$/ : /\.spec\.mjs$/,
  globalSetup: './setup/global-setup.mjs',
  timeout: 120000,
  expect: { timeout: 15000 },
  workers: 1,
  retries: 1,
  outputDir: path.join(RESULTS, 'artifacts'),
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(RESULTS, 'results.json') }],
    ['html', { open: 'never', outputFolder: path.join(RESULTS, 'report') }],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    viewport: { width: 900, height: 1000 },
    locale: 'de-DE',
    // Fehlende Elemente schlagen nach 15 s fehl statt erst am Test-Timeout (2 min).
    actionTimeout: 15000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 900, height: 1000 } } }],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'npm run dev --prefix ../frontend -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
