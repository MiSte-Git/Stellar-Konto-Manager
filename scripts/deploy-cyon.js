// Deployment des Produktions-Builds zu cyon (public_html/SKM/), ersetzt den
// manuellen Upload per FileZilla. Wird von start-build.js mit --deploy
// aufgerufen; --dry-run endet nach dem rsync-Dry-Run.
//
// Frontend: frontend/dist/ mit --checksum und --delete (geloescht wird nur
// unterhalb von assets/, siehe scripts/deploy/frontend.rsync-filter).
// api: api/ mit --checksum, ohne --delete; _config.php und data/ bleiben
// unangetastet (scripts/deploy/api.rsync-filter). Ohne Unterschiede wird api
// still uebersprungen.
// vendor: eigener Schritt vor den api-PHP-Dateien (siehe deployVendor). Lokal
// composer install --no-dev nach composer.lock, Vergleich ueber den sha256 von
// vendor/composer/installed.json; bei Abweichung Upload nach vendor_next/,
// Tausch, Pruefung, bei Fehler Ruecktausch.
const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { printFromFile } = require("./print-test-failures");
const readline = require("readline");

const REMOTE_HOST = "cyon-skm"; // Eintrag in ~/.ssh/config
const REMOTE_DIR = "public_html/SKM/";
const SITE_URL = "https://skm.steei.de";
const VITE_BASE = "/";

const FRONTEND_FILTER = "scripts/deploy/frontend.rsync-filter";
const API_FILTER = "scripts/deploy/api.rsync-filter";
const LOG_FILE = "deploy.log";
const REMOTE_API_DIR = `${REMOTE_DIR}api`;
const VENDOR_STATE_FILE = "vendor/composer/installed.json";
// PHP-CLI auf dem Server fuer die Pruefung nach dem Tausch. Muss dieselbe Version wie die
// Web-PHP sein (composer.json config.platform.php), sonst per SKM_REMOTE_PHP setzen.
const REMOTE_PHP = process.env.SKM_REMOTE_PHP || "php";
// Klassen, die nach dem Tausch per Autoload ladbar sein muessen
const VENDOR_REQUIRED_CLASSES = ["Soneso\\StellarSDK\\StellarSDK", "GuzzleHttp\\Client"];
// Aendern sich bei jedem Build, ohne dass sich das Frontend aendert
const BUILD_META_FILES = new Set(["SHA256SUMS", "build-info.json"]);

function fail(message) {
  throw new Error(`[deploy] ${message}`);
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    fail(`git ${args.join(" ")} fehlgeschlagen: ${result.stderr.trim()}`);
  }
  return result.stdout.trimEnd();
}

// Meldung bei HEAD != origin/main mit der naechsten Handlung. ahead: Commits nur lokal, behind: nur auf origin.
function describeHeadMismatch({ head, remote, ahead, behind }) {
  const hashes = `HEAD ${head.slice(0, 7)}, origin/main ${remote.slice(0, 7)}`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  if (ahead > 0 && behind === 0) {
    return `Noch nicht gepusht: ${plural(ahead, "Commit liegt", "Commits liegen")} nur lokal (${hashes}). Erst "git push", dann erneut deployen.`;
  }
  if (behind > 0 && ahead === 0) {
    return `Lokal veraltet: origin/main hat ${plural(behind, "neueren Commit", "neuere Commits")} (${hashes}). Erst "git pull", dann erneut deployen.`;
  }
  return `Lokal und origin/main sind auseinandergelaufen: ${ahead} Commits nur lokal, ${behind} nur auf origin (${hashes}). Erst klaeren ("git pull --rebase", dann "git push"), dann erneut deployen.`;
}

