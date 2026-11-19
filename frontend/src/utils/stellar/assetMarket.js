// Marktdaten eines Tokens gegen XLM fuer die Asset-Detailseite (nur Anzeige, sendet nichts).
//
// Alle Preise sind XLM je 1 Token. Quelle ist ausschliesslich Horizon (DEX und Liquidity Pools); SKM bewertet
// damit kein Token (AGENTS.md Regel 4). Fehlen Daten, ist der Wert null (Anzeige: kein Handel / kein Angebot),
// nie 0.
//
// Horizon-Konventionen, belegt mit echten Mainnet-Antworten (__tests__/fixtures/horizon-usdc-xlm.json, Review AM-12):
// order_book (Basis = Token, Gegenwert = XLM): price ist XLM je Token; bei asks ist amount in Token, bei bids in XLM
// (der Bietende verkauft XLM). Trades: price {n, d} ist Gegenwert je Basis des jeweiligen Trades; Horizon richtet die
// Trades nach der Anfrage aus, behandelt werden trotzdem beide Richtungen. trade_aggregations rechnet in der
// angefragten Richtung (counter_volume in XLM). Ein Asset ohne je einen Handel ergibt bei trades und
// trade_aggregations 404: das heisst kein Handel, kein Fehler.

export const ORDERBOOK_DEPTH = 10;
// Abgefragte Preisstufen je Seite; bei so vielen Stufen zeigt die Karte den Zaehler mit +.
export const ORDERBOOK_LIMIT = 50;
export const HOUR_MS = 3600 * 1000;
export const DAY_MS = 24 * HOUR_MS;
// Duennes Orderbuch: eine Seite mit weniger als 3 Preisstufen, Spread ab 5 % oder ueberkreuztes Buch.
export const THIN_MIN_OFFERS = 3;
export const THIN_SPREAD_PCT = 5;

export const CHART_RANGES = Object.freeze({
  '24h': { spanMs: DAY_MS, resolution: HOUR_MS },
  '7d': { spanMs: 7 * DAY_MS, resolution: HOUR_MS },
  '30d': { spanMs: 30 * DAY_MS, resolution: DAY_MS },
  '90d': { spanMs: 90 * DAY_MS, resolution: DAY_MS },
  '180d': { spanMs: 180 * DAY_MS, resolution: DAY_MS },
  '365d': { spanMs: 365 * DAY_MS, resolution: DAY_MS },
});

// Zeitraeume mit Tageswerten: eigene Abfrage, erst bei Auswahl (24 h und 7 Tage kommen aus den Stundenwerten).
export const LONG_RANGES = Object.freeze(['30d', '90d', '180d', '365d']);
const AGG_PAGE_LIMIT = 200;

/** Kehrwert einer Kursreihe: Token je 1 XLM statt XLM je 1 Token. Volumen bleibt in XLM. */
export function invertSeries(series) {
  if (!Array.isArray(series)) return series;
  return series.filter((p) => p && p.price > 0).map((p) => ({ ...p, price: 1 / p.price }));
}

