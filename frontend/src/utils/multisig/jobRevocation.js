// Multisig-Job widerrufen (Backlog P2.3).
//
// Ein vorbereiteter Job ist an eine feste Sequence-Nummer S gebunden. Er kann nur
// eingereicht werden, solange die Sequence des Kontos kleiner als S ist. Eine eigene
// Transaktion mit bumpSequence(bumpTo = S) setzt die Sequence des Kontos auf mindestens S,
// danach ist der Job dauerhaft ungueltig (Backend-Status obsolete_seq, siehe
// computeMultisigLifecycleStatus). Das ist der vorhandene, natuerliche Abbruchmechanismus
// aus G5, nur gezielt ausgeloest - ohne CAP-21-Preconditions.
//
// Nebenwirkung: Jede andere vorbereitete Transaktion dieses Kontos mit Sequence <= S wird
// ebenfalls ungueltig. bumpSequence ist eine Low-Threshold-Operation.
import { Operation, TransactionBuilder, StrKey } from '@stellar/stellar-sdk';

export const REVOCATION_TX_TIMEOUT_SECONDS = 60;

// Liefert Quellkonto (G-Adresse) und Sequence des Job-Transaktion.
// Bei einem Fee-Bump zaehlt die innere Transaktion.
export function getJobSequenceInfo(tx) {
  const inner = tx?.innerTransaction || tx;
  if (!inner?.sequence || !inner?.source) return null;
  let source = String(inner.source);
  if (StrKey.isValidMed25519PublicKey(source)) {
    const raw = StrKey.decodeMed25519PublicKey(source);
    source = StrKey.encodeEd25519PublicKey(raw.subarray(0, -8));
  }
  if (!StrKey.isValidEd25519PublicKey(source)) return null;
  return { sourceAccountId: source, sequence: String(inner.sequence) };
}

// Horizon-AccountResponse und sdk-Account liefern die Sequence unterschiedlich.
export function accountSequenceOf(account) {
  if (typeof account?.sequenceNumber === 'function') return account.sequenceNumber();
  return account?.sequence != null ? String(account.sequence) : null;
}

// true, wenn die Konto-Sequence den Job bereits verbraucht hat (gleiche Regel wie das Backend).
export function isJobSequenceConsumed(accountSequence, jobSequence) {
  try {
    return BigInt(accountSequence) >= BigInt(jobSequence);
  } catch {
    return false;
  }
}

// Sicherheitsgrenze: bumpTo stammt aus dem Job-XDR. Ein manipulierter Job mit hoher Sequence
// wuerde andere vorsignierte Transaktionen des Kontos zerstoeren oder (nahe 2^63-1) das Konto
// dauerhaft unbenutzbar machen. Ein noch gueltiger SKM-Job hat immer genau Konto-Sequence + 1:
// Er wird von der aktuellen Sequence aus gebaut, und sobald die Konto-Sequence steigt, ist er
// verbraucht. Jeder andere Abstand stammt nicht von SKM und wird verweigert.
export const MAX_REVOCATION_SEQUENCE_GAP = 1n;

// 'ok' | 'consumed' (Job schon tot) | 'too_far' (verdaechtig, verweigern) | 'invalid'
export function checkRevocationSequence(accountSequence, jobSequence) {
  let acc;
  let job;
  try {
    acc = BigInt(accountSequence);
    job = BigInt(jobSequence);
  } catch {
    return 'invalid';
  }
  if (acc >= job) return 'consumed';
  if (job - acc > MAX_REVOCATION_SEQUENCE_GAP) return 'too_far';
  return 'ok';
}

// Netzwerk eines Jobs streng lesen: unbekannte Werte nicht stillschweigend als Mainnet werten.
export function parseJobNetwork(network) {
  const v = String(network || '').trim().toLowerCase();
  if (v === 'testnet') return 'testnet';
  if (v === 'public' || v === 'mainnet') return 'public';
  return null;
}

// Prueft vor dem Signieren, dass der Horizon-Server wirklich zum erwarteten Netzwerk gehoert
// (Schutz gegen ueberschriebene Horizon-URLs, Dev-Proxy oder vertauschte Netzwerkwahl).
export async function assertHorizonNetwork(server, expectedPassphrase) {
  const root = await server.root();
  if (root?.network_passphrase !== expectedPassphrase) {
    throw Object.assign(new Error('revoke.networkMismatch'), { code: 'network_mismatch' });
  }
}

// Gesammelte Signer gegen die frisch geladenen Horizon-Signer abgleichen: jeder Key zaehlt nur
// einmal, das Gewicht kommt aus Horizon (nicht aus dem Modal), Gewicht 0 zaehlt nicht.
export function collectEffectiveSigners(collected, horizonSigners) {
  const weights = new Map();
  (Array.isArray(horizonSigners) ? horizonSigners : []).forEach((s) => {
    const key = s?.key || s?.public_key || s?.publicKey;
    const type = String(s?.type || 'ed25519_public_key');
    if (key && type.includes('ed25519')) weights.set(key, Number(s.weight || 0));
  });
  const seen = new Set();
  const signers = [];
  let weight = 0;
  (Array.isArray(collected) ? collected : []).forEach((s) => {
    const pub = s?.keypair?.publicKey?.();
    if (!pub || seen.has(pub)) return;
    const w = weights.get(pub) || 0;
    if (w <= 0) return;
    seen.add(pub);
    signers.push(s);
    weight += w;
  });
  return { signers, weight };
}

export function buildJobRevocationTx({ account, jobSequence, fee, networkPassphrase }) {
  return new TransactionBuilder(account, { fee: String(fee), networkPassphrase })
    .addOperation(Operation.bumpSequence({ bumpTo: String(jobSequence) }))
    .setTimeout(REVOCATION_TX_TIMEOUT_SECONDS)
    .build();
}
