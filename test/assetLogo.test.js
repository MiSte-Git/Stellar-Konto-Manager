// Logo-Proxy (services/assetLogo.js) gegen die gemeinsame Fixture test/assets/asset-logo.json:
// Bilderkennung an den ersten Bytes, Groesse aus dem Bildkopf, image-URL aus der stellar.toml, ganzer Ablauf
// mit Stubs, Header. Dazu der Abbruch beim Lesen (readBytesWithLimit) und der SSRF-Schutz beim Bildabruf.
// Pendant: test/assetLogo.test.php. Route und Rate-Limit: test/assetLogoRoute.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const logo = require('../services/assetLogo.js');
const { readBytesWithLimit } = require('../services/ssrfGuard.js');
const fixture = require('./assets/asset-logo.json');

const hex = (h) => Buffer.from(h, 'hex');

test('Grenzwerte und Fehlerstatus wie in der Fixture', () => {
  assert.equal(logo.MAX_BYTES, fixture.limits.maxBytes);
  assert.equal(logo.MAX_DIMENSION, fixture.limits.maxDimension);
  assert.equal(logo.MAX_URL_LENGTH, fixture.limits.maxUrlLength);
  assert.equal(logo.CACHE_SECONDS, fixture.limits.cacheSeconds);
  assert.equal(logo.ERROR_CACHE_SECONDS, fixture.limits.errorCacheSeconds);
  assert.deepEqual({ ...logo.ERROR_STATUS }, fixture.errors);
});

for (const c of fixture.images) {
  test(`Bild: ${c.name}`, () => {
    assert.deepEqual(logo.sniffLogoImage(hex(c.hex)), c.expect);
  });
}

test('Bild: ueber maxBytes ist tooLarge, genau maxBytes geht', () => {
  const png = hex(fixture.images[0].hex);
  const exact = Buffer.concat([png, Buffer.alloc(fixture.limits.maxBytes - png.length)]);
  assert.equal(logo.sniffLogoImage(exact).ok, true);
  assert.deepEqual(logo.sniffLogoImage(Buffer.concat([exact, Buffer.alloc(1)])), { ok: false, error: 'tooLarge' });
});

for (const c of fixture.imageUrls) {
  test(`image-URL: ${JSON.stringify(c.image)}`, () => {
    assert.equal(logo.logoUrlFromImage(c.image), c.expect);
  });
}

test('image-URL: Laenge bis maxUrlLength', () => {
  const base = 'https://example.com/';
  const ok = base + 'a'.repeat(fixture.limits.maxUrlLength - base.length);
  assert.equal(logo.logoUrlFromImage(ok), ok);
  assert.equal(logo.logoUrlFromImage(ok + 'a'), null);
});

function flowStubs(flow, requested) {
  const horizon = {
    loadAccount: async (id) => {
      assert.equal(id, fixture.issuer);
      if (flow.horizonError) throw new Error('Horizon down');
      return { account_id: id, home_domain: flow.homeDomain };
    },
  };
  const fetchToml = async (url) => {
    assert.equal(url, `https://${flow.homeDomain}/.well-known/stellar.toml`);
    if (flow.tomlError) throw new Error('HTTP 500');
    return flow.toml.split('__ISSUER__').join(fixture.issuer);
  };
  const fetchImage = async (url) => {
    requested.push(url);
    if (flow.imageError === 'tooLarge') throw new Error('ssrf.blocked:responseTooLarge');
    if (flow.imageError === 'network') throw new TypeError('fetch failed');
    if (!(url in flow.images)) throw new Error('HTTP 404');
    return hex(flow.images[url]);
  };
  return { horizon, fetchToml, fetchImage };
}

for (const flow of fixture.flows) {
  test(`Ablauf: ${flow.name}`, async () => {
    const requested = [];
    const result = await logo.fetchAssetLogo({ assetCode: fixture.code, issuer: fixture.issuer, ...flowStubs(flow, requested) });
    const { expect } = flow;
    assert.deepEqual(requested, expect.requested);
    if (expect.status === 200) {
      assert.equal(result.ok, true);
      assert.equal(result.mime, expect.mime);
      assert.equal(result.width, expect.width);
      assert.equal(result.height, expect.height);
      assert.deepEqual(result.bytes, hex(flow.images[expect.requested[0]]));
    } else {
      assert.deepEqual(result, { ok: false, error: expect.error, status: expect.status });
      assert.equal(fixture.errors[expect.error], expect.status);
    }
  });
}

