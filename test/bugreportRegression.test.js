// Regression guards for server.js's bugreport hardening (N3 field clamp /
// rate limit already covered elsewhere; this file focuses on N4). server.js
// itself isn't structured for HTTP-level testing (it calls app.listen() at
// module load time) - same source-pattern-matching approach as
// test/serverCorsRegression.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function extractRoute(source, routeStart) {
  const startIndex = source.indexOf(routeStart);
  assert.ok(startIndex > -1, `sanity: route "${routeStart}" exists`);
  // Routes in this file are always terminated by the next top-level "});"
  // followed by a blank line before the next app.* registration.
  const endIndex = source.indexOf("\n});\n", startIndex);
  assert.ok(endIndex > -1, `sanity: route "${routeStart}" has a locatable end`);
  return source.slice(startIndex, endIndex);
}

const createRoute = extractRoute(serverSource, "app.post('/api/bugreport'");

test('N4: POST /api/bugreport hardcodes a new report\'s status to "open" instead of trusting the client payload', () => {
  assert.match(createRoute, /const\s+normalizedStatus\s*=\s*'open'\s*;/);
});

test('N4: the client-supplied "status" field is no longer read when creating a report', () => {
  const destructureLine = createRoute.split('\n').find((line) => line.includes('req.body || {}'));
  assert.ok(destructureLine, 'sanity: the destructuring line exists');
  assert.equal(/\bstatus\b/.test(destructureLine), false, 'status must not be destructured from the create-report request body');
});

test('N4: the now-unreachable "rejected requires a reason" check was removed from report creation', () => {
  assert.equal(/normalizedStatus\s*===\s*'rejected'/.test(createRoute), false);
});

test('N3: report creation still clamps free-text fields to 5000 characters', () => {
  assert.match(createRoute, /clamp\s*=\s*\(s\s*=\s*''\)\s*=>\s*String\(s\s*\|\|\s*''\)\.slice\(0,\s*5000\)/);
  assert.match(createRoute, /url:\s*clamp\(url\)/);
  assert.match(createRoute, /userAgent:\s*clamp\(userAgent\)/);
});

test('PATCH /api/bugreport/:id (admin-only) can still set any allowed status, including "rejected"', () => {
  const patchRoute = extractRoute(serverSource, "app.patch('/api/bugreport/:id'");
  assert.match(patchRoute, /if\s*\(allowedStatus\.has\(status\)\)\s*item\.status\s*=\s*status;/);
});
