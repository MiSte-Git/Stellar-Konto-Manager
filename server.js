const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const StellarSdk = require('@stellar/stellar-sdk');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const crypto = require('crypto');
const { searchAssets, fetchAssetFacts, fetchExpertDirectoryEntry } = require('./services/tradeService.js');
const { createCorsMiddleware } = require('./services/corsConfig.js');
const { requireAllowedOrigin, requireJsonContentType } = require('./services/requestGuard.js');
const { createApiSecurityHeadersMiddleware } = require('./services/securityHeaders.js');
const { handleFederationRequest, HOP_HEADER: FEDERATION_HOP_HEADER } = require('./services/federationService.js');
const { writeJsonFileLocked } = require('./services/jsonFileStore.js');
const { createChallenge, consumeChallenge, verifyChallengeSignature } = require('./services/challengeStore.js');
const { createChallengeLimiter } = require('./services/challengeRateLimit.js');
const { createJobListLimiter } = require('./services/rateLimit.js');
const { filterValidSignatures, foreignOpSourcesOf, requiredWeightForOperations, signatureKey, txSourceBaseAccount, verifyCollected } = require('./services/txSignatures.js');
const { isInteractiveSigner, normalizeHorizonSigners } = require('./services/signerAuth.js');
const { isLocalRequest } = require('./services/network.js');
const { asciiTrim, isClassicAccount } = require('./services/addressKind.js');
const stellarNetworks = require('./services/stellarNetworks.js');
const { computeMultisigLifecycleStatus, extractMaxTimeUnix, mapSubmitResultCodeToLifecycleStatus, isMultisigTimeboundWithinCap, MULTISIG_JOB_MAX_TIMEBOUND_SECONDS } = require('./services/multisigLifecycle.js');
const { applyDecline, dropDeclinesOfCollected } = require('./services/multisigDecline.js');
const { withMultisigJobLock } = require('./services/multisigJobLock.js');
const { submitErrorResult, submitSuccessResult, withSanitizedSubmitResult } = require('./services/submitResult.js');
const { expireStalePendingJobs } = require('./services/multisigJobsGuard.js');
const {
  SUBMIT_UNCLEAR_STATUS, SUBMIT_UNCLEAR_MAX_RESOLVES_PER_REQUEST,
  isUnclearSubmitError, isUnclearSubmitSuccess, isSequenceConsumed, isUnclearResolveDue, parseLedgerClosedAt, isLedgerPastMaxTime, unclearOutcome,
  isExternalCheckCandidate, compareResolvePriority, transactionLookupFromRecord, externalOutcome,
  externalUnconsumedOutcome, isPastMaxTimeByClock,
} = require('./services/submitUnclear.js');

// Lightweight .env loader (root .env and backend/.env) without extra deps
(function loadDotEnv() {
  const applyDotEnv = (filePath) => {
    try {
      if (!fsSync.existsSync(filePath)) return;
      const text = fsSync.readFileSync(filePath, 'utf8');
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (!m) continue;
        const key = m[1];
        let val = m[2];
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith('\'') && val.endsWith('\''))) {
          val = val.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = val;
      }
    } catch (e) {
      console.warn('dotenv.load.failed', filePath, e?.message || e);
    }
  };
  try {
    const rootEnv = path.join(process.cwd(), '.env');
    const backendEnv = path.join(process.cwd(), 'backend', '.env');
    applyDotEnv(rootEnv);
    applyDotEnv(backendEnv);
  } catch {}
})();

const app = express();
const port = parseInt(process.env.PORT, 10) || 3000;
const HORIZON_URL = stellarNetworks.horizonUrlFor('public');
const horizon = new StellarSdk.Horizon.Server(HORIZON_URL);

function getTradeHorizon(network = 'PUBLIC') {
  const net = stellarNetworks.networkFromQuery(network);
  return net === 'public' ? horizon : new StellarSdk.Horizon.Server(stellarNetworks.horizonUrlFor(net));
}

// Security headers (Backlog P1.2) on every response, preflights and errors
// included - same values as api/securityHeaders.php (parity checked by
// test/securityHeaders.test.js). Registered first so no route can skip them.
app.use(createApiSecurityHeadersMiddleware());

// Explicit CORS headers for routes restricted to known dev/prod origins
// (was previously a wildcard '*' — finding B3). Origin allowlist + middleware
// factory live in services/corsConfig.js (finding #9) so it's a single
// source of truth shared with no duplicated per-route logic. Every one of
// these middlewares rejects a foreign Origin with 403 (G3).
//
// These path-scoped middlewares are registered BEFORE the global fallback
// below on purpose: each handles (and short-circuits) its own OPTIONS
// preflight with the extra headers/credentials those routes specifically
// need (x-job-token, cookies). If the global fallback ran first, it would
// answer those preflights itself - without x-job-token/credentials allowed -
// and the browser would block the real request before these more specific
// middlewares ever got a chance to run.
app.use('/api/multisig', createCorsMiddleware({
  methods: ['GET', 'POST', 'OPTIONS'],
  headers: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'x-job-token'],
}));

// Session-cookie-protected routes (bugtracker admin auth, finding A2) need a
// specific origin + Access-Control-Allow-Credentials - '*' cannot be combined
// with cookies per the fetch/CORS spec.
app.use(['/api/admin', '/api/bugreport'], createCorsMiddleware({
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  headers: ['Content-Type'],
  credentials: true,
}));

// Global allowlist fallback for every route not already covered above
// (/api/composeMail, /trustlines, /api/trade/*, /expert) - replaces the
// previous cors middleware call, configured to reflect *any* request's
// Origin header at the CORS layer. That made the browser's same-origin
// policy no protection at all for these routes: a state-changing POST like
// /api/composeMail (see below) would still run server-side when triggered
// from an arbitrary third-party page, even though that page couldn't read
// the (CORS-blocked) response. Runs before express.json()/routes. Like the
// path-scoped middlewares above, it answers a request whose Origin header is
// outside the allowlist with 403 forbidden_origin (G3, preflight included), so
// such a request never reaches express.json() or a route handler. Requests
// without an Origin header (same-origin GET, scripts) pass through unchanged.
app.use(createCorsMiddleware({
  methods: ['GET', 'POST', 'OPTIONS'],
  headers: ['Content-Type'],
}));
app.use(express.json()); // built into Express 4.16+ (finding #16), no separate body-parser dependency needed

// Uses the default in-memory MemoryStore. server.js is documented (README)
// as the local/dev backend only - the production variant is the PHP backend
// on cyon hosting, which uses PHP's own session mechanism instead. A
// restarted dev server dropping admin sessions is an accepted, correctly-
// scoped tradeoff here; swapping in a persistent store (e.g. connect-sqlite3,
// connect-redis) would only be warranted if this backend were ever run as
// more than a single dev instance.
app.use(session({
  name: 'skm_admin_session',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  rolling: true, // finding #13: refresh cookie.maxAge on every request, so this is an inactivity timeout, not an absolute session lifetime
  cookie: {
    httpOnly: true,
    secure: 'auto', // https in prod, plain http in local dev
    sameSite: 'lax',
    maxAge: 30 * 60 * 1000, // 30 min inactivity timeout (finding #13)
  },
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100, // renamed from `max` (express-rate-limit v7+, finding #16)
  ipv6Subnet: 64, // wie api/rateLimit.php (Default der Bibliothek waere /56)
  message: 'Too many requests from this IP, please try again later.',
});
app.use(limiter);

// Health check endpoint removed (no longer used). 

const composeMailEnabled = process.env.ENABLE_COMPOSE_MAIL !== '0';
const sanitizeHeader = (value = '') => value.replace(/[\r\n]+/g, ' ').trim();
const normalizeBody = (value = '') => value.replace(/\r\n/g, '\n');

function timingSafeEqualStrings(a = '', b = '') {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

async function createComposeFile({ to, subject, body }) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'stm-compose-'));
  const tmpFile = path.join(tmpDir, 'compose.eml');
  const payload = [
    `To: ${sanitizeHeader(to)}`,
    `Subject: ${sanitizeHeader(subject)}`,
    '',
    normalizeBody(body)
  ].join('\n');
  await fs.writeFile(tmpFile, payload, 'utf8');
  const scheduleCleanup = () => {
    setTimeout(() => {
      fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }, 60_000);
  };
  return { tmpFile, scheduleCleanup };
}

if (composeMailEnabled) {
  app.post('/api/composeMail', async (req, res) => {
    try {
      // composeMail spawns a local GUI mail client on whatever machine runs
      // this process - only ever meaningful triggered from the same machine's
      // own frontend (per README, server.js is the local/dev backend only).
      // The CORS allowlist above stops a *browser* from completing a
      // cross-origin drive-by request, but CORS is a browser-enforced policy,
      // not server-side authentication - a non-browser caller (curl, a local
      // script, or a remote client if this port were ever reachable beyond
      // localhost) ignores the Origin header entirely. Checking the actual
      // TCP peer address instead lets the endpoint stay unauthenticated (no
      // extra secret to configure for a pure dev convenience feature) while
      // still only being triggerable from the same host.
      // G2: hinter dem Vite-Proxy ist die Peer-Adresse immer Loopback; deshalb
      // zaehlen zusaetzlich die vom Proxy angehaengten Forwarded-Adressen.
      if (!isLocalRequest(req)) {
        return res.status(403).json({ ok: false, error: 'composeMail.forbidden' });
      }
      const { to, subject = '', body = '' } = req.body || {};
      if (!to || typeof to !== 'string') {
        return res.status(400).json({ ok: false, error: 'composeMail.invalidRecipient' });
      }
      const target = process.env.COMPOSE_MAIL_BIN || 'claws-mail';
      const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

      let args;
      let cleanup = () => {};
      try {
        const fileInfo = await createComposeFile({ to, subject, body });
        args = ['--compose-from-file', fileInfo.tmpFile];
        cleanup = fileInfo.scheduleCleanup;
      } catch (composeFileError) {
        console.warn('composeMail temp file failed, falling back to mailto syntax', composeFileError);
        args = ['--compose', mailto];
      }

      const child = spawn(target, args, {
        detached: true,
        stdio: 'ignore',
      });
      // G1: Fehlt das Mailprogramm, meldet spawn das asynchron als error-Event.
      // Ohne Listener beendet das den ganzen Prozess. Auf spawn oder error warten
      // und den Fehler als Antwort melden.
      try {
        await new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('spawn', resolve);
        });
      } catch (spawnError) {
        console.error('composeMail spawn failed', spawnError?.code || spawnError?.message || spawnError);
        cleanup();
        return res.status(500).json({ ok: false, error: 'composeMail.spawnFailed' });
      }
      // Spaetere Fehler des Kindprozesses duerfen den Server nie beenden.
      child.on('error', () => {});
      child.unref();
      cleanup();
      res.json({ ok: true });
    } catch (error) {
      console.error('composeMail error', error);
      res.status(500).json({ ok: false, error: 'composeMail.spawnFailed' });
    }
  });
}

