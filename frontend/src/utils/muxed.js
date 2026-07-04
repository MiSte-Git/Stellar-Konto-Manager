// Muxed account helpers
// ESM import style consistent with project conventions
import { StrKey } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';

const isDev = import.meta.env.MODE !== 'production';

/**
 * Build an M-address from a base G-address and a uint64 ID.
 *
 * @param {string} basePublicKey - G... public key
 * @param {string|number|bigint} muxedIdStr - uint64 (0..2^64-1)
 * @returns {string} M... address
 * @throws {Error} with prefix 'submitTransaction.failed:' and detail key on invalid inputs
 */
export function buildMuxedAddress(basePublicKey, muxedIdStr) {
  // Diese Funktion erzeugt eine Muxed-Adresse (M...) aus
  // basePublicKey (G...) + muxedIdStr (uint64 als String).
  // Wirf Error('submitTransaction.failed:<key>') damit die UI
  // den Key via t() übersetzen kann.

  if (isDev) {
    try {
      const net = typeof window !== 'undefined' ? window.localStorage?.getItem('SKM_NETWORK') : undefined;
      console.log('[muxed.buildMuxedAddress] called', { basePublicKey, muxedIdStr: String(muxedIdStr), net });
    } catch { /* noop */ }
  }

  if (!basePublicKey || typeof basePublicKey !== 'string') {
    if (isDev) console.warn('[muxed.buildMuxedAddress] invalid basePublicKey', basePublicKey);
    throw new Error('submitTransaction.failed:muxed.error.invalidBaseAccount');
  }
  if (muxedIdStr === undefined || muxedIdStr === null || muxedIdStr === '') {
    if (isDev) console.warn('[muxed.buildMuxedAddress] missing muxedIdStr');
    throw new Error('submitTransaction.failed:muxed.error.noId');
  }

  // uint64 prüfen
  let asBig;
  try {
    asBig = BigInt(muxedIdStr);
  } catch (e) {
    if (isDev) console.error('[muxed.buildMuxedAddress] BigInt conversion failed', { muxedIdStr, error: e });
    throw new Error('submitTransaction.failed:createAccount.muxedIdInvalid');
  }
  const MAX = 18446744073709551615n;
  if (asBig < 0n || asBig > MAX) {
    if (isDev) console.warn('[muxed.buildMuxedAddress] ID out of range', { asBig: asBig.toString() });
    throw new Error('submitTransaction.failed:createAccount.muxedIdInvalid');
  }

  // tatsächliche Muxed-Adresse bauen (rein über StrKey, um SDK-Version-Mismatches zu vermeiden)
  try {
    // Validate base key early
    if (!StrKey.isValidEd25519PublicKey(basePublicKey)) {
      if (isDev) console.warn('[muxed.buildMuxedAddress] basePublicKey invalid format');
      throw new Error('submitTransaction.failed:muxed.error.invalidBaseAccount');
    }

    if (typeof StrKey.decodeEd25519PublicKey !== 'function' || typeof StrKey.encodeMed25519PublicKey !== 'function') {
      if (isDev) console.error('[muxed.buildMuxedAddress] StrKey med25519 helpers missing in current SDK build');
      throw new Error('submitTransaction.failed:muxed.error.invalidBaseAccount');
    }

    const rawG = StrKey.decodeEd25519PublicKey(basePublicKey);

    // Build 8-byte big-endian buffer for the ID
    const idBuf = Buffer.alloc(8);
    let tmp = asBig;
    for (let i = 7; i >= 0; i--) {
      idBuf[i] = Number(tmp & 0xffn);
      tmp >>= 8n;
    }

    const payload = Buffer.concat([Buffer.from(rawG), idBuf]);
    const m = StrKey.encodeMed25519PublicKey(payload);

    if (typeof m !== 'string' || !/^M[A-Z2-7]{10,}/.test(m)) {
      if (isDev) console.error('[muxed.buildMuxedAddress] StrKey.encodeMed25519PublicKey returned invalid value', { type: typeof m, m });
      throw new Error('submitTransaction.failed:muxed.error.invalidBaseAccount');
    }

    if (isDev) console.debug('[muxed.buildMuxedAddress] success (StrKey)', { addr: m });
    return m;
  } catch (e) {
    if (isDev) console.error('[muxed.buildMuxedAddress] build failed', e);
    throw new Error('submitTransaction.failed:muxed.error.invalidBaseAccount');
  }
}
