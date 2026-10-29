// Testnet-Setup fuer den manuellen Test der Liquidity Pools (Stufe 2a/2b).
// Nur Testnet. Legt Konten per Friendbot an, gibt Test-Assets aus, eroeffnet Pools
// und schreibt Keys und Pool-IDs nach testnet_lp_konten.md (per .gitignore *.md nicht versioniert).
//
//   node scripts/dev/testnetLiquiditySetup.mjs              Setup
//   node scripts/dev/testnetLiquiditySetup.mjs --move up     Kurs XLM/TESTLP verschieben (XLM -> TESTLP)
//   node scripts/dev/testnetLiquiditySetup.mjs --move down   Kurs zurueck (TESTLP -> XLM)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Horizon, Keypair, Asset, Operation, TransactionBuilder, Networks,
  LiquidityPoolAsset, LiquidityPoolFeeV18, getLiquidityPoolId,
  AuthRevocableFlag, AuthClawbackEnabledFlag,
} from '@stellar/stellar-sdk';

const HORIZON = 'https://horizon-testnet.stellar.org';
const FRIENDBOT = 'https://friendbot.stellar.org';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'testnet_lp_konten.md');
const server = new Horizon.Server(HORIZON);

async function fund(kp) {
  const res = await fetch(`${FRIENDBOT}?addr=${kp.publicKey()}`);
  if (!res.ok) throw new Error(`Friendbot ${res.status} fuer ${kp.publicKey()}`);
}

async function submit(source, ops, signers = [source]) {
  const account = await server.loadAccount(source.publicKey());
  const builder = new TransactionBuilder(account, { fee: '1000', networkPassphrase: Networks.TESTNET });
  ops.forEach((op) => builder.addOperation(op));
  const tx = builder.setTimeout(120).build();
  signers.forEach((s) => tx.sign(s));
  try {
    return await server.submitTransaction(tx);
  } catch (err) {
    console.error('Fehler:', JSON.stringify(err?.response?.data?.extras?.result_codes || err.message));
    throw err;
  }
}

function pool(a, b) {
  const [assetA, assetB] = Asset.compare(a, b) < 0 ? [a, b] : [b, a];
  return {
    asset: new LiquidityPoolAsset(assetA, assetB, LiquidityPoolFeeV18),
    // SDK v16 liefert ein Uint8Array, kein Buffer: daher Buffer.from(...).
    id: Buffer.from(getLiquidityPoolId('constant_product', { assetA, assetB, fee: LiquidityPoolFeeV18 })).toString('hex'),
  };
}

function save(k, extra = {}) {
  const data = {
    accounts: Object.fromEntries(Object.entries(k).map(([n, kp]) => [n, { public: kp.publicKey(), secret: kp.secret() }])),
    ...extra,
  };
  const rows = Object.entries(data.accounts).map(([n, a]) => `| ${n} | \`${a.public}\` | \`${a.secret}\` |`).join('\n');
  const pools = data.pools
    ? `Pools:\n- XLM/TESTLP: \`${data.pools.xlmTest}\`\n- XLM/CLAWLP (Clawback): \`${data.pools.xlmClaw}\`\n- XLM/EMPTYLP (leer): \`${data.pools.xlmEmpty}\`\n\n`
    : '';
  fs.writeFileSync(OUT, `# Testnet LP-Testkonten (nur Testnet!)\n\nStand: ${new Date().toISOString()}${data.done ? '' : ' (Setup nicht abgeschlossen)'}\n\n| Rolle | Public Key | Secret Key |\n|---|---|---|\n${rows}\n\n${pools}`
    + `\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`);
}

async function step(label, fn) {
  console.log(`${label} ...`);
  try {
    await fn();
  } catch (err) {
    console.error(`FEHLGESCHLAGEN: ${label}: ${err?.message || err}`);
    throw err;
  }
}

