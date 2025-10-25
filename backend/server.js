const express = require('express');
const bodyParser = require('body-parser');
const StellarSdk = require('@stellar/stellar-sdk');
const cors = require('cors');
const dotenv = require('dotenv');
const { spawn } = require('child_process');

// .env-Datei laden
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Horizon-Server dynamisch aus .env laden
const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon.stellar.org';
const horizonServer = new StellarSdk.Horizon.Server(HORIZON_URL);

console.log(`[INFO] Backend startet mit Horizon URL: ${HORIZON_URL}`);

app.use(cors()); // CORS aktivieren (Frontend ↔ Backend)
app.use(bodyParser.json()); // JSON-Body parsen

const composeMailEnabled = process.env.ENABLE_COMPOSE_MAIL !== '0';

if (composeMailEnabled) {
    app.post('/api/composeMail', (req, res) => {
        try {
            const { to, subject = '', body = '' } = req.body || {};
            if (!to || typeof to !== 'string') {
                return res.status(400).json({ error: 'composeMail.invalidRecipient' });
            }
            const target = process.env.COMPOSE_MAIL_BIN || 'claws-mail';
            const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            const child = spawn(target, ['--compose', mailto], {
                detached: true,
                stdio: 'ignore',
            });
            child.unref();
            res.json({ ok: true });
        } catch (error) {
            console.error('composeMail error', error);
            res.status(500).json({ error: 'composeMail.spawnFailed' });
        }
    });
}

// Middleware: logge alle eingehenden Requests
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    if (req.method === 'POST') {
        console.log('Request body:', req.body);
    }
    next();
});

/**
 * GET /trustlines
 * Ruft alle Trustlines eines gegebenen Stellar-Kontos ab
 * Query-Parameter: source (z. B. Public Key)
 */
app.get('/trustlines', async (req, res) => {
    const { source } = req.query;

    if (!source || !StellarSdk.StrKey.isValidEd25519PublicKey(source)) {
        console.error('Ungültiger oder fehlender Public Key');
        return res.status(400).json({ error: 'Invalid source public key' });
    }

    try {
        const account = await horizonServer.loadAccount(source);

        // Filtere alle Nicht-XLM-Assets heraus
        const trustlines = account.balances
            .filter(balance => balance.asset_type !== 'native')
            .map(balance => ({
                assetCode: balance.asset_code,
                assetIssuer: balance.asset_issuer,
                balance: balance.balance
            }));

        res.json({ trustlines });
    } catch (error) {
        console.error('Fehler beim Abrufen der Trustlines:', error);
        res.status(500).json({ error: 'Failed to fetch trustlines' });
    }
});

/**
 * POST /delete-trustlines
 * Entfernt eine Liste von Trustlines für ein gegebenes Konto
 * Body: { secretKey, trustlines: [ { assetCode, assetIssuer } ] }
 */
app.post('/delete-trustlines', async (req, res) => {
    try {
        const { secretKey, trustlines } = req.body;

        if (!secretKey || !StellarSdk.StrKey.isValidEd25519SecretSeed(secretKey)) {
            console.error('Ungültiger Secret Key');
            return res.status(400).json({ error: 'Invalid secret key' });
        }

        if (!Array.isArray(trustlines) || trustlines.length === 0) {
            console.error('Keine Trustlines angegeben');
            return res.status(400).json({ error: 'No trustlines provided' });
        }

        const sourceKeypair = StellarSdk.Keypair.fromSecret(secretKey);
        const sourceAccount = await horizonServer.loadAccount(sourceKeypair.publicKey());

        const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
            fee: StellarSdk.BASE_FEE,
            networkPassphrase: StellarSdk.Networks.PUBLIC
        });

        for (const trustline of trustlines) {
            if (!trustline.assetCode || !trustline.assetIssuer) {
                console.error('Ungültige Trustline:', trustline);
                continue;
            }

            const asset = new StellarSdk.Asset(trustline.assetCode, trustline.assetIssuer);
            transaction.addOperation(StellarSdk.Operation.changeTrust({
                asset,
                limit: '0'
            }));
        }

        const builtTransaction = transaction.setTimeout(30).build();
        builtTransaction.sign(sourceKeypair);

        const result = await horizonServer.submitTransaction(builtTransaction);
        console.log('Transaktion erfolgreich:', result.hash);

        res.json({
            messages: [`Successfully deleted ${trustlines.length} trustlines. Transaction hash: ${result.hash}`]
        });
    } catch (error) {
        console.error('Fehler in /delete-trustlines:', error);
        res.status(500).json({ error: error.message || 'Failed to delete trustlines' });
    }
});

// Starte Backend-Server
app.listen(port, () => {
    console.log(`Backend server running at http://localhost:${port}`);
});
/**
 * GET /trustlines
 * Ruft alle Trustlines (nicht-native Assets) eines Stellar-Kontos ab.
 * Optional wird auch das Erstellungsdatum über ChangeTrust-Operationen ergänzt.
 */
app.get('/trustlines', async (req, res) => {
  const source = req.query.source;

  // 🔒 Eingabevalidierung: Public Key muss vorhanden und gültig sein
  if (!source || !StellarSdk.StrKey.isValidEd25519PublicKey(source)) {
    return res.status(400).json({ error: 'Invalid or missing source public key' });
  }

  try {
    // 🧾 Lade das Stellar-Konto vom Horizon-Server
    const account = await horizonServer.loadAccount(source);

    // 🔍 Filtere nur nicht-native Assets (also keine XLM)
    const balances = account.balances.filter(b => b.asset_type !== 'native');

    // 📜 Hole Operationen (z. B. für "createdAt")
    const operations = await horizonServer
      .operations()
      .forAccount(source)
      .order('desc')
      .limit(200)
      .call();

    // 🎯 Filtere nur change_trust-Operationen dieses Kontos
    const changeTrustOps = operations.records.filter(
      op => op.type === 'change_trust' && op.trustor === source
    );

    // 🛠️ Kombiniere Asset-Informationen mit den Operationen
    const trustlines = balances.map(asset => {
      const match = changeTrustOps.find(
        op => op.asset_code === asset.asset_code && op.asset_issuer === asset.asset_issuer
      );
      return {
        assetCode: asset.asset_code,
        assetIssuer: asset.asset_issuer,
        assetType: asset.asset_type,
        balance: asset.balance,
        limit: asset.limit,
        buyingLiabilities: asset.buying_liabilities,
        sellingLiabilities: asset.selling_liabilities,
        isAuthorized: asset.is_authorized,
        createdAt: match?.created_at || null,
      };
    });

    // ✅ Erfolgreiche Antwort
    res.json(trustlines);
  } catch (err) {
    // 🛑 Fehlerbehandlung
    console.error('Error loading trustlines:', err);
    res.status(500).json({ error: 'Failed to load trustlines' });
  }
});
