// Regression guards for the security headers (Backlog P1.2): the shared
// module, the .htaccess template it renders, the Vite/Node wiring, the
// workflows, and Node/PHP parity of the API headers. Like
// test/serverCorsRegression.test.js, wiring that can't be exercised over
// HTTP here is checked in the source directly to catch a silent revert.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const sh = require('../services/securityHeaders.js');

const template = read('frontend/.htaccess.template');
const serverSource = read('server.js');
const viteConfig = read('frontend/vite.config.js');
const phpHeaders = read('api/securityHeaders.php');
const corsPhp = read('api/cors.php');
const apiHtaccess = read('api/.htaccess');
const canaryWorkflow = read('.github/workflows/deploy-canary.yml');
const deployWorkflow = read('.github/workflows/deploy.yml');

function directives(csp) {
  const map = new Map();
  for (const part of csp.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) map.set(name, values);
  }
  return map;
}

test('frontend CSP contains exactly the expected directives', () => {
  const d = directives(sh.buildFrontendCsp());
  assert.deepEqual(d.get('default-src'), ["'self'"]);
  assert.deepEqual(d.get('script-src'), ["'self'"]);
  assert.deepEqual(d.get('style-src'), ["'self'"]);
  assert.deepEqual(d.get('img-src'), ["'self'", 'data:']);
  assert.deepEqual(d.get('font-src'), ["'self'"]);
  assert.deepEqual(d.get('worker-src'), ["'self'", 'blob:']);
  assert.deepEqual(d.get('object-src'), ["'none'"]);
  assert.deepEqual(d.get('frame-ancestors'), ["'none'"]);
  assert.deepEqual(d.get('base-uri'), ["'self'"]);
  assert.deepEqual(d.get('form-action'), ["'self'"]);
  assert.deepEqual(d.get('connect-src'), [
    "'self'",
    'https://horizon.stellar.org',
    'https://horizon-testnet.stellar.org',
    'https://friendbot.stellar.org',
    'https://api.coingecko.com',
  ]);
});

test('frontend CSP never allows unsafe-inline, unsafe-eval, wildcards or a bare https: scheme', () => {
  const csp = sh.buildFrontendCsp();
  assert.equal(/unsafe-inline|unsafe-eval|wasm-unsafe-eval/.test(csp), false);
  assert.equal(/(^|\s)\*(\s|;|$)/.test(csp), false);
  for (const [name, values] of directives(csp)) {
    assert.equal(values.includes('https:'), false, `${name} must not allow https:`);
    assert.equal(values.includes('http:'), false, `${name} must not allow http:`);
  }
});

test('extra connect-src: absolute env URLs become origins, localhost only when asked for', () => {
  const env = {
    VITE_BACKEND_URL: 'https://api.example.org/base/api',
    VITE_HORIZON_URL: 'http://localhost:8000/',
  };
  assert.deepEqual(sh.extraConnectSrcFromEnv(env), ['https://api.example.org']);
  assert.deepEqual(sh.extraConnectSrcFromEnv(env, { includeLocal: true }), ['https://api.example.org', 'http://localhost:8000']);
  assert.deepEqual(sh.extraConnectSrcFromEnv({ VITE_BACKEND_URL: '/api', VITE_HORIZON_URL: 'javascript:alert(1)' }), []);
  const d = directives(sh.buildFrontendCsp({ extraConnectSrc: ['https://horizon.stellar.org', 'https://api.example.org'] }));
  assert.equal(d.get('connect-src').filter((v) => v === 'https://horizon.stellar.org').length, 1, 'deduplicated');
  assert.ok(d.get('connect-src').includes('https://api.example.org'));
});

