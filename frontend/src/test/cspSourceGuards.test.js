// Source guards for the production CSP (Backlog P1.2). The CSP itself is
// tested in test/securityHeaders.test.js (repo root); these checks keep the
// frontend code compatible with it, so a regression shows up in vitest
// instead of as a blocked request in the browser console.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { BASE_CONNECT_SRC } = require('../../../services/securityHeaders.js');
import { NETWORKS } from '../config/networks.js';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontendDir = path.resolve(srcDir, '..');

function listSourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['locales', '__tests__', 'test'].includes(entry.name)) continue;
      out.push(...listSourceFiles(full));
    } else if (/\.(jsx?|tsx?)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = listSourceFiles(srcDir).map((file) => ({
  rel: path.relative(srcDir, file),
  text: fs.readFileSync(file, 'utf8'),
}));

function offenders(re) {
  return files.filter(({ text }) => re.test(text)).map(({ rel }) => rel);
}

describe('frontend source stays compatible with the production CSP', () => {
  it('creates no <style> elements at runtime (style-src self)', () => {
    expect(offenders(/createElement\(\s*['"`]style['"`]\s*\)/)).toEqual([]);
  });

  it('uses no dangerouslySetInnerHTML or style attributes via setAttribute', () => {
    expect(offenders(/dangerouslySetInnerHTML|setAttribute\(\s*['"`]style['"`]/)).toEqual([]);
  });

  it('uses no eval or new Function (script-src self)', () => {
    expect(offenders(/\beval\s*\(|new Function\s*\(/)).toEqual([]);
  });

  it('never fetches stellar.toml or federation servers directly - that goes through /api/federation', () => {
    expect(offenders(/\.well-known\/stellar\.toml|Federation\.Server|StellarToml\.Resolver|FederationServer/)).toEqual([]);
  });

  it('only connects to hosts allowed by connect-src', () => {
    const allowed = new Set(BASE_CONNECT_SRC.filter((s) => s.startsWith('https://')));
    const found = [];
    const seen = new Set();
    for (const { rel, text } of files) {
      // Call with the URL literal on a following line, e.g. fetch(\n  `https://...`)
      for (const m of text.matchAll(/(?:fetch|Server|EventSource|WebSocket)\(\s*['"`](https?:\/\/[a-z0-9.-]+)/gi)) {
        seen.add(m[1].toLowerCase());
        if (!allowed.has(m[1].toLowerCase())) found.push(`${rel}: ${m[1]}`);
      }
      for (const line of text.split('\n')) {
        if (!/fetch\(|Server\(|EventSource\(|WebSocket\(|_URL\s*=|HORIZON\w*\s*=|FRIENDBOT\w*\s*=/.test(line)) continue;
        for (const m of line.matchAll(/(?:['"`])(https?:\/\/[a-z0-9.-]+)/gi)) {
          seen.add(m[1].toLowerCase());
          if (!allowed.has(m[1].toLowerCase())) found.push(`${rel}: ${m[1]}`);
        }
      }
    }
    // Endpunkte aktivierter Netze aus der Registry (config/networks.js). rpcUrl
    // nutzt das Frontend noch nicht; vor der ersten Nutzung hier aufnehmen.
    for (const n of Object.values(NETWORKS)) {
      if (!n.enabled) continue;
      for (const url of [n.horizonUrl, n.friendbotUrl].filter(Boolean)) {
        const origin = new URL(url).origin;
        seen.add(origin);
        if (!allowed.has(origin)) found.push(`config/networks.js (${n.id}): ${origin}`);
      }
    }
    expect(found).toEqual([]);
    // Sanity: the scan really sees the known direct connections.
    expect([...seen].sort()).toEqual([...allowed].sort());
  });

  it('index.html has no inline script or style', () => {
    const html = fs.readFileSync(path.join(frontendDir, 'index.html'), 'utf8');
    expect(/<script(?![^>]*\ssrc=)[^>]*>/i.test(html)).toBe(false);
    expect(/<style\b/i.test(html)).toBe(false);
    expect(/\sstyle=/i.test(html)).toBe(false);
    expect(/\son[a-z]+=/i.test(html)).toBe(false);
  });

  it('reads SKM_HORIZON_URL only through the dev-only helper', () => {
    const readers = files.filter(({ text }) => /getItem\(\s*['"]SKM_HORIZON_URL['"]\s*\)/.test(text)).map(({ rel }) => rel);
    expect(readers).toEqual([path.join('utils', 'stellar', 'stellarUtils.js')]);
    const stellarUtils = files.find(({ rel }) => rel === path.join('utils', 'stellar', 'stellarUtils.js')).text;
    expect(stellarUtils.match(/getItem\(\s*['"]SKM_HORIZON_URL['"]\s*\)/g)).toHaveLength(1);
    expect(stellarUtils).toMatch(/function devHorizonOverride\(\) \{\s*if \(!import\.meta\.env\?\.DEV\) return null;/);
  });
});
