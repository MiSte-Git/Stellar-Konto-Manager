#!/usr/bin/env node
/*
  Cross-platform dev launcher
  - loads .env (root and backend/.env) using dotenv
  - sets VITE_BUILD_DATE and PORT for children
  - spawns backend (node server.js) and frontend (npm run dev)
  - waits for frontend to respond and opens browser
  - forwards SIGINT/SIGTERM and cleans up children
*/
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const dotenv = require('dotenv');

const IS_WIN = process.platform === 'win32';
const CMD_EXE = process.env.ComSpec || process.env.comspec || 'cmd.exe';

function loadEnvFile(p) {
  try {
    if (fs.existsSync(p)) dotenv.config({ path: p });
  } catch (e) {}
}

loadEnvFile(path.resolve(process.cwd(), '.env'));
loadEnvFile(path.resolve(process.cwd(), 'backend', '.env'));

const VITE_BUILD_DATE = new Date().toISOString();
const BACKEND_PORT = process.env.BACKEND_PORT || process.env.PORT || '3000';
const FRONTEND_PORT = process.env.FRONTEND_PORT || '5173';
const PROD_API_URL = (process.env.PROD_API_URL || '').trim();
const DEFAULT_PROD_API_URL = process.env.DEFAULT_PROD_API_URL || 'https://www.skm.steei.de';
const I18N_AUTO_SYNC = process.env.I18N_AUTO_SYNC || '0';
const I18N_PY_SYNC = process.env.I18N_PY_SYNC || '';
const BASE_REF = process.env.BASE_REF || 'origin/main';
const VITE_DEV_PROXY_TARGET = process.env.VITE_DEV_PROXY_TARGET || '';

const backendCwd = process.cwd();
const frontendCwd = path.join(process.cwd(), 'frontend');

function npmCmd() {
  return IS_WIN ? 'npm.cmd' : 'npm';
}

