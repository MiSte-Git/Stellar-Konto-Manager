// Peer-address check used to gate /api/composeMail (server.js). CORS is a
// browser-enforced policy, not server-side authentication - a non-browser
// caller ignores the Origin header entirely - so an endpoint that must stay
// unauthenticated but is only ever meant to be triggered from the same
// machine (composeMail spawns a local GUI mail client) needs a check that
// doesn't depend on anything the client sends.
function isLoopbackAddress(remoteAddress) {
  const addr = String(remoteAddress || '').replace(/^::ffff:/, '');
  if (addr === '::1') return true;
  // B3-4: nur echte IPv4-Adressen 127.x.y.z, jedes Oktett 0 bis 255 (kein 127.999.1.1).
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr);
  return m !== null && m.slice(1).every((octet) => Number(octet) <= 255);
}

// G2: Hinter einem Reverse Proxy (Vite-Dev-Proxy) ist die Peer-Adresse immer
// Loopback, auch wenn der Aufrufer von aussen kommt. Deshalb zaehlt ein Request
// nur dann als lokal, wenn die Peer-Adresse Loopback ist UND jede Adresse in
// X-Forwarded-For, Forwarded und X-Real-IP ebenfalls Loopback ist. Fail-closed:
// ein Eintrag, der sich nicht sicher als Loopback-Adresse lesen laesst, lehnt ab.
// Voraussetzung: der Proxy haengt die Client-Adresse an (Vite: xfwd: true in
// frontend/vite.config.js). Ein vom Client mitgeschickter Header kann nur
// weitere Adressen hinzufuegen, nie die echte entfernen.
function headerValues(value) {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}

function forwardedEntriesLoopback(headers) {
  const entries = [];
  for (const v of headerValues(headers['x-forwarded-for'])) entries.push(...v.split(','));
  for (const v of headerValues(headers['x-real-ip'])) entries.push(...v.split(','));
  for (const v of headerValues(headers.forwarded)) {
    for (const element of v.split(',')) {
      const m = /(?:^|;)\s*for\s*=\s*("[^"]*"|[^;]*)/i.exec(element);
      // Ein Forwarded-Element ohne for= traegt keine Adresse, ist aber ungewoehnlich: ablehnen.
      if (!m) return false;
      entries.push(m[1].replace(/^"|"$/g, '').replace(/^\[|\](?::\d+)?$/g, '').replace(/^(\d+\.\d+\.\d+\.\d+):\d+$/, '$1'));
    }
  }
  return entries.every((e) => isLoopbackAddress(e.trim()));
}

function isLocalRequest(req) {
  if (!isLoopbackAddress(req?.socket?.remoteAddress)) return false;
  return forwardedEntriesLoopback(req.headers || {});
}

module.exports = { isLoopbackAddress, isLocalRequest };
