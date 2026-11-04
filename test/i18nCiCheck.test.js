const test = require('node:test');
const assert = require('node:assert/strict');
const { findSingleBracePlaceholders } = require('../scripts/i18n_ci_check.js');

test('findSingleBracePlaceholders meldet {name}, aber nicht {{name}}', () => {
  const found = findSingleBracePlaceholders({
    'trustline.deleted.success': 'Erfolgreich: {count} Trustlines gelöscht.',
    'trustline.ok': 'Erfolgreich: {{count}} Trustlines gelöscht.',
    'x.format': '{{amount, number}} XLM',
    'x.json': 'Beispiel: { "a": 1 }',
  });
  assert.deepEqual(found, [{ key: 'trustline.deleted.success', names: ['count'] }]);
});

test('findSingleBracePlaceholders laesst die bewusst woertlichen Ausnahmen durch', () => {
  assert.deepEqual(findSingleBracePlaceholders({
    'common.multisigEdit.securityGuarantee.text': 'Mehr dazu {link}.',
    'settings.explorer.testnetUrlPlaceholder': 'https://…{address}',
  }), []);
});

test('keine Sprachdatei enthaelt Platzhalter mit einfachen Klammern', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'frontend', 'src', 'locales');
  const flatten = (obj, prefix = '') => Object.entries(obj).reduce((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(acc, flatten(v, key));
    else acc[key] = v;
    return acc;
  }, {});
  const problems = [];
  for (const lang of fs.readdirSync(dir).filter((d) => /^[a-z]{2}$/.test(d))) {
    for (const f of fs.readdirSync(path.join(dir, lang)).filter((n) => n.endsWith('.json'))) {
      const flat = flatten({ [f.slice(0, -5)]: JSON.parse(fs.readFileSync(path.join(dir, lang, f), 'utf8')) });
      for (const m of findSingleBracePlaceholders(flat)) problems.push(`${lang} ${m.key}`);
    }
  }
  assert.deepEqual(problems, []);
});
