import { beforeEach, describe, expect, it } from 'vitest';
import {
  aggregationsToSeries, bestSendResult, invertSeries, CHART_RANGES, clearAggregationCache, DAY_MS, HOUR_MS, loadAssetMarket, loadPriceSeries, priceFromTrade, referencePrice,
  summarizeAggregations, summarizeOrderbook,
} from '../assetMarket.js';
import fixture from './fixtures/horizon-usdc-xlm.json';

beforeEach(() => clearAggregationCache());

const ISSUER = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
const TOKEN = { code: 'LDEX', issuer: ISSUER };

describe('summarizeOrderbook', () => {
  it('rechnet Kaufangebote von XLM in Token um (bid amount ist XLM), Verkaufsangebote von Token in XLM', () => {
    const s = summarizeOrderbook({
      bids: [{ price: '0.0000114', amount: '114' }, { price: '0.0000113', amount: '11.3' }, { price: '0.0000112', amount: '1.12' }],
      asks: [{ price: '0.0000116', amount: '1000000' }, { price: '0.0000117', amount: '5' }, { price: '0.0000118', amount: '5' }],
    });
    expect(s.bids[0].amount).toBeCloseTo(10000000);
    expect(s.bids[0].total).toBeCloseTo(114);
    expect(s.asks[0].amount).toBe(1000000);
    expect(s.asks[0].total).toBeCloseTo(11.6);
    expect(s.bestBid).toBe(0.0000114);
    expect(s.bestAsk).toBe(0.0000116);
    expect(s.mid).toBeCloseTo(0.0000115);
    expect(s.spreadPct).toBeCloseTo((0.0000002 / 0.0000115) * 100);
    expect(s.thin).toBe(false);
  });

  it('duenn bei leerer Seite, wenigen Angeboten oder grossem Spread; ohne Gegenseite keine Mitte', () => {
    const one = summarizeOrderbook({ bids: [{ price: '1', amount: '1' }], asks: [] });
    expect(one.thin).toBe(true);
    expect(one.mid).toBeNull();
    expect(one.spreadPct).toBeNull();
    const wide = summarizeOrderbook({
      bids: [1, 2, 3].map(() => ({ price: '1', amount: '1' })),
      asks: [1, 2, 3].map(() => ({ price: '1.06', amount: '1' })),
    });
    expect(wide.thin).toBe(true);
    expect(summarizeOrderbook(null).thin).toBe(true);
  });

  it('nutzt price_r ohne price, verwirft kaputte Stufen und kappt auf die Tiefe', () => {
    const asks = Array.from({ length: 15 }, (_, i) => ({ price_r: { n: i + 1, d: 10 }, amount: '1' }));
    const s = summarizeOrderbook({ bids: [{ price: 'x', amount: '1' }], asks }, 10);
    expect(s.asks).toHaveLength(10);
    expect(s.asks[0].price).toBeCloseTo(0.1);
    expect(s.bids).toHaveLength(0);
    expect(s.askCount).toBe(15);
  });
});

describe('priceFromTrade', () => {
  const trade = (base, counter, n, d) => ({
    base_asset_type: base ? 'credit_alphanum4' : 'native', base_asset_code: base?.code, base_asset_issuer: base?.issuer,
    counter_asset_type: counter ? 'credit_alphanum4' : 'native', counter_asset_code: counter?.code, counter_asset_issuer: counter?.issuer,
    price: { n, d }, ledger_close_time: '2026-11-17T10:00:00Z',
  });
  it('Token als Basis: Preis direkt', () => {
    expect(priceFromTrade(trade(TOKEN, null, 114, 10000000), TOKEN).price).toBeCloseTo(0.0000114);
  });
  it('XLM als Basis: invertiert', () => {
    expect(priceFromTrade(trade(null, TOKEN, 10000000, 114), TOKEN).price).toBeCloseTo(0.0000114);
  });
  it('Gegenprobe: anderes Paar oder anderer Issuer ergibt null', () => {
    expect(priceFromTrade(trade({ code: 'LDEX', issuer: 'GX' }, null, 1, 1), TOKEN)).toBeNull();
    expect(priceFromTrade(trade(TOKEN, { code: 'USDC', issuer: ISSUER }, 1, 1), TOKEN)).toBeNull();
    expect(priceFromTrade(undefined, TOKEN)).toBeNull();
    expect(priceFromTrade(trade(TOKEN, null, 1, 0), TOKEN)).toBeNull();
  });
});

