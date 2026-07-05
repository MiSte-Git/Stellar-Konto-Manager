const express = require('express');
const cors = require('cors');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const StellarSdk = require('@stellar/stellar-sdk');
const { WebAuth } = require('@stellar/stellar-sdk');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const crypto = require('crypto');
const { searchAssets, fetchAssetFacts } = require('./services/tradeService.js');
const { createCorsMiddleware } = require('./services/corsConfig.js');
const { writeJsonFileLocked } = require('./services/jsonFileStore.js');

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
const HORIZON_URL = 'https://horizon.stellar.org';
const horizon = new StellarSdk.Horizon.Server(HORIZON_URL);

function getTradeHorizon(network = 'PUBLIC') {
  return String(network || '').toUpperCase() === 'TESTNET'
    ? new StellarSdk.Horizon.Server('https://horizon-testnet.stellar.org')
    : horizon;
}

// Allow dev origins (5173, 8080) and same-origin in production
app.use(cors({ origin: true }));
app.use(express.json()); // built into Express 4.16+ (finding #16), no separate body-parser dependency needed

// Explicit CORS headers for routes restricted to known dev/prod origins
// (was previously a wildcard '*' — finding B3). Origin allowlist + middleware
// factory live in services/corsConfig.js (finding #9) so it's a single
// source of truth shared with no duplicated per-route logic.
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
async function saveMultisigDb() {
  try {
    await ensureDbDir();
    await writeJsonFileLocked(MULTISIG_DB_PATH, multisigDb);
  } catch (e) {
    console.error('multisigdb.save.failed', e?.message || e);
  }
}
void loadBugDb();
void loadMultisigDb();

const allowedStatus = new Set(['open', 'in_progress', 'closed', 'rejected']);
const allowedPriority = new Set(['low', 'normal', 'high', 'urgent']);
const allowedCategory = new Set(['bug', 'idea', 'improve', 'other']);
const allowedPage = new Set(['start','trustlines','trustlineCompare','balance','xlmByMemo','sendPayment','investedTokens','createAccount','multisigEdit','settings','feedback','other']);
const ADMIN_SECRET = process.env.BUGTRACKER_ADMIN_SECRET || '';
const multisigStatus = new Set(['pending_signatures', 'ready_to_submit', 'submitted_success', 'submitted_failed', 'expired', 'obsolete_seq']);

