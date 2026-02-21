/**
 * testnetDemo.js
 *
 * Testnet-Demo-Utilities für den Scam-Simulator.
 * Simuliert ein „Konto leeren" auf dem Stellar Testnet, damit Nutzer
 * live erleben können, was beim Teilen eines Secret Keys passiert.
 *
 * Strategie: vollständig ephemere Keypairs (Keypair.random()).
 *   – Keine gespeicherten Keys, keine Wartung, kein Testnet-Reset-Problem.
 *   – Jeder Simulationslauf erzeugt frische Demo-Konten.
 *   – Keys leben nur im RAM dieser Browser-Session.
 *
 * Token-Setup:
 *   Ein Issuer-Konto emittiert drei Custom-Tokens (USDC, yXLM, BTC) und
 *   überweist sie ans Demo-Konto. Die Drain-Sequenz leert Token für Token,
 *   dann die XLM – für maximalen dramatischen Effekt.
 *
 * Öffentliche API:
 *   setupDemoAccounts()                                      → { issuerKeypair, demoKeypair, scammerKeypair }
 *   createTrustlines(demoKeypair, issuerPublicKey)           → txHash
 *   createScammerTrustlines(scammerKeypair, issuerPublicKey) → txHash
 *   fundDemoWithTokens(issuerKeypair, demoPublicKey)         → txHash
 *   getFullBalance(publicKey)                                → { xlm, usdc, yxlm, btc }
 *   drainAccount(demoKeypair, scammerPublicKey,
 *                issuerPublicKey, onProgress?)               → { hashes, explorerUrls }
 */

import {
  Keypair,
  Networks,
  TransactionBuilder,
  Operation,
  Asset,
  BASE_FEE,
  Horizon,
} from '@stellar/stellar-sdk';

// ── Konfiguration ─────────────────────────────────────────────────────────────

const HORIZON_TESTNET = 'https://horizon-testnet.stellar.org';
const FRIENDBOT_URL   = 'https://friendbot.stellar.org';

const POLL_INTERVAL_MS = 600;
const POLL_TIMEOUT_MS  = 20_000;

/** Token-Mengen, die das Issuer-Konto ans Demo-Konto überweist */
const USDC_AMOUNT = '250';
const YXLM_AMOUNT = '500';
const BTC_AMOUNT  = '0.05';

// ── Interne Hilfsfunktionen ───────────────────────────────────────────────────

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function getServer() {
  return new Horizon.Server(HORIZON_TESTNET);
}

/**
 * Erstellt die drei Custom-Token-Assets für einen Issuer.
 * @param {string} issuerPublicKey
 * @returns {{ usdc: Asset, yxlm: Asset, btc: Asset }}
 */
function makeAssets(issuerPublicKey) {
  return {
    usdc: new Asset('USDC', issuerPublicKey),
    yxlm: new Asset('yXLM', issuerPublicKey),
    btc:  new Asset('BTC',  issuerPublicKey),
  };
}

/**
 * Ruft Friendbot auf, um ein Testnet-Konto mit XLM zu finanzieren.
 * Netzwerkfehler werden ignoriert – Polling klärt den Zustand.
 */
