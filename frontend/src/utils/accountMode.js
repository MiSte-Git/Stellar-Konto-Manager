const WRITE_ACTIONS = new Set([
  'sendPayment',
  'listAll',
  'compare',
  'deleteAll',
  'deleteByIssuer',
  'multisigEdit',
  'multisigJobs',
  'createAccount',
  'muxed',
]);

export function requiresGAccount(actionId) {
  return WRITE_ACTIONS.has(String(actionId || ''));
}

export function isIdentityMode(muxedAddress) {
  return !!(muxedAddress && String(muxedAddress).trim());
}