// --- Bugreport storage (file-backed) ---
const DATA_DIR = process.env.BUG_DB_DIR || path.join(process.cwd(), 'data');
const BUG_DB_PATH = process.env.BUG_DB_PATH || path.join(DATA_DIR, 'bugreports.json');
const MULTISIG_DB_PATH = process.env.MULTISIG_DB_PATH || path.join(DATA_DIR, 'multisig_jobs.json');
console.log('Bug DB path resolved to:', BUG_DB_PATH);
let bugDb = { lastId: 0, items: [] };
let multisigDb = { items: [] };
async function ensureDbDir() {
  try {
    await fs.mkdir(path.dirname(BUG_DB_PATH), { recursive: true });
  } catch (e) {
    console.error('bugdb.ensureDir.failed', e?.message || e);
  }
}
async function loadBugDb() {
  await ensureDbDir();
  try {
    const txt = await fs.readFile(BUG_DB_PATH, 'utf8');
    const data = JSON.parse(txt);
    if (data && Array.isArray(data.items)) {
      const lastId = Number(data.lastId) || data.items.reduce((m, it) => Math.max(m, Number(it.id) || 0), 0);
      bugDb = { lastId, items: data.items };
    }
  } catch {
    // first run – no file yet
  }
}
async function saveBugDb() {
  try {
    await ensureDbDir();
    await writeJsonFileLocked(BUG_DB_PATH, bugDb);
  } catch (e) {
    console.error('bugdb.save.failed', e?.message || e);
  }
}
async function loadMultisigDb() {
  await ensureDbDir();
  try {
    const txt = await fs.readFile(MULTISIG_DB_PATH, 'utf8');
    const data = JSON.parse(txt);
    if (data && Array.isArray(data.items)) {
      multisigDb = { items: data.items };
    }
  } catch {
    // first run – no file yet
  }
}
// Gibt zurueck, ob gespeichert wurde. Aeltere Aufrufer ignorieren das Ergebnis.
async function saveMultisigDb() {
  try {
    await ensureDbDir();
    // R-7: submittedResult aller Jobs bereinigen (idempotent), damit auch Altjobs envelope_xdr/result_xdr
    // verlieren, sobald die Datei einmal geschrieben wird. Gleich wie saveJobs in api/multisig.php.
    multisigDb.items = multisigDb.items.map(withSanitizedSubmitResult);
    await writeJsonFileLocked(MULTISIG_DB_PATH, multisigDb);
    return true;
  } catch (e) {
    console.error('multisigdb.save.failed', e?.message || e);
    return false;
  }
}

void loadBugDb();
void loadMultisigDb();

const allowedStatus = new Set(['open', 'in_progress', 'closed', 'rejected']);
const allowedPriority = new Set(['low', 'normal', 'high', 'urgent']);
const allowedCategory = new Set(['bug', 'idea', 'improve', 'other']);
const allowedPage = new Set(['start','trustlines','trustlineCompare','balance','xlmByMemo','sendPayment','investedTokens','createAccount','multisigEdit','settings','feedback','other']);
const ADMIN_SECRET = process.env.BUGTRACKER_ADMIN_SECRET || '';
const multisigStatus = new Set(['pending_signatures', 'ready_to_submit', 'submit_unclear', 'submitted_success', 'submitted_failed', 'expired', 'obsolete_seq', 'rejected']);
const multisigFinalStatus = new Set(['submitted_success', 'submitted_failed', 'expired', 'obsolete_seq', 'rejected']);

// Bugtracker admin session auth (finding A2): replaces the client-side secret
// comparison (VITE_BUGTRACKER_ADMIN_SECRET baked into the JS bundle) with a
// real server-side login that sets a session cookie. Same endpoint paths and
// JSON contracts as the PHP variant (api/admin.php) so the frontend needs no
// backend-specific branching.
// G4: Origin und Content-Type werden als Route-Middleware vor dem Handler
// geprueft (services/requestGuard.js), gleich wie in api/admin.php.
app.post('/api/admin/login', requireAllowedOrigin, requireJsonContentType, (req, res) => {
  const provided = sanitizeHeader(String(req.body?.secret || ''));
  if (!ADMIN_SECRET || !timingSafeEqualStrings(provided, ADMIN_SECRET)) {
    return res.status(401).json({ ok: false, error: 'forbidden' });
  }
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ ok: false, error: 'session_failed' });
    req.session.bugtrackerAdmin = true;
    res.json({ ok: true });
  });
});

app.get('/api/admin/check', (req, res) => {
  res.json({ authenticated: !!req.session?.bugtrackerAdmin });
});

