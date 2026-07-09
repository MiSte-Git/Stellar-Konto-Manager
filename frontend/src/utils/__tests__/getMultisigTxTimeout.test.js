// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { getMultisigTxTimeout } from '../getMultisigTxTimeout.js';

describe('getMultisigTxTimeout', () => {
  it('uses the short local-submit timeout for an immediate direct submit', () => {
    expect(getMultisigTxTimeout({
      immediateSubmit: true,
      localSubmitTimeoutSeconds: 180,
      multisigTimeoutSeconds: 86400,
    })).toBe(180);
  });

  it('uses the configured multisigTimeoutSeconds for a distributed job (not immediate) - the actual bug', () => {
    // MultisigEditPage.jsx's handlePrepareMultisig used to hardcode 60s here,
    // which is far too short for another signer to load, sign, and merge the
    // job before it expires on-chain.
    expect(getMultisigTxTimeout({
      immediateSubmit: false,
      localSubmitTimeoutSeconds: 180,
      multisigTimeoutSeconds: 86400,
    })).toBe(86400);
  });

  it('never returns less than 60 seconds even if multisigTimeoutSeconds is misconfigured very low', () => {
    expect(getMultisigTxTimeout({
      immediateSubmit: false,
      localSubmitTimeoutSeconds: 180,
      multisigTimeoutSeconds: 5,
    })).toBe(60);
  });

  it('falls back to 86400 (24h) when multisigTimeoutSeconds is missing, zero, or not a number', () => {
    expect(getMultisigTxTimeout({ immediateSubmit: false, localSubmitTimeoutSeconds: 180, multisigTimeoutSeconds: 0 })).toBe(86400);
    expect(getMultisigTxTimeout({ immediateSubmit: false, localSubmitTimeoutSeconds: 180 })).toBe(86400);
    expect(getMultisigTxTimeout({ immediateSubmit: false, localSubmitTimeoutSeconds: 180, multisigTimeoutSeconds: 'nope' })).toBe(86400);
  });
});
