// SSRF-Schutz fuer serverseitige Abrufe an Ziele, die ein Client bestimmen kann (stellar.toml einer
// home_domain, Federation). Eine Stelle fuer tradeService.js und federationService.js, Gegenstueck zu
// api/ssrfGuard.php. Gemeinsame Faelle in test/assets/ssrf-addresses.json.
//
// F-7: Adressen werden binaer geprueft (net.isIP und die 4 bzw. 16 Bytes), nicht per Text. Vorher erkannte
// die Textpruefung ::ffff:7f00:1 (so normalisiert new URL ::ffff:127.0.0.1) nicht als Loopback.
// IPv4-mapped (::ffff:0:0/96) und IPv4-compatible (::/96 ausser :: und ::1) gelten wie ihre IPv4-Adresse.
// Weitere IPv6-Formen mit eingebetteter IPv4 sind ganz gesperrt: NAT64 (64:ff9b::/96, 64:ff9b:1::/48), SIIT
// (::ffff:0:0:0/96), 6to4 (2002::/16) und Teredo (2001::/32). Ein Relay oder Uebersetzer koennte sonst eine
// interne IPv4-Adresse erreichen, und eine Einzelpruefung der eingebetteten Adresse lohnt sich fuer diese
// seltenen Formen nicht. Das Dokumentationsnetz 2001:db8::/32 bleibt wie die IPv4-Dokunetze erlaubt.
const dns = require('dns');
const net = require('net');
const { Agent } = require('undici');

// IPv4: gesperrt sind Netze, die nicht oeffentlich routbar sind oder auf den Server selbst zeigen.
// Dokumentationsnetze (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24) bleiben erlaubt, sie sind nicht routbar.
function isBlockedIPv4Bytes([a, b, c]) {
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && (b & 0xc0) === 64) return true; // 100.64.0.0/10 (Carrier-Grade NAT)
  if (a === 127) return true; // 127.0.0.0/8 (Loopback)
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (Link-Local, Cloud-Metadaten)
  if (a === 172 && (b & 0xf0) === 16) return true; // 172.16.0.0/12
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 (IETF)
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b & 0xfe) === 18) return true; // 198.18.0.0/15 (Benchmark)
  if (a >= 224) return true; // 224.0.0.0/4 Multicast, 240.0.0.0/4 reserviert, Broadcast
  return false;
}

// 16 Bytes einer IPv6-Adresse. s ist schon von net.isIP als IPv6 erkannt (ohne Zonen-Index).
function ipv6Bytes(s) {
  let text = s.toLowerCase();
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const [a, b, c, d] = tail.split('.').map(Number);
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [left, right] = text.split('::');
  const leftGroups = left ? left.split(':') : [];
  const rightGroups = right !== undefined && right !== '' ? right.split(':') : [];
  const fill = right !== undefined ? new Array(8 - leftGroups.length - rightGroups.length).fill('0') : [];
  const groups = [...leftGroups, ...fill, ...rightGroups];
  const bytes = new Uint8Array(16);
  groups.forEach((g, i) => {
    const v = parseInt(g, 16);
    bytes[i * 2] = v >> 8;
    bytes[i * 2 + 1] = v & 0xff;
  });
  return bytes;
}

/**
 * Bytes einer IP-Adresse (4 oder 16), null wenn es keine gueltige Adresse ist. Ein Zonen-Index (fe80::1%eth0)
 * wird abgeschnitten.
 */
function ipToBytes(ip) {
  let s = String(ip ?? '').trim();
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);
  const family = net.isIP(s);
  if (family === 4) return Uint8Array.from(s.split('.').map(Number));
  if (family === 6) return ipv6Bytes(s);
  return null;
}

/** Ist die Adresse als Ziel gesperrt? Keine gueltige Adresse: gesperrt (fail closed). */
function isBlockedAddress(ip) {
  const b = ipToBytes(ip);
  if (!b) return true;
  if (b.length === 4) return isBlockedIPv4Bytes(b);
  const zeroUpTo = (n) => b.subarray(0, n).every((x) => x === 0);
  // ::ffff:0:0/96 (IPv4-mapped): wie die IPv4-Adresse.
  if (zeroUpTo(10) && b[10] === 0xff && b[11] === 0xff) return isBlockedIPv4Bytes(b.subarray(12));
  // ::/96: :: und ::1 gesperrt, sonst IPv4-compatible wie die IPv4-Adresse.
  if (zeroUpTo(12)) {
    if (b[12] === 0 && b[13] === 0 && b[14] === 0 && b[15] <= 1) return true;
    return isBlockedIPv4Bytes(b.subarray(12));
  }
  // ::ffff:0:0:0/96 (SIIT, RFC 6145): ganz gesperrt.
  if (zeroUpTo(8) && b[8] === 0xff && b[9] === 0xff && b[10] === 0 && b[11] === 0) return true;
  // 64:ff9b::/96 (NAT64, RFC 6052) und 64:ff9b:1::/48 (lokales NAT64, RFC 8215): ganz gesperrt.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) {
    if (b.subarray(4, 12).every((x) => x === 0)) return true;
    if (b[4] === 0x00 && b[5] === 0x01) return true;
  }
  if (b[0] === 0x20 && b[1] === 0x02) return true; // 2002::/16 (6to4)
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return true; // 2001::/32 (Teredo)
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 Link-Local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true; // fec0::/10 Site-Local (veraltet)
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 Unique-Local
  if (b[0] === 0xff) return true; // ff00::/8 Multicast
  return false;
}