// G4: kein Body, darum nur die Origin-Pruefung.
app.post('/api/admin/logout', requireAllowedOrigin, (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

function requireAdminSession(req, res) {
  if (!req.session?.bugtrackerAdmin) {
    res.status(403).json({ ok: false, error: 'bugReport.admin.forbidden' });
    return false;
  }
  return true;
}

app.post('/api/bugreport', async (req, res) => {
  try {
    const { url, userAgent, language, title, subject, description, ts, appVersion, priority, category, page, reportToken, contactEmail, rejectionReason, comment } = req.body || {};
    const nowIso = new Date().toISOString();
    const clamp = (s = '') => String(s || '').slice(0, 5000);
    const emailNorm = typeof contactEmail === 'string' ? contactEmail.trim() : '';
    const emailValid = emailNorm && /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(emailNorm) ? emailNorm : null;
    // N4: a newly-submitted report is always "open", regardless of what the
    // (unauthenticated) reporter's payload claims - otherwise anyone could
    // file a report that's already "closed"/"rejected" and never show up in
    // the admin queue. Status transitions after creation go through the
    // admin-only PATCH route below.
    const normalizedStatus = 'open';
    const normalizedRejectionReason = typeof rejectionReason === 'string' ? clamp(rejectionReason) : null;
    const normalizedComment = typeof comment === 'string' ? clamp(comment).trim() : null;

    // Variant A compatibility: frontend historically sends "subject" (Betreff). Map it to "title".
    const normalizedTitle = typeof title === 'string'
      ? clamp(title).trim()
      : (typeof subject === 'string' ? clamp(subject).trim() : null);

    if (!normalizedTitle) {
      return res.status(400).json({ ok: false, error: 'bugReport.invalidPayload.title' });
    }

    // Backward compatibility: some clients send "rejection_reason" instead of "rejectionReason"
    const rejectionReasonSnake = req.body && typeof req.body.rejection_reason === 'string' ? clamp(req.body.rejection_reason) : null;
    const normalizedRejectionReasonFinal = normalizedRejectionReason ?? rejectionReasonSnake;

    const item = {
      id: ++bugDb.lastId,
      ts: typeof ts === 'string' ? ts : nowIso,
      url: clamp(url),
      userAgent: clamp(userAgent),
      language: clamp(language),
      reportToken: typeof reportToken === 'string' ? clamp(reportToken) : null,
      title: normalizedTitle,
      comment: normalizedComment,
      description: typeof description === 'string' ? clamp(description) : null,
      rejectionReason: normalizedRejectionReasonFinal,
      appVersion: appVersion ? clamp(appVersion) : null,
      status: normalizedStatus,
      priority: allowedPriority.has(priority) ? priority : 'normal',
      category: allowedCategory.has(category) ? category : 'bug',
      page: allowedPage.has(page) ? page : 'other',
      contactEmail: emailValid,
    };
    bugDb.items.unshift(item);
    await saveBugDb();
    res.json({ ok: true, id: item.id });
  } catch (e) {
    console.error('bugreport.post.failed', e?.message || e);
    res.status(500).json({ ok: false, error: 'bugReport.saveFailed' });
  }
});

app.get('/api/bugreport', async (req, res) => {
  try {
    // Listing exposes contact emails/free-text reports - admin-only (was
    // unprotected before the A2 fix, since the admin UI's client-side secret
    // check was the only prior gate).
    if (!requireAdminSession(req, res)) return;

    let { limit = '20', offset = '0', status, priority, category, page, q, sort, dir } = req.query;
    let items = bugDb.items.slice();
    if (status && allowedStatus.has(String(status))) items = items.filter((r) => r.status === status);
    if (priority && allowedPriority.has(String(priority))) items = items.filter((r) => r.priority === priority);
    if (category && allowedCategory.has(String(category))) items = items.filter((r) => r.category === category);
    if (page) {
      const pages = Array.isArray(page) ? page.map(String) : [String(page)];
      const keep = new Set(pages.filter((p) => allowedPage.has(p)));
      if (keep.size > 0) items = items.filter((r) => keep.has(String(r.page || 'other')));
    }
    if (q && String(q).trim()) {
      const needle = String(q).trim().toLowerCase();
      items = items.filter((r) => {
        const desc = String(r.description || '');
        const email = r.contactEmail || '';
        const page = r.page || '';
        const fields = [String(r.id), r.ts, r.url, r.userAgent, r.language, r.title || '', r.category, r.status, r.priority, r.appVersion || '', desc, email, page];
        return fields.some((s) => String(s || '').toLowerCase().includes(needle));
      });
    }
    if (sort) {
      const key = String(sort);
      const asc = String(dir || 'asc').toLowerCase() !== 'desc';
      const getVal = (r) => {
        switch (key) {
          case 'id': return Number(r.id) || 0;
          case 'ts': return r.ts || '';
          case 'url': return r.url || '';
          case 'language': return r.language || '';
          case 'email': return r.contactEmail || '';
          case 'userAgent': return r.userAgent || '';
          case 'description': return r.description || '';
          case 'category': return r.category || '';
          case 'status': return r.status || '';
          case 'priority': return r.priority || '';
          case 'appVersion': return r.appVersion || '';
          case 'page': return r.page || '';
          default: return '';
        }
      };
      items.sort((a, b) => {
        const va = getVal(a);
        const vb = getVal(b);
        let cmp;
        if (key === 'id') cmp = (va) - (vb);
        else if (key === 'ts') cmp = new Date(va).getTime() - new Date(vb).getTime();
        else cmp = String(va).localeCompare(String(vb));
        return asc ? cmp : -cmp;
      });
    }
    const total = items.length;
    const lim = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
    const off = Math.max(0, parseInt(String(offset), 10) || 0);
    const pageItems = items.slice(off, off + lim);
    res.json({ total, items: pageItems });
  } catch (e) {
    console.error('bugreport.list.failed', e?.message || e);
    res.status(500).json({ ok: false, error: 'bugReport.listFailed' });
  }
});

// G4: Origin und Content-Type vor der Admin-Pruefung (services/requestGuard.js).
app.patch('/api/bugreport/:id', requireAllowedOrigin, requireJsonContentType, async (req, res) => {
  try {
    if (!requireAdminSession(req, res)) return;
    const id = parseInt(String(req.params.id), 10);
    const item = bugDb.items.find((r) => r.id === id);
    if (!item) return res.status(404).json({ ok: false, error: 'bugReport.notFound' });
    const { status, priority, contactEmail, rejectionReason, comment } = req.body || {};

    if (allowedStatus.has(status)) item.status = status;
    if (allowedPriority.has(priority)) item.priority = priority;
    if (typeof contactEmail === 'string' || contactEmail === null) item.contactEmail = contactEmail;
    if (typeof rejectionReason === 'string' || rejectionReason === null) item.rejectionReason = rejectionReason;
    if (typeof comment === 'string' || comment === null) item.comment = (typeof comment === 'string' ? comment.trim() : null);

    if (String(item.status) === 'rejected') {
      const reason = String(item.rejectionReason || '').trim();
      if (!reason) {
        return res.status(400).json({ ok: false, error: 'bugReport.rejectionReason.required' });
      }
    }

    await saveBugDb();
    res.json({ ok: true });
  } catch (e) {
    console.error('bugreport.patch.failed', e?.message || e);
    res.status(500).json({ ok: false, error: 'bugReport.saveFailed' });
  }
});

// --- Pending multisig jobs (file-backed, no secrets stored) ---
const { normalizeNetwork } = stellarNetworks;

// Fee-Bump-Transaktionen sind als Multisig-Job nicht vorgesehen (#15): Beim Anlegen und beim Merge
// wird ausdruecklich mit 'fee_bump_not_supported' abgelehnt, nicht nur beilaeufig als ungueltiges
// XDR. Pendant: api/multisig.php (gleicher Code, gleiche Reihenfolge).
const FEE_BUMP_CODE = 'fee_bump_not_supported';

function parseTxAndHash(txXdr, network) {
  let tx;
  try {
    const passphrase = stellarNetworks.passphraseFor(network);
    tx = StellarSdk.TransactionBuilder.fromXDR(txXdr, passphrase);
  } catch (e) {
    const err = new Error(e?.message || 'invalid_xdr');
    err.code = 'invalid_xdr';
    throw err;
  }
  if (tx instanceof StellarSdk.FeeBumpTransaction) {
    const err = new Error(FEE_BUMP_CODE);
    err.code = FEE_BUMP_CODE;
    throw err;
  }
  try {
    // Buffer.from: ab stellar-sdk v17 liefert hash() ein Uint8Array, dessen toString('hex') kein Hex ist.
    const hashHex = Buffer.from(tx.hash()).toString('hex');
    return { tx, hashHex };
  } catch (e) {
    const err = new Error(e?.message || 'invalid_xdr');
    err.code = 'invalid_xdr';
    throw err;
  }
}

// Antwort fuer einen Fehler aus parseTxAndHash: Fee-Bump mit eigenem Code, sonst invalid_xdr.
function parseErrorBody(e) {
  if (e?.code === FEE_BUMP_CODE) return { ok: false, error: FEE_BUMP_CODE };
  return { ok: false, error: 'invalid_xdr', detail: e?.message || 'invalid_xdr' };
}

function newJobId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
}

// Per-job access token (B3): required to view a job's full XDR or merge a signature
// into it. Sent/checked via the x-job-token header, never via the URL, so it never
// ends up in browser history or server access logs.
function newAccessToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hasValidJobToken(job, req) {
  const provided = sanitizeHeader(req.headers['x-job-token'] || '');
  const expected = String(job?.accessToken || '');
  if (!expected || !provided) return false;
  return timingSafeEqualStrings(provided, expected);
}

// R1: Ohne Timeout haelt ein haengendes Horizon den Job-Lock (Ablehnen, Loeschen, Merge)
// und die Anfrage beliebig lange. Nach HORIZON_LOAD_TIMEOUT_MS gilt die Abfrage als
// fehlgeschlagen (horizon_timeout). Die Antwort des SDK danach wird verworfen.
const HORIZON_LOAD_TIMEOUT_MS = Number(process.env.HORIZON_LOAD_TIMEOUT_MS) > 0 ? Number(process.env.HORIZON_LOAD_TIMEOUT_MS) : 10_000;

// B3-1: Speichern scheiterte, nachdem schon an Horizon gesendet wurde (Anlegen, Merge).
const SAVE_FAILED_AFTER_SUBMIT = 'multisig.jobs.save_failed_after_submit';

async function loadAccount(server, accountId) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('horizon_timeout'), { code: 'horizon_timeout' })), HORIZON_LOAD_TIMEOUT_MS);
  });
  const load = server.loadAccount(accountId);
  load.catch(() => {}); // kein unbehandeltes Rejection, falls der Timeout zuerst kommt
  try {
    return await Promise.race([load, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// R2: Horizon antwortet 404 = das Konto gibt es nicht, also ist niemand dessen Signer (403).
// Jeder andere Fehler (Netz, Timeout, 5xx) sagt nichts ueber die Signer: 503 horizon_unavailable.
function isAccountNotFound(err) {
  return err?.response?.status === 404 || err?.name === 'NotFoundError';
}
function sendSignerLookupFailed(res, err) {
  if (isAccountNotFound(err)) return res.status(403).json({ ok: false, error: 'forbidden' });
  return res.status(503).json({ ok: false, error: 'horizon_unavailable' });
}

function extractSignerMeta(account) {
  const signers = Array.isArray(account?.signers) ? account.signers : [];
  const thresholds = account?.thresholds || {};
  return {
    // Mit Signer-Typ aus Horizon (ADR 0012, Plan 8.2 Teilschritt 5): wird im Job gespeichert.
    signers: normalizeHorizonSigners({ signers }),
    thresholds: {
      low: Number(thresholds.low_threshold ?? 0),
      med: Number(thresholds.med_threshold ?? 0),
      high: Number(thresholds.high_threshold ?? 0),
    },
    // G5 stage 1: the account's current live sequence number, used by
    // computeMultisigLifecycleStatus() to detect a job whose baked-in
    // sequence has already been consumed by another transaction.
    sequence: typeof account?.sequenceNumber === 'function' ? account.sequenceNumber() : null,
  };
}

function horizonServerForNet(net) {
  return new StellarSdk.Horizon.Server(stellarNetworks.horizonUrlFor(net));
}

// Node equivalent of api/multisig.php's fetchAccountSignersCached() - a
// persistent process can just hold this in memory (no file-backed cache
// needed, unlike PHP's per-request CGI model). Same TTL rationale: listing
// or merging several jobs of the same account within a short window should
// not each trigger their own Horizon round-trip. G5 stage 1: this is now
// called from the merge route's normal (non-heal) path too, not just when
// job.signers is empty, because the lifecycle check needs the account's live
// sequence number regardless of whether the stored signer snapshot is
// already populated.
const ACCOUNT_META_CACHE_TTL_MS = 30000;
const accountMetaCache = new Map();

async function fetchAccountMetaCached(net, accountId) {
  const key = `${net}:${accountId}`;
  const cached = accountMetaCache.get(key);
  if (cached && (Date.now() - cached.fetchedAt) < ACCOUNT_META_CACHE_TTL_MS) {
    return cached.data;
  }
  let data;
  try {
    const account = await loadAccount(horizonServerForNet(net), accountId);
    data = { ok: true, ...extractSignerMeta(account) };
  } catch (e) {
    // Never cache a failed lookup (same rationale as the PHP version): a
    // transient Horizon hiccup would otherwise be served as "this account
    // has no signers" for the full TTL. notFound wie in api/multisig.php (Horizon 404 = Konto unbekannt).
    return { ok: false, signers: [], thresholds: { low: 0, med: 0, high: 0 }, sequence: null, notFound: isAccountNotFound(e) };
  }
  accountMetaCache.set(key, { data, fetchedAt: Date.now() });
  return data;
}

// Gespeichertes XDR eines Jobs fuer Lesen, Klaerung und Ablehnen. Liest wie parseTx in api/multisig.php auch
// einen Fee-Bump (Altjob von vor #15); Anlegen und Merge nehmen keinen an (parseTxAndHash). Nicht lesbar: null.
function parseJobTx(job) {
  try {
    const passphrase = stellarNetworks.passphraseFor(job.network);
    return StellarSdk.TransactionBuilder.fromXDR(job.txXdrCurrent || job.txXdrOriginal || '', passphrase);
  } catch {
    return null;
  }
}

// Operationen fuer das noetige Gewicht. Ein Fee-Bump zaehlt ohne Operationen (strenges Mindestgewicht
// max(low, med, 1)), wie requiredWeightForOperations in api/txSignatures.php. Das SDK gaebe bei einem
// Fee-Bump sonst die inneren Operationen heraus, PHP nicht.
function jobTxOperations(tx) {
  return tx instanceof StellarSdk.FeeBumpTransaction ? [] : tx.operations;
}

// Lesen eines Jobs (Liste, Detail, Ablehnen, Loeschen): Neuberechnung ohne Speichern, gleich wie
// summarizeJob in api/multisig.php (F-11 / F-8). Offene Jobs mit antwortendem Horizon: Signer,
// Schwellen und requiredWeight live, collected aus verifyCollected gegen diese Signer, Status aus
// Lebenszyklus bzw. Gewicht. Antwortet Horizon nicht, gilt der gespeicherte Stand (Signer, Schwellen,
// requiredWeight), der Status wird daraus berechnet. Endzustaende: keine Abfrage, Status bleibt.
// submit_unclear (F-2): Signer und Gewicht live wie bei offenen Jobs, der Status bleibt; aendern darf
// ihn nur die Klaerung (resolveUnclearJobs). Gespeicherte collectedSigners nur bei nicht lesbarem XDR.
// Dauerhaft aendern nur Anlegen, Merge und die Klaerung (unter saveMultisigDb()).
function recomputeJobState(job, tx, liveMeta, nowUnix) {
  const isFinal = multisigFinalStatus.has(job.status);
  const signers = liveMeta ? (liveMeta.signers || []) : (Array.isArray(job.signers) ? job.signers : []);
  let requiredWeight;
  if (liveMeta && tx) {
    requiredWeight = requiredWeightForOperations(jobTxOperations(tx), liveMeta.thresholds);
  } else if (job.requiredWeight !== undefined && job.requiredWeight !== null) {
    requiredWeight = Number(job.requiredWeight);
  } else {
    requiredWeight = tx ? requiredWeightForOperations(jobTxOperations(tx), job.thresholds || {}) : Number(job.thresholds?.med || 0);
  }
  const collectedSigners = tx ? verifyCollected(tx, signers) : (Array.isArray(job.collectedSigners) ? job.collectedSigners : []);
  const collectedWeight = collectedSigners.reduce((acc, s) => acc + Number(s.weight || 0), 0);
  // ADR 0013: fremde op.source-Konten aus dem XDR (auch fuer Altjobs ohne gespeichertes Feld).
  const foreignOpSources = tx ? foreignOpSourcesOf(tx, job.accountId) : (Array.isArray(job.foreignOpSources) ? job.foreignOpSources : []);
  const out = { ...job, signers, requiredWeight, collectedSigners, collectedWeight, foreignOpSources };
  if (liveMeta) out.thresholds = liveMeta.thresholds;
  if (!isFinal && job.status !== SUBMIT_UNCLEAR_STATUS) {
    // Sequenz von accountId genuegt: K1 erzwingt beim Anlegen und Merge, dass die Tx-Quelle
    // (Basiskonto) gleich accountId ist. Altjobs von vor K1 nehmen keine Signatur mehr an und laufen ab.
    const accountSequence = liveMeta ? liveMeta.sequence : null;
    const lifecycleStatus = tx ? computeMultisigLifecycleStatus(tx, accountSequence, nowUnix) : null;
    out.status = lifecycleStatus || ((requiredWeight > 0 && collectedWeight >= requiredWeight) ? 'ready_to_submit' : 'pending_signatures');
  }
  return out;
}

// Name historisch (G5): berechnet inzwischen den ganzen Lesestand neu, siehe recomputeJobState.
async function annotateJobsLifecycleStatus(items) {
  const nowUnix = Math.floor(Date.now() / 1000);
  const liveKeys = new Set();
  for (const j of items) {
    if (!multisigFinalStatus.has(j.status)) liveKeys.add(`${j.network}::${j.accountId}`);
  }
  const metaByKey = new Map();
  await Promise.all(Array.from(liveKeys).map(async (key) => {
    const sep = key.indexOf('::');
    const net = key.slice(0, sep);
    const accountId = key.slice(sep + 2);
    metaByKey.set(key, await fetchAccountMetaCached(net, accountId));
  }));
  return items.map((j) => {
    const meta = multisigFinalStatus.has(j.status) ? null : metaByKey.get(`${j.network}::${j.accountId}`);
    return recomputeJobState(j, parseJobTx(j), meta && meta.ok ? meta : null, nowUnix);
  });
}

// K1: Signer und Gewichte eines Jobs kommen aus accountId, das Netz prueft die
// Signaturen aber gegen die Quelle der Transaktion. Beide muessen uebereinstimmen.
// Gleicher Wortlaut wie in api/multisig.php.
const ACCOUNT_MISMATCH_BODY = { ok: false, error: 'account_mismatch', detail: 'Transaction source does not match accountId.' };

// F-2: Sende-Timeout wie PHP (curl 20 s). Ohne ihn wartet das SDK bis zu 60 s und haelt so lange den
// Job-Lock. Nach dem Timeout gilt das Ergebnis als unklar (submit_unclear), die Antwort danach wird
// verworfen. Optional per HORIZON_SUBMIT_TIMEOUT_MS (Tests).
const HORIZON_SUBMIT_TIMEOUT_MS = Number(process.env.HORIZON_SUBMIT_TIMEOUT_MS) > 0 ? Number(process.env.HORIZON_SUBMIT_TIMEOUT_MS) : 20_000;

async function submitTx(tx, network) {
  const horizon = horizonServerForNet(network);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('submit_timeout'), { code: 'submit_timeout' })), HORIZON_SUBMIT_TIMEOUT_MS);
  });
  // R-5: ohne SEP-29-Pruefung des SDK, wie PHP. Sonst laedt das SDK vor dem POST die Zielkonten; verlangt eines
  // ein Memo oder scheitert das Laden, wirft es ohne HTTP-Status, und der Job wuerde submit_unclear, obwohl
  // nichts gesendet wurde. SEP-29 ist eine Pruefung fuer Wallets beim Bauen, nicht fuer das Einreichen
  // einer schon von allen Signern bestaetigten Transaktion.
  const submit = horizon.submitTransaction(tx, { skipMemoRequiredCheck: true });
  submit.catch(() => {}); // kein unbehandeltes Rejection, falls der Timeout zuerst kommt
  try {
    return await Promise.race([submit, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Senden eines Jobs mit Einordnung des Ergebnisses (F-2), gleich wie in api/multisig.php:
// Erfolg mit Hash -> submitted_success; keine Antwort, Timeout, 408, 429, >= 500 ohne result_codes
// oder 2xx ohne Hash -> submit_unclear; sonst Ablehnung (submitted_failed, beim Merge tx_bad_seq und
// tx_too_late als obsolete_seq/expired). submittedResult immer im F-3-Format.
async function submitJobTx(tx, network, { mapLifecycleCodes }) {
  let result;
  try {
    result = await submitTx(tx, network);
  } catch (submitErr) {
    if (isUnclearSubmitError(submitErr)) {
      return { status: SUBMIT_UNCLEAR_STATUS, submittedResult: submitErrorResult(submitErr) };
    }
    // G5 stage 1 (nur Merge): a submission that fails specifically because the sequence/timebound
    // died between our pre-merge check and Horizon's authoritative processing must not be reported
    // as a generic submitted_failed - safety net for that TOCTOU gap (the account sequence used
    // there can be up to 30s cached).
    const resultCode = submitErr?.response?.data?.extras?.result_codes?.transaction;
    const mapped = mapLifecycleCodes ? mapSubmitResultCodeToLifecycleStatus(resultCode) : null;
    // F-3: nur Fehlertext und result_codes, nie envelope_xdr/result_xdr (die Liste ist ohne Token lesbar).
    return { status: mapped || 'submitted_failed', submittedResult: submitErrorResult(submitErr) };
  }
  if (isUnclearSubmitSuccess(result)) {
    return { status: SUBMIT_UNCLEAR_STATUS, submittedResult: submitErrorResult(new Error('submit_no_hash')) };
  }
  return { status: 'submitted_success', submittedResult: submitSuccessResult(result) };
}

// R-3: Ergebnis eines Sendens nach dem Write-ahead schreiben (Anlegen, Merge), unter dem Job-Lock des
// Aufrufers. Nur wenn der Job noch submit_unclear ist; hat die Klaerung ihn inzwischen entschieden, bleibt
// das (Ledger-Daten gehen vor). Scheitert das Speichern, bleibt im Speicher wie in der Datei der
// Write-ahead-Stand (submit_unclear): 500 save_failed_after_submit, die Klaerung uebernimmt.
async function applySubmitOutcome(jobId, sent) {
  const current = findMultisigJob(jobId);
  if (!current || current.status !== SUBMIT_UNCLEAR_STATUS) return { job: current };
  const updated = { ...current, status: sent.status, submittedAt: new Date().toISOString(), submittedResult: sent.submittedResult };
  multisigDb.items = multisigDb.items.map((j) => (j.id === jobId ? updated : j));
  if (!(await saveMultisigDb())) {
    multisigDb.items = multisigDb.items.map((j) => (j.id === jobId ? current : j));
    return { error: SAVE_FAILED_AFTER_SUBMIT };
  }
  return { job: updated };
}

// F-2: Abruf GET /transactions/{hash} fuer die Klaerung. 404 = nicht im Ledger, alles andere ohne
// Datensatz (Netz, Timeout, 5xx) = Fehler, der Job bleibt dann unklar. Der Datensatz zaehlt nur zum
// abgefragten Hash (auch als innerer Hash eines Fee-Bumps), siehe transactionLookupFromRecord (ADR 0014).
async function lookupJobTransaction(network, hash) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('horizon_timeout'), { code: 'horizon_timeout' })), HORIZON_LOAD_TIMEOUT_MS);
  });
  const call = horizonServerForNet(network).transactions().transaction(hash).call();
  call.catch(() => {});
  try {
    const rec = await Promise.race([call, timeout]);
    // Das SDK legt das Ledger als ledger_attr ab (ledger wird zur Link-Funktion).
    return transactionLookupFromRecord(rec, hash);
  } catch (err) {
    if (isAccountNotFound(err)) return { kind: 'not_found' };
    return { kind: 'error' };
  } finally {
    clearTimeout(timer);
  }
}

