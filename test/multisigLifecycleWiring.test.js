// Regression guards for how server.js wires in the G5 stage 1 lifecycle
// logic (services/multisigLifecycle.js, services/multisigJobsGuard.js - see
// test/multisigLifecycle.test.js and test/multisigJobsGuard.test.js for the
// actual decision-logic tests). Mirrors test/multisigLifecycleWiring.test.php
// - keep both in sync.
//
// server.js isn't structured for HTTP-level testing (it calls app.listen()
// at module load time - see test/multisigSignersGuard.test.js's header
// comment), so this checks the source directly for the specific patterns the
// G5 stage 1 change requires.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('server.js requires the new lifecycle and jobs-guard modules', () => {
  assert.ok(serverSource.includes("require('./services/multisigLifecycle.js')"), 'multisigLifecycle.js must be required');
  assert.ok(serverSource.includes("require('./services/multisigJobsGuard.js')"), 'multisigJobsGuard.js must be required');
});

// --- POST /jobs (create): maxTimeUnix precomputed + write-time guard --------

const createRouteIndex = serverSource.indexOf("app.post('/api/multisig/jobs', async");
const listRouteIndex = serverSource.indexOf("app.get('/api/multisig/jobs', async");
test('sanity: the create route exists and precedes the list route', () => {
  assert.ok(createRouteIndex > -1);
  assert.ok(listRouteIndex > createRouteIndex);
});
const createBlock = serverSource.slice(createRouteIndex, listRouteIndex);

test('the create route precomputes and stores maxTimeUnix on the new job', () => {
  assert.ok(createBlock.includes('maxTimeUnix: extractMaxTimeUnix(parsed.tx)'));
});

test('the create route runs expireStalePendingJobs() on the full item list before saving (write-time guard parity)', () => {
  const guardIndex = createBlock.indexOf('multisigDb.items = expireStalePendingJobs(multisigDb.items);');
  const saveIndex = createBlock.indexOf('await saveMultisigDb();');
  assert.ok(guardIndex > -1, 'the guard call must exist in the create route');
  assert.ok(saveIndex > -1 && guardIndex < saveIndex, 'the guard must run before the job file is saved');
});

test('F4: the create route responds with the post-guard job object, not the pre-guard reference', () => {
  const guardIndex = createBlock.indexOf('multisigDb.items = expireStalePendingJobs(multisigDb.items);');
  const responseVarIndex = createBlock.indexOf('const responseJob = multisigDb.items.find((j) => j.id === job.id) || job;');
  const respondIndex = createBlock.indexOf('res.json(responseJob);');
  assert.ok(guardIndex > -1, 'sanity: the guard call exists');
  assert.ok(responseVarIndex > -1 && responseVarIndex > guardIndex, 'the response must be looked up from the guarded item list, after the guard ran');
  assert.ok(respondIndex > -1, 'the route must respond with the post-guard object');
  assert.ok(!createBlock.includes('res.json(job);'), 'must no longer respond with the stale pre-guard `job` reference');
});

// --- GET /jobs (list) and GET /jobs/:id: read-time lifecycle overlay --------

const detailRouteIndex = serverSource.indexOf("app.get('/api/multisig/jobs/:id', async");
const mergeRouteIndex = serverSource.indexOf("app.post('/api/multisig/jobs/:id/merge-signed-xdr', async");
test('sanity: list, detail and merge routes exist in that order', () => {
  assert.ok(listRouteIndex > -1);
  assert.ok(detailRouteIndex > listRouteIndex);
  assert.ok(mergeRouteIndex > detailRouteIndex);
});
const listBlock = serverSource.slice(listRouteIndex, detailRouteIndex);
const detailBlock = serverSource.slice(detailRouteIndex, mergeRouteIndex);

test('the list route recomputes lifecycle status before applying the ?status= filter', () => {
  const annotateIndex = listBlock.indexOf('items = await annotateJobsLifecycleStatus(items);');
  const statusFilterIndex = listBlock.indexOf('if (status && multisigStatus.has(String(status)))');
  assert.ok(annotateIndex > -1, 'the list route must call annotateJobsLifecycleStatus()');
  assert.ok(statusFilterIndex > -1 && annotateIndex < statusFilterIndex, 'annotation must run before the status filter sees the jobs');
});