function quoteForCmd(arg = '') {
  if (!arg) return '""';
  if (!/[ \t"]/u.test(arg)) return arg;
  return `"${arg.replace(/(["\\])/g, '\\$1')}"`;
}

function spawnPortable(command, args = [], opts = {}) {
  if (!IS_WIN) return spawn(command, args, opts);
  const line = [command, ...args].map(quoteForCmd).join(' ');
  return spawn(CMD_EXE, ['/d', '/s', '/c', line], opts);
}

function spawnPortableSync(command, args = [], opts = {}) {
  if (!IS_WIN) return spawnSync(command, args, opts);
  const line = [command, ...args].map(quoteForCmd).join(' ');
  return spawnSync(CMD_EXE, ['/d', '/s', '/c', line], opts);
}

function checkNodeAndNpm() {
  const min = [20, 0, 0];
  const ver = (process.version || 'v0.0.0').replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < min.length; i++) {
    if ((ver[i] || 0) > min[i]) break;
    if ((ver[i] || 0) < min[i]) {
      console.error(`Node.js ${min.join('.')}+ is required. Current: ${process.version}`);
      process.exit(1);
    }
  }
  try {
    const res = spawnPortableSync(npmCmd(), ['--version'], { stdio: 'ignore' });
    let ok = !res.error && res.status === 0;

    if (!ok) {
      // When invoked via `npm run`, npm may not be directly invokable as `npm` in the child env,
      // but npm sets `npm_execpath` / `npm_config_user_agent` in the environment. Accept that.
      if (process.env.npm_execpath || process.env.npm_config_user_agent) {
        return;
      }
      console.error('`npm` not found or not working. Please install Node.js (includes npm) and ensure it is in your PATH.');
      process.exit(1);
    }
  } catch (e) {
    console.error('`npm` check failed:', e && e.message ? e.message : e);
    process.exit(1);
  }
}

checkNodeAndNpm();

function parseArgs() {
  const args = process.argv.slice(2);
  let useProdBackend = null;
  for (const arg of args) {
    if (arg === '--use-prod-backend' || arg === '-p') {
      useProdBackend = true;
    } else if (arg === '--use-local-backend' || arg === '-l') {
      useProdBackend = false;
    } else {
      console.error(`Unknown parameter: ${arg}`);
      console.error('Usage: start-dev.js [--use-prod-backend|-p] [--use-local-backend|-l]');
      process.exit(1);
    }
  }
  return useProdBackend;
}

function askQuestion(prompt) {
  if (!process.stdin.isTTY) return Promise.resolve('');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function selectBackendMode() {
  let useProdBackend = parseArgs();
  if (useProdBackend !== null) return useProdBackend;
  if (!process.stdin.isTTY) return false;
  while (true) {
    const answer = (await askQuestion('Backend wählen: [l] lokal (Default) / [p] Prod-Backend ')).trim();
    if (!answer || /^l$/i.test(answer)) return false;
    if (/^p$/i.test(answer)) return true;
    console.warn('Ungueltige Eingabe. Bitte l oder p waehlen (Enter = lokal).');
  }
}

function isHttpsUrl(value) {
  return /^https:\/\//i.test(value);
}

async function promptProdApiUrl(currentValue) {
  if (currentValue) return currentValue;
  if (!process.stdin.isTTY) return DEFAULT_PROD_API_URL;
  let prodUrl = '';
  while (!prodUrl) {
    const answer = await askQuestion(`Bitte gib die URL des PROD-Backends ein (Enter fuer Default: ${DEFAULT_PROD_API_URL}): `);
    prodUrl = answer.trim() || DEFAULT_PROD_API_URL;
    if (!isHttpsUrl(prodUrl)) {
      console.warn('Ungueltige URL (erwarte https://…). Bitte erneut eingeben.');
      prodUrl = '';
    }
  }
  return prodUrl;
}

async function maybeSaveProdApiUrl(prodUrl) {
  if (!process.stdin.isTTY) return;
  const answer = (await askQuestion('Soll ich diesen Wert dauerhaft in .env speichern? [j/N] ')).trim();
  if (!/^j$/i.test(answer)) {
    console.log('Verwende PROD_API_URL nur temporaer fuer diesen Start.');
    return;
  }
  const envPath = path.resolve(process.cwd(), '.env');
  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
  }
  const lines = content.split(/\r?\n/);
  let replaced = false;
  const updated = lines.map((line) => {
    if (line.startsWith('PROD_API_URL=')) {
      replaced = true;
      return `PROD_API_URL=${prodUrl}`;
    }
    return line;
  });
  if (!replaced) updated.push(`PROD_API_URL=${prodUrl}`);
  fs.writeFileSync(envPath, updated.filter((line, idx, arr) => !(line === '' && idx === arr.length - 1)).join('\n') + '\n');
  console.log('PROD_API_URL wurde gespeichert.');
}

async function checkProdBackendHealth(prodUrl) {
  const healthUrl = `${prodUrl.replace(/\/+$/, '')}/api/health.php`;
  if (typeof fetch !== 'function') return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(healthUrl, { method: 'GET', signal: controller.signal });
    clearTimeout(timeout);
    if (!res || res.status >= 400) {
      console.warn(`Hinweis: Konnte ${healthUrl} nicht erreichen. Pruefe URL/Netzwerk (nur Warnung).`);
    }
  } catch (e) {
    console.warn(`Hinweis: Konnte ${healthUrl} nicht erreichen. Pruefe URL/Netzwerk (nur Warnung).`);
  }
}

function detectGitChanges(pathSpec) {
  try {
    const res = spawnPortableSync('git', ['status', '--porcelain', '--', pathSpec], { stdio: ['ignore', 'pipe', 'ignore'] });
    if (res.status !== 0 || !res.stdout) return 0;
    return String(res.stdout).trim().split('\n').filter(Boolean).length;
  } catch (e) {
    return 0;
  }
}

function runPythonSync(scriptPath) {
  if (!scriptPath || !fs.existsSync(scriptPath)) return;
  let res = spawnPortableSync('python3', [scriptPath], { stdio: 'inherit' });
  if (res.status !== 0) {
    spawnPortableSync('python', [scriptPath], { stdio: 'inherit' });
  }
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawnPortable(cmd, args, Object.assign({ stdio: 'inherit' }, opts));
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('exit ' + code));
    });
    p.on('error', reject);
  });
}