test('Ablauf: Too-large-Fehler in fetch failed (cause) zaehlt als tooLarge', async () => {
  const flow = fixture.flows[0];
  const stubs = flowStubs(flow, []);
  stubs.fetchImage = async () => { throw new TypeError('fetch failed', { cause: new Error('ssrf.blocked:responseTooLarge') }); };
  const result = await logo.fetchAssetLogo({ assetCode: fixture.code, issuer: fixture.issuer, ...stubs });
  assert.equal(result.error, 'tooLarge');
});

test('Ablauf: ungueltiger Code oder Issuer wirft vor jedem Abruf', async () => {
  const never = async () => { throw new Error('darf nicht aufgerufen werden'); };
  const horizon = { loadAccount: never };
  await assert.rejects(logo.fetchAssetLogo({ assetCode: 'TOOLONGCODE123', issuer: fixture.issuer, horizon, fetchToml: never, fetchImage: never }),
    /assetSearch\.invalidInput:codeInvalid/);
  await assert.rejects(logo.fetchAssetLogo({ assetCode: 'USDX', issuer: 'GABC', horizon, fetchToml: never, fetchImage: never }),
    /assetSearch\.invalidInput:issuerInvalid/);
});

test('Header: Erfolg und Fehler wie in der Fixture, Typ aus der Erkennung', () => {
  const bytes = hex(fixture.images[0].hex);
  const sniffed = logo.sniffLogoImage(bytes);
  const headers = logo.logoSuccessHeaders({ ...sniffed, bytes });
  assert.deepEqual(headers, {
    ...fixture.headers.success,
    'Content-Type': 'image/png',
    'Content-Length': String(bytes.length),
    'Content-Disposition': 'inline; filename="logo.png"',
  });
});

// Voruebergehend (no-store) gegen dauerhaft (eine Stunde). Die Liste kommt aus der Fixture, die Gegenprobe
// stellt sicher, dass jede Gruppe nur ihren eigenen Header bekommt.
const PERMANENT_ERRORS = ['noHomeDomain', 'notListed', 'noImage', 'tooLarge', 'unsupportedType', 'invalidImage', 'dimensionsTooLarge'];

test('Fehlergruppen: Fixture teilt alle Fehler in genau zwei Gruppen', () => {
  assert.deepEqual([...logo.TRANSIENT_ERRORS], fixture.transientErrors);
  assert.deepEqual(fixture.transientErrors, ['issuerUnavailable', 'tomlUnavailable', 'fetchFailed']);
  const all = Object.keys(fixture.errors).sort();
  assert.deepEqual([...fixture.transientErrors, ...PERMANENT_ERRORS].sort(), all);
  assert.equal(fixture.transientErrors.filter((e) => PERMANENT_ERRORS.includes(e)).length, 0);
});

for (const error of ['issuerUnavailable', 'tomlUnavailable', 'fetchFailed']) {
  test(`Fehler-Header voruebergehend: ${error} -> no-store`, () => {
    const headers = logo.logoErrorHeaders(error);
    assert.deepEqual(headers, fixture.headers.transientError);
    assert.equal(headers['Cache-Control'], 'no-store');
    assert.doesNotMatch(headers['Cache-Control'], /max-age/, 'Gegenprobe: kein max-age');
  });
}

for (const error of PERMANENT_ERRORS) {
  test(`Fehler-Header dauerhaft: ${error} -> max-age 3600`, () => {
    const headers = logo.logoErrorHeaders(error);
    assert.deepEqual(headers, fixture.headers.error);
    assert.equal(headers['Cache-Control'], `public, max-age=${fixture.limits.errorCacheSeconds}`);
    assert.notEqual(headers['Cache-Control'], 'no-store', 'Gegenprobe: nicht no-store');
  });
}

test('Fehler-Header: unbekannter oder fehlender Fehler gilt als dauerhaft', () => {
  assert.deepEqual(logo.logoErrorHeaders('irgendwas'), fixture.headers.error);
  assert.deepEqual(logo.logoErrorHeaders(undefined), fixture.headers.error);
});

test('Ablauf: jeder fehlgeschlagene Ablauf bekommt den Header seiner Gruppe', async () => {
  let transient = 0;
  let permanent = 0;
  for (const flow of fixture.flows.filter((f) => f.expect.status !== 200)) {
    const result = await logo.fetchAssetLogo({ assetCode: fixture.code, issuer: fixture.issuer, ...flowStubs(flow, []) });
    const isTransient = fixture.transientErrors.includes(flow.expect.error);
    assert.deepEqual(logo.logoErrorHeaders(result.error), isTransient ? fixture.headers.transientError : fixture.headers.error, flow.name);
    if (isTransient) transient += 1; else permanent += 1;
  }
  assert.ok(transient >= 3 && permanent >= 3, 'beide Gruppen kommen in den Ablaeufen vor');
});

