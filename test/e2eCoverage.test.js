// Prueft, dass docs/testing.md und e2e/specs zusammenpassen: Jede Spec steht in der Abdeckungstabelle,
// jede dort genannte Datei existiert. Haelt die Dokumentation der E2E-Tests aktuell (docs/testing.md).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const doc = fs.readFileSync(path.join(root, "docs", "testing.md"), "utf8");
const specDir = path.join(root, "e2e", "specs");
const specs = fs.readdirSync(specDir).filter((f) => f.endsWith(".spec.mjs"));

test("jede E2E-Spec steht in docs/testing.md", () => {
  assert.ok(specs.length > 0, "keine Specs gefunden");
  for (const spec of specs) {
    assert.ok(doc.includes(`e2e/specs/${spec}`), `e2e/specs/${spec} fehlt in der Abdeckungstabelle von docs/testing.md`);
  }
});

test("jede in docs/testing.md genannte Spec existiert", () => {
  const mentioned = [...doc.matchAll(/e2e\/specs\/[\w.-]+\.spec\.mjs/g)].map((m) => m[0]);
  assert.ok(mentioned.length > 0);
  for (const rel of mentioned) {
    assert.ok(fs.existsSync(path.join(root, rel)), `${rel} steht in docs/testing.md, existiert aber nicht`);
  }
});

test("E2E-Fixtures, Helfer und Konfiguration sind vorhanden", () => {
  for (const rel of ["e2e/playwright.config.mjs", "e2e/helpers.mjs", "e2e/setup/fixtures.mjs", "e2e/setup/global-setup.mjs", "scripts/run-e2e.js"]) {
    assert.ok(fs.existsSync(path.join(root, rel)), `${rel} fehlt`);
  }
});

test("Specs enthalten keine Mainnet-Zugriffe und keine fest eingetragenen Keys", () => {
  const files = [...specs.map((f) => path.join(specDir, f)), path.join(root, "e2e", "helpers.mjs")];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    assert.ok(!/horizon\.stellar\.org/.test(src.replace(/horizon-testnet\.stellar\.org/g, "")), `${path.basename(file)}: Mainnet-Horizon`);
    assert.ok(!/\bS[A-Z2-7]{55}\b/.test(src), `${path.basename(file)}: fest eingetragener Secret Key`);
  }
});
