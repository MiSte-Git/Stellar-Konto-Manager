// Decodes a stellar-sdk Transaction's operations into human-readable lines
// for the multisig job-detail transparency panel (G5 stage 2 - signers
// previously saw only the raw tx hash, never what they were actually being
// asked to sign). Covers the operation types this app's own multisig flows
// actually build (SendPaymentPage: createAccount/payment; MultisigEditPage:
// setOptions; ListTrustlines: changeTrust; Claimable Balances und Batch-Convert:
// claimClaimableBalance/pathPaymentStrictSend; Widerruf: bumpSequence; Liquidity
// Pools: liquidityPoolDeposit/liquidityPoolWithdraw). Anything
// else falls back to a generic "unknown operation type" line, and
// findOperationWarnings() flags it so the signer must confirm explicitly.
import { formatPriceDecimal } from '../../components/liquidity/formatPoolAmount.js';

// Nur das echte native Asset heisst XLM. Ein Token mit dem Code XLM wird mit Herausgeber
// angezeigt, damit es in der Job-Ansicht nicht wie natives XLM aussieht.
// Pool-Share-Assets (LiquidityPoolAsset) haben keinen code und wuerden sonst
// unten als XLM erscheinen; sie werden als "Pool A/B" mit beiden Assets angezeigt.
function formatAsset(asset) {
  if (!asset) return 'XLM';
  if (isPoolShareAsset(asset)) return `Pool ${formatAsset(asset.assetA)}/${formatAsset(asset.assetB)}`;
  if (typeof asset.isNative === 'function' ? asset.isNative() : asset.code === 'native') return 'XLM';
  if (!asset.code) return 'XLM';
  return asset.issuer ? `${asset.code} (${shortKey(asset.issuer)})` : asset.code;
}

function isPoolShareAsset(asset) {
  if (typeof asset.getAssetType === 'function') return asset.getAssetType() === 'liquidity_pool_shares';
  return !!(asset.assetA && asset.assetB);
}

function formatPath(path) {
  const list = Array.isArray(path) ? path : [];
  return list.length ? list.map(formatAsset).join(' → ') : '-';
}

// Operationstypen, die describeOperations im Klartext beschreibt.
export const DESCRIBED_OPERATION_TYPES = new Set([
  'payment', 'createAccount', 'setOptions', 'changeTrust', 'accountMerge',
  'claimClaimableBalance', 'pathPaymentStrictSend', 'pathPaymentStrictReceive', 'bumpSequence',
  'liquidityPoolDeposit', 'liquidityPoolWithdraw',
]);

/**
 * Hinweise fuer Signer, bevor sie einen Job signieren.
 * unknownTypes: Operationen, die SKM nicht im Klartext zeigen kann.
 * pathPaymentToOther: ein Tausch, dessen Erloes an ein anderes Konto als das Quellkonto geht.
 * @param {Array<object>} operations
 * @param {string} sourceAccountId - G-Adresse des Quellkontos der Transaktion
 */
export function findOperationWarnings(operations, sourceAccountId) {
  const ops = Array.isArray(operations) ? operations : [];
  const unknownTypes = [...new Set(ops.map((op) => op?.type || '?').filter((type) => !DESCRIBED_OPERATION_TYPES.has(type)))];
  const pathPaymentToOther = ops.some((op) => (
    (op?.type === 'pathPaymentStrictSend' || op?.type === 'pathPaymentStrictReceive')
    && op.destination !== sourceAccountId
  ));
  return { unknownTypes, pathPaymentToOther };
}

function shortKey(pk) {
  const val = String(pk || '');
  if (val.length <= 16) return val;
  return `${val.slice(0, 8)}…${val.slice(-8)}`;
}

/**
 * @param {Array<object>} operations - decoded operations from a stellar-sdk Transaction (tx.operations)
 * @param {(key: string, opts?: object) => string} t - react-i18next translate function, bound to the 'multisig' namespace
 * @param {string} [sourceAccountId] - Quellkonto, damit Tauschzahlungen an das eigene Konto als solche erkennbar sind
 * @param {{ poolInfo?: Record<string, { assetA: object, assetB: object }>, locale?: string }} [options]
 *   poolInfo: bekannte Pool-Assets je Pool-ID (kanonisch A/B). Ist poolInfo gesetzt, fehlt
 *   aber ein Pool, wird die Zeile mit Asset A/B und einem Hinweis beschrieben; ohne poolInfo
 *   (z. B. waehrend des Ladens) ohne Hinweis.
 * @returns {string[]} one human-readable line per operation (a single setOptions op can expand to several lines)
 */