describe('summarizeAggregations und Verlauf', () => {
  const now = Date.UTC(2026, 10, 17, 12);
  const rec = (hoursAgo, o, c, h, l, xlm) => ({
    timestamp: String(now - hoursAgo * HOUR_MS), open: String(o), close: String(c), high: String(h), low: String(l),
    counter_volume: String(xlm), base_volume: String(xlm / c), trade_count: '2',
  });
  const records = [rec(100, 1, 1.1, 1.2, 0.9, 10), rec(20, 2, 2.2, 2.5, 1.9, 5), rec(2, 2.2, 3, 3.1, 2.1, 7)];

  it('24 h: Aenderung gegen den letzten Schlusskurs vor dem Zeitraum (AM-5)', () => {
    const s = summarizeAggregations(records, now - DAY_MS, HOUR_MS);
    expect(s.volumeXlm).toBe(12);
    expect(s.changePct).toBeCloseTo(((3 - 1.1) / 1.1) * 100);
    expect(s.changeBase).toBe('before');
    expect(s.high).toBe(3.1);
    expect(s.low).toBe(1.9);
    expect(s.trades).toBe(4);
  });
  it('ohne Handel vor dem Zeitraum: gegen den ersten Eroeffnungskurs, gekennzeichnet', () => {
    const s = summarizeAggregations(records, now - 7 * DAY_MS, HOUR_MS);
    expect(s.volumeXlm).toBe(22);
    expect(s.changePct).toBeCloseTo(200);
    expect(s.changeBase).toBe('firstTrade');
  });
  it('Bucket, der in den Zeitraum hineinreicht, zaehlt mit (Gegenprobe ohne resolution: faellt weg)', () => {
    const edge = [rec(24.5, 1, 2, 2, 1, 9)];
    expect(summarizeAggregations(edge, now - DAY_MS, HOUR_MS).volumeXlm).toBe(9);
    expect(summarizeAggregations(edge, now - DAY_MS, 0)).toBeNull();
  });
  it('ohne Bucket im Zeitraum null (kein Handel, nie 0)', () => {
    expect(summarizeAggregations(records, now, HOUR_MS)).toBeNull();
    expect(summarizeAggregations([], 0)).toBeNull();
  });
  it('sehr kleine Preise: Bruch statt 0.0000000 (AM-12)', () => {
    const tiny = { timestamp: String(now - HOUR_MS), open: '0.0000000', open_r: { n: '3', d: '100000000' }, close: '0.0000000', close_r: { n: '4', d: '100000000' }, high: '0.0000000', high_r: { n: '5', d: '100000000' }, low: '0.0000000', low_r: { n: '2', d: '100000000' }, counter_volume: '0.0000001' };
    const s = summarizeAggregations([tiny], now - DAY_MS, HOUR_MS);
    expect(s.close).toBeCloseTo(4e-8);
    expect(s.low).toBeCloseTo(2e-8);
    expect(aggregationsToSeries([tiny])[0].price).toBeCloseTo(4e-8);
  });
  it('Verlauf aufsteigend, ohne Punkte mit Preis 0 oder ohne Zeit', () => {
    const s = aggregationsToSeries([rec(2, 1, 3, 3, 1, 1), rec(20, 1, 2, 2, 1, 1), { timestamp: 'x', close: '1' }, { ...rec(1, 1, 0, 0, 0, 0) }]);
    expect(s.map((p) => p.price)).toEqual([2, 3]);
  });
  it('bestSendResult nimmt das hoechste Ergebnis, sonst null', () => {
    expect(bestSendResult({ records: [{ destination_amount: '1' }, { destination_amount: '2.5' }] })).toBe(2.5);
    expect(bestSendResult({ records: [] })).toBeNull();
  });
});

