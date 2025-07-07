const express = require('express');
const bodyParser = require('body-parser');
const StellarSdk = require('@stellar/stellar-sdk');
const cors = require('cors');
const dotenv = require('dotenv');

// .env-Datei laden
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
//const server = new StellarSdk.Horizon.Server('https://horizon.stellar.org');
// Horizon-Server dynamisch aus .env laden
const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon.stellar.org';
const horizonServer = new StellarSdk.Horizon.Server(HORIZON_URL);

console.log(`[INFO] Backend startet mit Horizon URL: ${HORIZON_URL}`);

app.use(cors()); // Enable CORS for all origins (development)
app.use(bodyParser.json());

// Log all incoming requests
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    if (req.method === 'POST') {
        console.log('Request body:', req.body);
    }
    next();
});

app.post('/delete-trustlines', async (req, res) => {
    try {
        const { secretKey, trustlines } = req.body;

        if (!secretKey || !StellarSdk.StrKey.isValidEd25519SecretSeed(secretKey)) {
            console.error('Invalid secret key provided');
            return res.status(400).json({ error: 'Invalid secret key' });
        }

        if (!Array.isArray(trustlines) || trustlines.length === 0) {
            console.error('Invalid or empty trustlines array');
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
                console.error('Invalid trustline:', trustline);
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
        console.log('Transaction successful:', result.hash);
        res.json({ messages: [`Successfully deleted ${trustlines.length} trustlines. Transaction hash: ${result.hash}`] });
    } catch (error) {
        console.error('Error in /delete-trustlines:', error);
        res.status(500).json({ error: error.message || 'Failed to delete trustlines' });
    }
});

app.listen(port, () => {
    console.log(`Backend server running at http://localhost:${port}`);
});
