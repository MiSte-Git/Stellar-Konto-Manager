// Node parity to test/multisigJobsGuard.test.php's expireStalePendingJobs()
// coverage (G5 stage 1: services/multisigJobsGuard.js was previously missing
// entirely - see analyse_multisig.md b5 and the follow-up time-window
// analysis). Mirrors the PHP test cases so both backends stay provably in
// sync; see services/multisigJobsGuard.js for the maxTimeUnix-vs-age-based
// heuristic rationale.
const test = require('node:test');
const assert = require('node:assert/strict');
const { expireStalePendingJobs, PENDING_JOB_EXPIRY_DAYS } = require('../services/multisigJobsGuard.js');

function jobAt(status, daysAgo) {
  return {
    id: Math.random().toString(16).slice(2),
    status,
    createdAt: new Date(Date.now() - daysAgo * 86400 * 1000).toISOString(),
  };
}

function jobWithMaxTime(status, maxTimeUnix, daysAgo = 0) {
  return {
    id: Math.random().toString(16).slice(2),
    status,
    createdAt: new Date(Date.now() - daysAgo * 86400 * 1000).toISOString(),
    maxTimeUnix,
  };
}

function byId(items) {
  return Object.fromEntries(items.map((j) => [j.id, j]));
}

test('expireStalePendingJobs leaves a recently-created pending job untouched', () => {
  const job = jobAt('pending_signatures', 1);
  const result = byId(expireStalePendingJobs([job]));
  assert.equal(result[job.id].status, 'pending_signatures');
});

test('expireStalePendingJobs marks a stale pending_signatures job as expired', () => {
  const job = jobAt('pending_signatures', PENDING_JOB_EXPIRY_DAYS + 1);
  const result = byId(expireStalePendingJobs([job]));
  assert.equal(result[job.id].status, 'expired');
});

test('expireStalePendingJobs marks a stale ready_to_submit job as expired too', () => {
  const job = jobAt('ready_to_submit', PENDING_JOB_EXPIRY_DAYS + 5);
  const result = byId(expireStalePendingJobs([job]));
  assert.equal(result[job.id].status, 'expired');
});

test('expireStalePendingJobs never touches a job already in a final state (submitted_success)', () => {
  const job = jobAt('submitted_success', PENDING_JOB_EXPIRY_DAYS + 10);
  const result = byId(expireStalePendingJobs([job]));
  assert.equal(result[job.id].status, 'submitted_success');
});

test('expireStalePendingJobs is a no-op on a job already marked expired', () => {
  const job = jobAt('expired', PENDING_JOB_EXPIRY_DAYS + 10);
  const result = byId(expireStalePendingJobs([job]));
  assert.equal(result[job.id].status, 'expired');
});

test('expireStalePendingJobs does not expire a job exactly at the boundary age', () => {
  const job = jobAt('pending_signatures', PENDING_JOB_EXPIRY_DAYS);
  const result = expireStalePendingJobs([job]);
  assert.equal(result[0].status, 'pending_signatures');
});

test('expireStalePendingJobs leaves a job with an unparseable createdAt untouched', () => {
  const job = { id: 'x', status: 'pending_signatures', createdAt: 'not-a-date' };
  const result = expireStalePendingJobs([job]);
  assert.equal(result[0].status, 'pending_signatures');
});

// --- G5 stage 1: maxTimeUnix-based expiry ------------------------------------

test('a job whose maxTimeUnix has already passed is expired immediately, without waiting for PENDING_JOB_EXPIRY_DAYS', () => {
  const job = jobWithMaxTime('pending_signatures', Math.floor(Date.now() / 1000) - 3600);
  const result = expireStalePendingJobs([job]);
  assert.equal(result[0].status, 'expired');
});

test('a job with a future maxTimeUnix is never expired by age, even far past PENDING_JOB_EXPIRY_DAYS (maxTimeUnix wins over the age heuristic)', () => {
  const job = jobWithMaxTime('pending_signatures', Math.floor(Date.now() / 1000) + 3600, PENDING_JOB_EXPIRY_DAYS + 10);
  const result = expireStalePendingJobs([job]);
  assert.equal(result[0].status, 'pending_signatures');
});

test('a job with maxTimeUnix=0 (no upper bound) falls back to the age-based heuristic and does get expired once stale', () => {
  const job = jobWithMaxTime('pending_signatures', 0, PENDING_JOB_EXPIRY_DAYS + 1);
  const result = expireStalePendingJobs([job]);
  assert.equal(result[0].status, 'expired');
});

test('a job with maxTimeUnix=0 (no upper bound) that is still fresh by age is left untouched', () => {
  const job = jobWithMaxTime('pending_signatures', 0, 1);
  const result = expireStalePendingJobs([job]);
  assert.equal(result[0].status, 'pending_signatures');
});

test('a ready_to_submit job past its maxTimeUnix is expired too, not just pending_signatures ones', () => {
  const job = jobWithMaxTime('ready_to_submit', Math.floor(Date.now() / 1000) - 1);
  const result = expireStalePendingJobs([job]);
  assert.equal(result[0].status, 'expired');
});

test('a job already in a final state is never touched, regardless of maxTimeUnix', () => {
  const job = jobWithMaxTime('submitted_success', Math.floor(Date.now() / 1000) - 100000);
  const result = expireStalePendingJobs([job]);
  assert.equal(result[0].status, 'submitted_success');
});

test('a legacy job with no maxTimeUnix field at all falls back to the age heuristic', () => {
  const job = jobAt('pending_signatures', PENDING_JOB_EXPIRY_DAYS + 1);
  const result = expireStalePendingJobs([job]);
  assert.equal(result[0].status, 'expired');
});
