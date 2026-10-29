// Horizon-Ergebniscodes von Liquidity-Pool-Transaktionen auf das bestehende
// Fehlerschema 'submitTransaction.failed:<detail>' abbilden. formatErrorForUi
// uebersetzt <detail> dann ueber errors:submitTransaction.failed.<detail>.
export const LIQUIDITY_OP_CODES = Object.freeze([
  'op_underfunded',
  'op_bad_price',
  'op_line_full',
  'op_no_trust',
  'op_not_authorized',
  'op_low_reserve',
  // CHANGE_TRUST_CANNOT_DELETE (Horizon-Schreibweise)
  'op_cannot_delete',
  // Withdraw: Mindestbetrag nicht erreicht
  'op_under_minimum',
  'op_pool_full',
  'op_malformed',
  // changeTrust(poolAsset): CHANGE_TRUST_TRUST_LINE_MISSING
  'op_trust_line_missing',
  // changeTrust(poolAsset): CHANGE_TRUST_NOT_AUTH_MAINTAIN_LIABILITIES. Horizon
  // schreibt diesen Code tatsaechlich ohne "h" (internal/codes/main.go).
  'op_not_aut_maintain_liabilities',
  // CAP-77: LIQUIDITY_POOL_DEPOSIT/WITHDRAW_TRUSTLINE_FROZEN, Horizon liefert fuer
  // beide denselben Code
  'op_trustline_frozen',
]);

/** 'submitTransaction.failed:liquidity.<code>' fuer bekannte Codes, sonst null. */
export function liquidityErrorKey(err) {
  const codes = err?.response?.data?.extras?.result_codes;
  if (!codes) return null;
  const ops = Array.isArray(codes.operations) ? codes.operations : [];
  const op = ops.find((code) => code && code !== 'op_success');
  if (op && LIQUIDITY_OP_CODES.includes(op)) return `submitTransaction.failed:liquidity.${op}`;
  if (codes.transaction === 'tx_bad_auth') return 'submitTransaction.failed:tx_bad_auth';
  return null;
}