// Im Dry-Run wird nichts hochgeladen, Git-Abweichungen sind dort nur Warnungen.
function checkGit(root, { dryRun, fetch }) {
  const problems = [];
  const dirty = git(root, ["status", "--porcelain"]);
  if (dirty) {
    problems.push(`Arbeitsverzeichnis nicht sauber:\n${dirty}`);
  }
  if (fetch) {
    git(root, ["fetch", "--quiet", "origin"]);
  }
  const head = git(root, ["rev-parse", "HEAD"]);
  const remote = git(root, ["rev-parse", "origin/main"]);
  if (head !== remote) {
    // rev-list --left-right --count origin/main...HEAD liefert "<nur remote> <nur lokal>".
    const [behind, ahead] = git(root, ["rev-list", "--left-right", "--count", "origin/main...HEAD"])
      .split(/\s+/)
      .map(Number);
    problems.push(describeHeadMismatch({ head, remote, ahead, behind }));
  }
  for (const problem of problems) {
    if (!dryRun) {
      fail(problem);
    }
    console.warn(`[deploy] WARNUNG (Dry-Run): ${problem}`);
  }
  return head;
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(entryPath, files);
    } else {
      files.push(entryPath);
    }
  }
  return files;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

// dist muss exakt dem Stand entsprechen, den hash-dist.mjs nach dem Build
// festgehalten hat (z. B. kein "npm run preview:csp" dazwischen, das neu baut).
function verifyDistHashes(distDir) {
  const sumsFile = path.join(distDir, "SHA256SUMS");
  if (!fs.existsSync(sumsFile)) {
    fail("frontend/dist/SHA256SUMS fehlt");
  }
  const expected = new Map();
  for (const line of fs.readFileSync(sumsFile, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const [hash, file] = line.split(/ {2}(.+)/);
    expected.set(file, hash);
  }
  const actual = walk(distDir)
    .map((file) => path.relative(distDir, file).split(path.sep).join("/"))
    .filter((file) => file !== "SHA256SUMS");
  const mismatches = [];
  for (const file of actual) {
    if (!expected.has(file)) {
      mismatches.push(`neu: ${file}`);
    } else if (expected.get(file) !== sha256(path.join(distDir, file))) {
      mismatches.push(`geaendert: ${file}`);
    }
    expected.delete(file);
  }
  for (const file of expected.keys()) {
    mismatches.push(`fehlt: ${file}`);
  }
  if (mismatches.length > 0) {
    fail(`frontend/dist weicht von SHA256SUMS ab:\n  ${mismatches.join("\n  ")}`);
  }
  console.log(`[deploy] SHA256SUMS ok (${actual.length} Dateien)`);
}

function checkBuildOutput(distDir) {
  const htaccessPath = path.join(distDir, ".htaccess");
  if (!fs.existsSync(htaccessPath)) {
    fail("frontend/dist/.htaccess fehlt im Build");
  }
  if (/__[A-Z_]+__/.test(fs.readFileSync(htaccessPath, "utf8"))) {
    fail("Platzhalter in frontend/dist/.htaccess nicht ersetzt");
  }
  const indexHtml = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
  if (!indexHtml.includes(`"${VITE_BASE}assets/`)) {
    fail(`index.html verweist nicht auf ${VITE_BASE}assets/ (VITE_BASE falsch?)`);
  }
}

function rsync(root, { source, target, filter, del, dryRun }) {
  const args = ["-rl", "--checksum", "--itemize-changes", `--filter=merge ${filter}`];
  if (del) args.push("--delete");
  if (dryRun) args.push("--dry-run");
  args.push(source, `${REMOTE_HOST}:${target}`);
  const result = spawnSync("rsync", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.error) {
    fail(`rsync nicht ausfuehrbar: ${result.error.message}`);
  }
  process.stdout.write(result.stdout);
  if (result.status !== 0) {
    fail(`rsync beendet mit Code ${result.status}`);
  }
  return result.stdout.split("\n").filter((line) => line.trim() !== "");
}

// Pfad aus einer --itemize-changes-Zeile, z. B. "<fcsT...... assets/x.js"
// oder "*deleting   assets/y.js"
function itemizedPath(line) {
  return line.replace(/^\S+\s+/, "");
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    let answered = false;
    rl.question(`${question} [j/N] `, (answer) => {
      answered = true;
      rl.close();
      resolve(answer.trim().toLowerCase() === "j");
    });
    rl.on("close", () => {
      if (!answered) {
        process.stdout.write("\n");
        resolve(false);
      }
    });
  });
}

