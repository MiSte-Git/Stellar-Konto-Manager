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
