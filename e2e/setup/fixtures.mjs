// Testnet-Fixtures fuer die E2E-Tests. Nur Testnet. Jeder Lauf legt frische Konten per Friendbot an,
// damit kein Test vom Zustand eines frueheren Laufs abhaengt.
//
// Konten:
//   main    Trustlines SKMA/SKMB, Guthaben, haelt Pool Shares (Regression: Meine Trustlines mit Pool-Konto)
//   lp      Trustline SKMA und Guthaben, ohne Pool Shares (Liquidity einzahlen/abheben in der UI)
//   cb      Claimable Balances (XLM, SKMA, SKMB), keine Trustlines (Einloesen, Batch-Convert)
//   issuer  gibt SKMA/SKMB aus und stellt den Markt (Offers XLM <-> SKMA/SKMB)
//
// Die Keys liegen nur in e2e/.fixtures/run.json (per .gitignore nicht versioniert, nur Testnet).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Horizon, Keypair, Asset, Operation, TransactionBuilder, Networks, Claimant,
  LiquidityPoolAsset, LiquidityPoolFeeV18, getLiquidityPoolId,
} from '@stellar/stellar-sdk';

export const HORIZON = 'https://horizon-testnet.stellar.org';
const FRIENDBOT = 'https://friendbot.stellar.org';
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = path.resolve(HERE, '..', '.fixtures');
export const FIXTURE_FILE = path.join(FIXTURE_DIR, 'run.json');
const server = new Horizon.Server(HORIZON);

async function fund(kp) {
  for (let i = 0; i < 3; i += 1) {
    const res = await fetch(`${FRIENDBOT}?addr=${kp.publicKey()}`);
    if (res.ok) return;
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw new Error(`Friendbot fehlgeschlagen fuer ${kp.publicKey()}`);
}

export async function submit(source, ops) {
  const account = await server.loadAccount(source.publicKey());
  const builder = new TransactionBuilder(account, { fee: '1000', networkPassphrase: Networks.TESTNET });
  ops.forEach((op) => builder.addOperation(op));
  const tx = builder.setTimeout(120).build();
  tx.sign(source);
  try {
    return await server.submitTransaction(tx);
  } catch (err) {
    throw new Error(`Testnet-Transaktion abgelehnt: ${JSON.stringify(err?.response?.data?.extras?.result_codes || err.message)}`);
  }
}

export function poolIdFor(a, b) {
  const [assetA, assetB] = Asset.compare(a, b) < 0 ? [a, b] : [b, a];
  return {
    asset: new LiquidityPoolAsset(assetA, assetB, LiquidityPoolFeeV18),
    id: Buffer.from(getLiquidityPoolId('constant_product', { assetA, assetB, fee: LiquidityPoolFeeV18 })).toString('hex'),
  };
}

export async function createFixtures() {
  const main = Keypair.random();
  const lp = Keypair.random();
  const cb = Keypair.random();
  const issuer = Keypair.random();
  await Promise.all([main, lp, cb, issuer].map(fund));

  const skma = new Asset('SKMA', issuer.publicKey());
  const skmb = new Asset('SKMB', issuer.publicKey());

  await submit(main, [Operation.changeTrust({ asset: skma }), Operation.changeTrust({ asset: skmb })]);
  await submit(lp, [Operation.changeTrust({ asset: skma })]);
  await submit(issuer, [
    Operation.payment({ destination: main.publicKey(), asset: skma, amount: '1000' }),
    Operation.payment({ destination: main.publicKey(), asset: skmb, amount: '1000' }),
    Operation.payment({ destination: lp.publicKey(), asset: skma, amount: '1000' }),
    // Markt: der Issuer kauft SKMA/SKMB fuer XLM, damit Swap und Batch-Convert nach XLM Kurs finden.
    Operation.manageSellOffer({ selling: Asset.native(), buying: skma, amount: '2000', price: '1' }),
    Operation.manageSellOffer({ selling: Asset.native(), buying: skmb, amount: '2000', price: '1' }),
  ]);

  // Pool XLM/SKMA mit Pool Shares fuer main.
  const pool = poolIdFor(Asset.native(), skma);
  await submit(main, [
    Operation.changeTrust({ asset: pool.asset }),
    Operation.liquidityPoolDeposit({
      liquidityPoolId: pool.id, maxAmountA: '100', maxAmountB: '100', minPrice: '0.5', maxPrice: '2',
    }),
  ]);

  const fixtures = {
    createdAt: new Date().toISOString(),
    horizon: HORIZON,
    issuer: { public: issuer.publicKey(), secret: issuer.secret() },
    main: { public: main.publicKey(), secret: main.secret() },
    lp: { public: lp.publicKey(), secret: lp.secret() },
    cb: { public: cb.publicKey(), secret: cb.secret() },
    assets: { skma: `SKMA:${issuer.publicKey()}`, skmb: `SKMB:${issuer.publicKey()}` },
    poolId: pool.id,
  };
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  fs.writeFileSync(FIXTURE_FILE, JSON.stringify(fixtures, null, 2), { mode: 0o600 });
  return fixtures;
}

export function readFixtures() {
  if (!fs.existsSync(FIXTURE_FILE)) {
    throw new Error('e2e/.fixtures/run.json fehlt. Die Fixtures legt globalSetup an (npm run test:e2e).');
  }
  return JSON.parse(fs.readFileSync(FIXTURE_FILE, 'utf8'));
}

// Legt Claimable Balances fuer das Konto cb an (XLM, SKMA, SKMB). Vor jedem Test, der sie verbraucht.
export async function createClaimables(fx) {
  const issuer = Keypair.fromSecret(fx.issuer.secret);
  const cb = Keypair.fromSecret(fx.cb.secret);
  const skma = new Asset('SKMA', issuer.publicKey());
  const skmb = new Asset('SKMB', issuer.publicKey());
  const claimants = [new Claimant(cb.publicKey())];
  await submit(issuer, [
    Operation.createClaimableBalance({ asset: Asset.native(), amount: '10', claimants }),
    Operation.createClaimableBalance({ asset: skma, amount: '100', claimants }),
    Operation.createClaimableBalance({ asset: skmb, amount: '100', claimants }),
  ]);
}

export async function accountBalances(publicKey) {
  const res = await fetch(`${HORIZON}/accounts/${publicKey}`);
  if (!res.ok) throw new Error(`Horizon ${res.status} fuer ${publicKey}`);
  return (await res.json()).balances;
}

export async function claimableCount(publicKey) {
  const res = await fetch(`${HORIZON}/claimable_balances?claimant=${publicKey}&limit=50`);
  return (await res.json())._embedded.records.length;
}

export function xlmOf(balances) {
  return Number(balances.find((b) => b.asset_type === 'native')?.balance || 0);
}