async function fundViaFriendbot(publicKey) {
  try {
    await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`);
  } catch { /* Polling bestätigt den Zustand */ }
}

/**
 * Fragt den nativen XLM-Saldo eines Kontos ab.
 * @param {string} publicKey
 * @returns {Promise<string>} Saldo oder '0' bei 404.
 */
async function getNativeBalance(publicKey) {
  try {
    const account = await getServer().loadAccount(publicKey);
    return account.balances.find((b) => b.asset_type === 'native')?.balance ?? '0';
  } catch (err) {
    if (err?.response?.status === 404) return '0';
    throw err;
  }
}

/**
 * Pollt Horizon bis das Konto sichtbar ist oder POLL_TIMEOUT_MS abgelaufen sind.
 * @param {string} publicKey
 * @returns {Promise<string>} XLM-Saldo sobald > '0', sonst '0'.
 */
async function pollUntilVisible(publicKey) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const balance = await getNativeBalance(publicKey);
      if (balance !== '0') return balance;
    } catch { /* noch nicht sichtbar */ }
    await sleep(POLL_INTERVAL_MS);
  }
  return await getNativeBalance(publicKey).catch(() => '0');
}

// ── Öffentliche API ───────────────────────────────────────────────────────────

/**
 * Schritt 1 – Konten einrichten.
 *
 * Generiert drei ephemere Keypairs (Issuer, Demo, Scammer) und finanziert
 * alle drei parallel via Friendbot. Wartet, bis alle Konten auf Horizon
 * sichtbar sind, bevor es zurückgibt.
 *
 * @returns {Promise<{
 *   issuerKeypair:  Keypair,
 *   demoKeypair:    Keypair,
 *   scammerKeypair: Keypair,
 * }>}
 */
export async function setupDemoAccounts() {
  const issuerKeypair  = Keypair.random();
  const demoKeypair    = Keypair.random();
  const scammerKeypair = Keypair.random();

  // Alle drei gleichzeitig via Friendbot finanzieren
  await Promise.all([
    fundViaFriendbot(issuerKeypair.publicKey()),
    fundViaFriendbot(demoKeypair.publicKey()),
    fundViaFriendbot(scammerKeypair.publicKey()),
  ]);

  // Warten bis alle drei auf Horizon sichtbar sind
  await Promise.all([
    pollUntilVisible(issuerKeypair.publicKey()),
    pollUntilVisible(demoKeypair.publicKey()),
    pollUntilVisible(scammerKeypair.publicKey()),
  ]);

  return { issuerKeypair, demoKeypair, scammerKeypair };
}

/**
 * Schritt 2 – Trustlines auf dem Demo-Konto anlegen.
 *
 * Eine Transaktion mit drei ChangeTrust-Operationen:
 *   USDC:issuer  (limit 10.000)
 *   yXLM:issuer  (limit 10.000)
 *   BTC:issuer   (limit 1)
 *
 * Muss vor fundDemoWithTokens() aufgerufen werden.
 *
 * @param {Keypair} demoKeypair
 * @param {string}  issuerPublicKey
 * @returns {Promise<string>} txHash
 */
export async function createTrustlines(demoKeypair, issuerPublicKey) {
  const server = getServer();
  const account = await server.loadAccount(demoKeypair.publicKey());
  const { usdc, yxlm, btc } = makeAssets(issuerPublicKey);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.changeTrust({ asset: usdc, limit: '10000' }))
    .addOperation(Operation.changeTrust({ asset: yxlm, limit: '10000' }))
    .addOperation(Operation.changeTrust({ asset: btc,  limit: '1' }))
    .setTimeout(30)
    .build();

  tx.sign(demoKeypair);
  const result = await server.submitTransaction(tx);
  return result.hash;
}

/**
 * Trustlines auf dem Scammer-Konto anlegen.
 *
 * Identische Struktur wie createTrustlines(). Scammer braucht Trustlines,
 * damit er Token-Payments empfangen kann.
 *
 * @param {Keypair} scammerKeypair
 * @param {string}  issuerPublicKey
 * @returns {Promise<string>} txHash
 */
export async function createScammerTrustlines(scammerKeypair, issuerPublicKey) {
  const server = getServer();
  const account = await server.loadAccount(scammerKeypair.publicKey());
  const { usdc, yxlm, btc } = makeAssets(issuerPublicKey);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.changeTrust({ asset: usdc, limit: '10000' }))
    .addOperation(Operation.changeTrust({ asset: yxlm, limit: '10000' }))
    .addOperation(Operation.changeTrust({ asset: btc,  limit: '1' }))
    .setTimeout(30)
    .build();

  tx.sign(scammerKeypair);
  const result = await server.submitTransaction(tx);
  return result.hash;
}

/**
 * Schritt 3 – Demo-Konto mit Token befüllen.
 *
 * Überweist in einer Transaktion vom Issuer ans Demo-Konto:
 *   250 USDC · 500 yXLM · 0.05 BTC
 *
 * Setzt voraus, dass createTrustlines() bereits ausgeführt wurde.
 *
 * @param {Keypair} issuerKeypair
 * @param {string}  demoPublicKey
 * @returns {Promise<string>} txHash
 */
export async function fundDemoWithTokens(issuerKeypair, demoPublicKey) {
  const server = getServer();
  const account = await server.loadAccount(issuerKeypair.publicKey());
  const { usdc, yxlm, btc } = makeAssets(issuerKeypair.publicKey());

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({ destination: demoPublicKey, asset: usdc, amount: USDC_AMOUNT }))
    .addOperation(Operation.payment({ destination: demoPublicKey, asset: yxlm, amount: YXLM_AMOUNT }))
    .addOperation(Operation.payment({ destination: demoPublicKey, asset: btc,  amount: BTC_AMOUNT }))
    .setTimeout(30)
    .build();

  tx.sign(issuerKeypair);
  const result = await server.submitTransaction(tx);
  return result.hash;
}

/**
 * Schritt 4 – Alle Guthaben eines Kontos abfragen.
 *
 * @param {string} publicKey
 * @returns {Promise<{ xlm: string, usdc: string, yxlm: string, btc: string }>}
 */
export async function getFullBalance(publicKey) {
  const account = await getServer().loadAccount(publicKey);
  const findToken = (code) =>
    account.balances.find((b) => b.asset_code === code)?.balance ?? '0';

  return {
    xlm:  account.balances.find((b) => b.asset_type === 'native')?.balance ?? '0',
    usdc: findToken('USDC'),
    yxlm: findToken('yXLM'),
    btc:  findToken('BTC'),
  };
}

/**
 * Schritt 5 – Demo-Konto vollständig leeren.
 *
 * Führt fünf Transaktionen sequenziell aus (1s Pause dazwischen):
 *
 *   TX 1 – alle USDC → Scammer
 *   TX 2 – alle yXLM → Scammer
 *   TX 3 – alle BTC  → Scammer
 *   TX 4 – Trustlines entfernen (ChangeTrust limit 0)
 *   TX 5 – AccountMerge → Scammer   (alle XLM, Konto wird gelöscht)
 *
 * Setzt voraus, dass createScammerTrustlines() bereits aufgerufen wurde.
 *
 * Der optionale onProgress-Callback wird vor jeder TX aufgerufen:
 *   onProgress(currentStep: number, totalSteps: number)
 *
 * @param {Keypair}  demoKeypair
 * @param {string}   scammerPublicKey
 * @param {string}   issuerPublicKey
 * @param {Function} [onProgress]
 * @returns {Promise<{ hashes: string[], explorerUrls: string[] }>}
 */
export async function drainAccount(demoKeypair, scammerPublicKey, issuerPublicKey, onProgress) {
  const server = getServer();
  const hashes = [];
  const TOTAL  = 5;
  const report = (step) => onProgress?.(step, TOTAL);

  const { usdc, yxlm, btc } = makeAssets(issuerPublicKey);
  const demoPublicKey = demoKeypair.publicKey();

  // Aktuelle Token-Bestände abrufen (einmalig am Anfang)
  const balances = await getFullBalance(demoPublicKey);

  /** Baut eine Transaktion aus einer einzelnen Operation und sendet sie ab. */
  async function submitOp(addOpFn) {
    const account = await server.loadAccount(demoPublicKey);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    });
    addOpFn(tx);
    const built = tx.setTimeout(30).build();
    built.sign(demoKeypair);
    const result = await server.submitTransaction(built);
    hashes.push(result.hash);
    return result.hash;
  }

  // ── TX 1: USDC ─────────────────────────────────────────────────────────────
  report(1);
  if (parseFloat(balances.usdc) > 0) {
    await submitOp((tx) =>
      tx.addOperation(Operation.payment({
        destination: scammerPublicKey,
        asset: usdc,
        amount: balances.usdc,
      }))
    );
  }
  await sleep(1000);

  // ── TX 2: yXLM ─────────────────────────────────────────────────────────────
  report(2);
  if (parseFloat(balances.yxlm) > 0) {
    await submitOp((tx) =>
      tx.addOperation(Operation.payment({
        destination: scammerPublicKey,
        asset: yxlm,
        amount: balances.yxlm,
      }))
    );
  }
  await sleep(1000);

  // ── TX 3: BTC ──────────────────────────────────────────────────────────────
  report(3);
  if (parseFloat(balances.btc) > 0) {
    await submitOp((tx) =>
      tx.addOperation(Operation.payment({
        destination: scammerPublicKey,
        asset: btc,
        amount: balances.btc,
      }))
    );
  }
  await sleep(1000);

  // ── TX 4: Trustlines entfernen ─────────────────────────────────────────────
  // ChangeTrust mit limit '0' entfernt die Trustline (nur möglich wenn Saldo = 0)
  report(4);
  {
    const account = await server.loadAccount(demoPublicKey);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.changeTrust({ asset: usdc, limit: '0' }))
      .addOperation(Operation.changeTrust({ asset: yxlm, limit: '0' }))
      .addOperation(Operation.changeTrust({ asset: btc,  limit: '0' }))
      .setTimeout(30)
      .build();
    tx.sign(demoKeypair);
    const result = await server.submitTransaction(tx);
    hashes.push(result.hash);
  }
  await sleep(1000);

  // ── TX 5: AccountMerge → Scammer (alle XLM, Konto wird gelöscht) ───────────
  report(5);
  {
    const account = await server.loadAccount(demoPublicKey);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.accountMerge({ destination: scammerPublicKey }))
      .setTimeout(30)
      .build();
    tx.sign(demoKeypair);
    const result = await server.submitTransaction(tx);
    hashes.push(result.hash);
  }

  const explorerBase = 'https://stellar.expert/explorer/testnet/tx/';
  return {
    hashes,
    explorerUrls: hashes.map((h) => `${explorerBase}${h}`),
  };
}
