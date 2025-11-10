#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function flatten(obj, prefix = '') {
  const out = [];
  Object.keys(obj || {}).forEach((key) => {
    const val = obj[key];
    const p = prefix ? `${prefix}.${key}` : key;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      out.push(...flatten(val, p));
    } else {
      out.push(p);
    }
  });
  return out;
}

const dePath = path.join(__dirname, '../../frontend/src/locales/de.json');
const raw = fs.readFileSync(dePath, 'utf8');
const data = JSON.parse(raw);
const glossary = data.glossary || {};
const keys = flatten(glossary).map(k => `glossary.${k}`);
keys.sort();
console.log(JSON.stringify(keys, null, 2));
