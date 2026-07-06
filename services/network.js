// Peer-address check used to gate /api/composeMail (server.js). CORS is a
// browser-enforced policy, not server-side authentication - a non-browser
// caller ignores the Origin header entirely - so an endpoint that must stay
// unauthenticated but is only ever meant to be triggered from the same
// machine (composeMail spawns a local GUI mail client) needs a check that
// doesn't depend on anything the client sends.
function isLoopbackAddress(remoteAddress) {
  const addr = String(remoteAddress || '').replace(/^::ffff:/, '');
  return addr === '::1' || addr === '127.0.0.1' || addr.startsWith('127.');
}

module.exports = { isLoopbackAddress };