async function setup() {
  const k = {
    issuer: Keypair.random(), clawIssuer: Keypair.random(), seeder: Keypair.random(),
    user: Keypair.random(), msig: Keypair.random(), msigSigner2: Keypair.random(),
  };
  const TEST = new Asset('TESTLP', k.issuer.publicKey());
  const EMPTY = new Asset('EMPTYLP', k.issuer.publicKey());
  const CLAW = new Asset('CLAWLP', k.clawIssuer.publicKey());
  const pTest = pool(Asset.native(), TEST);
  const pClaw = pool(Asset.native(), CLAW);
  const pEmpty = pool(Asset.native(), EMPTY);
  const extra = {
    pools: { xlmTest: pTest.id, xlmClaw: pClaw.id, xlmEmpty: pEmpty.id },
    assets: { TESTLP: k.issuer.publicKey(), EMPTYLP: k.issuer.publicKey(), CLAWLP: k.clawIssuer.publicKey() },
  };
  // Sofort speichern, damit die Keys auch bei einem Abbruch erhalten bleiben.
  save(k, extra);

  await step('Konten per Friendbot anlegen', () => Promise.all(['issuer', 'clawIssuer', 'seeder', 'user', 'msig'].map((n) => fund(k[n]))));
  await step('Clawback-Issuer konfigurieren', () => submit(k.clawIssuer, [Operation.setOptions({ setFlags: AuthRevocableFlag | AuthClawbackEnabledFlag })]));
  await step('Trustlines Seeder', () => submit(k.seeder, [TEST, EMPTY, CLAW].map((asset) => Operation.changeTrust({ asset }))));
  await step('Trustlines Nutzer', () => submit(k.user, [TEST, CLAW].map((asset) => Operation.changeTrust({ asset }))));
  await step('Trustline Multisig-Konto', () => submit(k.msig, [Operation.changeTrust({ asset: TEST })]));
  await step('TESTLP ausgeben', () => submit(k.issuer, [
    Operation.payment({ destination: k.seeder.publicKey(), asset: TEST, amount: '100000' }),
    Operation.payment({ destination: k.user.publicKey(), asset: TEST, amount: '5000' }),
    Operation.payment({ destination: k.msig.publicKey(), asset: TEST, amount: '5000' }),
  ]));
  await step('CLAWLP ausgeben', () => submit(k.clawIssuer, [
    Operation.payment({ destination: k.seeder.publicKey(), asset: CLAW, amount: '100000' }),
    Operation.payment({ destination: k.user.publicKey(), asset: CLAW, amount: '5000' }),
  ]));
  // XLM ist kanonisch immer A. Startkurs 0.1 XLM je Token.
  await step('Pool XLM/TESTLP eroeffnen und befuellen', () => submit(k.seeder, [
    Operation.changeTrust({ asset: pTest.asset }),
    Operation.liquidityPoolDeposit({ liquidityPoolId: pTest.id, maxAmountA: '1000', maxAmountB: '10000', minPrice: '0.09', maxPrice: '0.11' }),
  ]));
  await step('Pool XLM/EMPTYLP eroeffnen (leer)', () => submit(k.seeder, [Operation.changeTrust({ asset: pEmpty.asset })]));
  await step('Multisig-Konto: zweiter Signer, Med/High-Threshold 2', () => submit(k.msig, [Operation.setOptions({
    signer: { ed25519PublicKey: k.msigSigner2.publicKey(), weight: 1 },
    masterWeight: 1, lowThreshold: 1, medThreshold: 2, highThreshold: 2,
  })]));
  save(k, { ...extra, done: true });
  // Zuletzt, damit ein Fehlschlag hier den Rest nicht verhindert: prueft zugleich, ob Clawback-Assets poolfaehig sind.
  try {
    await step('Pool XLM/CLAWLP eroeffnen und befuellen (Clawback-Asset)', () => submit(k.seeder, [
      Operation.changeTrust({ asset: pClaw.asset }),
      Operation.liquidityPoolDeposit({ liquidityPoolId: pClaw.id, maxAmountA: '1000', maxAmountB: '10000', minPrice: '0.09', maxPrice: '0.11' }),
    ]));
  } catch {
    console.error('Hinweis: Pool mit Clawback-Asset liess sich nicht anlegen. Bitte die Fehlercodes oben melden.');
  }
  console.log(`Fertig. Daten in ${OUT}`);
}

async function move(direction) {
  const md = fs.readFileSync(OUT, 'utf8');
  const data = JSON.parse(md.slice(md.indexOf('```json') + 7, md.lastIndexOf('```')));
  const seeder = Keypair.fromSecret(data.accounts.seeder.secret);
  const TEST = new Asset('TESTLP', data.assets.TESTLP);
  const up = direction !== 'down';
  await submit(seeder, [Operation.pathPaymentStrictSend({
    sendAsset: up ? Asset.native() : TEST,
    sendAmount: up ? '30' : '300',
    destination: seeder.publicKey(),
    destAsset: up ? TEST : Asset.native(),
    destMin: '0.0000001',
    path: [],
  })]);
  const rec = await server.liquidityPools().liquidityPoolId(data.pools.xlmTest).call();
  console.log('Neue Reserven:', rec.reserves.map((r) => `${r.amount} ${r.asset.split(':')[0]}`).join(' / '));
}

const idx = process.argv.indexOf('--move');
(idx >= 0 ? move(process.argv[idx + 1]) : setup()).catch(() => process.exit(1));
