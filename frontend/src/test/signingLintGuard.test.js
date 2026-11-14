// @vitest-environment node
// Waechter (ADR 0012, Plan Signer-Buendelung 8.2, Teilschritt 6): Signieren und Schluesselmaterial nur in
// src/utils/signers/. Prueft die Regel in eslint.config.js an Beispielcode, damit sie nicht still wegfaellt.
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../..', import.meta.url));
const eslint = new ESLint({ cwd });

async function restrictedMessages(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === 'no-restricted-syntax').map((m) => m.message);
}

const SIGNING = [
  'export const f = (tx, kp) => tx.sign(kp);',
  'export const f = (tx, s) => tx.addSignature(s.pk, s.sig);',
  'export const f = (tx, s) => tx.addDecoratedSignature(s);',
  'export const f = (kp, h) => kp.signDecorated(h);',
  'export const f = (kp, p) => kp.signPayloadDecorated(p);',
];
const KEY_MATERIAL = [
  "import { Keypair } from '@stellar/stellar-sdk';\nexport const f = (s) => Keypair.fromSecret(s);",
  "import * as StellarSdk from '@stellar/stellar-sdk';\nexport const f = (s) => StellarSdk.Keypair.fromSecret(s);",
];

describe('Lint-Waechter fuer Signieren und Schluesselmaterial', () => {
  it.each(SIGNING)('ausserhalb von utils/signers verboten: %s', async (code) => {
    const msgs = await restrictedMessages(code, 'src/pages/Example.jsx');
    expect(msgs.some((m) => m.includes('utils/signers'))).toBe(true);
  });

  it.each(KEY_MATERIAL)('Keypair.fromSecret ausserhalb von utils/signers verboten: %s', async (code) => {
    const msgs = await restrictedMessages(code, 'src/utils/stellar/example.js');
    expect(msgs.some((m) => m.includes('keyMaterial'))).toBe(true);
  });

  it.each([
    'src/utils/signers/example.js',
    'src/components/story/Example.jsx',
    'src/components/scam-simulator/utils/example.js',
  ])('erlaubt in %s', async (filePath) => {
    for (const code of [...SIGNING, ...KEY_MATERIAL]) {
      expect(await restrictedMessages(code, filePath)).toEqual([]);
    }
  });

  it('Gegenprobe: Math.sign und andere Methodennamen bleiben erlaubt', async () => {
    expect(await restrictedMessages('export const f = (x, o) => Math.sign(x) + o.signer() + o.signTransaction();', 'src/pages/Example.jsx')).toEqual([]);
  });
});
