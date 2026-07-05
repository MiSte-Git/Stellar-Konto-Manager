// Serializes writes to a shared JSON file across concurrent requests (finding
// #10), parity with the flock()-based locking already used for the same
// multisig_jobs.json shape in api/multisig.php (C3/C7). Without this, two
// overlapping writeFile() calls to the same path can resolve out of order and
// let an older in-memory snapshot silently overwrite a newer one on disk.
//
// Node itself has no flock() binding in core `fs`, so this uses proper-lockfile
// (a well-established advisory file-locking package) for the cross-process
// guarantee, plus a temp-file + rename for the same atomic-write guarantee
// PHP's saveJobs() already has (a crash mid-write can never leave a partial/
// corrupted file for the next reader).
const fs = require('fs/promises');
const fsSync = require('fs');
const crypto = require('crypto');
const lockfile = require('proper-lockfile');

// In-process queue (per file path): the actual race in this single-process
// deployment is async interleaving between requests, not genuine multi-process
// contention, so this alone already fully serializes writes - cheaply and
// without ever touching the file lock's retry budget under normal load. The
// file lock below is kept as defense-in-depth for a hypothetical second
// process (e.g. a future clustered/PM2 deployment).
const writeQueues = new Map();

async function withWriteQueue(filePath, task) {
  const previous = writeQueues.get(filePath) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  writeQueues.set(filePath, next);
  try {
    return await next;
  } finally {
    if (writeQueues.get(filePath) === next) writeQueues.delete(filePath);
  }
}

async function writeJsonFileLockedInner(filePath, data) {
  if (!fsSync.existsSync(filePath)) {
    // proper-lockfile needs the target file to exist before it can lock it.
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  }
  const release = await lockfile.lock(filePath, {
    retries: { retries: 10, minTimeout: 50, maxTimeout: 500 },
    stale: 10_000,
  });
  try {
    const tmpPath = `${filePath}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmpPath, filePath);
  } finally {
    await release();
  }
}

function writeJsonFileLocked(filePath, data) {
  return withWriteQueue(filePath, () => writeJsonFileLockedInner(filePath, data));
}

module.exports = { writeJsonFileLocked };
