// F-14: Das Deploy bricht ab, wenn die hochzuladende api/.htaccess die Sperren fuer vendor/, vendor_old/,
// vendor_next/, composer.json und composer.lock nicht enthaelt oder der api-Filter die .htaccess vom Upload
// ausnimmt (checkApiUpload in scripts/deploy-cyon.js, vor dem rsync von api/). Die echte Wirkung der Regeln
// prueft test/apiHtaccess.test.js mit Apache.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkApiUpload } = require('../scripts/deploy-cyon.js');

const root = path.join(__dirname, '..');
const htaccess = fs.readFileSync(path.join(root, 'api', '.htaccess'), 'utf8');
const filter = fs.readFileSync(path.join(root, 'scripts', 'deploy', 'api.rsync-filter'), 'utf8');

const fakeRoot = (htaccessText, filterText) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-deploy-ht-'));
  fs.mkdirSync(path.join(dir, 'api'));
  fs.mkdirSync(path.join(dir, 'scripts', 'deploy'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'api', '.htaccess'), htaccessText);
  fs.writeFileSync(path.join(dir, 'scripts', 'deploy', 'api.rsync-filter'), filterText);
  return dir;
};

test('F-14: die api/.htaccess und der api-Filter im Repo bestehen die Pruefung', () => {
  assert.doesNotThrow(() => checkApiUpload(root));
});

test('F-14: fehlt eine Sperre in der .htaccess, bricht das Deploy ab', () => {
  const lines = htaccess.split('\n');
  for (const marker of ['vendor|vendor_old|vendor_next', 'composer\\.(json|lock)']) {
    const without = lines.filter((l) => !l.includes(marker)).join('\n');
    assert.notEqual(without, htaccess, `sanity: ${marker} steht in der .htaccess`);
    const dir = fakeRoot(without, filter);
    try {
      assert.throws(() => checkApiUpload(dir), /api\/\.htaccess/, marker);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('F-14: nimmt der api-Filter die .htaccess vom Upload aus, bricht das Deploy ab', () => {
  for (const rule of ['- /.htaccess', '- .htaccess', '- /.ht*']) {
    const dir = fakeRoot(htaccess, `${filter}\n${rule}\n`);
    try {
      assert.throws(() => checkApiUpload(dir), /api\.rsync-filter/, rule);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('F-14: das Deploy ruft die Pruefung vor dem rsync von api/ auf', () => {
  const source = fs.readFileSync(path.join(root, 'scripts', 'deploy-cyon.js'), 'utf8');
  const call = source.indexOf('checkApiUpload(root);');
  const rsyncApi = source.indexOf('source: "api/"');
  assert.ok(call > -1 && rsyncApi > -1 && call < rsyncApi);
});