test('server.js reicht den Fehler an logoErrorHeaders weiter', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /res\.set\(logoErrorHeaders\(result\.error\)\);/);
  assert.doesNotMatch(src, /logoErrorHeaders\(\)/);
});

// Antwort mit lesbarem Body, der in Stuecken kommt; zaehlt, wie viel gelesen wurde.
function streamingResponse(chunks, headers = {}) {
  const state = { reads: 0, cancelled: false };
  let i = 0;
  const reader = {
    read: async () => {
      state.reads += 1;
      if (i >= chunks.length) return { done: true, value: undefined };
      return { done: false, value: chunks[i++] };
    },
    cancel: async () => { state.cancelled = true; },
  };
  return { state, response: { headers: new Headers(headers), body: { getReader: () => reader } } };
}

test('readBytesWithLimit: bricht beim Lesen ab, sobald die Grenze ueberschritten ist', async () => {
  const chunk = new Uint8Array(100 * 1024);
  const { state, response } = streamingResponse([chunk, chunk, chunk, chunk, chunk]);
  await assert.rejects(readBytesWithLimit(response, logo.MAX_BYTES), /ssrf\.blocked:responseTooLarge/);
  assert.equal(state.reads, 3, 'nach dem dritten Stueck (300 KB) Schluss, Rest nicht gelesen');
  assert.equal(state.cancelled, true);
});

test('readBytesWithLimit: zu grosses Content-Length bricht vor dem Lesen ab', async () => {
  const { state, response } = streamingResponse([new Uint8Array(10)], { 'content-length': String(logo.MAX_BYTES + 1) });
  await assert.rejects(readBytesWithLimit(response, logo.MAX_BYTES), /ssrf\.blocked:responseTooLarge/);
  assert.equal(state.reads, 0);
});

test('readBytesWithLimit: genau an der Grenze liefert die Bytes', async () => {
  const half = new Uint8Array(logo.MAX_BYTES / 2).fill(7);
  const { response } = streamingResponse([half, half]);
  const buf = await readBytesWithLimit(response, logo.MAX_BYTES);
  assert.equal(buf.length, logo.MAX_BYTES);
  assert.equal(buf[0], 7);
});

test('fetchImageBytes: nur https, keine privaten Adressen', async () => {
  await assert.rejects(logo.fetchImageBytes('http://example.com/logo.png'), /ssrf\.blocked:scheme/);
  await assert.rejects(logo.fetchImageBytes('https://127.0.0.1/logo.png'), /ssrf\.blocked:privateAddress/);
  await assert.rejects(logo.fetchImageBytes('https://[::ffff:169.254.169.254]/logo.png'), /ssrf\.blocked:privateAddress/);
});

// --- Review LP-1, LP-2, LP-3, LP-6 -----------------------------------------------------------------------

test('Fristen und Hop-Header wie in der Fixture', () => {
  const { TOML_FETCH_TIMEOUT_MS } = require('../services/tradeService.js');
  assert.equal(logo.HORIZON_TIMEOUT_MS, fixture.limits.horizonTimeoutSeconds * 1000);
  assert.equal(TOML_FETCH_TIMEOUT_MS, fixture.limits.tomlTimeoutSeconds * 1000);
  assert.equal(logo.IMAGE_FETCH_TIMEOUT_MS, fixture.limits.imageTimeoutSeconds * 1000);
  assert.equal(logo.HOP_HEADER, fixture.hopHeader.toLowerCase());
});

for (const c of fixture.refusals) {
  test(`Ablehnung: hop=${JSON.stringify(c.hop)} dest=${JSON.stringify(c.dest)}`, () => {
    const got = logo.logoRequestRefusal(c.hop ?? undefined, c.dest ?? undefined);
    assert.deepEqual(got, c.expect === null ? null : { status: 404, error: c.expect });
  });
}

const sub = (v) => (Array.isArray(v) ? v.map(sub) : (typeof v === 'string' ? v.split('__ISSUER__').join(fixture.issuer) : v));
for (const c of fixture.identityInputs) {
  test(`Eingang: code=${JSON.stringify(c.code)} issuer=${JSON.stringify(c.issuer)}`, () => {
    const { normalizeAssetIdentity } = require('../services/tradeService.js');
    const run = () => normalizeAssetIdentity({ assetCode: sub(c.code) ?? undefined, issuer: sub(c.issuer) ?? undefined });
    if (c.expect === 'ok') assert.deepEqual(run(), { code: 'USDX', issuer: fixture.issuer });
    else assert.throws(run, (e) => e.message === c.expect);
  });
}

