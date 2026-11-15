const test = require('node:test');
const assert = require('node:assert/strict');
const { isLoopbackAddress } = require('../services/network.js');

test('isLoopbackAddress accepts IPv4 loopback', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('127.0.0.2'), true); // whole 127.0.0.0/8 is loopback
});

test('isLoopbackAddress accepts IPv6 loopback', () => {
  assert.equal(isLoopbackAddress('::1'), true);
});

test('isLoopbackAddress accepts the IPv4-mapped IPv6 form Node uses for dual-stack sockets', () => {
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
});

test('isLoopbackAddress rejects a LAN address', () => {
  assert.equal(isLoopbackAddress('192.168.1.50'), false);
});

test('isLoopbackAddress rejects a public address', () => {
  assert.equal(isLoopbackAddress('203.0.113.7'), false);
});

test('isLoopbackAddress rejects an IPv4-mapped non-loopback address', () => {
  assert.equal(isLoopbackAddress('::ffff:203.0.113.7'), false);
});

test('isLoopbackAddress rejects empty/missing input (fail closed)', () => {
  assert.equal(isLoopbackAddress(''), false);
  assert.equal(isLoopbackAddress(undefined), false);
  assert.equal(isLoopbackAddress(null), false);
});

const { isLocalRequest } = require('../services/network.js');
const req = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });

test('G2: isLocalRequest akzeptiert direkten Loopback ohne Weiterleitungs-Header', () => {
  assert.equal(isLocalRequest(req('127.0.0.1')), true);
  assert.equal(isLocalRequest(req('::1')), true);
});

test('G2: isLocalRequest lehnt Aufrufe von aussen ab, die ueber einen Loopback-Proxy kommen', () => {
  assert.equal(isLocalRequest(req('127.0.0.1', { 'x-forwarded-for': '203.0.113.7' })), false);
  // Der Client darf Loopback vorgeben; der Proxy haengt die echte Adresse an.
  assert.equal(isLocalRequest(req('127.0.0.1', { 'x-forwarded-for': '127.0.0.1, 203.0.113.7' })), false);
  assert.equal(isLocalRequest(req('127.0.0.1', { 'x-real-ip': '198.51.100.2' })), false);
  assert.equal(isLocalRequest(req('127.0.0.1', { forwarded: 'for=203.0.113.7;proto=http' })), false);
  assert.equal(isLocalRequest(req('127.0.0.1', { forwarded: 'for="[2001:db8::1]:4711"' })), false);
});

test('G2: isLocalRequest akzeptiert Loopback auch im Weiterleitungs-Header (lokaler Browser ueber Vite)', () => {
  assert.equal(isLocalRequest(req('127.0.0.1', { 'x-forwarded-for': '::1' })), true);
  assert.equal(isLocalRequest(req('::ffff:127.0.0.1', { 'x-forwarded-for': '127.0.0.1' })), true);
  assert.equal(isLocalRequest(req('127.0.0.1', { forwarded: 'for=127.0.0.1' })), true);
});

test('G2: isLocalRequest lehnt im Zweifel ab (fail-closed)', () => {
  assert.equal(isLocalRequest(req('203.0.113.7')), false);
  assert.equal(isLocalRequest(req('127.0.0.1', { 'x-forwarded-for': '' })), false);
  assert.equal(isLocalRequest(req('127.0.0.1', { 'x-forwarded-for': 'unknown' })), false);
  assert.equal(isLocalRequest(req('127.0.0.1', { forwarded: 'by=203.0.113.7' })), false);
  assert.equal(isLocalRequest(req('127.0.0.1', { 'x-forwarded-for': '127.0.0.1.evil.test' })), false);
  assert.equal(isLocalRequest({ headers: {} }), false);
  assert.equal(isLocalRequest(undefined), false);
});

test('G2: isLoopbackAddress lehnt Adressen ab, die nur mit 127. beginnen', () => {
  assert.equal(isLoopbackAddress('127.0.0.1.evil.test'), false);
});