// R-1: Ledger-Zeit von Horizon (GET /, history_latest_ledger_closed_at) als Unix-Sekunden, null bei
// Fehler, Timeout oder fehlendem Feld. Nur nach einem 404 in der Klaerung abgefragt.
async function fetchLedgerClosedAt(network) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('horizon_timeout'), { code: 'horizon_timeout' })), HORIZON_LOAD_TIMEOUT_MS);
  });
  const call = horizonServerForNet(network).root();
  call.catch(() => {});
  try {
    const root = await Promise.race([call, timeout]);
    return parseLedgerClosedAt(root?.history_latest_ledger_closed_at);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// F-2: Klaerung offener submit_unclear-Jobs beim Lesen (Liste, Detail). Nur mit Live-Kontodaten und
// nur, wenn das Ergebnis feststehen kann (Sequence der Tx-Quelle verbraucht oder maxTime laut Serveruhr
// vorbei), hoechstens SUBMIT_UNCLEAR_MAX_RESOLVES_PER_REQUEST Abfragen je Anfrage. Gefunden ist sofort
// endgueltig, ein 404 erst, wenn Horizon einen Ledger mehr als 60 s nach maxTime meldet (R-1, Ledger-Zeit aus GET /,
// einmal je Netz und Anfrage, nur nach einem 404; siehe unclearOutcome). Gespeichert wird
// unter dem Job-Lock und nur, wenn der Job dort noch submit_unclear ist. Scheitert das Speichern,
// bleibt der Job unklar (auch in der Antwort). Gleich wie resolveUnclearJobs in api/multisig.php.
//
// ADR 0014: Dieselbe Klaerung prueft auch Jobs, die ausserhalb von SKM gesendet worden sein koennen: gespeichert
// offen oder in einem Endzustand, den SKM ohne Blick ins Ledger setzt (isExternalCheckCandidate), mit laut
// Live-Daten verbrauchter Sequence. Gemeinsames Budget, Reihenfolge nach compareResolvePriority. Ergebnis aus
// externalOutcome, gespeichert unter dem Job-Lock nur, wenn der Job dort noch denselben Status hat wie beim
// Lesen und noch Kandidat ist. Jede gespeicherte Klaerung (auch submit_unclear) setzt ledgerCheckedAt: Der Job
// ist im Ledger geprueft und wird danach nie wieder abgefragt. Gesendet wird nie.
// ES-11: Konto, dessen Sequence die Job-Transaktion verbraucht, also das Basiskonto der Tx-Quelle. Seit K1 gleich
// accountId; bei Altjobs von vor K1 ein anderes Konto. Gleich wie skm_sequence_account_of in api/multisig.php.
function sequenceAccountOf(job, tx) {
  return (tx && txSourceBaseAccount(tx)) || job.accountId;
}

// Sequence laut Live-Kontodaten verbraucht: true/false, null = unbekannt (Horizon-Fehler, Timeout). Kennt Horizon das
// Konto nicht (404, z. B. nach einem accountMerge), kann die Transaktion nicht mehr ins Ledger, die Sequence gilt als
// verbraucht (ES-4). Gleich wie skm_sequence_consumed_from_meta in api/multisig.php.
function sequenceConsumedFromMeta(tx, meta) {
  if (!meta) return null;
  if (meta.ok) return isSequenceConsumed(tx.sequence, meta.sequence);
  return meta.notFound ? true : null;
}

// ADR 0014: Gespeicherter Job ist Kandidat der Klaerung und seine Sequence laut Live-Daten verbraucht (consumed aus
// sequenceConsumedFromMeta). Unbekannt (null) zaehlt als verbraucht: Im Zweifel nicht loeschen und nicht zum Neuanlegen
// auffordern (ES-8). Fee-Bump-Altjobs (keine eigene Sequence) nie. Gleich wie skm_ledger_check_pending in api/multisig.php.
function isLedgerCheckPending(storedJob, tx, consumed) {
  return isExternalCheckCandidate(storedJob) && !!tx && !(tx instanceof StellarSdk.FeeBumpTransaction)
    && consumed !== false;
}

async function resolveUnclearJobs(items) {
  const nowUnix = Math.floor(Date.now() / 1000);
  const storedById = new Map(multisigDb.items.map((x) => [x.id, x]));
  // R-1: Ledger-Zeit hoechstens einmal je Netz und Anfrage (Promise, damit auch ein Fehler gemerkt bleibt).
  const ledgerClosedAtByNet = new Map();
  const ledgerClosedAt = (net) => {
    if (!ledgerClosedAtByNet.has(net)) ledgerClosedAtByNet.set(net, fetchLedgerClosedAt(net));
    return ledgerClosedAtByNet.get(net);
  };
  const candidates = [];
  items.forEach((j, index) => {
    let readStatus;
    if (j.status === SUBMIT_UNCLEAR_STATUS) {
      readStatus = SUBMIT_UNCLEAR_STATUS;
    } else {
      // Der gespeicherte Status zaehlt, nicht der neu berechnete (ein offener Job zeigt beim Lesen schon obsolete_seq).
      const stored = storedById.get(j.id);
      if (!isExternalCheckCandidate(stored)) return;
      readStatus = stored.status;
    }
    const tx = parseJobTx(j);
    // Fee-Bump (Altjob): keine eigene Sequence und kein Zeitfenster, bleibt wie er ist (wie in api/multisig.php).
    if (!tx || tx instanceof StellarSdk.FeeBumpTransaction) return;
    candidates.push({
      index, job: j, tx, readStatus, unclear: readStatus === SUBMIT_UNCLEAR_STATUS, maxTimeUnix: extractMaxTimeUnix(tx),
      // ES-2: mindestens eine gueltige gesammelte Signatur eines Signers des Job-Kontos (verifyCollected beim Lesen).
      signed: Number(j.collectedWeight || 0) > 0,
    });
  });
  candidates.sort((a, b) => compareResolvePriority(a, b, nowUnix));

  let budget = SUBMIT_UNCLEAR_MAX_RESOLVES_PER_REQUEST;
  const resolved = new Map();
  // ES-8: Kandidaten (nicht submit_unclear) mit verbrauchter oder unbekannter Sequence, die diese Anfrage nicht klaert.
  const pending = new Set();
  for (const c of candidates) {
    const j = c.job;
    // Kontodaten auch nach erschoepftem Budget (gecacht 30 s), damit ledgerCheckPending fuer jeden Kandidaten stimmt.
    // ES-11: Sequence der Tx-Quelle (bei Altjobs von vor K1 nicht accountId).
    const meta = await fetchAccountMetaCached(j.network, sequenceAccountOf(j, c.tx));
    const sequenceConsumed = sequenceConsumedFromMeta(c.tx, meta);
    if (!c.unclear && sequenceConsumed !== false) pending.add(c.index);
    // Horizon-Fehler: diesmal nicht klaeren.
    if (sequenceConsumed === null) continue;
    let outcome;
    if (!c.unclear && !sequenceConsumed) {
      // ES-9: Endzustand mit freier Sequence. Erst nach maxTime plus Marge laut Serveruhr nach der Ledger-Zeit fragen
      // (keine Abfrage der Transaktion, kein Budget); entscheidet die Ledger-Zeit (R-1), bleibt der Status.
      if (!isPastMaxTimeByClock(c.maxTimeUnix, nowUnix) || !externalUnconsumedOutcome(c.readStatus, true)) continue;
      outcome = externalUnconsumedOutcome(c.readStatus, isLedgerPastMaxTime(c.maxTimeUnix, await ledgerClosedAt(j.network)));
    } else {
      if (c.unclear && !isUnclearResolveDue({ sequenceConsumed, maxTimeUnix: c.maxTimeUnix, nowUnix })) continue;
      if (budget <= 0) continue;
      budget -= 1;
      const lookup = await lookupJobTransaction(j.network, j.txHash);
      // Ein 404 ist nur endgueltig, wenn Horizon einen Ledger mehr als 60 s nach maxTime meldet (R-1, nicht die Serveruhr).
      const ledgerPast = lookup.kind === 'not_found' && isLedgerPastMaxTime(c.maxTimeUnix, await ledgerClosedAt(j.network));
      outcome = c.unclear ? unclearOutcome(lookup, sequenceConsumed, ledgerPast) : externalOutcome(lookup, ledgerPast, c.readStatus);
    }
    if (!outcome) continue;
    const saved = await withMultisigJobLock(j.id, async () => {
      const current = findMultisigJob(j.id);
      // Geloescht oder inzwischen geaendert (Merge, Ablehnen, Waechter, Senden): nichts speichern.
      if (!current || current.status !== c.readStatus) return null;
      if (!c.unclear && !isExternalCheckCandidate(current)) return null;
      const at = new Date().toISOString();
      const updated = c.unclear
        ? { ...current, status: outcome.status, resolvedAt: at, ledgerCheckedAt: at, ...(outcome.submittedResult ? { submittedResult: outcome.submittedResult } : {}) }
        : { ...current, ...outcome, ledgerCheckedAt: at };
      multisigDb.items = multisigDb.items.map((x) => (x.id === j.id ? updated : x));
      if (!(await saveMultisigDb())) {
        multisigDb.items = multisigDb.items.map((x) => (x.id === j.id ? current : x));
        return null;
      }
      return updated;
    });
    if (!saved) continue;
    pending.delete(c.index);
    resolved.set(c.index, c.unclear
      ? { ...j, status: saved.status, submittedResult: saved.submittedResult, resolvedAt: saved.resolvedAt, ledgerCheckedAt: saved.ledgerCheckedAt }
      : {
        ...j,
        status: saved.status,
        submittedResult: saved.submittedResult,
        submittedAt: saved.submittedAt,
        submittedExternally: saved.submittedExternally,
        ledgerCheckedAt: saved.ledgerCheckedAt,
      });
  }
  // ES-8: ledgerCheckPending nur in der Antwort, nie gespeichert. Gleich wie api/multisig.php.
  return items.map((j, i) => ({ ...(resolved.get(i) || j), ledgerCheckPending: pending.has(i) }));
}

app.post('/api/multisig/jobs', async (req, res) => {
  // B3-1: wurde schon an Horizon gesendet, bevor das Speichern scheitert, kommt ein eigener
  // Code (die Transaktion kann im Netz sein). Gleicher Code wie PHP.
  let submitAttempted = false;
  try {
    const { network, accountId, txXdr, createdBy } = req.body || {};
    // Nur ein String ist ein Netz: Array, Zahl, Objekt ergeben 400 invalid_network (wie PHP, nie 200/500).
    const net = normalizeNetwork(typeof network === 'string' ? network : null);
    if (!net) return res.status(400).json({ ok: false, error: 'invalid_network' });
    if (typeof accountId !== 'string' || !isClassicAccount(asciiTrim(accountId))) {
      return res.status(400).json({ ok: false, error: 'invalid_account' });
    }
    if (!txXdr || typeof txXdr !== 'string') return res.status(400).json({ ok: false, error: 'invalid_xdr' });
    let parsed;
    try {
      parsed = parseTxAndHash(txXdr, net);
    } catch (e) {
      return res.status(400).json(parseErrorBody(e));
    }
    if (txSourceBaseAccount(parsed.tx) !== asciiTrim(accountId)) {
      return res.status(400).json(ACCOUNT_MISMATCH_BODY);
    }

    // G5 stage 2: reject a timebound longer than the app's own cap before any
    // Horizon work - clientside multisigTimeoutSeconds is clamped to the same
    // value, but that's trivially bypassable via a direct POST.
    const maxTimeUnix = extractMaxTimeUnix(parsed.tx);
    if (!isMultisigTimeboundWithinCap(maxTimeUnix, Math.floor(Date.now() / 1000))) {
      return res.status(400).json({ ok: false, error: 'timebound_too_long', maxAllowedSeconds: MULTISIG_JOB_MAX_TIMEBOUND_SECONDS });
    }

    // F-8: Ohne Signer-Daten kein Job (wie api/multisig.php). Frueher entstand bei einem
    // Horizon-Ausfall ein Job mit leeren Signern und noetigem Gewicht 1.
    const signerMeta = await fetchAccountMetaCached(net, asciiTrim(accountId));
    if (!signerMeta.ok) {
      return signerMeta.notFound
        ? res.status(400).json({ ok: false, error: 'account_not_found' })
        : res.status(503).json({ ok: false, error: 'horizon_unavailable' });
    }
    // ADR 0014 (ES-1): Eine Transaktion mit verbrauchter Sequence oder abgelaufener maxTime kann nie mehr ins Ledger.
    // Kein Job: sonst liesse sich eine alte, schon ausgefuehrte Transaktion eines fremden Kontos als Job anlegen, die
    // Klaerung zeigte sie als "ausserhalb von SKM gesendet" und belegte das Budget. Gleich wie api/multisig.php.
    const deadStatus = computeMultisigLifecycleStatus(parsed.tx, signerMeta.sequence, Math.floor(Date.now() / 1000));
    if (deadStatus) return res.status(409).json({ ok: false, error: 'tx_not_viable', status: deadStatus });
    const requiredWeight = requiredWeightForOperations(parsed.tx.operations, signerMeta.thresholds);
    const signers = signerMeta.signers || [];
    const collectedSigners = signers.length ? verifyCollected(parsed.tx, signers) : [];
    const collectedWeight = collectedSigners.reduce((acc, s) => acc + Number(s.weight || 0), 0);
    const nowIso = new Date().toISOString();
    // ADR 0013: Gewicht und Signer fremder op.source-Konten prueft das Backend nicht. Ein solcher Job
    // wird nie automatisch gesendet, auch wenn das Gewicht des Job-Kontos erreicht ist (sonst tx_bad_auth).
    const foreignOpSources = foreignOpSourcesOf(parsed.tx, asciiTrim(accountId));
    const shouldSubmit = collectedWeight >= requiredWeight && requiredWeight > 0 && foreignOpSources.length === 0;
    const job = {
      id: newJobId(),
      accessToken: newAccessToken(),
      network: net,
      accountId: asciiTrim(accountId),
      txHash: parsed.hashHex,
      txXdrOriginal: txXdr,
      txXdrCurrent: txXdr,
      status: collectedWeight >= requiredWeight && requiredWeight > 0 ? 'ready_to_submit' : 'pending_signatures',
      createdAt: nowIso,
      // G5 stage 1: precomputed once here so the dependency-free
      // expireStalePendingJobs() guard never needs to parse XDR itself.
      maxTimeUnix,
      createdBy: typeof createdBy === 'string' && createdBy.trim() ? createdBy.trim() : 'local',
      signers,
      requiredWeight,
      collectedSigners,
      collectedWeight,
      foreignOpSources,
    };
    // R-3: Erreicht die Signatur schon die Schwelle, sendet das Backend sofort (z. B. Single-Sig). Write-ahead:
    // Der Job wird vorher als submit_unclear gespeichert, erst dann gesendet und das Ergebnis geschrieben.
    // Stirbt der Prozess oder scheitert das Speichern danach, steht er gesperrt da und wird geklaert, nie
    // erneut gesendet. Alles unter dem Job-Lock (gleiche Reihenfolge wie api/multisig.php).
    if (shouldSubmit) {
      job.status = SUBMIT_UNCLEAR_STATUS;
      job.submittedAt = nowIso;
      job.submittedResult = null;
    }
    const outcome = await withMultisigJobLock(job.id, async () => {
      multisigDb.items.unshift(job);
      multisigDb.items = expireStalePendingJobs(multisigDb.items);
      // Beim Speichern fehlgeschlagen nie Erfolg melden (wie PHP, dort wirft saveJobs):
      // saveMultisigDb wirft nicht, sondern gibt false zurueck. Den Job wieder aus dem
      // Speicher nehmen, damit er nicht in der Liste steht, ohne gespeichert zu sein. Vor dem
      // Senden: es wurde nichts gesendet.
      if (!(await saveMultisigDb())) {
        multisigDb.items = multisigDb.items.filter((j) => j.id !== job.id);
        return { error: 'multisig.jobs.save_failed' };
      }
      // F4: respond with the post-guard object, not the pre-guard `job`
      // reference - a dead-on-arrival XDR (already-expired timebound) can be
      // marked 'expired' by the guard call above, and the response must
      // reflect that rather than the stale in-memory object from before it ran.
      const responseJob = multisigDb.items.find((j) => j.id === job.id) || job;
      if (!shouldSubmit) return { job: responseJob };
      submitAttempted = true;
      // Beim Anlegen ohne Abbildung von tx_bad_seq/tx_too_late (wie bisher und wie PHP).
      const sent = await submitJobTx(parsed.tx, net, { mapLifecycleCodes: false });
      return applySubmitOutcome(job.id, sent);
    });
    if (outcome.error) return res.status(500).json({ ok: false, error: outcome.error });
    res.json(withSanitizedSubmitResult(outcome.job));
  } catch (e) {
    console.error('multisig.jobs.post.failed', e);
    res.status(500).json({ ok: false, error: submitAttempted ? SAVE_FAILED_AFTER_SUBMIT : 'multisig.jobs.save_failed' });
  }
});

// R-8: eigenes Rate-Limit fuer die Liste, gleiches Budget und gleiche Antwort wie
// api/multisig.php (60 je Minute und IP); der globale Limiter gilt zusaetzlich.
const jobListLimiter = createJobListLimiter();
app.get('/api/multisig/jobs', jobListLimiter, async (req, res) => {
  try {
    const { network, accountId, status, signer } = req.query;
    // Without a scoping filter this would enumerate every job of every
    // account (accountId/signer/status/createdBy metadata across all users) -
    // the frontend's two legitimate discovery flows ("my own jobs" by
    // accountId, "jobs where I'm a signer" by signer public key) always send
    // one of these, so requiring it here costs no real functionality. Mirrors
    // the identical fix in api/multisig.php (analyse_multisig.md a3);
    // checked before any job data is even read.
    if (!accountId && !signer) {
      return res.status(400).json({ ok: false, error: 'accountId_or_signer_required' });
    }
    let items = multisigDb.items.slice();
    if (network) {
      const net = normalizeNetwork(network);
      if (net) items = items.filter((j) => j.network === net);
    }
    if (accountId) {
      const acc = String(accountId).trim();
      items = items.filter((j) => j.accountId === acc);
    }
    if (signer) {
      const s = String(signer).trim();
      if (s) {
        items = items.filter((j) => Array.isArray(j.signers) && j.signers.some((si) => si.publicKey === s));
      }
    }
    // G5 stage 1: recompute expired/obsolete_seq before the status filter
    // below runs, so ?status=... is evaluated against each job's actual
    // current viability, not a possibly-stale stored status.
    items = await annotateJobsLifecycleStatus(items);
    // F-2: vor dem Statusfilter, damit ?status= den geklaerten Stand sieht.
    items = await resolveUnclearJobs(items);
    if (status && multisigStatus.has(String(status))) {
      items = items.filter((j) => j.status === status);
    }
    // accessToken is never included in the list response (B3-follow-up): anyone
    // who knows a public accountId/signer key could otherwise read every pending
    // job's token straight out of the list, defeating the per-job token check
    // below. Clients fetch the token per job via GET /:id/token instead, which
    // verifies the requester's public key against the account's live signers.
    res.json(items.map(({ txXdrCurrent, txXdrOriginal, accessToken, ...meta }) => withMissingSigners(meta)));
  } catch (e) {
    console.error('multisig.jobs.list.failed', e);
    res.status(500).json({ ok: false, error: 'multisig.jobs.list_failed' });
  }
});

app.get('/api/multisig/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const job = multisigDb.items.find((j) => j.id === id);
    if (!job) return res.status(404).json({ ok: false, error: 'not_found' });
    if (!hasValidJobToken(job, req)) return res.status(403).json({ ok: false, error: 'forbidden' });
    const [annotated] = await annotateJobsLifecycleStatus([job]);
    const [resolved] = await resolveUnclearJobs([annotated]);
    res.json(withMissingSigners(resolved));
  } catch (e) {
    console.error('multisig.jobs.get.failed', e);
    res.status(500).json({ ok: false, error: 'multisig.jobs.get_failed' });
  }
});

