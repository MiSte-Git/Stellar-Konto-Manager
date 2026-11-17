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
});

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

// Kurswert einer Aggregation: der String hat 7 Nachkommastellen und kann bei sehr kleinen Preisen 0.0000000 sein,
// dann der genaue Bruch (*_r).
function aggPrice(record, key) {
  const direct = num(record?.[key]);
  if (direct != null && direct > 0) return direct;
  const r = ratio(record?.[`${key}_r`]);
  return r != null && r > 0 ? r : direct;
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
  return (Array.isArray(records) ? records : [])
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
  try {
    const res = await server
      .tradeAggregation(tokenAsset, nativeAsset, now - spanMs - extraMs, now, resolution, 0)
      .limit(200)
      .order('asc')
      .call();
    return Array.isArray(res?.records) ? res.records : [];
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
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

/** Kursverlauf fuer einen Zeitraum ('24h', '7d', '30d'). */
export async function loadPriceSeries({ server, tokenAsset, nativeAsset, range, now = Date.now() }) {
  const records = await loadAggregations(server, tokenAsset, nativeAsset, range, now);
  return aggregationsToSeries(records).filter((p) => p.t >= now - CHART_RANGES[range].spanMs);
}
