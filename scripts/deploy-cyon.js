// Deployment des Produktions-Builds zu cyon (public_html/SKM/), ersetzt den
// manuellen Upload per FileZilla. Wird von start-build.js mit --deploy
// aufgerufen; --dry-run endet nach dem rsync-Dry-Run.
//
// Frontend: frontend/dist/ mit --checksum und --delete (geloescht wird nur
// unterhalb von assets/, siehe scripts/deploy/frontend.rsync-filter).
// api: api/ mit --checksum, ohne --delete; _config.php, data/ und vendor/
// bleiben unangetastet (scripts/deploy/api.rsync-filter). Ohne Unterschiede
// wird api still uebersprungen.
const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const REMOTE_HOST = "cyon-skm"; // Eintrag in ~/.ssh/config
const REMOTE_DIR = "public_html/SKM/";
const SITE_URL = "https://skm.steei.de";
const VITE_BASE = "/";

const FRONTEND_FILTER = "scripts/deploy/frontend.rsync-filter";
const API_FILTER = "scripts/deploy/api.rsync-filter";
const LOG_FILE = "deploy.log";
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
    problems.push(`HEAD (${head.slice(0, 7)}) ist nicht origin/main (${remote.slice(0, 7)})`);
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
    `frontend=${entry.frontend}  api=${entry.api}\n`;
  fs.appendFileSync(path.join(root, LOG_FILE), line);
  console.log(`[deploy] Log: ${line.trim()}`);
}

function createDeploy({ root, frontendDir, run, npmCmd, dryRun }) {
  const distDir = path.join(frontendDir, "dist");
  let commit = null;

  // Vor dem Build: Git-Stand pruefen, Tests laufen lassen, Build-Umgebung fixieren.
  async function beforeBuild() {
    console.log(`[deploy] Ziel: ${REMOTE_HOST}:${REMOTE_DIR}${dryRun ? " (Dry-Run)" : ""}`);
    commit = checkGit(root, { dryRun, fetch: true });

    await run(npmCmd(), ["test"], { cwd: root, shell: true });
    await run(npmCmd(), ["test"], { cwd: frontendDir, shell: true });

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

    if (dryRun) {
      console.log("\n[deploy] Dry-Run beendet, nichts hochgeladen.");
      return;
    }

    console.log("");
    const frontendCodeChanged = frontendChanges.some(
      (line) => !BUILD_META_FILES.has(itemizedPath(line))
    );
    if (
      frontendCodeChanged &&
      !(await ask("Frontend-Aenderungen lokal im Browser durchgeklickt (npm run dev oder preview)?"))
    ) {
      fail("Abbruch: Frontend-Aenderungen nicht lokal geprueft.");
    }
    verifyDistHashes(distDir);

    const entry = { commit, frontend: "skipped", api: apiChanges.length === 0 ? "unchanged" : "skipped" };
    const results = [];

    if (frontendChanges.length > 0 && (await ask("Frontend jetzt hochladen?"))) {
      rsync(root, { source: "frontend/dist/", target: REMOTE_DIR, filter: FRONTEND_FILTER, del: true });
      entry.frontend = "uploaded";
      results.push(await smokeTestFrontend(commit));
    }

    if (apiChanges.length > 0 && (await ask("api jetzt hochladen?"))) {
      rsync(root, { source: "api/", target: `${REMOTE_DIR}api/`, filter: API_FILTER, del: false });
      entry.api = "uploaded";
      results.push(await healthCheckApi());
    }

    writeLog(root, entry);
    if (results.includes(false)) {
      fail("Upload erfolgt, aber Smoke-Test/Health-Check fehlgeschlagen.");
    }
  }

  return { beforeBuild, afterBuild };
}

module.exports = { createDeploy };