// Stand des letzten vollstaendigen E2E-Laufs (scripts/run-e2e.js schreibt e2e/.last-run.json).
function e2eStatusLine(root) {
  const file = path.join(root, "e2e", ".last-run.json");
  if (!fs.existsSync(file)) return "E2E-Tests: noch nie gelaufen (npm run test:e2e).";
  try {
    const last = JSON.parse(fs.readFileSync(file, "utf8"));
    const head = git(root, ["rev-parse", "--short", "HEAD"]).trim();
    const behind = last.commit ? git(root, ["rev-list", "--count", `${last.commit}..HEAD`]).trim() : "?";
    const same = last.commit === head && !last.dirty;
    const state = last.ok ? "gruen" : "FEHLGESCHLAGEN";
    const age = new Date(last.at).toLocaleString("de-CH");
    return `E2E-Tests: zuletzt ${state} am ${age} auf ${last.commit || "?"}${last.dirty ? " (mit lokalen Aenderungen)" : ""}, ${same ? "entspricht dem aktuellen Stand" : `${behind} Commit(s) hinter dem aktuellen Stand`}.`;
  } catch {
    return "E2E-Tests: letzter Lauf nicht lesbar.";
  }
}

function runE2e(root) {
  console.log("\n[deploy] Starte E2E-Tests gegen das Testnet (ca. 1-3 Minuten) ...");
  const result = spawnSync(process.execPath, ["scripts/run-e2e.js"], { cwd: root, stdio: "inherit" });
  return result.status === 0;
}

async function fetchOk(url, method = "GET") {
  try {
    const response = await fetch(url, { method });
    return { ok: response.ok, status: response.status, body: method === "HEAD" ? "" : await response.text() };
  } catch (error) {
    return { ok: false, status: 0, body: error.message };
  }
}

// JS- und CSS-Assets, die index.html per src/href referenziert
function referencedAssets(indexHtml) {
  const urls = new Set();
  for (const match of indexHtml.matchAll(/\b(?:src|href)="([^"]+\.(?:js|css))(?:\?[^"]*)?"/g)) {
    urls.add(new URL(match[1], `${SITE_URL}/`).href);
  }
  return [...urls];
}

async function smokeTestFrontend(commit) {
  const index = await fetchOk(`${SITE_URL}/`);
  const info = await fetchOk(`${SITE_URL}/build-info.json`);
  let deployedCommit = null;
  try {
    deployedCommit = JSON.parse(info.body).commit;
  } catch {
    // build-info.json nicht lesbar, unten als Fehler gemeldet
  }

  const assets = index.ok ? referencedAssets(index.body) : [];
  const missing = [];
  for (const url of assets) {
    const head = await fetchOk(url, "HEAD");
    if (head.status !== 200) {
      missing.push(`${url} (HTTP ${head.status})`);
    }
  }

  const ok = index.ok && deployedCommit === commit && assets.length > 0 && missing.length === 0;
  console.log(
    `[deploy] Smoke-Test Frontend: index.html HTTP ${index.status}, ` +
      `build-info.json commit=${deployedCommit ? deployedCommit.slice(0, 7) : "?"}, ` +
      `Assets ${assets.length - missing.length}/${assets.length} HTTP 200 ` +
      (ok ? "ok" : "FEHLER")
  );
  if (index.ok && assets.length === 0) {
    console.error("[deploy] index.html referenziert keine JS-/CSS-Assets");
  }
  if (missing.length > 0) {
    console.error(`[deploy] Fehlende Assets:\n  ${missing.join("\n  ")}`);
  }
  return ok;
}

async function healthCheckApi() {
  const health = await fetchOk(`${SITE_URL}/api/health.php`);
  let ok = false;
  try {
    ok = health.ok && JSON.parse(health.body).ok === true;
  } catch {
    // keine JSON-Antwort, ok bleibt false
  }
  console.log(`[deploy] Health-Check api: HTTP ${health.status} ${ok ? "ok" : `FEHLER ${health.body.slice(0, 200)}`}`);
  return ok;
}

