const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const net = require('../services/stellarNetworks.js');

test('normalizeNetwork liefert nur aktivierte Netze', () => {
  assert.equal(net.normalizeNetwork('PUBLIC'), 'public');
  assert.equal(net.normalizeNetwork('publicnet'), 'public');
  assert.equal(net.normalizeNetwork('Test'), 'testnet');
  assert.equal(net.normalizeNetwork('futurenet'), null); // vorbereitet, aber deaktiviert
  assert.equal(net.normalizeNetwork(''), null);
  assert.equal(net.normalizeNetwork(undefined), null);
});

test('getNetworkConfig wirft bei unbekanntem Netz statt still umzuleiten', () => {
  assert.throws(() => net.getNetworkConfig('mainnet2'), /unknown_network/);
  assert.equal(net.horizonUrlFor('testnet'), 'https://horizon-testnet.stellar.org');
  assert.equal(net.passphraseFor('public'), 'Public Global Stellar Network ; September 2015');
  assert.equal(net.passphraseFor('futurenet'), 'Test SDF Future Network ; October 2022');
});

test('networkFromQuery faellt auf public zurueck', () => {
  assert.equal(net.networkFromQuery('TESTNET'), 'testnet');
  assert.equal(net.networkFromQuery(undefined), 'public');
  assert.equal(net.networkFromQuery('FUTURENET'), 'public');
});

// Paritaet: Frontend, Node und PHP muessen dieselben Werte fuehren.
test('Registry ist in Frontend, Node und PHP identisch', () => {
  const root = path.join(__dirname, '..');
  const php = fs.readFileSync(path.join(root, 'api/stellarNetworks.php'), 'utf8');
  const fe = fs.readFileSync(path.join(root, 'frontend/src/config/networks.js'), 'utf8');

  for (const [id, cfg] of Object.entries(net.NETWORKS)) {
    const phpBlock = php.match(new RegExp(`'${id}' => \\[([\\s\\S]*?)\\]`));
    assert.ok(phpBlock, `PHP: ${id} fehlt`);
    assert.ok(phpBlock[1].includes(`'passphrase' => '${cfg.passphrase}'`), `PHP passphrase ${id}`);
    assert.ok(phpBlock[1].includes(`'horizonUrl' => '${cfg.horizonUrl}'`), `PHP horizonUrl ${id}`);
    assert.ok(phpBlock[1].includes(`'enabled' => ${cfg.enabled}`), `PHP enabled ${id}`);

    const feBlock = fe.match(new RegExp(`backendId: '${id}',([\\s\\S]*?)\\}\\)`));
    assert.ok(feBlock, `Frontend: ${id} fehlt`);
    assert.ok(feBlock[1].includes(`horizonUrl: '${cfg.horizonUrl}'`), `Frontend horizonUrl ${id}`);
    assert.ok(feBlock[1].includes(`enabled: ${cfg.enabled},`), `Frontend enabled ${id}`);
  }
});