test('other frontend headers: Referrer-Policy, nosniff, X-Frame-Options, Permissions-Policy', () => {
  const h = sh.frontendHeaders();
  assert.equal(h['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  assert.equal(h['X-Frame-Options'], 'DENY');
  assert.equal(h['Permissions-Policy'], 'camera=(self), microphone=(), geolocation=()');
  assert.ok(h['Content-Security-Policy']);
  assert.equal(h['Content-Security-Policy-Report-Only'], undefined);
  const ro = sh.frontendHeaders({ reportOnly: true });
  assert.ok(ro['Content-Security-Policy-Report-Only']);
  assert.equal(ro['Content-Security-Policy'], undefined);
});

test('the P2.1 camera note sits next to the Permissions-Policy value', () => {
  assert.match(read('services/securityHeaders.js'), /P2\.1[\s\S]{0,80}camera=\(self\)/);
  assert.match(template, /P2\.1[\s\S]{0,80}camera=\(self\)/);
});

test('HSTS: one year, no includeSubDomains, no preload', () => {
  assert.equal(sh.HSTS, 'max-age=31536000');
});

test('.htaccess template renders all placeholders for a root deploy', () => {
  const out = sh.renderHtaccess(template, { base: '' });
  assert.equal(/__[A-Z_]+__/.test(out), false);
  assert.match(out, /^RewriteBase \/$/m);
  assert.match(out, /^RewriteRule \^ \/index\.html \[L\]$/m);
  assert.ok(out.includes(`Header always set Content-Security-Policy "${sh.buildFrontendCsp()}"`));
  assert.ok(out.includes('Header always set X-Content-Type-Options "nosniff"'));
  assert.ok(out.includes('Header always set X-Frame-Options "DENY"'));
  assert.ok(out.includes('Header always set Referrer-Policy "strict-origin-when-cross-origin"'));
  assert.ok(out.includes('Header always set Permissions-Policy "camera=(self), microphone=(), geolocation=()"'));
  assert.ok(out.includes(`Header always set Strict-Transport-Security "max-age=31536000" "expr=%{HTTPS} == 'on'"`));
  assert.equal(/SAMEORIGIN/.test(out), false);
});

test('.htaccess template: HTML headers exclude /api, HSTS does not', () => {
  const out = sh.renderHtaccess(template, { base: '' });
  const ifStart = out.indexOf('<If "%{REQUEST_URI} !~ m#^/api(/|$)#">');
  const ifEnd = out.indexOf('</If>');
  const cspAt = out.indexOf('Header always set Content-Security-Policy');
  const hstsAt = out.indexOf('Strict-Transport-Security');
  assert.ok(ifStart > -1 && ifEnd > ifStart);
  assert.ok(cspAt > ifStart && cspAt < ifEnd, 'CSP inside the /api exclusion');
  assert.ok(hstsAt > ifEnd, 'HSTS outside, so api/ keeps it');
});

test('.htaccess template renders a subfolder base and Report-Only mode for the canary', () => {
  const out = sh.renderHtaccess(template, { base: '/SKM_Canary/', reportOnly: true });
  assert.match(out, /^RewriteBase \/SKM_Canary\/$/m);
  assert.match(out, /^RewriteRule \^ \/SKM_Canary\/index\.html \[L\]$/m);
  assert.ok(out.includes('<If "%{REQUEST_URI} !~ m#^/SKM_Canary/api(/|$)#">'));
  assert.ok(out.includes('Header always set Content-Security-Policy-Report-Only "'));
  assert.equal(/Header always set Content-Security-Policy "/.test(out), false);
});

test('renderHtaccess refuses to leave an unknown placeholder behind', () => {
  assert.throws(() => sh.renderHtaccess('Header set X "__UNKNOWN__"'), /unresolved placeholder __UNKNOWN__/);
});

test('API headers: JSON-only CSP, nosniff, Referrer-Policy', () => {
  assert.deepEqual(sh.apiHeaders(), {
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
});

test('Node middleware sets the API headers, HSTS only on secure requests', () => {
  const mw = sh.createApiSecurityHeadersMiddleware();
  const run = (secure) => {
    const headers = {};
    let nextCalled = false;
    mw({ secure }, { setHeader: (k, v) => { headers[k] = v; } }, () => { nextCalled = true; });
    assert.ok(nextCalled);
    return headers;
  };
  const plain = run(false);
  assert.equal(plain['Content-Security-Policy'], sh.API_CSP);
  assert.equal(plain['X-Content-Type-Options'], 'nosniff');
  assert.equal(plain['Strict-Transport-Security'], undefined);
  assert.equal(run(true)['Strict-Transport-Security'], 'max-age=31536000');
});

test('server.js registers the security header middleware before any CORS middleware or route', () => {
  const mwAt = serverSource.indexOf('app.use(createApiSecurityHeadersMiddleware())');
  const firstCors = serverSource.indexOf('app.use(\'/api/multisig\', createCorsMiddleware(');
  const firstRoute = serverSource.search(/app\.(get|post|put|patch|delete)\(/);
  assert.ok(mwAt > -1, 'middleware is wired up');
  assert.ok(firstCors > mwAt, 'before the CORS middlewares');
  assert.ok(firstRoute > mwAt, 'before the first route');
});

test('PHP API headers are identical to the Node ones (parity)', () => {
  const constant = (name) => {
    const m = phpHeaders.match(new RegExp(`const ${name} = (["'])(.*?)\\1;`));
    assert.ok(m, `${name} defined in api/securityHeaders.php`);
    return m[2];
  };
  assert.equal(constant('SKM_API_CSP'), sh.API_CSP);
  assert.equal(constant('SKM_API_REFERRER_POLICY'), sh.REFERRER_POLICY);
  assert.match(phpHeaders, /'Content-Security-Policy' => SKM_API_CSP/);
  assert.match(phpHeaders, /'X-Content-Type-Options' => 'nosniff'/);
  assert.match(phpHeaders, /'Referrer-Policy' => SKM_API_REFERRER_POLICY/);
  assert.equal(Object.keys(sh.apiHeaders()).length, 3, 'update the PHP twin when adding an API header');
});

test('api/cors.php (required by every endpoint) applies the API security headers', () => {
  assert.match(corsPhp, /require_once __DIR__ \. '\/securityHeaders\.php';\s*apply_api_security_headers\(\);/);
  for (const file of fs.readdirSync(path.join(root, 'api')).filter((f) => f.endsWith('.php'))) {
    const src = read(`api/${file}`);
    if (file === 'cors.php' || file === 'securityHeaders.php') continue;
    if (/^\s*(header\(|echo |http_response_code\()/m.test(src)) {
      assert.match(src, /require(_once)? __DIR__ \. '\/cors\.php'/, `${file} responds over HTTP and must require cors.php`);
    }
  }
});

test('api/.htaccess does not unset headers (would drop PHP-FPM headers too)', () => {
  assert.equal(/^\s*Header\s+(always\s+)?unset/m.test(apiHtaccess), false);
});

test('Vite: build emits .htaccess via the shared module, preview gets the production headers', () => {
  assert.match(viteConfig, /require\('\.\.\/services\/securityHeaders\.js'\)/);
  assert.match(viteConfig, /fileName: '\.htaccess'/);
  assert.match(viteConfig, /apply: 'build'/);
  assert.match(viteConfig, /preview: \{\s*headers: frontendHeaders\(/);
  assert.equal(/server: \{[^}]*headers:/.test(viteConfig), false, 'dev server stays without CSP (HMR)');
});

test('workflows: canary starts in Report-Only and keeps the built .htaccess, deploy is manual and ships .htaccess', () => {
  assert.match(canaryWorkflow, /VITE_CSP_REPORT_ONLY: '1'/);
  assert.equal(/sed [^\n]*\.htaccess\.template[^\n]*> \.\/dist\/\.htaccess/.test(canaryWorkflow), false, 'no sed overwrite of the generated file');
  assert.match(deployWorkflow, /on:\s*\n\s*workflow_dispatch:/);
  assert.equal(/^\s*(push|pull_request):/m.test(deployWorkflow), false);
  assert.match(deployWorkflow, /local_path: "dist\/\.htaccess"/);
});

test('no stale root .htaccess (old /StellarTrustlineManager/ base) is tracked', () => {
  assert.equal(fs.existsSync(path.join(root, '.htaccess')), false);
});

test('.htaccess: base is regex-escaped inside the /api exclusion, unsafe bases are refused', () => {
  const out = sh.renderHtaccess(template, { base: '/SKM.v2/' });
  assert.match(out, /^RewriteBase \/SKM\.v2\/$/m);
  assert.ok(out.includes('<If "%{REQUEST_URI} !~ m#^/SKM\\.v2/api(/|$)#">'));
  assert.throws(() => sh.renderHtaccess(template, { base: '/a#b' }), /unsupported base/);
  assert.throws(() => sh.renderHtaccess(template, { base: '/a"b' }), /unsupported base/);
});

test('.htaccess: security headers are not wrapped in IfModule (fail closed without mod_headers)', () => {
  const out = sh.renderHtaccess(template, { base: '' });
  const ifModuleBlocks = [...out.matchAll(/<IfModule mod_headers\.c>[\s\S]*?<\/IfModule>/g)].map((m) => m[0]);
  assert.equal(ifModuleBlocks.some((b) => /Content-Security-Policy|Strict-Transport-Security/.test(b)), false);
});

test('api/.htaccess adds nosniff for static non-PHP files only', () => {
  assert.match(apiHtaccess, /<If "%\{REQUEST_FILENAME\} !~ \/\\\.php\$\/">\s*Header always set X-Content-Type-Options "nosniff"\s*<\/If>/);
});