// --- vendor/ ---------------------------------------------------------------------------------
// Ablauf in deployVendor, die Ausfuehrung (Composer, ssh, rsync) in den ops, damit Tests den
// Ablauf ohne Server pruefen koennen (test/deployVendor.test.js).

// Gleicher Stand: ueberspringen. Fehlt die Datei auf dem Server (null): wie abweichend.
function decideVendorAction(localHash, remoteHash) {
  return remoteHash !== null && remoteHash === localHash ? "skip" : "swap";
}

function shortHash(hash) {
  return hash ? hash.slice(0, 12) : "?";
}

// Eintrag fuer deploy.log, z. B. "unchanged:3f2a9c1b0d4e" oder "swapped:3f2a9c1b0d4e".
function vendorLogValue(state, hash) {
  return `${state}:${shortHash(hash)}`;
}

// prepare: lokal installieren, vergleichen, rsync-Dry-Run nach vendor_next/. Liest auf dem
// Server nur (kein Schreibzugriff), auch ausserhalb von --dry-run.
// apply: Upload nach vendor_next/, Tausch, Pruefung (PHP-CLI, Health-Check), bei Fehler
// Ruecktausch und Abbruch, bei Erfolg vendor_old loeschen.
function deployVendor(ops) {
  async function prepare() {
    ops.composerInstall();
    const localHash = ops.localHash();
    const remoteHash = ops.remoteHash();
    const action = decideVendorAction(localHash, remoteHash);
    if (action === "skip") {
      console.log(`[deploy] vendor unveraendert (installed.json ${shortHash(localHash)}), wird uebersprungen`);
      return { action, localHash, remoteHash, changes: [] };
    }
    console.log(
      `[deploy] vendor weicht ab: lokal ${shortHash(localHash)}, Server ` +
        `${remoteHash === null ? "ohne installed.json" : shortHash(remoteHash)}`
    );
    const changes = ops.rsyncVendor({ dryRun: true });
    console.log(`[deploy] Dry-Run vendor nach vendor_next/: ${changes.length} Eintraege`);
    return { action, localHash, remoteHash, changes };
  }

  async function apply(plan) {
    if (plan.action !== "swap") return vendorLogValue("unchanged", plan.localHash);
    // Upload und Tausch: scheitert einer, ist das laufende vendor unveraendert (Tausch siehe
    // remoteCommands.swap). Kein Ruecktausch noetig.
    try {
      ops.rsyncVendor({ dryRun: false });
      ops.swap();
    } catch (error) {
      error.vendorLog = vendorLogValue("failed", plan.localHash);
      throw error;
    }
    // Pruefung: Ein Fehler beim Pruefen selbst (z. B. ssh) zaehlt wie eine fehlgeschlagene Pruefung.
    let ok = false;
    try {
      ok = ops.checkRemote() && (await ops.healthCheck());
    } catch (error) {
      console.error(`[deploy] Pruefung vendor nicht moeglich: ${error.message}`);
      ok = false;
    }
    if (!ok) {
      try {
        ops.rollback();
      } catch (error) {
        error.message =
          `[deploy] vendor-Pruefung fehlgeschlagen UND Ruecktausch fehlgeschlagen, bitte auf dem Server ` +
          `pruefen (${REMOTE_API_DIR}: vendor, vendor_old, vendor_next): ${error.message}`;
        error.vendorLog = vendorLogValue("rollbackFailed", plan.localHash);
        throw error;
      }
      const error = new Error(
        "[deploy] vendor nach dem Tausch nicht in Ordnung, zurueckgetauscht (vendor_old ist wieder vendor)."
      );
      error.vendorLog = vendorLogValue("rolledback", plan.localHash);
      throw error;
    }
    // vendor laeuft; scheitert nur das Aufraeumen, bleibt vendor_old liegen (naechster Tausch raeumt es).
    try {
      ops.cleanupOld();
    } catch (error) {
      console.warn(`[deploy] WARNUNG: vendor_old nicht geloescht: ${error.message}`);
    }
    console.log(`[deploy] vendor getauscht (installed.json ${shortHash(plan.localHash)})`);
    return vendorLogValue("swapped", plan.localHash);
  }

  return { prepare, apply };
}