// Paritaet mit summarizeJob in api/multisig.php (#16): Signer, die noch signieren koennen und noch
// nicht signiert haben (Gewicht > 0, Typ Ed25519). Nur in der Antwort, nicht gespeichert. Altjobs ohne
// Signer-Typ: Typ aus dem Schluessel (signerTypeOf).
// F-3: bereinigt dabei auch submittedResult von Altjobs (envelope_xdr/result_xdr fallen weg).
function withMissingSigners(job) {
  const collected = new Set((Array.isArray(job?.collectedSigners) ? job.collectedSigners : []).map((s) => s?.publicKey).filter(Boolean));
  const missingSigners = (Array.isArray(job?.signers) ? job.signers : []).filter((s) => (
    s?.publicKey && Number(s.weight || 0) > 0 && !collected.has(s.publicKey) && isInteractiveSigner({ key: s.publicKey, type: s.type })
  ));
  const missingWeight = missingSigners.reduce((acc, s) => acc + Number(s.weight || 0), 0);
  return { ...withSanitizedSubmitResult(job), missingSigners, missingWeight };
}

function findMultisigJob(id) {
  return multisigDb.items.find((j) => j.id === id);
}

// Nur Strings: ein Array mit einem gueltigen Key oder eine Zahl ergibt null (400 invalid_signer),
// wie in api/multisig.php. Vorher machte String(['G...']) daraus einen gueltigen Key (R-1).
function parseSignerPublicKey(raw) {
  if (typeof raw !== 'string') return null;
  const signerPk = sanitizeHeader(raw).trim();
  try {
    StellarSdk.Keypair.fromPublicKey(signerPk);
  } catch {
    return null;
  }
  return signerPk;
}

