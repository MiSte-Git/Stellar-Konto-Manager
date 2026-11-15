// F-14: api/.htaccess sperrt vendor/, vendor_old/, vendor_next/, composer.json und composer.lock. Echter
// Apache (mod_rewrite, mod_headers, mod_authz_core) gegen eine Kopie von api/ mit den Regeln aus dem Repo;
// PHP laeuft dabei nicht, die Dateien werden statisch ausgeliefert. Entscheidend ist 403 gegen 200: Die
// Endpunkte (health.php, Rewrites fuer multisig, trade, admin, federation) bleiben erreichbar. Ohne
// /usr/sbin/apache2 wird uebersprungen.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APACHE = '/usr/sbin/apache2';
const MODULES = '/usr/lib/apache2/modules';
const PORT = 3972;
const available = fs.existsSync(APACHE) && ['mod_rewrite.so', 'mod_headers.so', 'mod_authz_core.so', 'mod_mpm_prefork.so'].every((m) => fs.existsSync(path.join(MODULES, m)));

let dir;
let conf;
const status = async (urlPath) => (await fetch(`http://127.0.0.1:${PORT}/${urlPath}`, { redirect: 'manual' })).status;

test.before(() => {
  if (!available) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-htaccess-'));
  const api = path.join(dir, 'root', 'api');
  fs.mkdirSync(path.join(dir, 'run'), { recursive: true });
  for (const sub of ['vendor/composer', 'vendor_old', 'vendor_next', 'vendorx', 'data']) fs.mkdirSync(path.join(api, sub), { recursive: true });
  const repoApi = path.join(__dirname, '..', 'api');
  fs.copyFileSync(path.join(repoApi, '.htaccess'), path.join(api, '.htaccess'));
  fs.copyFileSync(path.join(repoApi, 'data', '.htaccess'), path.join(api, 'data', '.htaccess'));
  for (const f of fs.readdirSync(repoApi).filter((n) => n.endsWith('.php'))) fs.copyFileSync(path.join(repoApi, f), path.join(api, f));
  fs.writeFileSync(path.join(api, 'vendor', 'autoload.php'), '<?php');
  fs.writeFileSync(path.join(api, 'vendor', 'composer', 'installed.json'), '{}');
  fs.writeFileSync(path.join(api, 'vendor_old', 'autoload.php'), '<?php');
  fs.writeFileSync(path.join(api, 'vendor_next', 'autoload.php'), '<?php');
  fs.writeFileSync(path.join(api, 'vendorx', 'readme.txt'), 'x');
  fs.writeFileSync(path.join(api, 'composer.json'), '{}');
  fs.writeFileSync(path.join(api, 'composer.lock'), '{}');
  fs.writeFileSync(path.join(api, 'data', 'multisig_jobs.json'), '{}');
  conf = path.join(dir, 'httpd.conf');
  fs.writeFileSync(conf, [
    `ServerRoot "${dir}"`, `Listen 127.0.0.1:${PORT}`, `PidFile ${dir}/run/httpd.pid`, `ErrorLog ${dir}/run/error.log`,
    ...['mpm_prefork', 'authz_core', 'rewrite', 'headers', 'mime', 'dir'].map((m) => `LoadModule ${m}_module ${MODULES}/mod_${m}.so`),
    'ServerName localhost', 'TypesConfig /dev/null', `DocumentRoot "${dir}/root"`,
    `<Directory "${dir}/root">`, '  AllowOverride All', '  Require all granted', '</Directory>',
  ].join('\n'));
  const start = spawnSync(APACHE, ['-f', conf, '-k', 'start'], { encoding: 'utf8' });
  if (start.status !== 0) throw new Error(`apache start: ${start.stderr}`);
});

test.after(() => {
  if (!available) return;
  spawnSync(APACHE, ['-f', conf, '-k', 'stop']);
  fs.rmSync(dir, { recursive: true, force: true });
});

const waitUp = async () => {
  for (let i = 0; i < 50; i += 1) {
    try { await fetch(`http://127.0.0.1:${PORT}/api/health.php`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('apache did not start');
};

test('F-14: vendor/, vendor_old/, vendor_next/, composer.json und composer.lock sind gesperrt (403)', { skip: !available && 'kein Apache' }, async () => {
  await waitUp();
  for (const p of ['api/vendor/autoload.php', 'api/vendor/composer/installed.json', 'api/vendor/', 'api/vendor', 'api/vendor_old/autoload.php',
    'api/vendor_next/autoload.php', 'api/composer.json', 'api/composer.lock', 'api/COMPOSER.JSON', 'api/data/multisig_jobs.json']) {
    assert.equal(await status(p), 403, p);
  }
});

test('F-14: health.php und die Endpunkte bleiben erreichbar, aehnliche Namen nicht gesperrt', { skip: !available && 'kein Apache' }, async () => {
  await waitUp();
  for (const p of ['api/health.php', 'api/multisig.php', 'api/multisig/jobs', 'api/multisig/jobs/abc/merge-signed-xdr', 'api/trade/search',
    'api/trade.php', 'api/admin/login', 'api/federation', 'api/vendorx/readme.txt']) {
    assert.equal(await status(p), 200, p);
  }
});
