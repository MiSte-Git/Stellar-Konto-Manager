// A transaction that gets submitted immediately after signing (a direct
// local test-mode submit) only needs to survive the round-trip to Horizon,
// but one prepared for a distributed, asynchronous multisig job must stay
// valid long enough for other signers to load, sign, and merge it before it
// expires on-chain - governed by the user's configured multisigTimeoutSeconds
// (default 24h) instead of a short, hardcoded window.
export function getMultisigTxTimeout({ immediateSubmit, localSubmitTimeoutSeconds, multisigTimeoutSeconds }) {
  if (immediateSubmit) return localSubmitTimeoutSeconds;
  return Math.max(60, Number(multisigTimeoutSeconds || 0) || 86400);
}