test('B3-4: isLoopbackAddress akzeptiert nur Oktette 0 bis 255', () => {
  assert.equal(isLoopbackAddress('127.255.255.255'), true);
  assert.equal(isLoopbackAddress('127.0.0.256'), false);
  assert.equal(isLoopbackAddress('127.999.1.1'), false);
  assert.equal(isLoopbackAddress('127.0.256.0'), false);
  assert.equal(isLoopbackAddress('127.0.0.1\n'), false);
});

test('B3-4: isLocalRequest lehnt ungueltige Oktette im Weiterleitungs-Header ab', () => {
  assert.equal(isLocalRequest(req('127.0.0.1', { 'x-forwarded-for': '127.999.1.1' })), false);
  assert.equal(isLocalRequest(req('127.0.0.1', { forwarded: 'for=127.0.0.256' })), false);
  assert.equal(isLocalRequest(req('127.0.0.1', { 'x-forwarded-for': '127.0.0.5' })), true);
});

// B3-5: Forwarded wird wie X-Forwarded-For ganz gelesen: jedes for= in jedem Element, auch mehrere for= in
// einem Element (durch ; getrennt) und mehrere Header-Zeilen. Vorher zaehlte je Element nur das erste for=,
// ein weiteres mit fremder Adresse blieb unbeachtet. Fail-closed wie bisher: was sich nicht sicher als
// Loopback lesen laesst, lehnt ab.
test('B3-5: zweites for= im selben Forwarded-Element mit fremder Adresse lehnt ab', () => {
  assert.equal(isLocalRequest(req('127.0.0.1', { forwarded: 'for=127.0.0.1;for=203.0.113.7' })), false);
  assert.equal(isLocalRequest(req('127.0.0.1', { forwarded: 'for=127.0.0.1;proto=http;for="[2001:db8::1]:4711"' })), false);
  assert.equal(isLocalRequest(req('127.0.0.1', { forwarded: 'proto=http;for=127.0.0.1;by=127.0.0.1;FOR=203.0.113.7' })), false);
});

test('B3-5: jedes Element und jede Header-Zeile zaehlt', () => {
  assert.equal(isLocalRequest(req('127.0.0.1', { forwarded: 'for=127.0.0.1, for=203.0.113.7' })), false);
  assert.equal(isLocalRequest(req('127.0.0.1', { forwarded: ['for=127.0.0.1', 'for=127.0.0.1;for=203.0.113.7'] })), false);
});

test('B3-5: Leerzeichen, Gross- und Kleinschreibung und Anfuehrungszeichen verbergen kein for=', () => {
  assert.equal(isLocalRequest(req('127.0.0.1', { forwarded: 'for=127.0.0.1 ; For = 203.0.113.7' })), false);
  assert.equal(isLocalRequest(req('127.0.0.1', { forwarded: 'for=127.0.0.1;x="a;for=203.0.113.7"' })), false);
  assert.equal(isLocalRequest(req('127.0.0.1', { forwarded: 'for="127.0.0.1;for=203.0.113.7"' })), false);
  assert.equal(isLocalRequest(req('127.0.0.1', { forwarded: 'for=_hidden' })), false);
  assert.equal(isLocalRequest(req('127.0.0.1', { forwarded: 'for=unknown' })), false);
});

test('B3-5 Gegenprobe: mehrere for= nur mit Loopback bleiben lokal', () => {
  assert.equal(isLocalRequest(req('127.0.0.1', { forwarded: 'for=127.0.0.1;for="[::1]:1234";proto=http' })), true);
  assert.equal(isLocalRequest(req('127.0.0.1', { forwarded: 'for=127.0.0.1, for="127.0.0.2:8080"' })), true);
  assert.equal(isLocalRequest(req('127.0.0.1', { forwarded: ['for=127.0.0.1', 'FOR=::1'] })), true);
});
