import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSettings, MULTISIG_TIMEOUT_MAX_SECONDS } from '../useSettings.js';

// G5 stage 2: multisigTimeoutSeconds must never exceed the same cap the
// backends enforce at job creation (api/multisigLifecycle.php /
// services/multisigLifecycle.js's MULTISIG_JOB_MAX_TIMEBOUND_SECONDS) - a
// value above it can never reach the server as a valid job anyway.
describe('useSettings multisigTimeoutSeconds cap', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('MULTISIG_TIMEOUT_MAX_SECONDS matches the documented 7-day cap', () => {
    expect(MULTISIG_TIMEOUT_MAX_SECONDS).toBe(604800);
  });

  it('setMultisigTimeoutSeconds clamps a value above the cap down to the cap', () => {
    const { result } = renderHook(() => useSettings());
    act(() => {
      result.current.setMultisigTimeoutSeconds(MULTISIG_TIMEOUT_MAX_SECONDS * 10);
    });
    expect(result.current.multisigTimeoutSeconds).toBe(MULTISIG_TIMEOUT_MAX_SECONDS);
  });

  it('setMultisigTimeoutSeconds accepts a value at or under the cap unchanged', () => {
    const { result } = renderHook(() => useSettings());
    act(() => {
      result.current.setMultisigTimeoutSeconds(3600);
    });
    expect(result.current.multisigTimeoutSeconds).toBe(3600);

    act(() => {
      result.current.setMultisigTimeoutSeconds(MULTISIG_TIMEOUT_MAX_SECONDS);
    });
    expect(result.current.multisigTimeoutSeconds).toBe(MULTISIG_TIMEOUT_MAX_SECONDS);
  });

  it('setMultisigTimeoutSeconds ignores non-finite or non-positive values, keeping the previous value (matches the pre-cap min>0 guard)', () => {
    const { result } = renderHook(() => useSettings());
    act(() => {
      result.current.setMultisigTimeoutSeconds(3600);
    });
    act(() => {
      result.current.setMultisigTimeoutSeconds(-5);
    });
    expect(result.current.multisigTimeoutSeconds).toBe(3600);
    act(() => {
      result.current.setMultisigTimeoutSeconds(NaN);
    });
    expect(result.current.multisigTimeoutSeconds).toBe(3600);
  });

  it('a stale localStorage value above the cap (from before the cap existed) is clamped on initial load, not just on the next set', () => {
    localStorage.setItem('stm.multisigTimeoutSeconds', String(MULTISIG_TIMEOUT_MAX_SECONDS * 5));
    const { result } = renderHook(() => useSettings());
    expect(result.current.multisigTimeoutSeconds).toBe(MULTISIG_TIMEOUT_MAX_SECONDS);
  });

  it('applySettingsSnapshot (settings import) also clamps an imported value above the cap', () => {
    const { result } = renderHook(() => useSettings());
    act(() => {
      result.current.applySettingsSnapshot({ multisigTimeoutSeconds: MULTISIG_TIMEOUT_MAX_SECONDS * 3 });
    });
    expect(result.current.multisigTimeoutSeconds).toBe(MULTISIG_TIMEOUT_MAX_SECONDS);
  });
});