test('Horizon haengt: nach der Frist issuerUnavailable, ohne weiteren Abruf', async () => {
  const requested = [];
  const stubs = flowStubs(fixture.flows[0], requested);
  stubs.horizon = { loadAccount: () => new Promise(() => {}) };
  const started = Date.now();
  const result = await logo.fetchAssetLogo({ assetCode: fixture.code, issuer: fixture.issuer, ...stubs, horizonTimeoutMs: 50 });
  assert.deepEqual(result, { ok: false, error: 'issuerUnavailable', status: fixture.errors.issuerUnavailable });
  assert.ok(Date.now() - started < 1000);
  assert.deepEqual(requested, []);
});

test('Horizon wirft synchron: issuerUnavailable', async () => {
  const stubs = flowStubs(fixture.flows[0], []);
  stubs.horizon = { loadAccount: () => { throw new Error('sync'); } };
  const result = await logo.fetchAssetLogo({ assetCode: fixture.code, issuer: fixture.issuer, ...stubs });
  assert.equal(result.error, 'issuerUnavailable');
});

// Abrufe mit ersetztem fetch: Hop-Header und accept-encoding identity gehen bei TOML und Bild mit, auch
// nach einer Weiterleitung. Ziel ist eine oeffentliche Doku-Adresse, der SSRF-Agent wird nie benutzt,
// weil fetch selbst ersetzt ist.
test('Abrufe tragen Hop-Header und accept-encoding identity, auch nach Weiterleitung', async () => {
  const { fetchTextWithTimeout } = require('../services/tradeService.js');
  const seen = [];
  const original = global.fetch;
  global.fetch = async (url, init) => {
    seen.push({ url, headers: init.headers });
    if (url.endsWith('/start')) return new Response(null, { status: 302, headers: { location: '/next' } });
    return new Response(url.includes('toml') ? 'x = 1' : new Uint8Array([1, 2, 3]), { status: 200 });
  };
  try {
    await logo.fetchImageBytes('https://203.0.113.10/start');
    await fetchTextWithTimeout('https://203.0.113.10/toml/start', { [logo.HOP_HEADER]: '1' });
  } finally {
    global.fetch = original;
  }
  assert.equal(seen.length, 4);
  for (const s of seen) {
    assert.equal(s.headers[logo.HOP_HEADER], '1', s.url);
    assert.equal(s.headers['accept-encoding'], 'identity', s.url);
  }
});

test('server.js: Ablehnung vor dem Limiter, Vary beim Logo', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /app\.get\('\/api\/trade\/assets\/logo', refuseLogoRequest, assetLogoLimiter,/);
  assert.match(src, /res\.vary\('Sec-Fetch-Dest'\);\s*return res\.status\(200\)\.end\(result\.bytes\);/);
});

// --- Review LP-4: dieselbe stellar.toml in Node und PHP gleich gelesen (tomlCases) ------------------------

const tomlText = (c) => sub(c.tomlHex !== undefined ? Buffer.from(c.tomlHex, 'hex').toString('utf8') : c.toml);
const PNG_HEX = fixture.images[0].hex;
const subDeep = (v) => {
  if (Array.isArray(v)) return v.map(subDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, subDeep(x)]));
  return sub(v);
};

test('TOML-Faelle: die Probefaelle aus dem Review sind dabei, beide Ergebnisarten kommen vor', () => {
  const probes = fixture.tomlCases.filter((c) => c.probe);
  assert.ok(probes.length >= 15);
  assert.ok(fixture.tomlCases.some((c) => c.expect.invalid) && fixture.tomlCases.some((c) => c.expect.currencies));
  for (const name of ['BOM am Dateianfang', '\\u-Escape in image', '\\U-Escape in image', 'image doppelt im Eintrag', '[[Currencies]]']) {
    assert.ok(probes.some((c) => c.name === name), name);
  }
});

for (const c of fixture.tomlCases) {
  test(`TOML: ${c.name}`, async () => {
    const { parseCurrencySectionsFromToml } = require('../services/tradeService.js');
    const text = tomlText(c);
    if (c.expect.invalid) {
      assert.throws(() => parseCurrencySectionsFromToml(text));
    } else {
      assert.deepEqual(JSON.parse(JSON.stringify(parseCurrencySectionsFromToml(text))), subDeep(c.expect.currencies));
    }
    // Ganzer Ablauf /logo: unter jeder Bild-URL liegt ein gueltiges PNG.
    const result = await logo.fetchAssetLogo({
      assetCode: fixture.code,
      issuer: fixture.issuer,
      horizon: { loadAccount: async () => ({ home_domain: 'example.com' }) },
      fetchToml: async () => text,
      fetchImage: async () => hex(PNG_HEX),
    });
    assert.equal(result.ok ? 'ok' : result.error, c.logo);
  });
}