function ssh(command, { allowFailure = false } = {}) {
  const result = spawnSync("ssh", [REMOTE_HOST, command], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) fail(`ssh nicht ausfuehrbar: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) {
    fail(`ssh ${REMOTE_HOST} beendet mit Code ${result.status}: ${String(result.stderr || "").trim()}`);
  }
  return result;
}

// Befehle fuer den Server. Pfade sind feste Konstanten ohne Leerzeichen.
const remoteCommands = {
  hash: () =>
    `f=${REMOTE_API_DIR}/${VENDOR_STATE_FILE}; ` +
    `if [ -f "$f" ]; then (sha256sum "$f" 2>/dev/null || shasum -a 256 "$f") | cut -d' ' -f1; else echo MISSING; fi`,
  // Nur mit vorhandenem vendor_next. vendor_old eines abgebrochenen Laufs ist nicht mehr live
  // und darf weg. Scheitert das zweite mv, kommt vendor_old sofort zurueck: nie ohne vendor.
  swap: () =>
    `cd ${REMOTE_API_DIR} && [ -d vendor_next ] && rm -rf vendor_old && ` +
    `if [ -d vendor ]; then mv vendor vendor_old; fi && ` +
    `if ! mv vendor_next vendor; then if [ -d vendor_old ]; then mv vendor_old vendor; fi; exit 1; fi`,
  // Ohne vendor_old gab es vorher kein vendor: dann wieder ohne vendor.
  rollback: () =>
    `cd ${REMOTE_API_DIR} && rm -rf vendor_next && mv vendor vendor_next && ` +
    `if [ -d vendor_old ]; then mv vendor_old vendor; fi`,
  cleanupOld: () => `cd ${REMOTE_API_DIR} && rm -rf vendor_old`,
  check: () => {
    const checks = VENDOR_REQUIRED_CLASSES.map((c) => `class_exists("${c.replace(/\\/g, "\\\\")}")`).join(" && ");
    const code = `require "vendor/autoload.php"; $ok = ${checks}; echo $ok ? "SKM_VENDOR_OK" : "SKM_VENDOR_MISSING"; exit($ok ? 0 : 1);`;
    return `cd ${REMOTE_API_DIR} && ${REMOTE_PHP} -r '${code}'`;
  },
};

function realVendorOps(root) {
  const apiDir = path.join(root, "api");
  return {
    composerInstall() {
      console.log("[deploy] composer install --no-dev in api/ ...");
      const result = spawnSync("composer", ["install", "--no-dev", "--no-interaction"], { cwd: apiDir, stdio: "inherit" });
      if (result.error) fail(`composer nicht ausfuehrbar: ${result.error.message}`);
      if (result.status !== 0) fail(`composer install beendet mit Code ${result.status}`);
    },
    localHash() {
      const file = path.join(apiDir, VENDOR_STATE_FILE);
      if (!fs.existsSync(file)) fail(`api/${VENDOR_STATE_FILE} fehlt nach composer install`);
      return sha256(file);
    },
    remoteHash() {
      const out = ssh(remoteCommands.hash()).stdout.trim();
      if (out === "MISSING") return null;
      if (!/^[0-9a-f]{64}$/.test(out)) fail(`sha256 von installed.json auf dem Server nicht lesbar: ${out.slice(0, 200)}`);
      return out;
    },
    // --link-dest: unveraenderte Dateien werden aus dem laufenden vendor/ verlinkt statt neu
    // uebertragen; der Dry-Run zeigt so nur echte Aenderungen.
    rsyncVendor({ dryRun }) {
      const args = ["-a", "--delete", "--checksum", "--itemize-changes", "--link-dest=../vendor/"];
      if (dryRun) args.push("--dry-run");
      args.push("api/vendor/", `${REMOTE_HOST}:${REMOTE_API_DIR}/vendor_next/`);
      const result = spawnSync("rsync", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
      if (result.error) fail(`rsync nicht ausfuehrbar: ${result.error.message}`);
      if (result.status !== 0) fail(`rsync vendor beendet mit Code ${result.status}`);
      return result.stdout.split("\n").filter((line) => line.trim() !== "");
    },
    swap() {
      ssh(remoteCommands.swap());
    },
    checkRemote() {
      const result = ssh(remoteCommands.check(), { allowFailure: true });
      const ok = result.status === 0 && String(result.stdout).includes("SKM_VENDOR_OK");
      console.log(`[deploy] PHP-CLI-Pruefung vendor: ${ok ? "ok" : `FEHLER ${String(result.stdout + result.stderr).trim().slice(0, 300)}`}`);
      return ok;
    },
    healthCheck: healthCheckApi,
    rollback() {
      ssh(remoteCommands.rollback());
    },
    cleanupOld() {
      ssh(remoteCommands.cleanupOld());
    },
  };
}

// Lokale Zeit mit Offset, z. B. 2026-10-22T17:05:12+02:00
function localTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  );
}

function writeLog(root, entry) {
  const line =
    `${localTimestamp()}  target=prod  commit=${entry.commit.slice(0, 7)}  ` +
    `frontend=${entry.frontend}  vendor=${entry.vendor}  api=${entry.api}\n`;
  fs.appendFileSync(path.join(root, LOG_FILE), line);
  console.log(`[deploy] Log: ${line.trim()}`);
}

function createDeploy({ root, frontendDir, run, npmCmd, dryRun, vendorOps = realVendorOps(root) }) {
  const distDir = path.join(frontendDir, "dist");
  const vendor = deployVendor(vendorOps);
  let commit = null;

  // Testlauf wie bisher (Ausgabe live, Abbruch bei Fehler). Zusaetzlich landet das Ergebnis in einer
  // Temp-Datei; scheitert der Lauf, steht danach eine Zusammenfassung (Datei, Test, erste Zeilen der
  // Meldung) am Ende der Ausgabe, direkt vor dem Abbruch.
  async function runTests(label, cwd, extraArgs) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skm-tests-"));
    const resultFile = path.join(dir, "result.json");
    // shell: true reicht die Argumente ungequotet weiter: ein Temp-Pfad mit Leerzeichen braucht Anfuehrungszeichen.
    const quoted = /\s/.test(resultFile) ? `"${resultFile}"` : resultFile;
    const args = extraArgs.map((a) => a.replace("__RESULT__", quoted));
    try {
      await run(npmCmd(), args, { cwd, shell: true, env: { ...process.env, SKM_TEST_RESULT_FILE: resultFile } });
    } catch (error) {
      printFromFile(resultFile, { label, cwd: root });
      throw error;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // Vor dem Build: Git-Stand pruefen, Tests laufen lassen, Build-Umgebung fixieren.
  async function beforeBuild() {
    console.log(`[deploy] Ziel: ${REMOTE_HOST}:${REMOTE_DIR}${dryRun ? " (Dry-Run)" : ""}`);
    commit = checkGit(root, { dryRun, fetch: true });

    // test:report = npm test plus Reporter, der gescheiterte Tests in SKM_TEST_RESULT_FILE schreibt
    await runTests("Tests (Root)", root, ["run", "test:report"]);
    await runTests("Tests (frontend)", frontendDir, [
      "test",
      "--",
      "--reporter=default",
      "--reporter=json",
      "--outputFile=__RESULT__",
    ]);

    process.env.VITE_BASE = VITE_BASE;
    delete process.env.VITE_CSP_REPORT_ONLY;
  }

  async function afterBuild() {
    checkBuildOutput(distDir);
    await run(process.execPath, ["scripts/gen-build-info.mjs"], { cwd: root });
    await run(process.execPath, ["scripts/hash-dist.mjs"], { cwd: root });

    // i18n-Auto-Sync vor dem Build darf keine uncommitteten Aenderungen erzeugen
    checkGit(root, { dryRun, fetch: false });

    console.log("\n[deploy] Dry-Run Frontend (frontend/dist/ -> " + REMOTE_DIR + "):");
    const frontendChanges = rsync(root, {
      source: "frontend/dist/",
      target: REMOTE_DIR,
      filter: FRONTEND_FILTER,
      del: true,
      dryRun: true,
    });
    if (frontendChanges.length === 0) console.log("(keine Unterschiede)");

    console.log("\n[deploy] Dry-Run api (api/ -> " + REMOTE_DIR + "api/):");
    const apiChanges = rsync(root, {
      source: "api/",
      target: `${REMOTE_DIR}api/`,
      filter: API_FILTER,
      del: false,
      dryRun: true,
    });
    if (apiChanges.length === 0) console.log("(keine Unterschiede, api wird uebersprungen)");

    // vendor: auch im Dry-Run vergleichen (lokal composer install, auf dem Server nur lesen).
    console.log("\n[deploy] vendor (api/vendor/ -> " + REMOTE_API_DIR + "/vendor_next/):");
    const vendorPlan = await vendor.prepare();

    if (dryRun) {
      console.log("\n[deploy] Dry-Run beendet, nichts hochgeladen.");
      return;
    }

    console.log("");
    const frontendCodeChanged = frontendChanges.some(
      (line) => !BUILD_META_FILES.has(itemizedPath(line))
    );
    if (frontendCodeChanged) {
      // E2E laeuft automatisch (ca. 1-3 Minuten). Notausgang: SKIP_E2E=1 npm run deploy ...
      if (process.env.SKIP_E2E === "1") {
        console.log("[deploy] SKIP_E2E=1: E2E-Tests uebersprungen. " + e2eStatusLine(root));
      } else if (!runE2e(root)) {
        fail("Abbruch: E2E-Tests fehlgeschlagen (Details oben, Bericht: npx playwright show-report e2e/.results/report). Notfall: SKIP_E2E=1.");
      }
    }
    verifyDistHashes(distDir);

    const entry = {
      commit,
      frontend: "skipped",
      vendor: vendorPlan.action === "skip" ? vendorLogValue("unchanged", vendorPlan.localHash) : vendorLogValue("skipped", vendorPlan.localHash),
      api: apiChanges.length === 0 ? "unchanged" : "skipped",
    };
    const results = [];

    if (frontendChanges.length > 0 && (await ask("Frontend jetzt hochladen?"))) {
      rsync(root, { source: "frontend/dist/", target: REMOTE_DIR, filter: FRONTEND_FILTER, del: true });
      entry.frontend = "uploaded";
      results.push(await smokeTestFrontend(commit));
    }

    // vendor vor den api-PHP-Dateien: neue PHP-Dateien koennen neue Pakete brauchen.
    const vendorChanged = vendorPlan.action === "swap";
    if ((apiChanges.length > 0 || vendorChanged) && (await ask(vendorChanged ? "api jetzt hochladen (mit vendor-Tausch)?" : "api jetzt hochladen?"))) {
      if (vendorChanged) {
        try {
          entry.vendor = await vendor.apply(vendorPlan);
        } catch (error) {
          entry.vendor = error.vendorLog || vendorLogValue("failed", vendorPlan.localHash);
          writeLog(root, entry);
          throw error;
        }
      }
      if (apiChanges.length > 0) {
        rsync(root, { source: "api/", target: `${REMOTE_DIR}api/`, filter: API_FILTER, del: false });
        entry.api = "uploaded";
        results.push(await healthCheckApi());
      }
    }

    writeLog(root, entry);
    if (results.includes(false)) {
      fail("Upload erfolgt, aber Smoke-Test/Health-Check fehlgeschlagen.");
    }
  }

  return { beforeBuild, afterBuild };
}

module.exports = {
  createDeploy,
  checkGit,
  describeHeadMismatch,
  decideVendorAction,
  deployVendor,
  remoteCommands,
  vendorLogValue,
};
