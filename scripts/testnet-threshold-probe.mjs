#!/usr/bin/env node
// Einmaliger Beleg: Welche Schwelle verlangt das Stellar-Netz fuer reine Low-Transaktionen
// (bumpSequence, claimClaimableBalance)? Hintergrund: Plan Signer-Buendelung 9.1. Das Backend rechnet
// fuer solche Jobs mit med || low || high, das Frontend mit low. Vor einer Vereinheitlichung wird hier
// festgehalten, was das Netz tatsaechlich annimmt.
//
// Nur Testnet. Legt pro Fall frische Konten per Friendbot an. Keine Secrets werden gespeichert.
// Aufruf: node scripts/testnet-threshold-probe.mjs        (Dauer etwa 2 bis 3 Minuten)
// Seit 14.11. auch Medium (payment) und High (setOptions) mit Schwelle 0 (Faelle G bis K).
// Ausgabe: Tabelle auf der Konsole und als JSON (letzte Zeile).
import {
  Asset, Claimant, Horizon, Keypair, Networks, Operation, TransactionBuilder,
} from '@stellar/stellar-sdk';

const HORIZON = 'https://horizon-testnet.stellar.org';
const FRIENDBOT = 'https://friendbot.stellar.org';
const server = new Horizon.Server(HORIZON);

