#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

// 🧭 Einstellungen
const PROJECT_ROOT = path.resolve(__dirname, "..");
const CSV_FILE = path.resolve(__dirname, "..", "history", "mapping_combined.csv");
const FILE_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx"];
const IGNORE_DIRS = ["node_modules", ".git", "config", "history", "dist", "build", "backend", "Helper Skripts"];

// 🧾 CSV einlesen
const csvRaw = fs.readFileSync(CSV_FILE, "utf8");
const csvLines = csvRaw.split(/\r?\n/).filter(Boolean);
const header = csvLines.shift().split(",").map(h => h.replace(/^["']|["']$/g, "").trim());

const originalKeyIdx = header.indexOf("originalKey");
const suggestedKeyIdx = header.indexOf("suggestedKey");

if (originalKeyIdx === -1 || suggestedKeyIdx === -1) {
  console.error("❌ CSV muss Spalten 'originalKey' und 'suggestedKey' enthalten.");
  process.exit(1);
}

if (!fs.existsSync(CSV_FILE)) {
  console.error("❌ CSV-Datei nicht gefunden: " + CSV_FILE);
  process.exit(1);
}


// 🔁 Ersetzungen vorbereiten
const keyMap = {};
csvLines.forEach(line => {
  const parts = line.split(",").map(x => x.trim().replace(/^["']|["']$/g, ""));
  const oldKey = parts[originalKeyIdx];
  const newKey = parts[suggestedKeyIdx];
  if (oldKey && newKey && oldKey !== newKey) {
    keyMap[oldKey] = newKey;
  }
});

// 📁 Projektdateien durchlaufen
function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.includes(entry.name)) walk(fullPath);
    } else if (FILE_EXTENSIONS.includes(path.extname(entry.name))) {
      replaceInFile(fullPath);
    }
  }
}

// 🔍 Ersetze alle Keys in Datei
function replaceInFile(filePath) {
  let content = fs.readFileSync(filePath, "utf8");
  let modified = false;

  for (const [oldKey, newKey] of Object.entries(keyMap)) {
    const pattern = new RegExp(`\\bt\\(['"\`]${oldKey}['"\`]\\)`, "g");
    const newContent = content.replace(pattern, `t('${newKey}')`);
    if (newContent !== content) {
      console.log(`🔁 ${oldKey} → ${newKey} in ${filePath}`);
      content = newContent;
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, content, "utf8");
    console.log(`✅ Datei aktualisiert: ${filePath}`);
  }
}

console.log(`🔎 Durchsuche Quellcode unter: ${PROJECT_ROOT}`);
walk(PROJECT_ROOT);
console.log("✅ Alle Ersetzungen abgeschlossen.");