export function describeOperations(operations, t, sourceAccountId = '', options = {}) {
  const { poolInfo, locale } = options || {};
  const poolAssets = (id) => (poolInfo && poolInfo[id] ? poolInfo[id] : null);
  const unknownPoolHint = (id) => (poolInfo && !poolInfo[id]
    ? ` ${t('detail.operations.liquidityPoolAssetsUnknown', { defaultValue: '(Pool-Assets konnten nicht geladen werden)' })}`
    : '');
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
            defaultValue: 'Thresholds setzen: niedrig={{low}}, mittel={{med}}, hoch={{high}}',
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
        if (Number(op.limit) === 0) {
          lines.push(t('detail.operations.changeTrustRemove', {
            asset: formatAsset(op.line || op.asset),
            defaultValue: 'Trustline für {{asset}} entfernen',
          }));
          break;
        }
        lines.push(t('detail.operations.changeTrust', {
          asset: formatAsset(op.line || op.asset),
          limit: op.limit,
          defaultValue: 'Trustline für {{asset}} setzen (Limit: {{limit}})',
        }));
        break;
      case 'claimClaimableBalance':
        lines.push(t('detail.operations.claimClaimableBalance', {
          id: shortKey(op.balanceId),
          defaultValue: 'Claimable Balance einlösen: {{id}}',
        }));
        break;
      case 'pathPaymentStrictSend':
        lines.push(t('detail.operations.pathPaymentStrictSend', {
          sendAmount: op.sendAmount,
          sendAsset: formatAsset(op.sendAsset),
          destMin: op.destMin,
          destAsset: formatAsset(op.destAsset),
          destination: op.destination === sourceAccountId ? t('detail.operations.ownAccount', { defaultValue: 'das eigene Konto' }) : shortKey(op.destination),
          path: formatPath(op.path),
          defaultValue: 'Tausch: {{sendAmount}} {{sendAsset}} gegen mindestens {{destMin}} {{destAsset}} an {{destination}} (Pfad: {{path}})',
        }));
        break;
      case 'pathPaymentStrictReceive':
        lines.push(t('detail.operations.pathPaymentStrictReceive', {
          sendMax: op.sendMax,
          sendAsset: formatAsset(op.sendAsset),
          destAmount: op.destAmount,
          destAsset: formatAsset(op.destAsset),
          destination: op.destination === sourceAccountId ? t('detail.operations.ownAccount', { defaultValue: 'das eigene Konto' }) : shortKey(op.destination),
          path: formatPath(op.path),
          defaultValue: 'Tausch: höchstens {{sendMax}} {{sendAsset}} für genau {{destAmount}} {{destAsset}} an {{destination}} (Pfad: {{path}})',
        }));
        break;
      case 'bumpSequence':
        lines.push(t('detail.operations.bumpSequence', {
          bumpTo: op.bumpTo,
          defaultValue: 'Sequenz des Kontos erhöhen auf {{bumpTo}}',
        }));
        break;
      // Die Operation enthaelt nur die Pool-ID, nicht die Assets; A/B meint die
      // kanonische Reihenfolge des Pools. Der Preis ist definiert als A/B
      // (Menge A je Einheit B), angezeigt als Dezimalzahl.
      case 'liquidityPoolDeposit': {
        const info = poolAssets(op.liquidityPoolId);
        const minPrice = formatPriceDecimal(op.minPrice, locale);
        const maxPrice = formatPriceDecimal(op.maxPrice, locale);
        if (info) {
          lines.push(t('detail.operations.liquidityPoolDepositAssets', {
            assetA: formatAsset(info.assetA),
            assetB: formatAsset(info.assetB),
            pool: shortKey(op.liquidityPoolId),
            maxAmountA: op.maxAmountA,
            maxAmountB: op.maxAmountB,
            minPrice,
            maxPrice,
            defaultValue: 'Liquidität einzahlen in Pool {{assetA}}/{{assetB}} ({{pool}}): höchstens {{maxAmountA}} {{assetA}} und {{maxAmountB}} {{assetB}}, Preis {{assetA}}/{{assetB}} zwischen {{minPrice}} und {{maxPrice}}',
          }));
          break;
        }
        lines.push(t('detail.operations.liquidityPoolDeposit', {
          pool: shortKey(op.liquidityPoolId),
          maxAmountA: op.maxAmountA,
          maxAmountB: op.maxAmountB,
          minPrice,
          maxPrice,
          defaultValue: 'Liquidität einzahlen in Pool {{pool}}: höchstens {{maxAmountA}} Asset A und {{maxAmountB}} Asset B, Preis A/B zwischen {{minPrice}} und {{maxPrice}}',
        }) + unknownPoolHint(op.liquidityPoolId));
        break;
      }
      case 'liquidityPoolWithdraw': {
        const info = poolAssets(op.liquidityPoolId);
        if (info) {
          lines.push(t('detail.operations.liquidityPoolWithdrawAssets', {
            assetA: formatAsset(info.assetA),
            assetB: formatAsset(info.assetB),
            pool: shortKey(op.liquidityPoolId),
            amount: op.amount,
            minAmountA: op.minAmountA,
            minAmountB: op.minAmountB,
            defaultValue: 'Liquidität abheben aus Pool {{assetA}}/{{assetB}} ({{pool}}): {{amount}} Pool Shares gegen mindestens {{minAmountA}} {{assetA}} und {{minAmountB}} {{assetB}}',
          }));
          break;
        }
        lines.push(t('detail.operations.liquidityPoolWithdraw', {
          pool: shortKey(op.liquidityPoolId),
          amount: op.amount,
          minAmountA: op.minAmountA,
          minAmountB: op.minAmountB,
          defaultValue: 'Liquidität abheben aus Pool {{pool}}: {{amount}} Pool Shares gegen mindestens {{minAmountA}} Asset A und {{minAmountB}} Asset B',
        }) + unknownPoolHint(op.liquidityPoolId));
        break;
      }
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

export { formatAsset, shortKey };