describe('echte Horizon-Antworten (Fixture USDC/XLM, AM-12)', () => {
  it('Orderbuch: bids-Menge in XLM, asks-Menge in Token, belegt durch das umgekehrte Buch', () => {
    const s = summarizeOrderbook(fixture.orderbook);
    // Gegenprobe: die Menge der besten Bid-Stufe erscheint im umgekehrten Buch als Ask mit XLM als Basis
    expect(fixture.orderbookReversed.base.asset_type).toBe('native');
    expect(fixture.orderbook.bids[0].amount).toBe(fixture.orderbookReversed.asks[0].amount);
    expect(fixture.orderbook.asks[0].amount).toBe(fixture.orderbookReversed.bids[0].amount);
    expect(s.bids[0].total).toBeCloseTo(499.9999951);
    expect(s.bids[0].amount).toBeCloseTo(499.9999951 / 7.120585, 3);
    expect(s.asks[0].amount).toBeCloseTo(3.2343311);
    expect(s.asks[0].total).toBeCloseTo(3.2343311 * 7.1316237, 4);
    expect(s.mid).toBeCloseTo((7.120585 + 7.1316237) / 2, 5);
    expect(s.thin).toBe(false);
  });
  it('Aggregationen: Preise XLM je USDC, Volumen in XLM', () => {
    const series = aggregationsToSeries(fixture.tradeAggregations);
    // Aus dem genauen Bruch close_r (KV-1), auf 7 Stellen gleich dem gerundeten Text
    expect(series[0].price).toBeCloseTo(7.1164855, 6);
    expect(series[1].price).toBeCloseTo(7.1176657, 6);
    expect(series[0].xlm).toBeCloseTo(428066.4065136);
  });
  it('Trade mit XLM als Basis wird invertiert', () => {
    const p = priceFromTrade(fixture.tradeNativeBase[0], { code: 'USDC', issuer: fixture.orderbook.base.asset_issuer });
    expect(p.price).toBeCloseTo(10000000 / 1404379, 5);
  });
});

describe('Orderbuch-Randfaelle (AM-8)', () => {
  it('beste Preise unabhaengig von der Reihenfolge; ueberkreuztes Buch: keine Mitte, duenn', () => {
    const s = summarizeOrderbook({
      bids: [{ price: '1', amount: '1' }, { price: '3', amount: '3' }, { price: '2', amount: '2' }],
      asks: [{ price: '2.5', amount: '1' }, { price: '4', amount: '1' }, { price: '5', amount: '1' }],
    });
    expect(s.bestBid).toBe(3);
    expect(s.bestAsk).toBe(2.5);
    expect(s.crossed).toBe(true);
    expect(s.mid).toBeNull();
    expect(s.thin).toBe(true);
  });
  it('Zaehler gedeckelt bei 50 Stufen', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ price: String(1 + i), amount: '1' }));
    const s = summarizeOrderbook({ bids: [], asks: many });
    expect(s.askCountCapped).toBe(true);
    expect(s.bidCountCapped).toBe(false);
  });
});

describe('referencePrice (AM-2)', () => {
  const book = (bids, asks) => summarizeOrderbook({
    bids: bids.map((p) => ({ price: String(p), amount: '10' })),
    asks: asks.map((p) => ({ price: String(p), amount: '10' })),
  });
  it('nur die Mitte eines nicht duennen Orderbuchs, nie der letzte Handel', () => {
    expect(referencePrice({ orderbook: book([1, 0.99, 0.98], [1.01, 1.02, 1.03]), lastTrade: { price: 500 } }).price).toBeCloseTo(1.005);
  });
  it('Gegenproben: duenn, leer, nicht ladbar, gar keine Daten', () => {
    expect(referencePrice({ orderbook: book([0.0000001], [100]), lastTrade: { price: 500 } })).toEqual({ price: null, reason: 'thin' });
    expect(referencePrice({ orderbook: book([1, 0.9, 0.8], [1.2, 1.3, 1.4]) })).toEqual({ price: null, reason: 'thin' });
    expect(referencePrice({ orderbook: book([], []) })).toEqual({ price: null, reason: 'none' });
    expect(referencePrice({ orderbook: null, orderbookError: true })).toEqual({ price: null, reason: 'unavailable' });
    expect(referencePrice(null)).toEqual({ price: null, reason: 'unavailable' });
  });
});

