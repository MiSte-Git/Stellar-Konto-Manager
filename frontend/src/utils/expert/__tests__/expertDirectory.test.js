import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DIRECTORY_BATCH_SIZE, DIRECTORY_CONCURRENCY, clearDirectoryCache, getCachedDirectoryEntry, isExchangeEntry, loadDirectoryBatch } from '../expertDirectory.js';

const accounts = (n) => Array.from({ length: n }, (_, i) => `G${i}`);
const ok = (body) => ({ ok: true, status: 200, json: async () => body });

describe('Directory-Abfrage', () => {
  beforeEach(() => {
    clearDirectoryCache();
    vi.stubGlobal('fetch', vi.fn(async () => ok({ status: 'listed', name: 'Börse', tags: ['exchange'] })));
  });

  it('fragt je Aufruf hoechstens einen Stapel ab und meldet den Rest', async () => {
    const onEntry = vi.fn();
    const result = await loadDirectoryBatch({ accounts: accounts(100), network: 'PUBLIC', onEntry });
    expect(fetch).toHaveBeenCalledTimes(DIRECTORY_BATCH_SIZE);
    expect(result).toEqual({ checked: DIRECTORY_BATCH_SIZE, remaining: 100 - DIRECTORY_BATCH_SIZE, stopped: '' });
    expect(onEntry).toHaveBeenCalledTimes(DIRECTORY_BATCH_SIZE);
  });

  it('nutzt den Sitzungs-Cache je Netz', async () => {
    await loadDirectoryBatch({ accounts: ['GA'], network: 'PUBLIC' });
    await loadDirectoryBatch({ accounts: ['GA', 'GA'], network: 'PUBLIC' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getCachedDirectoryEntry('PUBLIC', 'GA')).toMatchObject({ status: 'listed' });
    expect(getCachedDirectoryEntry('TESTNET', 'GA')).toBeUndefined();
  });

  it('begrenzt die Parallelitaet', async () => {
    let running = 0;
    let peak = 0;
    fetch.mockImplementation(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      return ok({ status: 'notListed' });
    });
    await loadDirectoryBatch({ accounts: accounts(12), network: 'PUBLIC' });
    expect(peak).toBe(DIRECTORY_CONCURRENCY);
  });

  it('stoppt bei 429 sofort und cacht nichts davon', async () => {
    fetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    const result = await loadDirectoryBatch({ accounts: accounts(30), network: 'PUBLIC' });
    expect(result.stopped).toBe('rateLimited');
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(DIRECTORY_CONCURRENCY);
    expect(getCachedDirectoryEntry('PUBLIC', 'G0')).toBeUndefined();
  });

  it('stoppt nach drei Ausfaellen unseres Backends als nicht erreichbar', async () => {
    fetch.mockRejectedValue(new Error('offline'));
    const result = await loadDirectoryBatch({ accounts: accounts(30), network: 'PUBLIC' });
    expect(result.stopped).toBe('unavailable');
    expect(fetch.mock.calls.length).toBeLessThan(10);
  });

  it('wertet eine Folge von HTTP 200 mit unavailable als Limit', async () => {
    fetch.mockResolvedValue(ok({ status: 'unavailable' }));
    const result = await loadDirectoryBatch({ accounts: accounts(30), network: 'PUBLIC' });
    expect(result.stopped).toBe('rateLimited');
    expect(getCachedDirectoryEntry('PUBLIC', 'G0')).toBeUndefined();
  });

  it('laesst einzelne unavailable durch', async () => {
    fetch.mockResolvedValueOnce(ok({ status: 'unavailable' }));
    const result = await loadDirectoryBatch({ accounts: accounts(6), network: 'PUBLIC' });
    expect(result).toMatchObject({ checked: 5, stopped: '' });
  });

  it('ruft im Testnet nichts ab', async () => {
    const result = await loadDirectoryBatch({ accounts: accounts(5), network: 'TESTNET' });
    expect(fetch).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 0, remaining: 0, stopped: '' });
  });

  it('stoppt beim Abbruch und zaehlt ihn nicht als Ausfall', async () => {
    const controller = new AbortController();
    fetch.mockImplementation(async () => { controller.abort(); throw new DOMException('Aborted', 'AbortError'); });
    const result = await loadDirectoryBatch({ accounts: accounts(30), network: 'PUBLIC', signal: controller.signal });
    expect(result.stopped).toBe('aborted');
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(DIRECTORY_CONCURRENCY);
  });

  it('erkennt das Tag exchange', () => {
    expect(isExchangeEntry({ tags: ['exchange'] })).toBe(true);
    expect(isExchangeEntry({ tags: ['anchor'] })).toBe(false);
    expect(isExchangeEntry(undefined)).toBe(false);
  });
});
