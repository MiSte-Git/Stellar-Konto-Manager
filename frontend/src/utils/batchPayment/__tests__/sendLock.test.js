import { LOCK_TTL_MS, withSendLock } from '../sendLock.js';

const KEY = 'skm_batch_send_lock_v1:skm-batch-send-PUBLIC';

beforeEach(() => {
  window.localStorage.clear();
  delete window.navigator.locks;
});

describe('withSendLock without Web Locks (localStorage fallback)', () => {
  it('runs exclusively: a second run waits until the first is done', async () => {
    const order = [];
    let releaseFirst;
    const first = withSendLock('PUBLIC', async () => {
      order.push('first-start');
      await new Promise((r) => { releaseFirst = r; });
      order.push('first-end');
    });
    await new Promise((r) => setTimeout(r, 150));
    const onWaiting = vi.fn();
    const second = withSendLock('PUBLIC', async () => { order.push('second'); }, { onWaiting });
    await new Promise((r) => setTimeout(r, 300));
    expect(onWaiting).toHaveBeenCalled();
    expect(order).toEqual(['first-start']);
    releaseFirst();
    await first;
    await second;
    expect(order).toEqual(['first-start', 'first-end', 'second']);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('takes over a stale lock of a crashed tab', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ owner: 'dead', at: Date.now() - LOCK_TTL_MS - 1 }));
    const fn = vi.fn(async () => 'ok');
    expect(await withSendLock('PUBLIC', fn)).toBe('ok');
  });

  it('can be aborted while waiting', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ owner: 'other', at: Date.now() }));
    const controller = new AbortController();
    const fn = vi.fn();
    const p = withSendLock('PUBLIC', fn, { signal: controller.signal, onWaiting: () => controller.abort() });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('releases the lock also when the run throws', async () => {
    await expect(withSendLock('PUBLIC', async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});

describe('withSendLock with Web Locks', () => {
  it('tries without waiting first and only reports waiting when the lock is busy', async () => {
    const calls = [];
    window.navigator.locks = {
      request: vi.fn(async (name, opts, cb) => {
        calls.push(opts);
        if (opts.ifAvailable) return cb(null); // belegt
        return cb({});
      }),
    };
    const onWaiting = vi.fn();
    expect(await withSendLock('PUBLIC', async () => 'done', { onWaiting })).toBe('done');
    expect(onWaiting).toHaveBeenCalledTimes(1);
    expect(calls[0]).toEqual({ ifAvailable: true });
  });
});

describe('withSendLock lock ownership (localStorage fallback)', () => {
  it('hands touch and isHeld to the run and detects a lost lock', async () => {
    let seen;
    await withSendLock('PUBLIC', async (lock) => {
      expect(lock.isHeld()).toBe(true);
      expect(lock.touch()).toBe(true);
      // Ein anderer Tab uebernimmt (z.B. nach Ruhezustand dieses Tabs).
      window.localStorage.setItem(KEY, JSON.stringify({ owner: 'other', at: Date.now() }));
      seen = { held: lock.isHeld(), touched: lock.touch() };
    });
    expect(seen).toEqual({ held: false, touched: false });
    // Der fremde Lock bleibt stehen.
    expect(JSON.parse(window.localStorage.getItem(KEY)).owner).toBe('other');
  });

  it('removes its own lock when aborted in the settle window', async () => {
    const controller = new AbortController();
    const p = withSendLock('PUBLIC', vi.fn(), { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});

describe('withSendLock with Web Locks hands an always-held lock', () => {
  it('passes touch and isHeld', async () => {
    window.navigator.locks = { request: vi.fn(async (name, opts, cb) => cb({})) };
    await withSendLock('PUBLIC', async (lock) => {
      expect(lock.isHeld()).toBe(true);
      expect(lock.touch()).toBe(true);
    });
  });
});

describe('heartbeat', () => {
  it('renews the storage lock while a long run is going on', async () => {
    vi.useFakeTimers();
    try {
      let release;
      const p = withSendLock('PUBLIC', () => new Promise((r) => { release = r; }), { settleMs: 0 });
      await vi.advanceTimersByTimeAsync(10);
      const firstAt = JSON.parse(window.localStorage.getItem(KEY)).at;
      await vi.advanceTimersByTimeAsync(LOCK_TTL_MS + 30000);
      const later = JSON.parse(window.localStorage.getItem(KEY));
      expect(later.at).toBeGreaterThan(firstAt + LOCK_TTL_MS);
      release();
      await p;
    } finally {
      vi.useRealTimers();
    }
  });
});