async function fund(kp) {
  for (let i = 0; i < 4; i += 1) {
    const res = await fetch(`${FRIENDBOT}?addr=${kp.publicKey()}`);
    if (res.ok) return;
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw new Error(`Friendbot fehlgeschlagen fuer ${kp.publicKey()}`);
}

async function build(sourceId, ops) {
  const account = await server.loadAccount(sourceId);
  const b = new TransactionBuilder(account, { fee: '1000', networkPassphrase: Networks.TESTNET });
  ops.forEach((op) => b.addOperation(op));
  return b.setTimeout(120).build();
}

// Sendet und liefert 'ok' oder die result_codes als Text.
async function trySubmit(tx) {
  try {
    await server.submitTransaction(tx);
    return 'ok';
  } catch (err) {
    const codes = err?.response?.data?.extras?.result_codes;
    return codes ? JSON.stringify(codes) : `error: ${err.message}`;
  }
}

async function mustSubmit(tx) {
  const r = await trySubmit(tx);
  if (r !== 'ok') throw new Error(`Setup abgelehnt: ${r}`);
}

async function claimableIdFor(accountId) {
  const page = await server.claimableBalances().claimant(accountId).limit(10).call();
  const rec = page.records[0];
  if (!rec) throw new Error('Claimable Balance nicht gefunden');
  return rec.id;
}

// Ein Fall: Konto A mit Master-Gewicht 1 und Signer B mit Gewicht 1, Schwellen wie angegeben.
// Gesendet wird je eine Transaktion pro Operation in ops (Standard: bumpSequence und
// claimClaimableBalance), signiert mit signWith. payment (Medium) zahlt 1 XLM an den Funder,
// setOptions (High) setzt nur die Home-Domain.
async function runCase(funder, { name, thresholds, signWith, ops = ['bumpSequence', 'claimClaimableBalance'] }) {
  const a = Keypair.random();
  const b = Keypair.random();
  await fund(a);

  // Claimable Balance fuer A anlegen (vom Funder).
  const cbTx = await build(funder.publicKey(), [
    Operation.createClaimableBalance({ asset: Asset.native(), amount: '1', claimants: [new Claimant(a.publicKey())] }),
  ]);
  cbTx.sign(funder);
  await mustSubmit(cbTx);

  // Signer B und Schwellen setzen (vor der Aenderung reicht der Master allein).
  const setTx = await build(a.publicKey(), [
    Operation.setOptions({ signer: { ed25519PublicKey: b.publicKey(), weight: 1 } }),
    Operation.setOptions({
      masterWeight: 1,
      lowThreshold: thresholds.low,
      medThreshold: thresholds.med,
      highThreshold: thresholds.high,
    }),
  ]);
  setTx.sign(a);
  await mustSubmit(setTx);

  const keys = { master: [a], both: [a, b], none: [] }[signWith];
  const result = { name, thresholds, signWith, weight: keys.length };

  for (const op of ops) {
    let operation;
    if (op === 'bumpSequence') {
      const account = await server.loadAccount(a.publicKey());
      operation = Operation.bumpSequence({ bumpTo: account.sequence });
    } else if (op === 'claimClaimableBalance') {
      operation = Operation.claimClaimableBalance({ balanceId: await claimableIdFor(a.publicKey()) });
    } else if (op === 'payment') {
      operation = Operation.payment({ destination: funder.publicKey(), asset: Asset.native(), amount: '1' });
    } else if (op === 'setOptions') {
      operation = Operation.setOptions({ homeDomain: 'probe.example' });
    } else {
      throw new Error(`unbekannte Operation ${op}`);
    }
    const tx = await build(a.publicKey(), [operation]);
    keys.forEach((k) => tx.sign(k));
    result[op] = await trySubmit(tx);
  }
  return result;
}

const CASES = [
  { name: 'A low=1 med=2 high=2, Gewicht 1', thresholds: { low: 1, med: 2, high: 2 }, signWith: 'master' },
  { name: 'B low=0 med=2 high=2, Gewicht 1', thresholds: { low: 0, med: 2, high: 2 }, signWith: 'master' },
  { name: 'C low=0 med=0 high=0, Gewicht 1', thresholds: { low: 0, med: 0, high: 0 }, signWith: 'master' },
  { name: 'D low=2 med=2 high=2, Gewicht 1 (Gegenprobe)', thresholds: { low: 2, med: 2, high: 2 }, signWith: 'master' },
  { name: 'E low=2 med=2 high=2, Gewicht 2', thresholds: { low: 2, med: 2, high: 2 }, signWith: 'both' },
  { name: 'F low=0 med=2 high=2, ohne Signatur', thresholds: { low: 0, med: 2, high: 2 }, signWith: 'none' },
  // Medium und High mit Schwelle 0 (Backend und Frontend nehmen heute die naechste Schwelle)
  { name: 'G low=1 med=0 high=2, Gewicht 1', thresholds: { low: 1, med: 0, high: 2 }, signWith: 'master', ops: ['payment', 'setOptions'] },
  { name: 'H low=2 med=0 high=0, Gewicht 1', thresholds: { low: 2, med: 0, high: 0 }, signWith: 'master', ops: ['payment', 'setOptions'] },
  { name: 'I low=1 med=2 high=0, Gewicht 1', thresholds: { low: 1, med: 2, high: 0 }, signWith: 'master', ops: ['setOptions'] },
  { name: 'J low=0 med=0 high=0, ohne Signatur', thresholds: { low: 0, med: 0, high: 0 }, signWith: 'none', ops: ['payment', 'setOptions'] },
  { name: 'K low=1 med=2 high=2, Gewicht 1 (Gegenprobe)', thresholds: { low: 1, med: 2, high: 2 }, signWith: 'master', ops: ['payment', 'setOptions'] },
];

async function main() {
  const funder = Keypair.random();
  await fund(funder);
  const results = [];
  for (const c of CASES) {
    process.stdout.write(`${c.name} ... `);
    try {
      const r = await runCase(funder, c);
      results.push(r);
      console.log((c.ops || ['bumpSequence', 'claimClaimableBalance']).map((op) => `${op}=${r[op]}`).join(' '));
    } catch (e) {
      results.push({ name: c.name, error: e.message });
      console.log(`Setup-Fehler: ${e.message}`);
    }
  }
  console.log('\nJSON:');
  console.log(JSON.stringify({ date: new Date().toISOString(), results }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