// Issues a short-lived, single-use nonce for (jobId, signerPublicKey) - the
// first half of the possession proof required by the /token endpoint below
// (H1 fix): naming a public key is not enough, the caller must additionally
// sign this nonce with the matching private key. Eigenes Rate-Limit je IP (C2), gleich
// wie in api/multisig.php; der globale Limiter gilt zusaetzlich.
const challengeLimiter = createChallengeLimiter();
app.post('/api/multisig/jobs/:id/challenge', challengeLimiter, (req, res) => {
  try {
    const { id } = req.params;
    const job = findMultisigJob(id);
    if (!job) return res.status(404).json({ ok: false, error: 'not_found' });

    const signerPk = parseSignerPublicKey(req.body?.signer);
    if (!signerPk) return res.status(400).json({ ok: false, error: 'invalid_signer' });

    const { challenge, expiresAt } = createChallenge(id, signerPk);
    res.json({ challenge, expiresAt });
  } catch (e) {
    console.error('multisig.jobs.challenge.failed', e);
    res.status(500).json({ ok: false, error: 'multisig.jobs.challenge_failed' });
  }
});

// Issues a job's access token to a caller who proves BOTH that they hold the
// private key for the claimed signer public key (a valid signature over
// `skm:token:` plus the nonce from /challenge above, sent back in the body field
// `challenge`; exactly that nonce is checked first and consumed regardless of
// outcome so it can never be replayed) AND - via the account's real, live
// signer list, never the client-supplied job.signers snapshot - that this
// public key is an active signer (weight > 0) of the job's account. This is
// the only way to obtain a job's token now that the list endpoint no longer
// includes it. (H1 fix: merely naming an active signer's public key used to
// be sufficient, even without ever holding its private key.)
app.post('/api/multisig/jobs/:id/token', async (req, res) => {
  try {
    const { id } = req.params;
    const job = findMultisigJob(id);
    if (!job) return res.status(404).json({ ok: false, error: 'not_found' });

    const signerPk = parseSignerPublicKey(req.body?.signer);
    if (!signerPk) return res.status(400).json({ ok: false, error: 'invalid_signer' });
    const signature = typeof req.body?.signature === 'string' ? req.body.signature.trim() : '';
    if (!signature) return res.status(400).json({ ok: false, error: 'missing_signature' });

    // Nur genau die mitgeschickte Nonce dieses Jobs und Signers wird verbraucht, andere offene bleiben.
    const pending = consumeChallenge(id, signerPk, req.body?.challenge);
    if (!pending) return res.status(400).json({ ok: false, error: 'challenge_missing_or_expired' });
    if (!verifyChallengeSignature(pending.nonce, signature, signerPk, 'token')) {
      return res.status(403).json({ ok: false, error: 'invalid_signature' });
    }

    const serverForNet = horizonServerForNet(job.network);
    let signerMeta;
    try {
      const account = await loadAccount(serverForNet, job.accountId);
      signerMeta = extractSignerMeta(account);
    } catch (loadErr) {
      return sendSignerLookupFailed(res, loadErr);
    }
    const isActiveSigner = (signerMeta.signers || []).some(
      (s) => s.publicKey === signerPk && Number(s.weight || 0) > 0
    );
    if (!isActiveSigner) return res.status(403).json({ ok: false, error: 'forbidden' });

    res.json({ accessToken: job.accessToken });
  } catch (e) {
    console.error('multisig.jobs.token.failed', e);
    res.status(500).json({ ok: false, error: 'multisig.jobs.token_failed' });
  }
});

