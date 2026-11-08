#!/usr/bin/env node
// F10 (review_runde1_opus.md): Prueft eine Kopie der produktiven Job-Datei auf Altjobs von
// vor dem K1-Fix (2dbfdf3), bei denen accountId nicht dem Basiskonto der Tx-Quelle entspricht,
// und auf Jobs mit Operationen fremder Quellkonten (F2). Solche Jobs nehmen keine Signaturen
// mehr an, ihr XDR mit bereits gesammelten Signaturen bleibt aber gespeichert. Ist die
// Transaktion noch einloesbar, kann sie jeder mit Zugriff einreichen.
//
// Nur lesend. Die Datei enthaelt Zugriffstokens und signierte XDRs: ausserhalb des Repos
// ablegen und danach loeschen.
//
//   scp cyon-skm:public_html/SKM/api/data/multisig_jobs.json /tmp/skm_jobs.json
//   node scripts/check-legacy-jobs.js /tmp/skm_jobs.json            (offline)
//   node scripts/check-legacy-jobs.js /tmp/skm_jobs.json --horizon  (fragt Sequenzen ab)
//   rm /tmp/skm_jobs.json
'use strict';

const fs = require('fs');
const { Horizon, Networks, StrKey, TransactionBuilder } = require('@stellar/stellar-sdk');
const { txSourceBaseAccount } = require('../services/txSignatures.js');

const HORIZON = {
  public: { url: 'https://horizon.stellar.org', passphrase: Networks.PUBLIC },
  testnet: { url: 'https://horizon-testnet.stellar.org', passphrase: Networks.TESTNET },
};
const FINAL = new Set(['submitted_success', 'submitted_failed', 'expired', 'obsolete_seq']);

function baseOf(address) {
  const a = String(address || '');
  if (StrKey.isValidMed25519PublicKey(a)) return StrKey.encodeEd25519PublicKey(StrKey.decodeMed25519PublicKey(a).subarray(0, 32));
  return a;
}

function decode(job) {
  const net = HORIZON[String(job.network || '').toLowerCase()];
  const xdr = job.txXdrCurrent || job.txXdrOriginal || '';
  if (!net || !xdr) return { error: net ? 'kein XDR' : `unbekanntes Netz ${job.network}` };
  try {
    return { tx: TransactionBuilder.fromXDR(xdr, net.passphrase), net };
  } catch (e) {
    return { error: `XDR nicht lesbar: ${e.message}` };
  }
}

async function liveSequenceState(net, account, tx) {
  try {
    const server = new Horizon.Server(net.url);
    const acc = await server.loadAccount(account);
    const current = BigInt(acc.sequenceNumber());
    const txSeq = BigInt((tx.innerTransaction || tx).sequence);
    if (txSeq === current + 1n) return 'noch einloesbar (Sequence passt)';
    if (txSeq <= current) return 'verbraucht (Sequence ueberholt)';
    return `Sequence liegt in der Zukunft (Konto ${current}, Tx ${txSeq})`;
  } catch (e) {
    return `Horizon-Fehler: ${e?.response?.status || e.message}`;
  }
}

