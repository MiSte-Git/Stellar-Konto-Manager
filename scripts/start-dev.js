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
const dotenv = require('dotenv');

const IS_WIN = process.platform === 'win32';
const CMD_EXE = process.env.comspec || 'cmd.exe';

function loadEnvFile(p) {
  try {
    if (fs.existsSync(p)) dotenv.config({ path: p });
  } catch (e) {}
}

loadEnvFile(path.resolve(process.cwd(), '.env'));
loadEnvFile(path.resolve(process.cwd(), 'backend', '.env'));

const VITE_BUILD_DATE = new Date().toISOString();
const BACKEND_PORT = process.env.PORT || process.env.BACKEND_PORT || '3000';
const PROD_API_URL = (process.env.PROD_API_URL || '').trim();
// Prefer explicit PROD_API_URL for the frontend; fall back to local backend.
const VITE_BACKEND_URL = process.env.VITE_BACKEND_URL || PROD_API_URL || `http://localhost:${BACKEND_PORT}`;
// Dev proxy target: only if explicitly provided
const VITE_DEV_PROXY_TARGET = process.env.VITE_DEV_PROXY_TARGET || '';

const env = Object.assign({}, process.env, {
  VITE_BUILD_DATE,
  PORT: BACKEND_PORT,
  VITE_BACKEND_URL,
  VITE_DEV_PROXY_TARGET,
});

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

const backend = startProcess(process.execPath, [path.join(process.cwd(), 'server.js')], { cwd: backendCwd, env, stdio: 'inherit' });
const frontend = startProcess(npmCmd(), ['run', 'dev'], { cwd: frontendCwd, env, stdio: 'inherit' });

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

async function waitForFrontend(url = 'http://localhost:5173', timeout = 30000) {
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
    const url = `http://localhost:5173`;
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
