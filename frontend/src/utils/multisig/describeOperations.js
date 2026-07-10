// Decodes a stellar-sdk Transaction's operations into human-readable lines
// for the multisig job-detail transparency panel (G5 stage 2 - signers
// previously saw only the raw tx hash, never what they were actually being
// asked to sign). Covers the operation types this app's own multisig flows
// actually build (SendPaymentPage.jsx: createAccount/payment;
// MultisigEditPage.jsx: setOptions) - anything else falls back to a generic
// "unknown operation type" line rather than failing to render.

function formatAsset(asset) {
  if (!asset || asset.isNative?.() || asset.code === 'XLM') return 'XLM';
  return asset.code || 'XLM';
}

function shortKey(pk) {
  const val = String(pk || '');
  if (val.length <= 16) return val;
  return `${val.slice(0, 8)}…${val.slice(-8)}`;
}

/**
 * @param {Array<object>} operations - decoded operations from a stellar-sdk Transaction (tx.operations)
 * @param {(key: string, opts?: object) => string} t - react-i18next translate function, bound to the 'multisig' namespace
 * @returns {string[]} one human-readable line per operation (a single setOptions op can expand to several lines)
 */
export function describeOperations(operations, t) {
  const ops = Array.isArray(operations) ? operations : [];
  const lines = [];
  ops.forEach((op) => {
    switch (op?.type) {
      case 'payment':
        lines.push(t('detail.operations.payment', {
          amount: op.amount,
          asset: formatAsset(op.asset),
          destination: shortKey(op.destination),
          defaultValue: 'Zahlung: {{amount}} {{asset}} an {{destination}}',
        }));
        break;
      case 'createAccount':
        lines.push(t('detail.operations.createAccount', {
          balance: op.startingBalance,
          destination: shortKey(op.destination),
          defaultValue: 'Konto erstellen: {{destination}} mit {{balance}} XLM Startguthaben',
        }));
        break;
      case 'setOptions':
        // stellar-sdk decodes an unset setOptions field as null, not
        // undefined/absent (verified against a real built+parsed
        // Transaction) - a masterWeight/threshold check against undefined
        // alone would otherwise always be true and render "null".
        if (op.masterWeight !== undefined && op.masterWeight !== null) {
          lines.push(t('detail.operations.masterWeight', {
            weight: op.masterWeight,
            defaultValue: 'Master-Gewicht setzen auf {{weight}}',
          }));
        }
        if (op.signer) {
          const signerKey = op.signer.ed25519PublicKey || op.signer.sha256Hash || op.signer.preAuthTx || op.signer.ed25519SignedPayload || '';
          if (Number(op.signer.weight) > 0) {
            lines.push(t('detail.operations.signerAdd', {
              key: shortKey(signerKey),
              weight: op.signer.weight,
              defaultValue: 'Gewicht für Signer {{key}} auf {{weight}} setzen',
            }));
          } else {
            lines.push(t('detail.operations.signerRemove', {
              key: shortKey(signerKey),
              defaultValue: 'Signer {{key}} entfernen',
            }));
          }
        }
        if ([op.lowThreshold, op.medThreshold, op.highThreshold].some((v) => v !== undefined && v !== null)) {
          lines.push(t('detail.operations.thresholds', {
            low: op.lowThreshold ?? '-',
            med: op.medThreshold ?? '-',
            high: op.highThreshold ?? '-',
            defaultValue: 'Schwellenwerte setzen: niedrig={{low}}, mittel={{med}}, hoch={{high}}',
          }));
        }
        if (op.homeDomain !== undefined && op.homeDomain !== null) {
          lines.push(t('detail.operations.homeDomain', {
            domain: op.homeDomain || '-',
            defaultValue: 'Home-Domain setzen auf {{domain}}',
          }));
        }
        break;
      case 'changeTrust':
        lines.push(t('detail.operations.changeTrust', {
          asset: formatAsset(op.line || op.asset),
          limit: op.limit,
          defaultValue: 'Trustline für {{asset}} setzen (Limit: {{limit}})',
        }));
        break;
      case 'accountMerge':
        lines.push(t('detail.operations.accountMerge', {
          destination: shortKey(op.destination),
          defaultValue: 'Konto zusammenführen mit {{destination}}',
        }));
        break;
      default:
        lines.push(t('detail.operations.unknown', {
          type: op?.type || '?',
          defaultValue: 'Unbekannte Operation: {{type}}',
        }));
    }
  });
  return lines;
}

export { shortKey };