// Validates scheme, and - only for the literal-IP-host case explained below
// - the address itself. Everything else (hostname-based targets) is checked
// inside ssrfSafeLookup() below, at the exact moment a connection is made.
function assertSafeScheme(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('ssrf.blocked:invalidUrl');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('ssrf.blocked:scheme');
  }
  // If the URL's host is already a literal IP address (e.g. a home_domain of
  // "127.0.0.1" or "169.254.169.254"), Node/undici's networking stack skips
  // DNS resolution entirely for it - net.isIP() short-circuits before a
  // custom connect.lookup is ever invoked, so ssrfSafeLookup() would never
  // run for this case at all. Check it here instead. new URL hat Hex- und
  // Dezimalschreibweisen (0x7f.1, 2130706433, ::ffff:127.0.0.1) schon normalisiert.
  const bareHost = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (net.isIP(bareHost) && isBlockedAddress(bareHost)) {
    throw new Error('ssrf.blocked:privateAddress');
  }
  return parsed;
}

// Custom DNS resolver plugged into the undici Agent used for TOML and federation fetches
// (N1 fix). Previously, a check-lookup validated the hostname and a
// *separate* lookup performed by fetch() itself resolved it again for the
// actual connection - a DNS-rebinding attacker controlling the target's
// nameserver could answer the first lookup with a public IP (passing
// validation) and the second, independent lookup moments later with a
// private one (e.g. cloud metadata), completing the SSRF after the check
// already passed. Wiring this function in as the Agent's connect.lookup
// means undici performs exactly one resolution, and it's this one: the
// address that gets validated here is unconditionally the same address the
// socket then connects to. dns.lookup bewusst ueber das Modul (Tests ersetzen es).
function ssrfSafeLookup(hostname, options, callback) {
  const host = String(hostname || '').trim();
  if (!host) return callback(new Error('ssrf.blocked:emptyHost'));
  const normalizedHost = host.replace(/\.$/, '').toLowerCase();
  if (normalizedHost === 'localhost' || normalizedHost.endsWith('.localhost')) {
    return callback(new Error('ssrf.blocked:localhost'));
  }
  dns.lookup(host, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(new Error('ssrf.blocked:dnsLookupFailed'));
    if (!addresses || !addresses.length) return callback(new Error('ssrf.blocked:noAddress'));
    for (const { address } of addresses) {
      if (isBlockedAddress(address)) return callback(new Error('ssrf.blocked:privateAddress'));
    }
    callback(null, addresses);
  });
}

// Single shared Agent (stable, stateless lookup fn - safe to reuse across
// requests, same as a normal connection-pooling HTTP agent would be).
const ssrfSafeAgent = new Agent({ connect: { lookup: ssrfSafeLookup } });

/**
 * F-7: Naechste URL einer von Hand verfolgten Weiterleitung. Relative Location wird gegen die aktuelle URL
 * aufgeloest; das Ergebnis muss https sein. Gleich wie skm_next_redirect_url in api/ssrfGuard.php.
 */
function nextRedirectUrl(currentUrl, location) {
  if (typeof location !== 'string' || location === '') throw new Error('ssrf.blocked:redirectWithoutLocation');
  let next;
  try {
    next = new URL(location, currentUrl);
  } catch {
    throw new Error('ssrf.blocked:invalidUrl');
  }
  if (next.protocol !== 'https:') throw new Error('ssrf.blocked:scheme');
  return next.toString();
}

// Reads a fetch Response body up to maxBytes, rejecting anything larger
// instead of buffering it fully in memory (N2 fix: an attacker-controlled
// home_domain could otherwise point stellar.toml at an effectively unbounded
// response). Falls back to response.text() for response shapes without a
// real streaming body (e.g. plain-object mocks in tests).
async function readTextWithLimit(response, maxBytes) {
  // Nur pruefen, ob ein Reader moeglich ist; holen tut ihn readBytesWithLimit (ein zweites getReader() auf
  // demselben Stream wirft "ReadableStream is locked").
  if (typeof response.body?.getReader !== 'function') {
    assertDeclaredLength(response, maxBytes);
    return response.text();
  }
  return (await readBytesWithLimit(response, maxBytes)).toString('utf8');
}

function assertDeclaredLength(response, maxBytes) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('ssrf.blocked:responseTooLarge');
  }
}

// Wie readTextWithLimit, liefert aber die Bytes (Logo-Proxy). Bricht ab, sobald mehr als maxBytes gelesen
// sind, und schon vorher bei zu grossem Content-Length. Ohne lesbaren Body (Mocks): arrayBuffer, dann Pruefung.
async function readBytesWithLimit(response, maxBytes) {
  assertDeclaredLength(response, maxBytes);
  const reader = response.body?.getReader?.();
  if (!reader) {
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('ssrf.blocked:responseTooLarge');
    return buf;
  }

  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error('ssrf.blocked:responseTooLarge');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

module.exports = {
  ipToBytes,
  isBlockedAddress,
  assertSafeScheme,
  ssrfSafeLookup,
  ssrfSafeAgent,
  nextRedirectUrl,
  readTextWithLimit,
  readBytesWithLimit,
};
