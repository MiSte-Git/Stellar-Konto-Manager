// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyError, isTimeoutStatus, withBackoff } from '../retry.js';

function httpError(status, extraMessage) {
  const err = new Error(extraMessage || `http ${status}`);
  err.response = { status };
  return err;
}

describe('isTimeoutStatus', () => {
  it.each([408, 504, 522, 524, 598, 599])('treats %s as a timeout status', (status) => {
    expect(isTimeoutStatus(status)).toBe(true);
  });

  it('does not treat an ordinary error status as a timeout', () => {
    expect(isTimeoutStatus(500)).toBe(false);
    expect(isTimeoutStatus(404)).toBe(false);
    expect(isTimeoutStatus(undefined)).toBe(false);
  });
});

describe('classifyError', () => {
  it('classifies a 404 as notFound', () => {
    expect(classifyError(httpError(404))).toEqual({ type: 'notFound', status: 404 });
  });

  it('classifies a 429 as rateLimit', () => {
    expect(classifyError(httpError(429))).toEqual({ type: 'rateLimit', status: 429 });
  });

  it('classifies a timeout status as timeout', () => {
    expect(classifyError(httpError(504))).toEqual({ type: 'timeout', status: 504 });
  });

  it('classifies a message containing "timeout" as timeout even without a matching status', () => {
    const err = new Error('Request timeout while contacting Horizon');
    expect(classifyError(err).type).toBe('timeout');
  });

  it('classifies a fetch/network failure message as network', () => {
    expect(classifyError(new Error('Failed to fetch')).type).toBe('network');
    expect(classifyError(new Error('NetworkError when attempting to fetch resource')).type).toBe('network');
  });

  it('classifies a Horizon result_codes payload as horizon with the codes as detail', () => {
    const err = httpError(400);
    err.response.data = { extras: { result_codes: { transaction: 'tx_bad_seq' } } };
    const result = classifyError(err);
    expect(result.type).toBe('horizon');
    expect(result.detail).toBe(JSON.stringify({ transaction: 'tx_bad_seq' }));
  });

  it('falls back to unknown for an unrecognized error shape', () => {
    expect(classifyError(httpError(401))).toEqual({ type: 'unknown', status: 401 });
  });

  it('never throws, even for a malformed input', () => {
    expect(() => classifyError(null)).not.toThrow();
    expect(classifyError(null).type).toBe('unknown');
  });
});

describe('withBackoff', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the result on the first successful attempt without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withBackoff(fn, { tries: 3, baseDelay: 50 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable (timeout) error and eventually succeeds', async () => {
    vi.useFakeTimers();
    const fn = vi.fn()
      .mockRejectedValueOnce(httpError(504))
      .mockResolvedValueOnce('ok');
    const promise = withBackoff(fn, { tries: 3, baseDelay: 50 });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-retryable error and rejects immediately', async () => {
    const definiteError = httpError(401);
    const fn = vi.fn().mockRejectedValue(definiteError);
    await expect(withBackoff(fn, { tries: 5, baseDelay: 50 })).rejects.toBe(definiteError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after the configured number of tries and rethrows the last error', async () => {
    vi.useFakeTimers();
    const lastError = httpError(504);
    const fn = vi.fn().mockRejectedValue(lastError);
    const promise = withBackoff(fn, { tries: 3, baseDelay: 10, maxDelay: 20 });
    const assertion = expect(promise).rejects.toBe(lastError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('honors a custom isRetryable predicate over the default classification', async () => {
    const definiteError = httpError(401);
    const fn = vi.fn()
      .mockRejectedValueOnce(definiteError)
      .mockResolvedValueOnce('ok');
    vi.useFakeTimers();
    const promise = withBackoff(fn, { tries: 3, baseDelay: 10, isRetryable: () => true });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('calls onRetry with attempt number and delay before each retry', async () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    const fn = vi.fn()
      .mockRejectedValueOnce(httpError(504))
      .mockResolvedValueOnce('ok');
    const promise = withBackoff(fn, { tries: 3, baseDelay: 10, onRetry });
    await vi.advanceTimersByTimeAsync(1000);
    await promise;
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0]).toMatchObject({ attempt: 1 });
  });
});