function startProcess(cmd, args, opts) {
  try {
    console.log('Spawning:', cmd, args.join(' '), 'cwd=', opts && opts.cwd);
    return spawnPortable(cmd, args, opts);
  } catch (err) {
    console.error('spawn failed for', cmd, args, 'error:', err && err.message ? err.message : err);
    console.error('process.execPath=', process.execPath);
    console.error('cwd=', process.cwd());
    console.error('env.PATH length:', String(process.env.PATH || '').length);
    process.exit(1);
  }
}

let backend = null;
let frontend = null;

let exiting = false;
function shutdown(code = 0) {
  if (exiting) return;
  exiting = true;
  try { backend.kill(); } catch (e) {}
  try { frontend.kill(); } catch (e) {}
  setTimeout(() => process.exit(code), 200);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function waitForFrontend(url = `http://localhost:${FRONTEND_PORT}`, timeout = 30000) {
  const start = Date.now();
  // Node 18+ has global fetch
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res && res.status < 400) return true;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

(async () => {
  try {
    const useProdBackend = await selectBackendMode();
    let prodUrl = PROD_API_URL;
    if (useProdBackend) {
      if (!prodUrl) {
        prodUrl = await promptProdApiUrl(prodUrl);
        await checkProdBackendHealth(prodUrl);
        await maybeSaveProdApiUrl(prodUrl);
      }
    }

    const apiBaseForFrontend = useProdBackend ? prodUrl : `http://localhost:${BACKEND_PORT}`;
    const env = Object.assign({}, process.env, {
      VITE_BUILD_DATE,
      PORT: BACKEND_PORT,
      VITE_BACKEND_URL: process.env.VITE_BACKEND_URL || apiBaseForFrontend,
      VITE_DEV_PROXY_TARGET,
    });

    if (useProdBackend) {
      console.log(`Frontend lokal, Backend = PROD (${apiBaseForFrontend})`);
    }

    if (!useProdBackend) {
      console.log('Installiere Backend-Abhaengigkeiten...');
      await run(npmCmd(), ['install'], { cwd: backendCwd, env });
    }

    console.log('Installiere Frontend-Abhaengigkeiten...');
    await run(npmCmd(), ['install'], { cwd: frontendCwd, env });

    if (I18N_AUTO_SYNC === '1') {
      console.log('i18n Auto-Sync aktiviert');
      const deChanges = detectGitChanges('frontend/src/locales/de');
      if (I18N_PY_SYNC && fs.existsSync(I18N_PY_SYNC) && deChanges !== 0) {
        console.log(`Fuehre Python-Sync aus: ${I18N_PY_SYNC}`);
        runPythonSync(I18N_PY_SYNC);
      } else {
        console.log('Kein Python-Sync noetig (kein Skript oder keine DE-Aenderungen)');
      }
      console.log('Aktualisiere EN-Acks (nur betroffene Keys)…');
      try {
        await run(npmCmd(), ['run', 'i18n:ack'], { cwd: frontendCwd, env: Object.assign({}, env, { BASE_REF }) });
      } catch (e) {
        console.warn('i18n:ack fehlgeschlagen (wird uebersprungen).');
      }
    }

    if (!useProdBackend) {
      console.log(`Starte Root-Backend auf http://localhost:${BACKEND_PORT} ...`);
      backend = startProcess(npmCmd(), ['start'], { cwd: backendCwd, env, stdio: 'inherit' });
    } else {
      console.log('Backend wird nicht gestartet (Option --use-prod-backend aktiv).');
    }

    console.log(`Starte Frontend auf http://localhost:${FRONTEND_PORT} ...`);
    frontend = startProcess(npmCmd(), ['run', 'dev'], { cwd: frontendCwd, env, stdio: 'inherit' });

    const url = `http://localhost:${FRONTEND_PORT}`;
    const ok = await waitForFrontend(url, 30000);
    if (ok) {
      try {
        // use the open package if available, otherwise fall back to npx open
        try {
          const open = require('open');
          await open(url);
        } catch (e) {
          // fallback to npx open (will fetch if needed)
          const opener = spawnPortable(npmCmd(), ['exec', '--no-install', 'open', url], { stdio: 'ignore', detached: true });
          opener.unref();
        }
      } catch (e) {
        // ignore
      }
    } else {
      console.warn('Frontend did not become available within timeout.');
    }
  } catch (e) {
    console.error('start-dev launcher error', e && e.message ? e.message : e);
  }
})();
