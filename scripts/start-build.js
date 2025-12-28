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
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
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
    const res = spawnSync(npmCmd(), ['--version'], {
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
    let ok = !res.error && res.status === 0;
    if (!ok && process.platform === 'win32' && res.error && res.error.code === 'EINVAL') {
      const fallback = spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm --version'], { stdio: 'ignore' });
      ok = !fallback.error && fallback.status === 0;
    }

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
    const p = spawn(cmd, args, Object.assign({ stdio: 'inherit' }, opts));
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
