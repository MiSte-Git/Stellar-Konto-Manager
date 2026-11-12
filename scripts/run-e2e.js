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
const resultsDir = path.join(root, "e2e", ".results");
const jsonFile = path.join(resultsDir, "results.json");
const historyFile = path.join(resultsDir, "history.log");

function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}


// Liest den JSON-Bericht von Playwright und liefert eine Zeile je Test (letzter Versuch zaehlt).
function collectTests(node, trail, out) {
  const title = node.title && !/\.spec\.mjs$/.test(node.title) ? [...trail, node.title] : trail;
  for (const spec of node.specs || []) {
    for (const t of spec.tests || []) {
      const results = t.results || [];
      const last = results[results.length - 1] || {};
      const seconds = results.reduce((sum, r) => sum + (r.duration || 0), 0) / 1000;
      const raw = last.error && (last.error.message || last.error.value);
      const errorLine = raw ? String(raw).replace(/\u001b\[[0-9;]*m/g, "").split("\n").find((l) => l.trim()) : "";
      out.push({
        file: spec.file,
        name: spec.title,
        status: t.status === "expected" ? "ok" : t.status === "flaky" ? "flaky" : t.status === "skipped" ? "skipped" : "FEHLER",
        seconds,
        attempts: results.length,
        errorLine,
      });
    }
  }
  for (const child of node.suites || []) collectTests(child, title, out);
}

function summarize(ok, commit, startedAt) {
  let tests = [];
  try {
    const report = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
    for (const suite of report.suites || []) collectTests(suite, [], tests);
  } catch {
    console.log("\n[e2e] Kein JSON-Bericht gefunden, keine Zusammenfassung moeglich.");
    return;
  }
  const stamp = new Date().toISOString();
  const lines = tests.map((t) =>
    `${stamp}\t${commit || "?"}\t${t.status}\t${t.seconds.toFixed(1)}s\t${t.attempts}x\t${t.file}\t${t.name}${t.errorLine ? `\t${t.errorLine}` : ""}`
  );
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.appendFileSync(historyFile, lines.join("\n") + (lines.length ? "\n" : ""));

  const failed = tests.filter((t) => t.status === "FEHLER");
  const flaky = tests.filter((t) => t.status === "flaky");
  const total = Math.round((Date.now() - startedAt) / 1000);
  console.log("\n[e2e] ===== Zusammenfassung =====");
  console.log(`[e2e] ${ok ? "GRUEN" : "ROT"}: ${tests.length - failed.length} von ${tests.length} Tests ok` +
    `${flaky.length ? `, ${flaky.length} erst im zweiten Versuch (flaky)` : ""}, Gesamtdauer ${Math.floor(total / 60)} min ${total % 60} s.`);
  const slowest = [...tests].sort((a, b) => b.seconds - a.seconds).slice(0, 3);
  if (slowest.length) {
    console.log("[e2e] Langsamste Tests:");
    slowest.forEach((t) => console.log(`[e2e]   ${t.seconds.toFixed(1)} s  ${t.name}`));
  }
  if (failed.length) {
    console.log("[e2e] Fehlgeschlagen:");
    failed.forEach((t) => console.log(`[e2e]   ${t.name}\n[e2e]     ${t.errorLine || "(keine Meldung)"}`));
  }
  if (flaky.length) {
    console.log("[e2e] Flaky (Netz/Friendbot pruefen):");
    flaky.forEach((t) => console.log(`[e2e]   ${t.name}`));
  }
  console.log("[e2e] Bericht: npx playwright show-report e2e/.results/report");
  console.log("[e2e] Verlauf: e2e/.results/history.log");
}

function main() {
  const extra = process.argv.slice(2);
  const started = Date.now();
  // Alten Bericht entfernen, damit nach einem Abbruch keine veraltete Zusammenfassung erscheint.
  try { fs.rmSync(jsonFile, { force: true }); } catch { /* noop */ }
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const res = spawnSync(npx, ["playwright", "test", "-c", "e2e/playwright.config.mjs", ...extra], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const ok = res.status === 0;
  summarize(ok, git("rev-parse --short HEAD"), started);
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