describe('loadAssetMarket', () => {
  const chain = (fn) => {
    const c = { limit: () => c, order: () => c, call: fn };
    return c;
  };
  it('ein scheiternder Teil bricht die anderen nicht ab', async () => {
    const now = Date.UTC(2026, 10, 17, 12);
    const server = {
      orderbook: () => chain(async () => { throw new Error('down'); }),
      trades: () => ({ forAssetPair: () => chain(async () => ({ records: [] })) }),
      strictSendPaths: () => ({ call: async () => ({ records: [{ destination_amount: '0.0000113' }] }) }),
      tradeAggregation: () => chain(async () => ({ records: [{ timestamp: String(now - HOUR_MS), open: '1', close: '1', high: '1', low: '1', counter_volume: '3' }] })),
    };
    const m = await loadAssetMarket({ server, tokenAsset: {}, nativeAsset: {}, token: TOKEN, now });
    expect(m.orderbook).toBeNull();
    expect(m.orderbookError).toBe(true);
    expect(m.lastTrade).toBeNull();
    expect(m.lastTradeError).toBe(false);
    expect(m.sendOne).toBe(0.0000113);
    expect(m.stats24h.volumeXlm).toBe(3);
    expect(m.series7d).toHaveLength(1);
  });
  const notFound = () => Object.assign(new Error('not found'), { response: { status: 404 } });
  it('nie gehandeltes Asset (Horizon 404 bei trades und trade_aggregations): kein Handel statt Fehler', async () => {
    const now = Date.UTC(2026, 10, 17, 12);
    const server = {
      orderbook: () => chain(async () => ({ bids: [], asks: [] })),
      trades: () => ({ forAssetPair: () => chain(async () => { throw notFound(); }) }),
      strictSendPaths: () => ({ call: async () => ({ records: [] }) }),
      tradeAggregation: () => chain(async () => { throw notFound(); }),
    };
    const m = await loadAssetMarket({ server, tokenAsset: {}, nativeAsset: {}, token: TOKEN, now });
    expect(m.lastTradeError).toBe(false);
    expect(m.statsError).toBe(false);
    expect(m.stats24h).toBeNull();
    expect(m.series7d).toEqual([]);
    expect(await loadPriceSeries({ server, tokenAsset: {}, nativeAsset: {}, range: '30d', now })).toEqual([]);
  });
  it('1 Jahr in Tageswerten: zweite Seite per next, nie mehr als noetig', async () => {
    clearAggregationCache();
    const now = Date.UTC(2026, 10, 19, 12);
    const rec = (i) => ({ timestamp: String(now - (365 - i) * DAY_MS), open: '1', close: String(1 + i / 1000), high: '1', low: '1', counter_volume: '1' });
    const page2 = { records: Array.from({ length: 165 }, (_, i) => rec(200 + i)), next: vi.fn(async () => { throw new Error('dritte Seite'); }) };
    const page1 = { records: Array.from({ length: 200 }, (_, i) => rec(i)), next: vi.fn(async () => page2) };
    let args;
    const server = { tradeAggregation: (...a) => { args = a; return chain(async () => page1); } };
    const series = await loadPriceSeries({ server, tokenAsset: {}, nativeAsset: {}, range: '365d', now });
    expect(args[4]).toBe(DAY_MS);
    expect(page1.next).toHaveBeenCalledTimes(1);
    expect(page2.next).not.toHaveBeenCalled();
    expect(series).toHaveLength(365);
    expect(CHART_RANGES['90d'].spanMs).toBe(90 * DAY_MS);
  });
  it('alle Zeitraeume mit Tageswerten teilen eine Jahresabfrage (KV-3), zugeschnitten', async () => {
    clearAggregationCache();
    const now = Date.UTC(2026, 10, 19, 12);
    const records = Array.from({ length: 100 }, (_, i) => ({ timestamp: String(now - (100 - i) * DAY_MS), close: '1', counter_volume: '1' }));
    const calls = [];
    const server = { tradeAggregation: (...a) => { calls.push(a); return chain(async () => ({ records })); } };
    expect(await loadPriceSeries({ server, tokenAsset: {}, nativeAsset: {}, range: '30d', now })).toHaveLength(30);
    expect(await loadPriceSeries({ server, tokenAsset: {}, nativeAsset: {}, range: '90d', now })).toHaveLength(90);
    expect(await loadPriceSeries({ server, tokenAsset: {}, nativeAsset: {}, range: '365d', now })).toHaveLength(100);
    expect(calls).toHaveLength(1);
    expect(calls[0][3] - calls[0][2]).toBe(365 * DAY_MS);
  });
  it('genauer Bruch statt gerundetem Text (KV-1), Doppelte je Zeitstempel einmal (KV-4)', () => {
    const rows = aggregationsToSeries([
      { timestamp: '1000', close: '0.0000001', close_r: { n: '1', d: '7000000' }, counter_volume: '1' },
      { timestamp: '2000', close: '0.0000002', close_r: { n: '3', d: '14000000' }, counter_volume: '1' },
      { timestamp: '2000', close: '0.0000002', close_r: { n: '3', d: '14000000' }, counter_volume: '2' },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].price).toBeCloseTo(1 / 7000000, 15);
    expect(rows[1].xlm).toBe(2);
    expect(invertSeries(rows)[0].price).toBeCloseTo(7000000, 3);
  });
  it('404 auf der zweiten Seite behaelt Seite 1 (KV-5), anderer Fehler scheitert', async () => {
    const now = Date.UTC(2026, 10, 19, 12);
    const mk = (err) => {
      const page1 = { records: Array.from({ length: 200 }, (_, i) => ({ timestamp: String(now - (365 - i) * DAY_MS), close: '1', counter_volume: '1' })), next: async () => { throw err; } };
      return { tradeAggregation: () => chain(async () => page1) };
    };
    clearAggregationCache();
    expect(await loadPriceSeries({ server: mk(notFound()), tokenAsset: {}, nativeAsset: {}, range: '365d', now })).toHaveLength(200);
    clearAggregationCache();
    await expect(loadPriceSeries({ server: mk(new Error('down')), tokenAsset: {}, nativeAsset: {}, range: '365d', now })).rejects.toThrow('down');
  });
  it('invertSeries: Kehrwert des Preises, Volumen bleibt, Preis 0 faellt weg', () => {
    expect(invertSeries([{ t: 1, price: 4, xlm: 9 }, { t: 2, price: 0, xlm: 1 }])).toEqual([{ t: 1, price: 0.25, xlm: 9 }]);
    expect(invertSeries(null)).toBeNull();
  });
  it('alle Teile scheitern: allFailed; ein synchroner Fehler trifft nur seinen Teil', async () => {
    const boom = () => { throw new Error('down'); };
    const all = await loadAssetMarket({ server: { orderbook: boom, trades: boom, strictSendPaths: boom, tradeAggregation: boom }, tokenAsset: {}, nativeAsset: {}, token: TOKEN });
    expect(all.allFailed).toBe(true);
    const some = await loadAssetMarket({
      server: { orderbook: boom, trades: () => ({ forAssetPair: () => chain(async () => ({ records: [] })) }), strictSendPaths: boom, tradeAggregation: boom },
      tokenAsset: {}, nativeAsset: {}, token: TOKEN,
    });
    expect(some.allFailed).toBe(false);
    expect(some.orderbookError).toBe(true);
    expect(some.sendOneError).toBe(true);
  });
  it('7 Tage mit einem Tag davor geladen (Basis der Aenderung), Verlauf nur 7 Tage', async () => {
    const now = Date.UTC(2026, 10, 17, 12);
    const calls = [];
    const server = {
      orderbook: () => chain(async () => ({ bids: [], asks: [] })),
      trades: () => ({ forAssetPair: () => chain(async () => ({ records: [] })) }),
      strictSendPaths: () => ({ call: async () => ({ records: [] }) }),
      tradeAggregation: (...a) => { calls.push(a); return chain(async () => ({ records: [
        { timestamp: String(now - 7.5 * DAY_MS), open: '1', close: '2', high: '2', low: '1', counter_volume: '1' },
        { timestamp: String(now - HOUR_MS), open: '2', close: '3', high: '3', low: '2', counter_volume: '1' },
      ] })); },
    };
    const m = await loadAssetMarket({ server, tokenAsset: {}, nativeAsset: {}, token: TOKEN, now });
    expect(calls[0][2]).toBe(now - 8 * DAY_MS);
    expect(m.stats7d.changeBase).toBe('before');
    expect(m.stats7d.changePct).toBeCloseTo(50);
    expect(m.series7d).toHaveLength(1);
  });
  it('trade_aggregations: Ergebnis 5 Minuten wiederverwendet, gleiche laufende Anfrage geteilt; Fehler nicht gemerkt', async () => {
    const now = Date.UTC(2026, 10, 17, 12);
    let calls = 0;
    const agg = { records: [{ timestamp: String(now - HOUR_MS), open: '1', close: '1', high: '1', low: '1', counter_volume: '1' }] };
    const server = {
      serverURL: new URL('https://horizon.stellar.org'),
      orderbook: () => chain(async () => ({ bids: [], asks: [] })),
      trades: () => ({ forAssetPair: () => chain(async () => ({ records: [] })) }),
      strictSendPaths: () => ({ call: async () => ({ records: [] }) }),
      tradeAggregation: () => { calls += 1; return chain(async () => agg); },
    };
    const args = { server, tokenAsset: { code: 'LDEX', issuer: ISSUER }, nativeAsset: {}, token: TOKEN };
    await Promise.all([loadAssetMarket({ ...args, now }), loadAssetMarket({ ...args, now })]);
    expect(calls).toBe(1);
    await loadAssetMarket({ ...args, now: now + 4 * 60 * 1000 });
    expect(calls).toBe(1);
    await loadAssetMarket({ ...args, now: now + 6 * 60 * 1000 });
    expect(calls).toBe(2);
    // anderes Netz (andere URL): eigene Abfrage
    await loadAssetMarket({ ...args, server: { ...server, serverURL: new URL('https://horizon-testnet.stellar.org') }, now: now + 6 * 60 * 1000 });
    expect(calls).toBe(3);
  });
  it('429 von Horizon: rateLimited, Fehler wird nicht zwischengespeichert', async () => {
    const now = Date.UTC(2026, 10, 17, 12);
    let calls = 0;
    const tooMany = () => Object.assign(new Error('429'), { response: { status: 429 } });
    const server = {
      orderbook: () => chain(async () => ({ bids: [], asks: [] })),
      trades: () => ({ forAssetPair: () => chain(async () => ({ records: [] })) }),
      strictSendPaths: () => ({ call: async () => ({ records: [] }) }),
      tradeAggregation: () => { calls += 1; return chain(async () => { throw tooMany(); }); },
    };
    const m = await loadAssetMarket({ server, tokenAsset: {}, nativeAsset: {}, token: TOKEN, now });
    expect(m.rateLimited).toBe(true);
    expect(m.statsError).toBe(true);
    await loadAssetMarket({ server, tokenAsset: {}, nativeAsset: {}, token: TOKEN, now });
    expect(calls).toBe(2);
  });
});
