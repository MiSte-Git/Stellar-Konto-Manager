import { createFixtures } from './fixtures.mjs';

export default async function globalSetup() {
  // E2E_OFFLINE=1: nur Specs ohne Testnet (siehe playwright.config.mjs), keine Fixtures noetig.
  if (process.env.E2E_OFFLINE) return;
  const fx = await createFixtures();
  console.log(`[e2e] Testnet-Fixtures angelegt: main ${fx.main.public.slice(0, 8)}…, Pool ${fx.poolId.slice(0, 8)}…`);
}