// Ablehnen: Der Signer beweist wie beim Token den Besitz seines Keys (signierte Challenge),
// das Job-Token allein sagt nicht, welcher Signer es ist. Signer und Gewichte kommen live
// aus dem Konto. Reicht das Gewicht der uebrigen Signer nicht mehr, wird der Job abgelehnt
// (rejected, Endzustand). Wer schon signiert hat, kann nicht mehr ablehnen.
app.post('/api/multisig/jobs/:id/decline', (req, res) => withMultisigJobLock(req.params.id, async () => {
  try {
    const { id } = req.params;
    const job = findMultisigJob(id);
    if (!job) return res.status(404).json({ ok: false, error: 'not_found' });

    const signerPk = parseSignerPublicKey(req.body?.signer);
    if (!signerPk) return res.status(400).json({ ok: false, error: 'invalid_signer' });
    const signature = typeof req.body?.signature === 'string' ? req.body.signature.trim() : '';
    if (!signature) return res.status(400).json({ ok: false, error: 'missing_signature' });

    // Nur genau die mitgeschickte Nonce dieses Jobs und Signers wird verbraucht, andere offene bleiben.
    const pending = consumeChallenge(id, signerPk, req.body?.challenge);
    if (!pending) return res.status(400).json({ ok: false, error: 'challenge_missing_or_expired' });
    if (!verifyChallengeSignature(pending.nonce, signature, signerPk, 'decline')) {
      return res.status(403).json({ ok: false, error: 'invalid_signature' });
    }

    let signerMeta;
    try {
      signerMeta = extractSignerMeta(await loadAccount(horizonServerForNet(job.network), job.accountId));
    } catch (loadErr) {
      return sendSignerLookupFailed(res, loadErr);
    }
    const isActiveSigner = (signerMeta.signers || []).some((s) => s.publicKey === signerPk && Number(s.weight || 0) > 0);
    if (!isActiveSigner) return res.status(403).json({ ok: false, error: 'forbidden' });

    const [current] = await annotateJobsLifecycleStatus([job]);
    // F-2: submit_unclear ist nicht final, aber gesperrt (die Transaktion kann im Ledger sein).
    if (multisigFinalStatus.has(current.status) || current.status === SUBMIT_UNCLEAR_STATUS) {
      return res.status(409).json({ ok: false, error: current.status });
    }
    // Aus dem neu berechneten Stand (F-11), wie summarizeJob in PHP: zaehlt auch eine Signatur im XDR,
    // die der gespeicherte Stand nicht kennt (z. B. Job bei Horizon-Ausfall angelegt).
    if ((current.collectedSigners || []).some((c) => c.publicKey === signerPk)) {
      return res.status(409).json({ ok: false, error: 'already_signed' });
    }

    // Noetiges Gewicht aus den aktuellen Thresholds, nicht aus dem Stand beim Anlegen: Wurde
    // ein Threshold inzwischen gesenkt, darf der Job nicht faelschlich abgelehnt werden.
    const tx = parseJobTx(job);
    const requiredWeight = tx
      ? requiredWeightForOperations(jobTxOperations(tx), signerMeta.thresholds)
      : Number(job.requiredWeight || 0);
    const result = applyDecline({ ...job, requiredWeight }, signerPk, signerMeta.signers, new Date().toISOString());
    const updated = { ...job, requiredWeight, declinedSigners: result.declinedSigners, status: result.status };
    multisigDb.items = multisigDb.items.map((j) => (j.id === job.id ? updated : j));
    if (!(await saveMultisigDb())) {
      // Nur diesen Job zuruecksetzen, Aenderungen an anderen Jobs bleiben.
      multisigDb.items = multisigDb.items.map((j) => (j.id === job.id ? job : j));
      return res.status(500).json({ ok: false, error: 'multisig.jobs.decline_failed' });
    }
    res.json({ ok: true, status: result.status, declinedSigners: result.declinedSigners });
  } catch (e) {
    console.error('multisig.jobs.decline.failed', e);
    res.status(500).json({ ok: false, error: 'multisig.jobs.decline_failed' });
  }
}));

// Einzelnen Job loeschen (C1): nur aktuelle Signer des Job-Kontos und nur im Endzustand.
// Der Signer beweist den Besitz seines Keys wie beim Ablehnen per signierter Challenge, hier
// mit eigenem Zweck `delete`; eine token- oder decline-Signatur gilt nicht. Das Job-Token
// reicht nicht: Es hat auch, wer den Job angelegt hat (Anlegen ist offen), und es bleibt
// gueltig, wenn der Signer spaeter aus dem Konto entfernt wird. Signer und Gewicht kommen
// deshalb live aus dem Konto. Ein offener Job wuerde durch Loeschen nicht unwirksam,
// signiertes XDR kann anderswo liegen; dafuer gibt es Ablehnen und Widerruf.
// Gleiche Reihenfolge der Pruefungen wie in api/multisig.php.
app.post('/api/multisig/jobs/:id/delete', (req, res) => withMultisigJobLock(req.params.id, async () => {
  try {
    const { id } = req.params;
    const job = findMultisigJob(id);
    if (!job) return res.status(404).json({ ok: false, error: 'not_found' });

    const signerPk = parseSignerPublicKey(req.body?.signer);
    if (!signerPk) return res.status(400).json({ ok: false, error: 'invalid_signer' });
    const signature = typeof req.body?.signature === 'string' ? req.body.signature.trim() : '';
    if (!signature) return res.status(400).json({ ok: false, error: 'missing_signature' });

    // Nur genau die mitgeschickte Nonce dieses Jobs und Signers wird verbraucht, andere offene bleiben.
    const pending = consumeChallenge(id, signerPk, req.body?.challenge);
    if (!pending) return res.status(400).json({ ok: false, error: 'challenge_missing_or_expired' });
    if (!verifyChallengeSignature(pending.nonce, signature, signerPk, 'delete')) {
      return res.status(403).json({ ok: false, error: 'invalid_signature' });
    }

    let signerMeta;
    try {
      signerMeta = extractSignerMeta(await loadAccount(horizonServerForNet(job.network), job.accountId));
    } catch (loadErr) {
      return sendSignerLookupFailed(res, loadErr);
    }
    const isActiveSigner = (signerMeta.signers || []).some((s) => s.publicKey === signerPk && Number(s.weight || 0) > 0);
    if (!isActiveSigner) return res.status(403).json({ ok: false, error: 'forbidden' });

    const [current] = await annotateJobsLifecycleStatus([job]);
    if (!multisigFinalStatus.has(current.status)) return res.status(409).json({ ok: false, error: 'not_final', status: current.status });
    // ADR 0014 (ES-3): Ein Kandidat mit verbrauchter Sequence kann ausserhalb von SKM gesendet worden sein. Erst nach
    // der Klaerung beim Lesen loeschbar, sonst ginge der Nachweis verloren und der Auftrag wuerde neu angelegt.
    // ES-11: Sequence der Tx-Quelle; seit K1 ist das accountId, dessen Kontodaten schon geladen sind.
    const jobTx = parseJobTx(job);
    const seqAccount = sequenceAccountOf(job, jobTx);
    const seqMeta = seqAccount === job.accountId ? { ok: true, ...signerMeta } : await fetchAccountMetaCached(job.network, seqAccount);
    if (isLedgerCheckPending(job, jobTx, jobTx ? sequenceConsumedFromMeta(jobTx, seqMeta) : false)) {
      return res.status(409).json({ ok: false, error: 'ledger_check_pending', status: current.status });
    }
    multisigDb.items = multisigDb.items.filter((j) => j.id !== id);
    if (!(await saveMultisigDb())) {
      // Nur diesen Job wiederherstellen, Aenderungen an anderen Jobs bleiben.
      if (!multisigDb.items.some((j) => j.id === id)) multisigDb.items = [...multisigDb.items, job];
      return res.status(500).json({ ok: false, error: 'multisig.jobs.delete_failed' });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('multisig.jobs.delete_one.failed', e);
    res.status(500).json({ ok: false, error: 'multisig.jobs.delete_failed' });
  }
}));

app.post('/api/multisig/jobs/:id/merge-signed-xdr', (req, res) => withMultisigJobLock(req.params.id, async () => {
  let submitAttempted = false; // B3-1
  try {
    const { id } = req.params;
    const { signedXdr } = req.body || {};
    const job = multisigDb.items.find((j) => j.id === id);
    if (!job) return res.status(404).json({ ok: false, error: 'not_found' });
    if (!hasValidJobToken(job, req)) return res.status(403).json({ ok: false, error: 'forbidden' });
    if (!signedXdr || typeof signedXdr !== 'string') {
      return res.status(400).json({ ok: false, error: 'invalid_xdr' });
    }
    const net = job.network;
    let incoming;
    try {
      incoming = parseTxAndHash(signedXdr, net);
    } catch (e) {
      return res.status(400).json(parseErrorBody(e));
    }
    if (incoming.hashHex !== job.txHash) {
      return res.status(400).json({ ok: false, error: 'mismatched_hash' });
    }
    // K1: Altjobs von vor dieser Pruefung bleiben gespeichert, nehmen aber keine
    // Signatur mehr an. Damit gibt es fuer sie auch keine automatische Einreichung.
    if (txSourceBaseAccount(incoming.tx) !== job.accountId) {
      return res.status(400).json(ACCOUNT_MISMATCH_BODY);
    }
    const current = parseTxAndHash(job.txXdrCurrent || job.txXdrOriginal, net);

    // Backfill for jobs stored before maxTimeUnix existed (G5 stage 1) -
    // self-healing, mirrors the empty-signers heal further below. Keeps
    // expireStalePendingJobs()'s dependency-free expiry guard accurate for
    // jobs created before this field existed.
    if (job.maxTimeUnix === undefined) {
      job.maxTimeUnix = extractMaxTimeUnix(current.tx);
    }

    // G5 stage 1 / b6-equivalent: a job already in a final state (e.g.
    // submitted_success) never accepts another merge - checked before any
    // Horizon lookup or signature work, both to avoid pointless cost and,
    // critically, so a genuinely successful submission can never be silently
    // overwritten. Without this, a stray signature arriving after success
    // used to fall through to the `else` branch below and incorrectly revert
    // a true submitted_success back to pending_signatures.
    // F-2: submit_unclear ebenso, sonst wuerde ein weiterer Merge erneut senden.
    if (multisigFinalStatus.has(job.status) || job.status === SUBMIT_UNCLEAR_STATUS) {
      return res.status(409).json({ ok: false, error: job.status, job: withSanitizedSubmitResult(job) });
    }

    // Signers/thresholds are always (re-)derived from the real on-chain account
    // state, never trusted from the request body (C2). G5 stage 1: fetched
    // unconditionally now (cached, short TTL) - not just when job.signers is
    // empty - because the lifecycle check below needs the account's live
    // sequence number regardless of whether the stored signer snapshot is
    // already populated.
    const meta = await fetchAccountMetaCached(net, job.accountId);
    // F-9: Antwortet Horizon nicht, wird nichts geaendert und nichts gesendet (wie api/multisig.php).
    // Frueher rechnete Node mit dem gespeicherten Signer-Stand weiter und sendete gegebenenfalls.
    if (!meta.ok) {
      return res.status(502).json({ ok: false, error: 'signers_unavailable' });
    }
    let signers = Array.isArray(job.signers) ? job.signers : [];
    // Fail closed on an empty signer list: filterValidSignatures() below would
    // otherwise wipe every previously collected signature from txXdrCurrent -
    // irrecoverably, since the XDR is their only home. An empty snapshot only
    // ever means the account lookup failed when the job was created (the
    // best-effort fallback in the create route), because an existing account
    // always has at least its master key as a signer.
    if (meta.ok) {
      signers = meta.signers || [];
      job.signers = signers;
      job.requiredWeight = requiredWeightForOperations(current.tx.operations, meta.thresholds);
    }
    if (!signers.length) {
      return res.status(502).json({ ok: false, error: 'signers_unavailable' });
    }

    // G5 stage 1: reject the merge outright if the job's underlying
    // transaction is already dead - its sequence has been consumed by
    // another transaction, or its timebound has passed. Checked before
    // touching any signature state so a doomed merge attempt never gets
    // recorded as if it mattered.
    // Sequenz von accountId genuegt: K1 (oben) erzwingt, dass die Tx-Quelle (Basiskonto) gleich accountId ist.
    const accountSequence = meta.ok ? meta.sequence : null;
    const lifecycleStatus = computeMultisigLifecycleStatus(current.tx, accountSequence, Math.floor(Date.now() / 1000));
    if (lifecycleStatus) {
      const dead = { ...job, status: lifecycleStatus };
      multisigDb.items = multisigDb.items.map((j) => (j.id === job.id ? dead : j));
      await saveMultisigDb();
      return res.status(409).json({ ok: false, error: lifecycleStatus, job: withSanitizedSubmitResult(dead) });
    }

    // signatureKey arbeitet auf rohen Bytes (stellar-sdk v16 und v17). Eine
    // eingehende Signatur, deren Bytes nicht lesbar sind, wird nicht uebernommen;
    // gespeicherte Signaturen stammen aus geprueftem XDR und muessen lesbar sein.
    // Bewusst OHNE try/catch fuer die gespeicherten Signaturen: Wirft signatureKey
    // hier (z. B. falsche Annahme ueber die XDR-Form nach einem SDK-Update), bricht
    // der Merge ab, bevor filterValidSignatures laeuft. Sonst wuerde der Filter
    // alle gespeicherten Signaturen verwerfen und txXdrCurrent unwiderruflich leeren.
    const existingKeys = new Set(current.tx.signatures.map((s) => signatureKey(s)));
    incoming.tx.signatures.forEach((sig) => {
      let key;
      try {
        key = signatureKey(sig);
      } catch {
        return;
      }
      if (!existingKeys.has(key)) {
        current.tx.signatures.push(sig);
        existingKeys.add(key);
      }
    });

    // M1 fix: drop anything that doesn't verify against a real account signer
    // and cap at Stellar's 20-signature protocol limit before persisting -
    // previously every submitted signature was stored verbatim, valid or not.
    // `tx.signatures` has no public setter (stellar-sdk throws "Transaction is
    // immutable" on assignment) - the array itself is mutable in place, so
    // clear it and push the filtered set back rather than reassigning it.
    const validSignatures = filterValidSignatures(current.tx, signers);
    current.tx.signatures.length = 0;
    current.tx.signatures.push(...validSignatures);
    const newXdr = current.tx.toXDR();
    const collected = verifyCollected(current.tx, signers);
    const collectedWeight = collected.reduce((acc, s) => acc + Number(s.weight || 0), 0);
    const requiredWeight = Number(job.requiredWeight || 0);
    const weightReached = requiredWeight > 0 && collectedWeight >= requiredWeight;
    // ADR 0013: mit fremden op.source-Konten nie automatisch senden (Gewicht dieser Konten ungeprueft).
    const foreignOpSources = foreignOpSourcesOf(current.tx, job.accountId);

    const updated = {
      ...job,
      foreignOpSources,
      txXdrCurrent: newXdr,
      collectedSigners: collected,
      collectedWeight,
      declinedSigners: dropDeclinesOfCollected(job.declinedSigners, collected),
    };

    // Auto-submit when threshold reached. R-3: Write-ahead wie beim Anlegen: erst als submit_unclear mit
    // der neuen Signatur speichern, dann senden, dann das Ergebnis schreiben. Scheitert das Speichern
    // davor, wird nicht gesendet (merge_failed).
    if (weightReached && foreignOpSources.length === 0) {
      const pending = { ...updated, status: SUBMIT_UNCLEAR_STATUS, submittedAt: new Date().toISOString(), submittedResult: null };
      multisigDb.items = expireStalePendingJobs(multisigDb.items.map((j) => (j.id === job.id ? pending : j)));
      if (!(await saveMultisigDb())) {
        multisigDb.items = multisigDb.items.map((j) => (j.id === job.id ? job : j));
        return res.status(500).json({ ok: false, error: 'multisig.jobs.merge_failed' });
      }
      submitAttempted = true;
      // tx_bad_seq/tx_too_late werden obsolete_seq/expired, unklar wird submit_unclear (submitJobTx).
      const sent = await submitJobTx(current.tx, net, { mapLifecycleCodes: true });
      const outcome = await applySubmitOutcome(job.id, sent);
      if (outcome.error) return res.status(500).json({ ok: false, error: outcome.error });
      return res.json(withSanitizedSubmitResult(outcome.job));
    } else {
      // Fremde op.source mit erreichtem Gewicht: kein Senden, ready_to_submit (ADR 0013). Sonst
      // pending_signatures. Der Status kommt immer aus dem Gewicht, auch ohne neue Signatur: Ist das
      // Gewicht seit dem Speichern gefallen (Signer oder Threshold geaendert), darf ein gespeichertes
      // ready_to_submit nicht stehen bleiben (FS-3). Gleich wie api/multisig.php.
      updated.status = weightReached ? 'ready_to_submit' : 'pending_signatures';
    }

    multisigDb.items = expireStalePendingJobs(multisigDb.items.map((j) => (j.id === job.id ? updated : j)));
    if (!(await saveMultisigDb())) {
      // Nur diesen Job zuruecksetzen, Aenderungen an anderen Jobs bleiben.
      multisigDb.items = multisigDb.items.map((j) => (j.id === job.id ? job : j));
      return res.status(500).json({ ok: false, error: submitAttempted ? SAVE_FAILED_AFTER_SUBMIT : 'multisig.jobs.merge_failed' });
    }
    res.json(withSanitizedSubmitResult(updated));
  } catch (e) {
    console.error('multisig.jobs.merge.failed', e);
    res.status(500).json({ ok: false, error: submitAttempted ? SAVE_FAILED_AFTER_SUBMIT : 'multisig.jobs.merge_failed' });
  }
}));

app.get('/trustlines', async (req, res) => {
  const { publicKey } = req.query;

  if (!publicKey) {
    return res.status(400).json({ ok: false, error: 'Public key is required' });
  }

  try {
    let account;
    if (publicKey.includes('*')) {
      // Horizon.Server has no resolveFederationAddress() method (never did in
      // recent SDK versions); SEP-2 federation lookups go through the
      // dedicated Federation.Server.resolve() helper instead.
      const resolved = await StellarSdk.Federation.Server.resolve(publicKey);
      if (!resolved || !resolved.account_id) {
        throw new Error('Invalid federation address');
      }
      account = await horizon.accounts().accountId(resolved.account_id).call();
    } else {
      StellarSdk.Keypair.fromPublicKey(publicKey);
      account = await horizon.accounts().accountId(publicKey).call();
    }

    const trustlines = account.balances
      .filter(balance => balance.asset_type !== 'native')
      .map(balance => ({
        assetCode: balance.asset_code || 'Unknown',
        balance: balance.balance,
        creationDate: 'N/A',
      }));

    res.json({ trustlines });
  } catch (error) {
    console.error('Error fetching trustlines:', error.message);
    res.status(500).json({ ok: false, error: 'Failed to fetch trustlines' });
  }
});

// SEP-2 federation via the backend (Backlog P1.2), so the frontend CSP's
// connect-src doesn't have to allow arbitrary domains. type=name: forward
// (name*domain -> account), type=id: reverse lookup with home_domain check
// and forward cross-check - see services/federationService.js. Each lookup
// fans out to up to three outbound requests, hence the own, tighter limit
// on top of the global one. PHP twin: api/federation.php.
const federationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  ipv6Subnet: 64, // wie api/rateLimit.php (Default der Bibliothek waere /56)
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'federation.rateLimited' },
});
// Loop guard (see HOP_HEADER in services/federationService.js): refused
// before it costs rate-limit budget or outbound requests, same as PHP.
async function refuseFederationHop(req, res, next) {
  if (!req.get(FEDERATION_HOP_HEADER)) return next();
  const { status, body } = await handleFederationRequest({}, { incomingHop: true });
  res.status(status).json(body);
}
app.get('/api/federation', refuseFederationHop, federationLimiter, async (req, res) => {
  const { status, body } = await handleFederationRequest(req.query || {}, {
    loadHomeDomain: async (accountId) => {
      const account = await getTradeHorizon(req.query?.network).loadAccount(accountId);
      return account?.home_domain || '';
    },
  });
  res.set('Cache-Control', 'no-store');
  res.status(status).json(body);
});