test('TOML: /facts nutzt dieselbe Auswahl (nur Text-Werte, exakte Schreibweise)', () => {
  const { currencyMatches } = require('../services/tradeService.js');
  const asset = { code: 'USDX', issuer: fixture.issuer };
  assert.equal(currencyMatches({ code: 'USDX', issuer: fixture.issuer }, asset), true);
  assert.equal(currencyMatches({ code: 'usdx', issuer: fixture.issuer }, asset), false);
  assert.equal(currencyMatches({ code: true, issuer: fixture.issuer }, { code: 'true', issuer: fixture.issuer }), false);
  assert.equal(currencyMatches({ code: 123, issuer: fixture.issuer }, { code: '123', issuer: fixture.issuer }), false);
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'services', 'tradeService.js'), 'utf8');
  assert.match(src, /const matches = currencies\.filter\(\(currency\) => currencyMatches\(currency, asset\)\);/);
});

// --- Verschachtelung der stellar.toml (tomlDepthCases) ----------------------------------------------------

const buildToml = (b) => sub(b.text !== undefined ? b.text
  : b.prefix + b.repeat.repeat(b.times) + b.middle + (b.suffix !== undefined ? b.suffix : b.suffixRepeat.repeat(b.times)));
const logoFor = async (text) => {
  const r = await logo.fetchAssetLogo({
    assetCode: fixture.code,
    issuer: fixture.issuer,
    horizon: { loadAccount: async () => ({ home_domain: 'example.com' }) },
    fetchToml: async () => text,
    fetchImage: async () => hex(PNG_HEX),
  });
  return r.ok ? 'ok' : r.error;
};

test('Verschachtelung: Grenzen wie in der Fixture und in der Bibliothek', () => {
  const { TOML_MAX_STRUCTURE_DEPTH, TOML_MAX_NODES, TOML_MAX_KEYS_PER_TABLE } = require('../services/tradeService.js');
  assert.equal(TOML_MAX_STRUCTURE_DEPTH, fixture.limits.tomlMaxStructureDepth);
  assert.equal(TOML_MAX_NODES, fixture.limits.tomlMaxNodes);
  assert.equal(TOML_MAX_KEYS_PER_TABLE, fixture.limits.tomlMaxKeysPerTable);
  const lib = require('fs').readFileSync(require.resolve('toml/lib/parser.js'), 'utf8');
  assert.match(lib, new RegExp(`options\\.maxDepth : ${fixture.limits.tomlMaxDepth};`));
});

for (const c of fixture.tomlDepthCases) {
  test(`Verschachtelung: ${c.name}`, async () => {
    const text = buildToml(c.build);
    const started = Date.now();
    assert.equal(await logoFor(text), c.logo);
    assert.ok(Date.now() - started < 5000, 'unter 5 s');
    // Gegenprobe ohne Grenze: der Fall ist sonst gueltig, abgelehnt wird er nur wegen der Grenze.
    if (c.withoutLimit !== undefined) {
      const { parseCurrencySectionsFromToml } = require('../services/tradeService.js');
      const list = parseCurrencySectionsFromToml(text, { maxDepth: 100000, maxStructureDepth: 100000, maxNodes: 1e9, maxKeysPerTable: 1e9 });
      assert.equal(list.some((e) => e.code === 'USDX') ? 'ok' : 'notListed', c.withoutLimit);
    }
  });
}

test('Verschachtelung: an der Grenze und darueber liegen je beide Faelle vor', () => {
  const names = fixture.tomlDepthCases.map((c) => c.name);
  for (const n of ['500 leere Arrays (an der Grenze)', '501 leere Arrays (eins darueber)', 'gemischt 500 + 1 (eins darueber)', '1 MB nur [']) {
    assert.ok(names.includes(n), n);
  }
  assert.ok(fixture.tomlDepthCases.some((c) => c.withoutLimit === 'ok' && c.logo === 'tomlUnavailable'));
});

test('UTF-8: Node dekodiert wie in utf8Cases (Massstab fuer PHP skm_utf8_scrub)', () => {
  for (const c of fixture.utf8Cases) {
    assert.equal(Buffer.from(Buffer.from(c.hex, 'hex').toString('utf8')).toString('hex'), c.expectHex, c.hex);
  }
});
