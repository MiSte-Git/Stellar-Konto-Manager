const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const path = require('path');
const { writeJsonFileLocked } = require('../services/jsonFileStore.js');

async function withTmpDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'skm-jsonstore-test-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('writeJsonFileLocked creates the file with the given data', async () => {
  await withTmpDir(async (dir) => {
    const file = path.join(dir, 'store.json');
    await writeJsonFileLocked(file, { items: [1] });
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.deepEqual(parsed, { items: [1] });
  });
});

test('writeJsonFileLocked never leaves a stray .tmp file behind on success', async () => {
  await withTmpDir(async (dir) => {
    const file = path.join(dir, 'store.json');
    await writeJsonFileLocked(file, { items: [] });
    const entries = fsSync.readdirSync(dir);
    assert.deepEqual(entries.filter((e) => e.includes('.tmp.')), []);
  });
});

test('concurrent writes are serialized - the file always ends up valid JSON matching the last write to finish', async () => {
  await withTmpDir(async (dir) => {
    const file = path.join(dir, 'store.json');
    await writeJsonFileLocked(file, { items: [] });

    // Fire many overlapping writes concurrently; without locking, interleaved
    // writeFile() calls to the same path could resolve out of order and leave
    // an older snapshot on disk, or even a torn/partial write.
    const writers = Array.from({ length: 20 }, (_, i) => writeJsonFileLocked(file, { items: [i] }));
    await Promise.all(writers);

    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw); // throws if the file were ever torn/corrupted
    assert.equal(Array.isArray(parsed.items), true);
    assert.equal(parsed.items.length, 1);
    assert.ok(parsed.items[0] >= 0 && parsed.items[0] < 20);
  });
});
