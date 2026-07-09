// Regression guard for GET /api/multisig/jobs in server.js (analyse_multisig.md
// finding a3, Node-Pendant zum bereits gefixten api/multisig.php): without an
// accountId or signer filter, this endpoint used to enumerate every job of
// every account (accountId/signer/status/createdBy metadata leaked across
// users). It must now reject with 400 before any job data is even read - same
// fix already applied to the PHP backend (see the analogous checks in
// test/multisigAuthGuard.test.php's GET /jobs section).
//
// server.js isn't structured for HTTP-level testing (it calls app.listen() at
// module load time), so - same approach as test/multisigSignersGuard.test.js -
// this checks the source directly for the specific patterns the fix requires.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const routeIndex = serverSource.indexOf("app.get('/api/multisig/jobs',");
const guardIndexPrecise = serverSource.indexOf('accountId_or_signer_required');
const dataLoadIndex = serverSource.indexOf('multisigDb.items.slice()', routeIndex);

test('GET /jobs route exists', () => {
  assert.ok(routeIndex > -1, 'sanity: the route handler exists');
});

test('GET /jobs rejects with accountId_or_signer_required when neither filter is given', () => {
  assert.ok(guardIndexPrecise > -1, 'the guard response must exist');
  assert.ok(guardIndexPrecise > routeIndex, 'the guard must live inside the GET /jobs handler');
});

test('the guard checks for the absence of both accountId and signer', () => {
  const checkIndex = serverSource.indexOf('if (!accountId && !signer)', routeIndex);
  assert.ok(checkIndex > -1, 'must reject only when both accountId and signer are missing, not just one');
  assert.ok(checkIndex < guardIndexPrecise, 'the check must gate the accountId_or_signer_required response');
});

test('the guard responds with HTTP 400, not a filtered/empty success response', () => {
  const responseSnippet = serverSource.slice(guardIndexPrecise - 80, guardIndexPrecise + 40);
  assert.match(responseSnippet, /res\.status\(400\)\.json/, 'must be a hard 400 rejection');
});

test('the guard runs before any job data is read - no data is ever touched for an unscoped request', () => {
  assert.ok(dataLoadIndex > -1, 'sanity: the route still reads multisigDb.items');
  assert.ok(guardIndexPrecise < dataLoadIndex, 'the guard must precede multisigDb.items.slice()');
});