// Bugtracker admin session auth (finding A2): replaces the client-side secret
// comparison (VITE_BUGTRACKER_ADMIN_SECRET baked into the JS bundle) with a
// real server-side login that sets a session cookie. Same endpoint paths and
// JSON contracts as the PHP variant (api/admin.php) so the frontend needs no
// backend-specific branching.
app.post('/api/admin/login', (req, res) => {
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

app.post('/api/admin/logout', (req, res) => {
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
    const { url, userAgent, language, title, subject, description, ts, appVersion, status, priority, category, page, reportToken, contactEmail, rejectionReason, comment } = req.body || {};
    const nowIso = new Date().toISOString();
    const clamp = (s = '') => String(s || '').slice(0, 5000);
    const emailNorm = typeof contactEmail === 'string' ? contactEmail.trim() : '';
    const emailValid = emailNorm && /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(emailNorm) ? emailNorm : null;
    const normalizedStatus = allowedStatus.has(String(status)) ? String(status) : 'open';
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

    if (normalizedStatus === 'rejected') {
      const reason = String(normalizedRejectionReasonFinal || '').trim();
      if (!reason) {
        return res.status(400).json({ ok: false, error: 'bugReport.rejectionReason.required' });
      }
    }

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

app.patch('/api/bugreport/:id', async (req, res) => {
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
function normalizeNetwork(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'public' || v === 'publicnet') return 'public';
  if (v === 'testnet' || v === 'test') return 'testnet';
  return null;
}

function parseTxAndHash(txXdr, network) {
  try {
    const passphrase = network === 'public' ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET;
    const tx = new StellarSdk.Transaction(txXdr, passphrase);
    const hashHex = tx.hash().toString('hex');
    return { tx, hashHex };
  } catch (e) {
    const msg = e?.message || 'invalid_xdr';
    const err = new Error(msg);
    err.code = 'invalid_xdr';
    throw err;
  }
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

async function loadAccount(server, accountId) {
  return server.loadAccount(accountId);
}

function extractSignerMeta(account) {
  const signers = Array.isArray(account?.signers) ? account.signers : [];
  const thresholds = account?.thresholds || {};
  return {
    signers: signers
      .map((s) => ({
        publicKey: s.key || s.public_key || s.ed25519PublicKey || '',
        weight: Number(s.weight || 0),
      }))
      .filter((s) => s.publicKey),
    thresholds: {
      low: Number(thresholds.low_threshold ?? 0),
      med: Number(thresholds.med_threshold ?? 0),
      high: Number(thresholds.high_threshold ?? 0),
    },
  };
}

function requiredWeightForPayment(thresholds) {
  return Number(thresholds?.med || 0) || 0;
}

function collectSignersForTx(tx, signers = []) {
  const collected = [];
  for (const s of signers) {
    try {
      if (WebAuth.verifyTxSignedBy(tx, s.publicKey)) {
        collected.push({ publicKey: s.publicKey, weight: Number(s.weight || 0) });
      }
    } catch {}
  }
  return collected;
}

async function submitTx(tx, network) {
  const horizon = network === 'public'
    ? new StellarSdk.Horizon.Server('https://horizon.stellar.org')
    : new StellarSdk.Horizon.Server('https://horizon-testnet.stellar.org');
  const res = await horizon.submitTransaction(tx);
  return res;
}

app.post('/api/multisig/jobs', async (req, res) => {
  try {
    const { network, accountId, txXdr, createdBy } = req.body || {};
    const net = normalizeNetwork(network);
    if (!net) return res.status(400).json({ ok: false, error: 'invalid_network' });
    if (!accountId || typeof accountId !== 'string') return res.status(400).json({ ok: false, error: 'invalid_account' });
    if (!txXdr || typeof txXdr !== 'string') return res.status(400).json({ ok: false, error: 'invalid_xdr' });
    let parsed;
    try {
      parsed = parseTxAndHash(txXdr, net);
    } catch (e) {
      return res.status(400).json({ ok: false, error: 'invalid_xdr', detail: e?.message || 'invalid_xdr' });
    }
    let account = null;
    let signerMeta = { signers: [], thresholds: { low: 0, med: 0, high: 0 } };
    try {
      const serverForNet = net === 'public'
        ? new StellarSdk.Horizon.Server('https://horizon.stellar.org')
        : new StellarSdk.Horizon.Server('https://horizon-testnet.stellar.org');
      account = await loadAccount(serverForNet, accountId.trim());
      signerMeta = extractSignerMeta(account);
    } catch (e) {
      // Best-effort fallback: allow job creation even if account lookup fails (no blocking)
      console.warn('multisig.jobs.account_load_failed', e?.message || e);
    }
    const requiredWeight = requiredWeightForPayment(signerMeta.thresholds);
    const signers = signerMeta.signers || [];
    const collectedSigners = signers.length ? collectSignersForTx(parsed.tx, signers) : [];
    const collectedWeight = collectedSigners.reduce((acc, s) => acc + Number(s.weight || 0), 0);
    const nowIso = new Date().toISOString();
    const shouldSubmit = collectedWeight >= requiredWeight && requiredWeight > 0;
    const job = {
      id: newJobId(),
      accessToken: newAccessToken(),
      network: net,
      accountId: accountId.trim(),
      txHash: parsed.hashHex,
      txXdrOriginal: txXdr,
      txXdrCurrent: txXdr,
      status: shouldSubmit ? 'ready_to_submit' : 'pending_signatures',
      createdAt: nowIso,
      createdBy: typeof createdBy === 'string' && createdBy.trim() ? createdBy.trim() : 'local',
      signers,
      requiredWeight,
      collectedSigners,
      collectedWeight,
    };
    // Auto submit if threshold already met (e.g., single-sig)
    if (shouldSubmit) {
      try {
        const result = await submitTx(parsed.tx, net);
        job.status = 'submitted_success';
        job.submittedAt = new Date().toISOString();
        job.submittedResult = { hash: result?.hash || result?.id || null };
      } catch (submitErr) {
        job.status = 'submitted_failed';
        job.submittedAt = new Date().toISOString();
        job.submittedResult = { error: submitErr?.response?.data || submitErr?.message || 'submit_failed' };
      }
    }
    multisigDb.items.unshift(job);
    try {
      await saveMultisigDb();
    } catch (saveErr) {
      console.warn('multisig.jobs.save_failed', saveErr?.message || saveErr);
      // continue; even if persistence fails, return job to caller
    }
    res.json(job);
  } catch (e) {
    console.error('multisig.jobs.post.failed', e);
    res.status(500).json({ ok: false, error: 'multisig.jobs.save_failed' });
  }
});

app.get('/api/multisig/jobs', async (req, res) => {
  try {
    const { network, accountId, status, signer } = req.query;
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
    if (status && multisigStatus.has(String(status))) {
      items = items.filter((j) => j.status === status);
    }
    // accessToken is never included in the list response (B3-follow-up): anyone
    // who knows a public accountId/signer key could otherwise read every pending
    // job's token straight out of the list, defeating the per-job token check
    // below. Clients fetch the token per job via GET /:id/token instead, which
    // verifies the requester's public key against the account's live signers.
    res.json(items.map(({ txXdrCurrent, txXdrOriginal, accessToken, ...meta }) => meta));
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
    res.json(job);
  } catch (e) {
    console.error('multisig.jobs.get.failed', e);
    res.status(500).json({ ok: false, error: 'multisig.jobs.get_failed' });
  }
});

// Issues a job's access token to a caller who proves - via the account's real,
// live signer list (never the client-supplied job.signers snapshot) - that the
// claimed public key is an active signer (weight > 0) of the job's account.
// This is the only way to obtain a job's token now that the list endpoint no
// longer includes it.
app.get('/api/multisig/jobs/:id/token', async (req, res) => {
  try {
    const { id } = req.params;
    const job = multisigDb.items.find((j) => j.id === id);
    if (!job) return res.status(404).json({ ok: false, error: 'not_found' });

    const signerPk = sanitizeHeader(String(req.query.signer || '')).trim();
    try {
      StellarSdk.Keypair.fromPublicKey(signerPk);
    } catch {
      return res.status(400).json({ ok: false, error: 'invalid_signer' });
    }

    const serverForNet = job.network === 'public'
      ? new StellarSdk.Horizon.Server('https://horizon.stellar.org')
      : new StellarSdk.Horizon.Server('https://horizon-testnet.stellar.org');
    let signerMeta;
    try {
      const account = await loadAccount(serverForNet, job.accountId);
      signerMeta = extractSignerMeta(account);
    } catch {
      return res.status(403).json({ ok: false, error: 'forbidden' });
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

app.post('/api/multisig/jobs/:id/merge-signed-xdr', async (req, res) => {
  try {
    const { id } = req.params;
    const { signedXdr } = req.body || {};
    const job = multisigDb.items.find((j) => j.id === id);
    if (!job) return res.status(404).json({ ok: false, error: 'not_found' });
    if (!hasValidJobToken(job, req)) return res.status(403).json({ ok: false, error: 'forbidden' });
    if (!signedXdr || typeof signedXdr !== 'string') {
      return res.status(400).json({ ok: false, error: 'invalid_xdr' });
    }
    const net = job.network === 'public' ? 'public' : 'testnet';
    let incoming;
    try {
      incoming = parseTxAndHash(signedXdr, net);
    } catch (e) {
      return res.status(400).json({ ok: false, error: 'invalid_xdr', detail: e?.message || 'invalid_xdr' });
    }
    if (incoming.hashHex !== job.txHash) {
      return res.status(400).json({ ok: false, error: 'mismatched_hash' });
    }
    const current = parseTxAndHash(job.txXdrCurrent || job.txXdrOriginal, net);

    const existingKeys = new Set(
      current.tx.signatures.map((s) => `${s.hint().toString('base64')}:${s.signature().toString('base64')}`)
    );
    let added = 0;
    incoming.tx.signatures.forEach((sig) => {
      const key = `${sig.hint().toString('base64')}:${sig.signature().toString('base64')}`;
      if (!existingKeys.has(key)) {
        current.tx.signatures.push(sig);
        existingKeys.add(key);
        added += 1;
      }
    });

    const newXdr = current.tx.toXDR();
    const signers = Array.isArray(job.signers) ? job.signers : [];
    const collected = collectSignersForTx(current.tx, signers);
    const collectedWeight = collected.reduce((acc, s) => acc + Number(s.weight || 0), 0);
    const requiredWeight = Number(job.requiredWeight || 0);

    const updated = {
      ...job,
      txXdrCurrent: newXdr,
      collectedSigners: collected,
      collectedWeight,
    };

    // Auto-submit when threshold reached and not already submitted
    if (requiredWeight > 0 && collectedWeight >= requiredWeight && job.status !== 'submitted_success') {
      try {
        const result = await submitTx(current.tx, net);
        updated.status = 'submitted_success';
        updated.submittedAt = new Date().toISOString();
        updated.submittedResult = { hash: result?.hash || result?.id || null };
      } catch (submitErr) {
        updated.status = 'submitted_failed';
        updated.submittedAt = new Date().toISOString();
        updated.submittedResult = { error: submitErr?.response?.data || submitErr?.message || 'submit_failed' };
      }
    } else if (added === 0) {
      // No new signature added, keep status
      updated.status = job.status;
    } else {
      updated.status = 'pending_signatures';
    }

    multisigDb.items = multisigDb.items.map((j) => (j.id === job.id ? updated : j));
    await saveMultisigDb();
    res.json(updated);
  } catch (e) {
    console.error('multisig.jobs.merge.failed', e);
    res.status(500).json({ ok: false, error: 'multisig.jobs.merge_failed' });
  }
});

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

app.listen(port, () => {
  console.log(`Backend server running at http://localhost:${port}`);
  console.log(`Bug DB file: ${BUG_DB_PATH}`);
  try { fs.access(BUG_DB_PATH).then(()=>console.log('Bug DB file exists')).catch(()=>console.log('Bug DB file will be created on first write')); } catch {}
});
