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
