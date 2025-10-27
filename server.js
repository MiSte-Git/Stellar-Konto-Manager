const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
const StellarSdk = require('@stellar/stellar-sdk');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');

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

// Allow dev origins (5173, 8080) and same-origin in production
app.use(cors({ origin: true }));
app.use(bodyParser.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
});
app.use(limiter);

// Health check endpoint removed (no longer used). 

const composeMailEnabled = process.env.ENABLE_COMPOSE_MAIL !== '0';
const sanitizeHeader = (value = '') => value.replace(/[\r\n]+/g, ' ').trim();
const normalizeBody = (value = '') => value.replace(/\r\n/g, '\n');

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
        return res.status(400).json({ error: 'composeMail.invalidRecipient' });
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
      res.status(500).json({ error: 'composeMail.spawnFailed' });
    }
  });
}

// --- Bugreport storage (file-backed) ---
const DATA_DIR = process.env.BUG_DB_DIR || path.join(process.cwd(), 'data');
const BUG_DB_PATH = process.env.BUG_DB_PATH || path.join(DATA_DIR, 'bugreports.json');
console.log('Bug DB path resolved to:', BUG_DB_PATH);
let bugDb = { lastId: 0, items: [] };
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
    await fs.writeFile(BUG_DB_PATH, JSON.stringify(bugDb, null, 2), 'utf8');
  } catch (e) {
    console.error('bugdb.save.failed', e?.message || e);
  }
}
void loadBugDb();

const allowedStatus = new Set(['open', 'in_progress', 'closed']);
const allowedPriority = new Set(['low', 'normal', 'high', 'urgent']);
const allowedCategory = new Set(['bug', 'idea', 'improve', 'other']);
const allowedPage = new Set(['start','trustlines','trustlineCompare','balance','xlmByMemo','sendPayment','investedTokens','multisigCreate','multisigEdit','settings','feedback','other']);
const ADMIN_SECRET = process.env.BUGTRACKER_ADMIN_SECRET || '';

app.post('/api/bugreport', async (req, res) => {
  try {
    const { url, userAgent, language, description, ts, appVersion, status, priority, category, page, reportToken, contactEmail } = req.body || {};
    const nowIso = new Date().toISOString();
    const clamp = (s = '') => String(s || '').slice(0, 5000);
    const emailNorm = typeof contactEmail === 'string' ? contactEmail.trim() : '';
    const emailValid = emailNorm && /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(emailNorm) ? emailNorm : null;
    const item = {
      id: ++bugDb.lastId,
      ts: typeof ts === 'string' ? ts : nowIso,
      url: clamp(url),
      userAgent: clamp(userAgent),
      language: clamp(language),
      reportToken: typeof reportToken === 'string' ? clamp(reportToken) : null,
      description: typeof description === 'string' ? clamp(description) : null,
      appVersion: appVersion ? clamp(appVersion) : null,
      status: allowedStatus.has(status) ? status : 'open',
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
    res.status(500).json({ error: 'bugReport.saveFailed' });
  }
});

app.get('/api/bugreport', async (req, res) => {
  try {
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
        const fields = [String(r.id), r.ts, r.url, r.userAgent, r.language, r.category, r.status, r.priority, r.appVersion || '', desc, email, page];
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
    res.status(500).json({ error: 'bugReport.listFailed' });
  }
});

app.patch('/api/bugreport/:id', async (req, res) => {
  try {
    const provided = sanitizeHeader(req.headers['x-admin-secret'] || '');
    if (ADMIN_SECRET && provided !== ADMIN_SECRET) {
      return res.status(403).json({ error: 'bugReport.admin.forbidden' });
    }
    const id = parseInt(String(req.params.id), 10);
    const item = bugDb.items.find((r) => r.id === id);
    if (!item) return res.status(404).json({ error: 'bugReport.notFound' });
    const { status, priority, contactEmail } = req.body || {};
    if (allowedStatus.has(status)) item.status = status;
    if (allowedPriority.has(priority)) item.priority = priority;
    if (typeof contactEmail === 'string' || contactEmail === null) item.contactEmail = contactEmail;
    await saveBugDb();
    res.json({ ok: true });
  } catch (e) {
    console.error('bugreport.patch.failed', e?.message || e);
    res.status(500).json({ error: 'bugReport.saveFailed' });
  }
});

app.get('/trustlines', async (req, res) => {
  const { publicKey } = req.query;

  if (!publicKey) {
    return res.status(400).json({ error: 'Public key is required' });
  }

  try {
    let account;
    if (publicKey.includes('*')) {
      const resolved = await horizon.resolveFederationAddress(publicKey);
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
    res.status(500).json({ error: 'Failed to fetch trustlines' });
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
    res.status(502).json({ error: 'expert.proxy.failed' });
  }
});

app.post('/delete-trustlines', async (req, res) => {
  const { publicKey, secretKey } = req.body;

  if (!publicKey || !secretKey) {
    return res.status(400).json({ error: 'Public key and secret key are required' });
  }

  try {
    const sourceKeypair = StellarSdk.Keypair.fromSecret(secretKey);
    if (sourceKeypair.publicKey() !== publicKey) {
      throw new Error('Secret key does not match public key');
    }

    const account = await horizon.accounts().accountId(publicKey).call();
    const trustlines = account.balances.filter(balance => balance.asset_type !== 'native');

    if (trustlines.length === 0) {
      return res.json({ message: 'No trustlines to delete' });
    }

    let transaction = new StellarSdk.TransactionBuilder(new StellarSdk.Account(publicKey, account.sequence), {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.PUBLIC,
    });

    for (const trustline of trustlines) {
      transaction = transaction.addOperation(
        StellarSdk.Operation.changeTrust({
          asset: new StellarSdk.Asset(trustline.asset_code, trustline.asset_issuer),
          limit: '0',
        })
      );
    }

    transaction = transaction.setTimeout(30).build();
    transaction.sign(sourceKeypair);

    const result = await horizon.submitTransaction(transaction);
    res.json({ message: 'Trustlines deleted successfully', transactionHash: result.hash });
  } catch (error) {
    console.error('Error deleting trustlines:', error.message);
    res.status(500).json({ error: 'Failed to delete trustlines' });
  }
});

// Inbound-Zuordnung entfernt – nicht mehr erforderlich, da E‑Mail optional direkt mitgesendet wird.

// Webhook-Integration entfernt: Postmark-Inbound wird nicht mehr benötigt.

app.listen(port, () => {
  console.log(`Backend server running at http://localhost:${port}`);
  console.log(`Bug DB file: ${BUG_DB_PATH}`);
  try { fs.access(BUG_DB_PATH).then(()=>console.log('Bug DB file exists')).catch(()=>console.log('Bug DB file will be created on first write')); } catch {}
});
