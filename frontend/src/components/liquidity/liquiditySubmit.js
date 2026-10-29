import { Account } from '@stellar/stellar-sdk';
import { normalizeNativePool } from '../../utils/stellar/liquidityPools.js';
import { getRequiredThreshold } from '../../utils/getRequiredThreshold.js';
import { getCollectedSignerWeight } from '../trading/assetSearchUtils.js';
import { signTransactionWithCollectedSigners } from '../../utils/stellar/tradingTransactions.js';
import { submitTransactionSafely, AmbiguousSubmitResultError } from '../../utils/stellar/submitTransactionSafely.js';
import { formatErrorForUi } from '../../utils/formatErrorForUi.js';
import { liquidityErrorKey } from '../../utils/stellar/liquidityErrors.js';

// Gemeinsame Bausteine fuer Einzahlen/Abheben: frischer Zustand, Gewichtspruefung
// wie submitChangeTrustTx (getRequiredThreshold + getCollectedSignerWeight),
// Signieren und Senden ueber die bestehende Pipeline, Fehlertexte.

/** Konto und Pool frisch von Horizon laden (wirft liquidityPools.poolIdMismatch bei inkonsistenten Pool-Daten). */
export async function loadFreshState(server, publicKey, poolId) {
  const [account, record] = await Promise.all([
    server.loadAccount(publicKey),
    server.liquidityPools().liquidityPoolId(poolId).call(),
  ]);
  return { account, pool: normalizeNativePool(record) };
}

/** Issuer-Flags fuer Assets ohne Trustline (auth_required, auth_clawback_enabled). */
export async function loadIssuerFlags(server, assets) {
  const entries = await Promise.all(assets.map(async (asset) => {
    const issuer = await server.loadAccount(asset.getIssuer());
    return [`${asset.getCode()}:${asset.getIssuer()}`, issuer?.flags || {}];
  }));
  return Object.fromEntries(entries);
}

/**
 * Kopie des Kontos fuer eine Vorschau-Transaktion, ohne die Sequenz des Originals
 * zu erhoehen. balances bleibt erhalten, weil der Withdraw-Builder damit prueft,
 * ob die Pool-Trustline entfernt werden darf.
 */
export function previewAccount(account) {
  return Object.assign(new Account(account.accountId(), account.sequenceNumber()), { balances: account.balances });
}

/** Wirft wie im Trading, wenn das gesammelte Gewicht nicht reicht. */
export function assertSignerWeight(account, collectedSigners, operationType) {
  const required = getRequiredThreshold(operationType, account?.thresholds || {});
  const current = getCollectedSignerWeight(collectedSigners, account?.signers || []);
  if (current <= 0) throw new Error('submitTransaction.failed:multisig.noKeysProvided');
  if (current < required) {
    throw Object.assign(new Error('submitTransaction.failed:multisig.insufficientWeight'), { required, current });
  }
}

export function signAndSubmit(server, tx, collectedSigners) {
  return submitTransactionSafely(server, signTransactionWithCollectedSigners(tx, collectedSigners));
}

/** Fehlertext fuer die Dialoge; AmbiguousSubmitResultError wird vom Aufrufer gesondert behandelt. */
export function describeLiquidityError(t, err) {
  if (err instanceof AmbiguousSubmitResultError) return '';
  const base = t('submitTransaction:failed', 'Transaction failed');
  if (err?.required !== undefined && err?.current !== undefined) {
    return `${base}: ${t('errors:submitTransaction.failed.multisig.insufficientWeight', { required: err.required, current: err.current })}`;
  }
  if (err?.code === 'network_mismatch') return t('liquidity:dialog.networkMismatch');
  if (err?.message === 'liquidityPools.poolIdMismatch') return t('liquidity:dialog.poolIdMismatch');
  const key = liquidityErrorKey(err);
  if (key) return formatErrorForUi(t, key);
  const codes = err?.response?.data?.extras?.result_codes;
  if (codes) return `${base}: ${JSON.stringify(codes)}`;
  return formatErrorForUi(t, err);
}