app.get('/api/trade/assets/search', async (req, res) => {
  const { code, issuer, limit, network } = req.query;
  try {
    const items = await searchAssets({
      assetCode: code,
      issuer,
      limit,
      horizon: getTradeHorizon(network),
    });
    res.json({ items });
  } catch (error) {
    const message = error?.message || 'assetSearch.failed:generic';
    const status = String(message).startsWith('assetSearch.invalidInput') ? 400 : 502;
    res.status(status).json({ ok: false, error: message });
  }
});

app.get('/api/trade/assets/facts', async (req, res) => {
  const { code, issuer, network } = req.query;
  try {
    const facts = await fetchAssetFacts({
      assetCode: code,
      issuer,
      horizon: getTradeHorizon(network),
    });
    res.json(facts);
  } catch (error) {
    const message = error?.message || 'assetFacts.failed:generic';
    const status = String(message).startsWith('assetSearch.invalidInput') ? 400 : 502;
    res.status(status).json({ ok: false, error: message });
  }
});

// Third-party StellarExpert directory hint for the selected asset's issuer.
// Deliberately its own endpoint (not part of /facts): /facts is called once
// per search result, this only once per selected asset - that plus the
// service-level cache keeps us inside the public API's rate limits.
// fetchExpertDirectoryEntry never throws on upstream failure (it degrades to
// status "unavailable"), so an outage there can't block the token display.
app.get('/api/trade/assets/expert', async (req, res) => {
  const { issuer, network } = req.query;
  try {
    const entry = await fetchExpertDirectoryEntry({ issuer, network });
    res.json(entry);
  } catch (error) {
    const message = error?.message || 'assetExpert.failed:generic';
    const status = String(message).startsWith('assetSearch.invalidInput') ? 400 : 502;
    res.status(status).json({ ok: false, error: message });
  }
});

// Proxy for StellarExpert Explorer API (Full-History) to avoid CORS in dev/prod
app.use('/expert', async (req, res) => {
  try {
    const tail = req.originalUrl.replace(/^\/expert/, '/explorer/public');
    const target = `https://api.stellar.expert${tail}`;
    const method = req.method || 'GET';
    const headers = { 'accept': 'application/json' };
    // Forward JSON bodies if present
    let body;
    if (method !== 'GET' && method !== 'HEAD' && req.is('application/json')) {
      body = JSON.stringify(req.body);
      headers['content-type'] = 'application/json';
    }
    const r = await fetch(target, { method, headers, body });
    const outHeaders = {};
    r.headers.forEach((v, k) => {
      if (k.toLowerCase() === 'content-type' || k.toLowerCase() === 'cache-control') outHeaders[k] = v;
    });
    res.status(r.status);
    for (const [k, v] of Object.entries(outHeaders)) res.setHeader(k, v);
    const buf = await r.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (e) {
    console.error('Expert proxy failed:', e?.message || e);
    res.status(502).json({ ok: false, error: 'expert.proxy.failed' });
  }
});

// Inbound-Zuordnung entfernt – nicht mehr erforderlich, da E‑Mail optional direkt mitgesendet wird.

// Webhook-Integration entfernt: Postmark-Inbound wird nicht mehr benötigt.

// G5: Fehler aus Middleware (vor allem express.json bei kaputtem JSON) nie als Stacktrace
// mit Body-Ausschnitt ausgeben, wie Express es ausserhalb von production tut. Kaputtes JSON
// ergibt 400 invalid_json wie in PHP; jeder andere Fehler eine feste 4xx/500-Antwort.
// Weder err.message noch err.body (enthaelt den Request-Inhalt) gelangen in die Antwort.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: 'invalid_json' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: 'payload_too_large' });
  }
  console.error('request.failed', err?.type || err?.name || 'error');
  return res.status(500).json({ ok: false, error: 'server_error' });
});

app.listen(port, () => {
  console.log(`Backend server running at http://localhost:${port}`);
  console.log(`Bug DB file: ${BUG_DB_PATH}`);
  try { fs.access(BUG_DB_PATH).then(()=>console.log('Bug DB file exists')).catch(()=>console.log('Bug DB file will be created on first write')); } catch {}
});