test('the detail route recomputes lifecycle status before responding', () => {
  assert.ok(detailBlock.includes('await annotateJobsLifecycleStatus([job])'));
});

test('annotateJobsLifecycleStatus() never touches a job already in a final state', () => {
  const fnIndex = serverSource.indexOf('async function annotateJobsLifecycleStatus(items)');
  assert.ok(fnIndex > -1, 'sanity: the helper exists');
  const fnBody = serverSource.slice(fnIndex, serverSource.indexOf('\n}', fnIndex));
  assert.ok(fnBody.includes('multisigFinalStatus.has(j.status)'), 'must check against the final-states set');
});

// --- merge route: reject already-final jobs before any Horizon lookup --------

const mergeBlock = serverSource.slice(mergeRouteIndex);

test('merge route backfills maxTimeUnix for jobs stored before the field existed', () => {
  assert.ok(mergeBlock.includes('job.maxTimeUnix = extractMaxTimeUnix(current.tx);'));
});

test('merge route rejects an already-final job with HTTP 409, before any Horizon lookup', () => {
  const finalCheckIndex = mergeBlock.indexOf('if (multisigFinalStatus.has(job.status)) {');
  const metaFetchIndex = mergeBlock.indexOf('fetchAccountMetaCached(net, job.accountId)');
  assert.ok(finalCheckIndex > -1, 'the already-final guard must exist');
  assert.ok(metaFetchIndex > -1 && finalCheckIndex < metaFetchIndex, 'the guard must precede the (Horizon-costing) account meta fetch');
  const guardSnippet = mergeBlock.slice(finalCheckIndex, finalCheckIndex + 200);
  assert.match(guardSnippet, /res\.status\(409\)\.json/, 'must be a hard 409 rejection, not a silent accept');
});

test('merge route computes lifecycle status against the live account sequence before merging signatures', () => {
  const lifecycleIndex = mergeBlock.indexOf('computeMultisigLifecycleStatus(current.tx, accountSequence,');
  const signatureMergeIndex = mergeBlock.indexOf('current.tx.signatures.push(sig);');
  assert.ok(lifecycleIndex > -1, 'the sequence/timebound check must exist');
  assert.ok(signatureMergeIndex > -1 && lifecycleIndex < signatureMergeIndex, 'the check must precede any signature being merged in');
});

test('merge route persists a lifecycle-dead status with HTTP 409 rather than silently accepting the signature', () => {
  const lifecycleIfIndex = mergeBlock.indexOf('if (lifecycleStatus) {');
  assert.ok(lifecycleIfIndex > -1);
  const branch = mergeBlock.slice(lifecycleIfIndex, lifecycleIfIndex + 400);
  assert.match(branch, /res\.status\(409\)\.json/, 'must respond 409 for a lifecycle-dead job');
  assert.ok(branch.includes('await saveMultisigDb();'), 'the corrected status must be persisted, not just returned');
});

// --- merge route: submit-failure result-code mapping (TOCTOU safety net) -----

test('merge route maps a failed submission\'s Horizon result code to a lifecycle status (TOCTOU safety net)', () => {
  const catchIndex = mergeBlock.indexOf('} catch (submitErr) {');
  const mappedIndex = mergeBlock.indexOf('const mapped = mapSubmitResultCodeToLifecycleStatus(resultCode);');
  assert.ok(catchIndex > -1 && mappedIndex > -1);
  assert.ok(mappedIndex > catchIndex, 'the mapping must happen inside the submit-failure catch block');
  assert.ok(mergeBlock.includes("updated.status = mapped || 'submitted_failed';"), 'must fall back to submitted_failed only when nothing was mapped');
});

test('merge route runs expireStalePendingJobs() on the full item list before saving (write-time guard parity)', () => {
  assert.ok(mergeBlock.includes('multisigDb.items = expireStalePendingJobs(multisigDb.items.map('));
});
