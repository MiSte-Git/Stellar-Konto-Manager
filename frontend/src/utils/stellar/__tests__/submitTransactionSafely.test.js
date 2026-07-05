// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  AmbiguousSubmitResultError,
  findSubmittedTransaction,
  isAmbiguousSubmitError,
  submitTransactionSafely,
} from '../submitTransactionSafely.js';

function httpError(status, resultCodes) {
  const err = new Error(`http ${status}`);
  err.response = { status, data: resultCodes ? { extras: { result_codes: resultCodes } } : {} };
  return err;
}

function fakeTx(hashHex) {
  return { hash: () => ({ toString: () => hashHex }) };
}

function fakeServer({ transactionImpl, submitImpl } = {}) {
  return {
    transactions: () => ({
      transaction: (hash) => ({
        call: () => (transactionImpl ? transactionImpl(hash) : Promise.reject(httpError(404))),
      }),
    }),
    submitTransaction: submitImpl || vi.fn(),
  };
}

describe('isAmbiguousSubmitError', () => {
  it('is not ambiguous when Horizon returned explicit result_codes', () => {
    expect(isAmbiguousSubmitError(httpError(400, { transaction: 'tx_bad_seq' }))).toBe(false);
  });

  it('is ambiguous when there is no response at all (network failure)', () => {
    expect(isAmbiguousSubmitError(new Error('network down'))).toBe(true);
  });

  it.each([408, 429, 500, 502, 503, 504])('treats HTTP %s without result_codes as ambiguous', (status) => {
    expect(isAmbiguousSubmitError(httpError(status))).toBe(true);
  });

  it('is not ambiguous for an unrelated status without result_codes', () => {
    expect(isAmbiguousSubmitError(httpError(401))).toBe(false);
  });
});

describe('findSubmittedTransaction', () => {
  it('returns null immediately when no hash is given (no lookup attempted)', async () => {
    const transactionImpl = vi.fn();
    const server = fakeServer({ transactionImpl });
    const result = await findSubmittedTransaction(server, '');
    expect(result).toBeNull();
    expect(transactionImpl).not.toHaveBeenCalled();
  });

  it('returns the record as soon as Horizon confirms the hash', async () => {
    const record = { hash: 'abc123' };
    const transactionImpl = vi.fn().mockResolvedValue(record);
    const server = fakeServer({ transactionImpl });
    const result = await findSubmittedTransaction(server, 'abc123', { attempts: 5, delayMs: 1 });
    expect(result).toBe(record);
    expect(transactionImpl).toHaveBeenCalledTimes(1);
  });

  it('retries on 404 (not yet visible) and eventually finds the transaction', async () => {
    const record = { hash: 'abc123' };
    const transactionImpl = vi.fn()
      .mockRejectedValueOnce(httpError(404))
      .mockRejectedValueOnce(httpError(404))
      .mockResolvedValueOnce(record);
    const server = fakeServer({ transactionImpl });
    const result = await findSubmittedTransaction(server, 'abc123', { attempts: 5, delayMs: 1 });
    expect(result).toBe(record);
    expect(transactionImpl).toHaveBeenCalledTimes(3);
  });

  it('does not throw on a non-404 lookup error and keeps retrying', async () => {
    const record = { hash: 'abc123' };
    const transactionImpl = vi.fn()
      .mockRejectedValueOnce(httpError(500))
      .mockResolvedValueOnce(record);
    const server = fakeServer({ transactionImpl });
    const result = await findSubmittedTransaction(server, 'abc123', { attempts: 5, delayMs: 1 });
    expect(result).toBe(record);
  });

  it('gives up and returns null after exhausting all attempts', async () => {
    const transactionImpl = vi.fn().mockRejectedValue(httpError(404));
    const server = fakeServer({ transactionImpl });
    const result = await findSubmittedTransaction(server, 'abc123', { attempts: 3, delayMs: 1 });
    expect(result).toBeNull();
    expect(transactionImpl).toHaveBeenCalledTimes(3);
  });
});

describe('submitTransactionSafely', () => {
  it('returns the Horizon response directly on a clean submit', async () => {
    const submitted = { hash: 'abc123', successful: true };
    const submitImpl = vi.fn().mockResolvedValue(submitted);
    const server = fakeServer({ submitImpl });
    const result = await submitTransactionSafely(server, fakeTx('abc123'));
    expect(result).toBe(submitted);
  });

  it('rethrows a definite (non-ambiguous) failure without attempting a lookup', async () => {
    const definiteError = httpError(400, { transaction: 'tx_bad_seq' });
    const transactionImpl = vi.fn();
    const submitImpl = vi.fn().mockRejectedValue(definiteError);
    const server = fakeServer({ transactionImpl, submitImpl });
    await expect(submitTransactionSafely(server, fakeTx('abc123'))).rejects.toBe(definiteError);
    expect(transactionImpl).not.toHaveBeenCalled();
  });

  it('resolves with the confirmed record when an ambiguous failure turns out to have succeeded', async () => {
    const confirmed = { hash: 'abc123', successful: true };
    const submitImpl = vi.fn().mockRejectedValue(httpError(504));
    const transactionImpl = vi.fn().mockResolvedValue(confirmed);
    const server = fakeServer({ transactionImpl, submitImpl });
    const result = await submitTransactionSafely(server, fakeTx('abc123'));
    expect(result).toBe(confirmed);
  });

  it('throws AmbiguousSubmitResultError (not the original error) when the outcome cannot be confirmed either way', async () => {
    // findSubmittedTransaction's default retry schedule (8 attempts x 1500ms)
    // runs inside submitTransactionSafely with no way to override it from the
    // outside, so fake timers stand in for the ~10s of real waiting.
    vi.useFakeTimers();
    try {
      const originalErr = httpError(504);
      const submitImpl = vi.fn().mockRejectedValue(originalErr);
      const transactionImpl = vi.fn().mockRejectedValue(httpError(404));
      const server = fakeServer({ transactionImpl, submitImpl });

      const resultPromise = submitTransactionSafely(server, fakeTx('abc123'));
      const assertion = expect(resultPromise).rejects.toBeInstanceOf(AmbiguousSubmitResultError);
      await vi.advanceTimersByTimeAsync(8 * 1500);
      await assertion;

      const caught = await resultPromise.catch((e) => e);
      expect(caught.hash).toBe('abc123');
      expect(caught.cause).toBe(originalErr);
    } finally {
      vi.useRealTimers();
    }
  });
});
