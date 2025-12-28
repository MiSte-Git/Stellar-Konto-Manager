#!/usr/bin/env node
/*
  Cross-platform build launcher
  - loads .env (root and backend/.env)
  - sets VITE_BUILD_DATE
  - runs frontend i18n ack and frontend build using npm
  - uses Node APIs instead of shell-only tools
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
const env = Object.assign({}, process.env, { VITE_BUILD_DATE });

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

(async () => {
  try {
    const frontendDir = path.join(process.cwd(), 'frontend');
    console.log('Running i18n ack (frontend)');
    await run(npmCmd(), ['run', 'i18n:ack'], { cwd: frontendDir, env });
    console.log('Building frontend');
    await run(npmCmd(), ['run', 'build'], { cwd: frontendDir, env });
    console.log('Build finished');
  } catch (e) {
    console.error('start-build failed:', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