function num(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ratio(r) {
  const n = num(r?.n ?? r?.N);
  const d = num(r?.d ?? r?.D);
  return n != null && d ? n / d : null;
}

function priceOf(item) {
  const direct = num(item?.price);
  if (direct != null && direct > 0) return direct;
  return ratio(item?.price_r);
}

// Kurswert einer Aggregation: zuerst der genaue Bruch (*_r). Der String hat nur 7 Nachkommastellen; bei kleinen
// Preisen ist er stark gerundet (1e-7 statt 1,43e-7), und der Kehrwert im umgekehrten Verlauf verstaerkt das
// (Review KV-1). Der String nur als Rueckfall.
function aggPrice(record, key) {
  const r = ratio(record?.[`${key}_r`]);
  if (r != null && r > 0) return r;
  return num(record?.[key]);
}

/** Horizon-404 (Asset nie gehandelt): leer statt Fehler. */
function isNotFound(err) {
  return (err?.response?.status ?? err?.status) === 404;
}

/** Horizon-429: zu viele Anfragen von dieser IP (bei trade_aggregations auf horizon.stellar.org schnell erreicht). */
export function isRateLimited(err) {
  return (err?.response?.status ?? err?.status) === 429;
}

// trade_aggregations ist auf dem oeffentlichen Horizon eng begrenzt (Sichtpruefung 17.11.: 429, waehrend order_book,
// trades und paths noch antworteten). Ergebnisse je Netz, Paar und Zeitraum deshalb 5 Minuten im Speicher, gleiche
// laufende Anfragen werden geteilt (React StrictMode, Doppelklick, Hin- und Herwechseln der Seite).
export const AGG_CACHE_MS = 5 * 60 * 1000;
const aggCache = new Map();

export function clearAggregationCache() {
  aggCache.clear();
}

function aggCacheKey(server, tokenAsset, range, extraMs) {
  const base = server?.serverURL?.toString?.() || '';
  const code = tokenAsset?.getCode?.() || tokenAsset?.code || '';
  const issuer = tokenAsset?.getIssuer?.() || tokenAsset?.issuer || '';
  return `${base}|${code}|${issuer}|${range}|${extraMs}`;
}

/** Orderbuch Token/XLM: beste Preise, Mitte, Spread, je Seite bis zu depth Stufen mit Menge (Token) und Summe (XLM). */
export function summarizeOrderbook(book, depth = ORDERBOOK_DEPTH) {
  const rawBids = Array.isArray(book?.bids) ? book.bids : [];
  const rawAsks = Array.isArray(book?.asks) ? book.asks : [];
  const bids = rawBids.map((b) => {
    const price = priceOf(b);
    const xlm = num(b?.amount);
    return price && xlm != null ? { price, amount: xlm / price, total: xlm } : null;
  }).filter(Boolean);
  const asks = rawAsks.map((a) => {
    const price = priceOf(a);
    const amount = num(a?.amount);
    return price && amount != null ? { price, amount, total: amount * price } : null;
  }).filter(Boolean);
  bids.sort((a, b) => b.price - a.price);
  asks.sort((a, b) => a.price - b.price);
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  // Mitte nur mit beiden Seiten (keine geratene Mitte aus einer Seite); ein ueberkreuztes Buch hat keine Mitte.
  const crossed = bestBid != null && bestAsk != null && bestBid >= bestAsk;
  const mid = bestBid != null && bestAsk != null && !crossed ? (bestBid + bestAsk) / 2 : null;
  const spreadPct = mid ? ((bestAsk - bestBid) / mid) * 100 : null;
  const thin = crossed || bids.length < THIN_MIN_OFFERS || asks.length < THIN_MIN_OFFERS
    || (spreadPct != null && spreadPct >= THIN_SPREAD_PCT);
  return {
    bestBid,
    bestAsk,
    mid,
    spreadPct,
    thin,
    crossed,
    bids: bids.slice(0, depth),
    asks: asks.slice(0, depth),
    bidCount: rawBids.length,
    askCount: rawAsks.length,
    bidCountCapped: rawBids.length >= ORDERBOOK_LIMIT,
    askCountCapped: rawAsks.length >= ORDERBOOK_LIMIT,
  };
}

function isSameToken(side, token) {
  return side?.code === token.code && side?.issuer === token.issuer;
}

/** Preis (XLM je Token) und Zeit eines Horizon-Trades fuer das Paar Token/XLM, sonst null. */
export function priceFromTrade(trade, token) {
  if (!trade || !token) return null;
  const base = { type: trade.base_asset_type, code: trade.base_asset_code, issuer: trade.base_asset_issuer };
  const counter = { type: trade.counter_asset_type, code: trade.counter_asset_code, issuer: trade.counter_asset_issuer };
  const n = num(trade?.price?.n);
  const d = num(trade?.price?.d);
  if (!n || !d) return null;
  const counterPerBase = n / d;
  let price = null;
  if (isSameToken(base, token) && counter.type === 'native') price = counterPerBase;
  else if (base.type === 'native' && isSameToken(counter, token)) price = 1 / counterPerBase;
  if (!price || !Number.isFinite(price)) return null;
  return { price, at: trade.ledger_close_time || null };
}

function aggRows(records) {
  // Je Zeitstempel ein Bucket (Review KV-4: ueberlappende Seiten), der letzte gewinnt.
  const byTime = new Map();
  for (const r of Array.isArray(records) ? records : []) byTime.set(num(r?.timestamp), r);
  return [...byTime.values()]
    .map((r) => ({
      t: num(r?.timestamp),
      open: aggPrice(r, 'open'),
      close: aggPrice(r, 'close'),
      high: aggPrice(r, 'high'),
      low: aggPrice(r, 'low'),
      xlm: num(r?.counter_volume) || 0,
      token: num(r?.base_volume) || 0,
      count: num(r?.trade_count) || 0,
    }))
    .filter((r) => r.t != null && r.close != null && r.close > 0)
    .sort((a, b) => a.t - b.t);
}

/**
 * Kennzahlen aus trade_aggregations (Token als Basis, XLM als Gegenwert) fuer den Zeitraum ab sinceMs. Ein Bucket
 * zaehlt mit, sobald er in den Zeitraum hineinreicht (t + resolution > sinceMs). Volumen in XLM und Token, Hoch,
 * Tief, Anzahl Trades. Aenderung gegen den letzten Schlusskurs vor dem Zeitraum (changeBase 'before'); gibt es keinen,
 * gegen den ersten Eroeffnungskurs im Zeitraum (changeBase 'firstTrade', die Karte sagt das dazu). Ohne Bucket im
 * Zeitraum: null (kein Handel).
 */
export function summarizeAggregations(records, sinceMs, resolution = 0) {
  const all = aggRows(records);
  const inside = all.filter((r) => r.t + resolution > sinceMs);
  if (!inside.length) return null;
  const before = all.filter((r) => r.t + resolution <= sinceMs);
  const prevClose = before.length ? before[before.length - 1].close : null;
  const base = prevClose ?? inside[0].open;
  const last = inside[inside.length - 1];
  const highs = inside.map((r) => r.high).filter((v) => v != null);
  const lows = inside.map((r) => r.low).filter((v) => v != null && v > 0);
  return {
    volumeXlm: inside.reduce((s, r) => s + r.xlm, 0),
    volumeToken: inside.reduce((s, r) => s + r.token, 0),
    trades: inside.reduce((s, r) => s + r.count, 0),
    changePct: base ? ((last.close - base) / base) * 100 : null,
    changeBase: prevClose != null ? 'before' : 'firstTrade',
    high: highs.length ? Math.max(...highs) : null,
    low: lows.length ? Math.min(...lows) : null,
    close: last.close,
  };
}

/** Punkte fuer den Kursverlauf: Schlusskurs je Bucket, aufsteigend nach Zeit. */
export function aggregationsToSeries(records) {
  return aggRows(records).map((r) => ({ t: r.t, price: r.close, xlm: r.xlm }));
}

/**
 * Richtkurs fuer den Wert des eigenen Bestands (Review AM-2): nur die Mitte eines nicht duennen Orderbuchs. Ein
 * einzelner (evtl. eigener) Handel oder die Mitte bei grossem Spread waeren leicht zu manipulieren bzw. nicht
 * erzielbar. Sonst kein Wert, mit Grund: 'unavailable' (Orderbuch nicht ladbar), 'thin', 'none' (keine Angebote).
 */
export function referencePrice(market) {
  if (!market) return { price: null, reason: 'unavailable' };
  if (market.orderbookError || !market.orderbook) return { price: null, reason: 'unavailable' };
  const ob = market.orderbook;
  if (ob.mid == null) return { price: null, reason: ob.bids.length || ob.asks.length ? 'thin' : 'none' };
  if (ob.thin) return { price: null, reason: 'thin' };
  return { price: ob.mid, reason: '' };
}

/** Bestes Ergebnis eines strict-send-Pfads (1 Token nach XLM), sonst null. */
export function bestSendResult(pathsResponse) {
  const records = Array.isArray(pathsResponse?.records) ? pathsResponse.records : [];
  const amounts = records.map((r) => num(r?.destination_amount)).filter((v) => v != null && v > 0);
  return amounts.length ? Math.max(...amounts) : null;
}

async function loadAggregations(server, tokenAsset, nativeAsset, range, now, extraMs = 0) {
  const key = aggCacheKey(server, tokenAsset, range, extraMs);
  const hit = aggCache.get(key);
  if (hit && (hit.promise || now - hit.at < AGG_CACHE_MS)) return hit.promise || hit.records;
  const promise = fetchAggregations(server, tokenAsset, nativeAsset, range, now, extraMs);
  aggCache.set(key, { promise });
  try {
    const records = await promise;
    aggCache.set(key, { at: now, records });
    return records;
  } catch (err) {
    aggCache.delete(key);
    throw err;
  }
}

async function fetchAggregations(server, tokenAsset, nativeAsset, range, now, extraMs) {
  const { spanMs, resolution } = CHART_RANGES[range];
  // 1 Jahr in Tageswerten braucht 2 Seiten zu 200 (365 plus hoechstens 2 angeschnittene Buckets), mehr Seiten als
  // noetig werden nie abgefragt. Wer CHART_RANGES aendert (z. B. Stundenwerte fuer laengere Zeitraeume), muss
  // pruefen, dass maxPages reicht; eine volle letzte Seite wuerde sonst still abgeschnitten (Review KV-5).
  const maxPages = Math.max(1, Math.ceil((spanMs + extraMs) / resolution / AGG_PAGE_LIMIT));
  // Folgeseiten nicht ueber next(): der Link von Horizon ist absolut (https://horizon.stellar.org/...) und umgeht
  // damit den konfigurierten Server, im Dev-Betrieb den Vite-Proxy (Sichtpruefung 19.11.: 1 Jahr nicht verfuegbar).
  // Stattdessen dieselbe Abfrage ab dem Bucket nach dem letzten erhaltenen.
  const fetchPage = (from) => server
    .tradeAggregation(tokenAsset, nativeAsset, from, now, resolution, 0)
    .limit(AGG_PAGE_LIMIT)
    .order('asc')
    .call();
  let res;
  try {
    res = await fetchPage(now - spanMs - extraMs);
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
  let records = Array.isArray(res?.records) ? res.records : [];
  for (let page = 1; page < maxPages && res?.records?.length === AGG_PAGE_LIMIT; page += 1) {
    const lastT = num(res.records[res.records.length - 1]?.timestamp);
    if (lastT == null || lastT + resolution >= now) break;
    try {
      res = await fetchPage(lastT + resolution);
    } catch (err) {
      // 404 auf einer Folgeseite: keine weiteren Daten, Seite 1 bleibt (Review KV-5). Andere Fehler wie bisher.
      if (isNotFound(err)) break;
      throw err;
    }
    if (!Array.isArray(res?.records) || res.records.length === 0) break;
    records = records.concat(res.records);
  }
  return records;
}

async function loadLastTrade(server, tokenAsset, nativeAsset) {
  try {
    return await server.trades().forAssetPair(tokenAsset, nativeAsset).order('desc').limit(1).call();
  } catch (err) {
    if (isNotFound(err)) return { records: [] };
    throw err;
  }
}

/**
 * Laedt Kopf, Kennzahlen und Orderbuch. Jeder Teil darf einzeln scheitern (Fehler je Teil, kein Gesamtabbruch).
 * tokenAsset/nativeAsset sind SDK-Assets; token = { code, issuer }.
 */
export async function loadAssetMarket({ server, tokenAsset, nativeAsset, token, now = Date.now() }) {
  // Funktionen statt direkter Aufrufe: ein synchroner Fehler (z. B. ungueltiges Asset) trifft nur seinen Teil.
  const [bookRes, tradeRes, pathRes, aggRes] = await Promise.allSettled([
    (async () => server.orderbook(tokenAsset, nativeAsset).limit(ORDERBOOK_LIMIT).call())(),
    loadLastTrade(server, tokenAsset, nativeAsset),
    (async () => server.strictSendPaths(tokenAsset, '1', [nativeAsset]).call())(),
    // 7 Tage plus ein Tag davor: Schlusskurs vor dem Zeitraum als Basis der Aenderung (AM-5). 192 Stundenwerte < 200.
    loadAggregations(server, tokenAsset, nativeAsset, '7d', now, DAY_MS),
  ]);
  const allFailed = [bookRes, tradeRes, pathRes, aggRes].every((r) => r.status === 'rejected');
  const lastTrade = tradeRes.status === 'fulfilled'
    ? priceFromTrade(tradeRes.value?.records?.[0], token)
    : null;
  const agg = aggRes.status === 'fulfilled' ? aggRes.value : null;
  return {
    loadedAt: now,
    allFailed,
    orderbook: bookRes.status === 'fulfilled' ? summarizeOrderbook(bookRes.value) : null,
    orderbookError: bookRes.status === 'rejected',
    lastTrade,
    lastTradeError: tradeRes.status === 'rejected',
    sendOne: pathRes.status === 'fulfilled' ? bestSendResult(pathRes.value) : null,
    sendOneError: pathRes.status === 'rejected',
    stats24h: agg ? summarizeAggregations(agg, now - DAY_MS, HOUR_MS) : null,
    stats7d: agg ? summarizeAggregations(agg, now - 7 * DAY_MS, HOUR_MS) : null,
    statsError: aggRes.status === 'rejected',
    rateLimited: [bookRes, tradeRes, pathRes, aggRes].some((r) => r.status === 'rejected' && isRateLimited(r.reason)),
    series7d: agg ? aggregationsToSeries(agg).filter((p) => p.t >= now - 7 * DAY_MS) : null,
  };
}

/**
 * Kursverlauf fuer einen Zeitraum aus CHART_RANGES. Alle Zeitraeume mit Tageswerten kommen aus einer Abfrage fuer
 * 1 Jahr (ein Cache-Eintrag), zugeschnitten auf den Zeitraum: spart Aufrufe bei dem eng begrenzten
 * trade_aggregations (Review KV-3).
 */
export async function loadPriceSeries({ server, tokenAsset, nativeAsset, range, now = Date.now() }) {
  const source = LONG_RANGES.includes(range) ? '365d' : range;
  const records = await loadAggregations(server, tokenAsset, nativeAsset, source, now);
  return aggregationsToSeries(records).filter((p) => p.t >= now - CHART_RANGES[range].spanMs);
}
