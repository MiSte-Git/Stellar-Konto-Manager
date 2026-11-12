#!/usr/bin/env node
// Startet die Testnet-E2E-Tests (Playwright) und schreibt das Ergebnis nach e2e/.last-run.json.
// Der Deploy liest die Datei und zeigt, wann die E2E-Tests zuletzt liefen (docs/testing.md).
//
//   npm run test:e2e                 alle Specs
//   npm run test:e2e -- sendLock     nur passende Specs (Argumente gehen an Playwright)
const { spawnSync, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const resultFile = path.join(root, "e2e", ".last-run.json");

function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function main() {
  const extra = process.argv.slice(2);
  const started = Date.now();
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const res = spawnSync(npx, ["playwright", "test", "-c", "e2e/playwright.config.mjs", ...extra], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const ok = res.status === 0;
  const dirty = git("status --porcelain -- frontend/src api e2e").length > 0;
  // Nur Gesamtlaeufe gelten als Stand fuer den Deploy, Teillaeufe (Filter) nicht.
  if (extra.length === 0) {
    fs.writeFileSync(
      resultFile,
      JSON.stringify({ ok, at: new Date().toISOString(), commit: git("rev-parse --short HEAD"), dirty, seconds: Math.round((Date.now() - started) / 1000) }, null, 2)
    );
  }
  process.exit(res.status === null ? 1 : res.status);
}

main();
