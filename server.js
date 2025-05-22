const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const rateLimit = require('express-rate-limit');
const StellarSdk = require('@stellar/stellar-sdk');

const app = express();
const port = 3000;
const HORIZON_URL = 'https://horizon.stellar.org';
const horizon = new StellarSdk.Horizon.Server(HORIZON_URL);

app.use(cors({ origin: 'http://localhost:8080' }));
app.use(bodyParser.json());

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
});
app.use(limiter);

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
