// Fehlerschluessel aus stellarUtils.js werden in der UI per t(message) im Namespace common
// uebersetzt. Fehlt der DE-Eintrag, erscheint der rohe Schluessel (so war es lange bei
// resolveOrValidatePublicKey.invalid). Dieser Test haelt alle geworfenen Schluessel abgedeckt.
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRACT_ADDRESS_ERROR } from '../addressType.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'stellarUtils.js'), 'utf8');
const common = JSON.parse(fs.readFileSync(path.join(here, '..', '..', '..', 'locales', 'de', 'common.json'), 'utf8'));

function lookup(obj, key) {
  return key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), obj);
}

describe('Fehlerschluessel der Adressaufloesung', () => {
  const thrown = [...source.matchAll(/throw new Error\('((?:resolveOrValidatePublicKey|publicKey|error)\.[A-Za-z.]+)'\)/g)].map((m) => m[1]);
  const keys = [...new Set([...thrown, CONTRACT_ADDRESS_ERROR])];

  it('findet die bekannten Schluessel', () => {
    expect(keys).toEqual(expect.arrayContaining(['resolveOrValidatePublicKey.invalid', 'resolveOrValidatePublicKey.empty', 'error.noFederationId']));
  });

  it.each(keys)('%s hat einen DE-Text in common', (key) => {
    expect(typeof lookup(common, key)).toBe('string');
  });
});
