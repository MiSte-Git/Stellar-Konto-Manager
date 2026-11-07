// G2/B3: Die composeMail-Pruefung (services/network.js isLocalRequest) verlaesst sich darauf, dass
// der Vite-Dev-Proxy die Client-Adresse als X-Forwarded-For anhaengt (xfwd: true). Ohne die Option
// sieht das Backend jeden Aufruf ueber den Proxy als Loopback. Der Test wertet die echte
// Vite-Konfiguration aus (kein Quelltext-Vergleich) und scheitert, wenn die Option fehlt.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

test('frontend/vite.config.js: Dev-Proxy fuer /api setzt xfwd: true', async () => {
  const configUrl = pathToFileURL(path.join(__dirname, '..', 'frontend', 'vite.config.js')).href;
  const { default: defineConfigResult } = await import(configUrl);
  const config = typeof defineConfigResult === 'function'
    ? await defineConfigResult({ mode: 'development', command: 'serve' })
    : defineConfigResult;
  const proxy = config?.server?.proxy?.['/api'];
  assert.ok(proxy, 'Dev-Proxy fuer /api fehlt');
  assert.equal(proxy.xfwd, true, 'xfwd: true fehlt: composeMail waere ueber den Proxy fuer jeden Aufrufer offen');
});
