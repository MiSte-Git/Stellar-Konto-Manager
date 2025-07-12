// sort-i18n-files.js
const fs = require('fs');
const path = require('path');

// ✅ Korrekt relativ zum Skriptpfad
const LOCALES_DIR = path.join(__dirname, '..', 'frontend', 'src', 'locales');

function sortObject(obj) {
  if (Array.isArray(obj)) return obj;
  return Object.keys(obj)
    .sort((a, b) => a.localeCompare(b))
    .reduce((acc, key) => {
      acc[key] = typeof obj[key] === 'object' && obj[key] !== null
        ? sortObject(obj[key])
        : obj[key];
      return acc;
    }, {});
}

fs.readdirSync(LOCALES_DIR).forEach(file => {
  if (!file.endsWith('.json')) return;

  const fullPath = path.join(LOCALES_DIR, file);
  const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));

  const sorted = sortObject(data);
  fs.writeFileSync(fullPath, JSON.stringify(sorted, null, 2), 'utf8');

  console.log(`✅ ${file} alphabetisch sortiert`);
});
