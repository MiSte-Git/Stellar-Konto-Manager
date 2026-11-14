// Waechter (ADR 0012, Plan Signer-Buendelung 8.2, Teilschritt 6): In beiden Backends wird eine Signatur nur
// in services/signerAuth.js bzw. api/signerAuth.php geprueft, und das Backend signiert nie. Liest den
// Quelltext (wie test/multisigSignersGuard.test.js); Kommentarzeilen zaehlen nicht.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const VERIFY_PATTERNS = [/\.verify\(/, /verifySignature\(/, /verifyTxSignedBy\(/, /sodium_crypto_sign_verify/];
const SIGN_PATTERNS = [/\.sign\(/, /->sign\(/, /addSignature\(/, /addDecoratedSignature\(/, /signDecorated\(/, /signPayloadDecorated\(/, /fromSecret\(/, /KeyPair::fromSeed\(/];

function codeLines(file) {
  return fs.readFileSync(file, 'utf8').split('\n')
    .map((line, i) => ({ line, no: i + 1 }))
    .filter(({ line }) => {
      const t = line.trim();
      return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('#');
    });
}

function backendFiles() {
  const node = ['server.js', ...fs.readdirSync(path.join(ROOT, 'services')).filter((f) => f.endsWith('.js')).map((f) => `services/${f}`)];
  const php = fs.readdirSync(path.join(ROOT, 'api')).filter((f) => f.endsWith('.php')).map((f) => `api/${f}`);
  return [...node, ...php];
}

function findings(patterns, allowed, files = backendFiles().map((rel) => ({ rel, abs: path.join(ROOT, rel) }))) {
  const out = [];
  for (const { rel, abs } of files) {
    if (allowed.includes(rel)) continue;
    for (const { line, no } of codeLines(abs)) {
      if (patterns.some((p) => p.test(line))) out.push(`${rel}:${no}: ${line.trim()}`);
    }
  }
  return out;
}

test('Signaturpruefung nur in signerAuth (Node und PHP)', () => {
  assert.deepEqual(findings(VERIFY_PATTERNS, ['services/signerAuth.js', 'api/signerAuth.php']), []);
});

test('Das Backend signiert nie und erzeugt kein Schluesselmaterial', () => {
  assert.deepEqual(findings(SIGN_PATTERNS, []), []);
});

test('Gegenprobe: der Waechter findet Pruefungen in signerAuth selbst', () => {
  const inNode = codeLines(path.join(ROOT, 'services/signerAuth.js')).some(({ line }) => /\.verify\(/.test(line));
  const inPhp = codeLines(path.join(ROOT, 'api/signerAuth.php')).some(({ line }) => /verifySignature\(/.test(line));
  assert.ok(inNode && inPhp);
});

test('Gegenprobe: eine Pruefung oder Signatur ausserhalb von signerAuth wuerde gefunden', () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'skm-guard-'));
  const probe = path.join(dir, 'probe.js');
  fs.writeFileSync(probe, '// kp.verify(x) im Kommentar zaehlt nicht\nmodule.exports = (kp, d, s, tx) => kp.verify(d, s) && tx.sign(kp);\n');
  const files = [{ rel: 'services/probe.js', abs: probe }];
  assert.equal(findings(VERIFY_PATTERNS, [], files).length, 1);
  assert.equal(findings(SIGN_PATTERNS, [], files).length, 1);
});
