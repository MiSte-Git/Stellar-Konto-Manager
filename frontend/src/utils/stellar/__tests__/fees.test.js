import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeFeePerOp, resolveFeePerOp, getStoredFeeLevel, setStoredFeeLevel,
  FEE_LEVEL_STORAGE_KEY, MAX_FEE_STROOPS,
} from '../fees.js';

const quiet = { last_ledger_base_fee: '100', fee_charged: { mode: '100', p95: '100' } };
const busy = { last_ledger_base_fee: '100', fee_charged: { mode: '500', p95: '8000' } };

describe('computeFeePerOp', () => {
  it('normal entspricht dem bisherigen Verhalten (mode, mindestens Basisgebuehr)', () => {
    expect(computeFeePerOp(quiet, 'normal')).toBe('100');
    expect(computeFeePerOp(busy, 'normal')).toBe('500');
    expect(computeFeePerOp({ fee_charged: { mode: '50' } }, 'normal')).toBe('100');
  });

  it('fast bietet mindestens 10x Basisgebuehr und p95', () => {
    expect(computeFeePerOp(quiet, 'fast')).toBe('1000');
    expect(computeFeePerOp(busy, 'fast')).toBe('8000');
  });

  it('deckelt Ausreisser und faellt ohne Daten auf die Basisgebuehr zurueck', () => {
    expect(computeFeePerOp({ fee_charged: { mode: '1', p95: '99999999' } }, 'fast')).toBe(String(MAX_FEE_STROOPS));
    expect(computeFeePerOp(null, 'normal')).toBe('100');
    expect(computeFeePerOp(undefined, 'fast')).toBe('1000');
    expect(computeFeePerOp({ fee_charged: { mode: 'abc' } }, 'unbekannt')).toBe('100');
  });
});

describe('resolveFeePerOp', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('nutzt die gespeicherte Stufe', async () => {
    const server = { feeStats: vi.fn(async () => busy) };
    expect(await resolveFeePerOp(server)).toBe('500');
    setStoredFeeLevel('fast');
    expect(await resolveFeePerOp(server)).toBe('8000');
  });

  it('nimmt fuer spaeter eingereichte Transaktionen immer fast', async () => {
    const server = { feeStats: vi.fn(async () => quiet) };
    expect(await resolveFeePerOp(server, { deferred: true })).toBe('1000');
  });

  it('wirft nicht, wenn Horizon ausfaellt', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const server = { feeStats: vi.fn(async () => { throw new Error('down'); }) };
    expect(await resolveFeePerOp(server)).toBe('100');
    expect(await resolveFeePerOp(server, { deferred: true })).toBe('1000');
    warn.mockRestore();
  });
});

describe('gespeicherte Stufe', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('Standard ist normal, ungueltige Werte werden ignoriert', () => {
    expect(getStoredFeeLevel()).toBe('normal');
    window.localStorage.setItem(FEE_LEVEL_STORAGE_KEY, 'turbo');
    expect(getStoredFeeLevel()).toBe('normal');
    setStoredFeeLevel('fast');
    expect(getStoredFeeLevel()).toBe('fast');
  });
});

describe('Obergrenze auch fuer die Basisgebuehr', () => {
  it('deckelt einen ausreissenden last_ledger_base_fee', () => {
    expect(computeFeePerOp({ last_ledger_base_fee: '99999999', fee_charged: { mode: '100' } }, 'normal')).toBe(String(MAX_FEE_STROOPS));
  });
});

