const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
const StellarSdk = require('@stellar/stellar-sdk');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs/promises');

const app = express();
const port = 3000;
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

app.listen(port, () => {
  console.log(`Backend server running at http://localhost:${port}`);
});
