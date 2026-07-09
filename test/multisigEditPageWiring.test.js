// Regression guards for two of the three "Multisig bearbeiten" workflow bugs
// fixed together (analyse_multisig.md b1-b3, all three needed for the Edit-Job
// workflow to work end to end):
//
// - b2: buildSetOptionsTx() used to hardcode a 60s XDR timebound even when the
//   built transaction was about to be handed to handlePrepareMultisig() for
//   asynchronous, distributed signing - on-chain worthless within a minute.
//   Fixed via getMultisigTxTimeout() (own unit tests in
//   frontend/src/utils/__tests__/getMultisigTxTimeout.test.js); this file only
//   guards that the page actually calls it instead of a literal setTimeout(60).
// - b3: the "prod mode" job-creation button called handleCreateMultisigJob(),
//   which posted {accountId, network, changes} without txXdr - a payload both
//   backends always reject with 400 invalid_xdr. Fixed by wiring the button to
//   handlePrepareMultisig() (the working txXdr-building/job-creation path
//   already used by "test mode") unconditionally, and deleting the dead
//   handler + its now-unused createPendingMultisigJob() API helper.
//
// MultisigEditPage.jsx is a heavily stateful page component (live Horizon
// calls, fetch, session-secret storage) with no existing render-test harness
// in this codebase (unlike simple presentational components, e.g.
// TokenFactsSummary.test.jsx) - same rationale as
// test/multisigSignersGuard.test.js for checking the source directly instead
// of mounting the component.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const pageSource = fs.readFileSync(path.join(__dirname, '..', 'frontend/src/pages/MultisigEditPage.jsx'), 'utf8');
const apiSource = fs.readFileSync(path.join(__dirname, '..', 'frontend/src/utils/multisigApi.js'), 'utf8');

test('b3: handleCreateMultisigJob (the broken txXdr-less job-creation path) no longer exists', () => {
  assert.ok(!pageSource.includes('handleCreateMultisigJob'), 'the dead/broken handler must be fully removed, not just unreferenced');
});

test('b3: createPendingMultisigJob is no longer imported or used by the Edit page', () => {
  assert.ok(!pageSource.includes('createPendingMultisigJob'), 'no remaining import/reference to the now-dead API helper');
});

test('b3: createPendingMultisigJob is no longer exported from multisigApi.js (fully dead, no other callers)', () => {
  assert.ok(!apiSource.includes('createPendingMultisigJob'), 'the now-unused helper must be deleted, not left dangling');
});

test('b3: the job-creation button in the confirm dialog calls handlePrepareMultisig unconditionally (both test and prod mode)', () => {
  const buttonIndex = pageSource.indexOf("onClick={handlePrepareMultisig}");
  assert.ok(buttonIndex > -1, 'the button must be wired to the working prepare-and-create-job flow regardless of mode');
  // Sanity: this is the second (job-creation) button in the confirm modal,
  // not the first (test-mode direct submit) button - it sits after the
  // "testModeButton" markup.
  const testModeButtonIndex = pageSource.indexOf('handleConfirmTestMode');
  assert.ok(testModeButtonIndex > -1 && testModeButtonIndex < buttonIndex);
});

test('b3: buildPlannedChanges is still present - it remains genuinely used by submitChanges() for the post-submit account snapshot', () => {
  assert.ok(pageSource.includes('function buildPlannedChanges') || pageSource.includes('const buildPlannedChanges'), 'must not be deleted alongside handleCreateMultisigJob - it has a separate, still-live caller');
  const submitChangesIndex = pageSource.indexOf('async function submitChanges');
  const usageInSubmitChanges = pageSource.indexOf('buildPlannedChanges()', submitChangesIndex);
  assert.ok(submitChangesIndex > -1 && usageInSubmitChanges > submitChangesIndex, 'submitChanges() must still call buildPlannedChanges()');
});

test('b2: buildSetOptionsTx no longer hardcodes setTimeout(60) for the built transaction', () => {
  assert.ok(!pageSource.includes('txb.setTimeout(60)'), 'the literal 60s timebound must be gone');
  assert.ok(pageSource.includes('getMultisigTxTimeout('), 'must compute the timebound via getMultisigTxTimeout() instead');
});

test('b2: the direct local-submit path (submitChanges) opts into the short immediate-submit timeout', () => {
  const submitChangesCallIndex = pageSource.indexOf('buildSetOptionsTx(collectedSigners, { signTx: true, requireSigners: true, immediateSubmit: true }');
  assert.ok(submitChangesCallIndex > -1, 'submitChanges() must pass immediateSubmit: true (it submits to Horizon in the same request)');
});

test('b2: the distributed job-preparation path (handlePrepareMultisig) does not opt into the immediate-submit timeout', () => {
  const prepareCallIndex = pageSource.indexOf('buildSetOptionsTx(null, { signTx: false, requireSigners: false }');
  assert.ok(prepareCallIndex > -1, 'handlePrepareMultisig() must build without immediateSubmit, so getMultisigTxTimeout() applies the long multisigTimeoutSeconds default');
});