// Prueft einen Job. Liefert null, wenn er unauffaellig ist, sonst { job, kind, detail, risky }.
// Fee-Bump (nur Altjobs aus PHP): txSourceBaseAccount kennt dafuer keine Quelle (null). Hier zaehlt
// die innere Transaktion, weil deren Sequence und Quelle der Widerruf trifft. Das Konto wird
// gegen die innere Quelle verglichen, der Fee-Bump selbst wird gesondert gemeldet.
async function inspectJob(job, { now = Math.floor(Date.now() / 1000), useHorizon = false } = {}) {
  const { tx, net, error } = decode(job);
  if (!tx) return { job, kind: 'nicht pruefbar', detail: error };
  const feeBump = !!tx.innerTransaction;
  const inner = tx.innerTransaction || tx;
  const source = txSourceBaseAccount(inner);
  const accountId = String(job.accountId || '');
  const mismatch = !!source && accountId !== source;
  const foreign = source
    ? [...new Set(inner.operations.filter((op) => op.source && baseOf(op.source) !== source).map((op) => baseOf(op.source)))]
    : [];
  if (!mismatch && !foreign.length && !feeBump) return null;

  const maxTime = Number(inner.timeBounds?.maxTime || 0);
  const timeOk = !maxTime || maxTime > now;
  const status = String(job.status || '');
  let live = '';
  if (useHorizon && timeOk && source) live = await liveSequenceState(net, source, tx);
  return {
    job,
    kind: [feeBump && 'Fee-Bump', mismatch && 'accountId ungleich Tx-Quelle', foreign.length && 'fremde op.source'].filter(Boolean).join(', '),
    detail: [
      `Netz ${job.network}, Status ${status || '-'}${FINAL.has(status) ? ' (Endzustand)' : ''}`,
      `accountId  ${accountId}`,
      feeBump
        ? `Tx-Quelle  ${source || '(unlesbar)'} (innere Transaktion; zahlendes Konto ${tx.feeSource})`
        : `Tx-Quelle  ${source || '(unlesbar)'}`,
      feeBump ? 'Fee-Bump: als Job nicht vorgesehen, nimmt keine Signatur mehr an; Widerruf bumpt die Sequence der inneren Quelle' : '',
      foreign.length ? `fremde op.source: ${foreign.join(', ')}` : '',
      `Signaturen im XDR: ${tx.signatures.length}, gesammelt laut Job: ${(job.collectedSigners || []).length}`,
      `Zeitfenster: ${maxTime ? new Date(maxTime * 1000).toISOString() : 'unbegrenzt'} ${timeOk ? '(noch offen)' : '(abgelaufen)'}`,
      live ? `Sequence: ${live}` : '',
    ].filter(Boolean),
    // Endzustaende sind erledigt (Sequence verbraucht oder abgelaufen). Ein gespeichertes
    // pending kann veraltet sein, --horizon klaert das.
    risky: timeOk && tx.signatures.length > 0 && !FINAL.has(status) && !live.startsWith('verbraucht'),
  };
}

async function main() {
  const [file, ...flags] = process.argv.slice(2);
  if (!file) {
    console.error('Aufruf: node scripts/check-legacy-jobs.js <multisig_jobs.json> [--horizon]');
    process.exit(2);
  }
  const useHorizon = flags.includes('--horizon');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const items = Array.isArray(data) ? data : (data.items || []);
  const now = Math.floor(Date.now() / 1000);
  const findings = [];
  let undecodable = 0;

  for (const job of items) {
    const f = await inspectJob(job, { now, useHorizon });
    if (!f) continue;
    if (f.kind === 'nicht pruefbar') undecodable += 1;
    findings.push(f);
  }

  console.log(`${items.length} Jobs geprueft, ${findings.length} auffaellig, ${undecodable} nicht dekodierbar.\n`);
  for (const f of findings) {
    console.log(`${f.risky ? '!! ' : '   '}Job ${f.job.id}: ${f.kind}`);
    (Array.isArray(f.detail) ? f.detail : [f.detail]).forEach((line) => console.log(`     ${line}`));
    console.log('');
  }
  const risky = findings.filter((f) => f.risky);
  if (risky.length) {
    console.log(`${risky.length} Job(s) mit !! sind noch einloesbar und tragen Signaturen.`);
    console.log('Absichern: im Job-Detail widerrufen (bumpSequence auf die Tx-Quelle, braucht deren Signer).');
    if (!useHorizon) console.log('Mit --horizon pruefen, ob die Sequence schon verbraucht ist.');
  } else {
    console.log('Kein noch einloesbarer Altjob mit Signaturen gefunden.');
  }
}

module.exports = { inspectJob };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
