// Regression guards for server.js's CORS/composeMail hardening. server.js
// itself isn't structured for HTTP-level testing (it calls app.listen() at
// module load time), so - same approach as the clientCollected guard in
// test/txSignatures.test.php - these check the source directly for the
// specific patterns this fix removes/requires, to catch a silent revert.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

test('server.js no longer uses the permissive cors({ origin: true }) middleware', () => {
  assert.equal(/cors\(\s*\{\s*origin\s*:\s*true/.test(serverSource), false);
});

test("server.js no longer requires the 'cors' package (replaced by the allowlist middleware)", () => {
  assert.equal(/require\((['"])cors\1\)/.test(serverSource), false);
});

test("package.json no longer lists 'cors' as a dependency", () => {
  assert.equal(Object.prototype.hasOwnProperty.call(packageJson.dependencies || {}, 'cors'), false);
});

test('server.js applies an allowlist-based fallback CORS middleware before express.json()/routes', () => {
  const jsonIndex = serverSource.indexOf('app.use(express.json())');
  const fallbackIndex = serverSource.indexOf('app.use(createCorsMiddleware(');
  assert.ok(jsonIndex > -1, 'sanity: express.json() is still wired up');
  assert.ok(fallbackIndex > -1, 'sanity: a createCorsMiddleware(...) call exists');
  assert.ok(fallbackIndex < jsonIndex, 'the global fallback CORS middleware must run before express.json()/routes');
});

test('composeMail route checks isLoopbackAddress before doing anything else', () => {
  const routeIndex = serverSource.indexOf("app.post('/api/composeMail'");
  const checkIndex = serverSource.indexOf('isLoopbackAddress(req.socket');
  assert.ok(routeIndex > -1 && checkIndex > -1, 'sanity: both the route and the check exist');
  assert.ok(checkIndex > routeIndex, 'the loopback check must live inside the composeMail handler');
  // Nothing between the handler's try{ and the loopback check should read
  // req.body - the check must run first, before touching client input.
  const betweenRouteAndCheck = serverSource.slice(routeIndex, checkIndex);
  assert.equal(betweenRouteAndCheck.includes('req.body'), false);
});
