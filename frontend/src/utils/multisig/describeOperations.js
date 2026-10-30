// Decodes a stellar-sdk Transaction's operations into structured blocks
// for the multisig job-detail transparency panel (G5 stage 2 - signers
// previously saw only the raw tx hash, never what they were actually being
// asked to sign). Covers the operation types this app's own multisig flows
// actually build (SendPaymentPage: createAccount/payment; MultisigEditPage:
// setOptions; ListTrustlines: changeTrust; Claimable Balances und Batch-Convert:
// claimClaimableBalance/pathPaymentStrictSend; Widerruf: bumpSequence; Liquidity
// Pools: liquidityPoolDeposit/liquidityPoolWithdraw). Anything
// else falls back to a generic "unknown operation type" block, and
// findOperationWarnings() flags it so the signer must confirm explicitly.
import { StrKey, extractBaseAddress } from '@stellar/stellar-sdk';
import { formatAmountWithUnit, formatPriceDecimal } from '../../components/liquidity/formatPoolAmount.js';
import { toStroops } from '../stellar/liquidityPools.js';

// Groesster Trustline-Wert (int64 in Stroops): wer "kein Limit" angibt, setzt genau diesen.
export const TRUSTLINE_LIMIT_MAX_STROOPS = 2n ** 63n - 1n;

// Bits der Konto-Flags, Reihenfolge wie im Protokoll.
const ACCOUNT_FLAGS = [
  [1, 'auth_required'],
  [2, 'auth_revocable'],
  [4, 'auth_immutable'],
  [8, 'auth_clawback_enabled'],
];

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

// Issuer eines Assets (bei Pool Shares beider Pool-Assets), native Assets haben keinen.
function issuersOf(asset) {
  if (!asset) return [];
  if (isPoolShareAsset(asset)) return [...issuersOf(asset.assetA), ...issuersOf(asset.assetB)];
  return asset.code && asset.issuer ? [{ code: asset.code, issuer: asset.issuer }] : [];
}

function parseStroops(value) {
  try {
    return toStroops(value);
  } catch {
    return null;
  }
}

// Der SDK liefert sha256Hash und preAuthTx als Bytes; als X.../T... bleiben sie mit
// Horizon und Stellar Lab vergleichbar.
function formatSignerKey(signer) {
  if (signer.ed25519PublicKey) return signer.ed25519PublicKey;
  if (signer.ed25519SignedPayload) return signer.ed25519SignedPayload;
  if (signer.sha256Hash) return StrKey.encodeSha256Hash(signer.sha256Hash);
  if (signer.preAuthTx) return StrKey.encodePreAuthTx(signer.preAuthTx);
  return '-';
}

function formatAccountFlags(value) {
  const flags = Number(value);
  const names = ACCOUNT_FLAGS.filter(([bit]) => (flags & bit) !== 0).map(([, name]) => name);
  return names.length ? `${names.join(', ')} (${value})` : String(value);
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

// Basiskonto einer G- oder M-Adresse; andere Werte bleiben unveraendert.
function baseAccountOf(address) {
  try {
    return extractBaseAddress(String(address));
  } catch {
    return String(address || '');
  }
}

// Eine M-Adresse ist dasselbe Konto wie ihre G-Adresse: Signaturen, Guthaben und
// Sequence haengen allein am Basiskonto.
function isSameAccount(a, b) {
  return !!a && !!b && baseAccountOf(a) === baseAccountOf(b);
}

// Fremd heisst: anderes Basiskonto als das Quellkonto der Transaktion. Ist das Quellkonto
// unbekannt, gilt op.source als fremd; ein Fehlalarm wiegt weniger als eine verdeckte Adresse.
function isForeignOpSource(op, sourceAccountId) {
  return !!op?.source && !isSameAccount(op.source, sourceAccountId);
}

/**
 * Hinweise fuer Signer, bevor sie einen Job signieren.
 * unknownTypes: Operationen, die SKM nicht im Klartext zeigen kann.
 * pathPaymentToOther: ein Tausch, dessen Erloes an ein anderes Konto als das Quellkonto geht.
 * foreignOpSources: Basiskonten (G...) von Operationen, die ein anderes Konto ausfuehrt.
 * @param {Array<object>} operations
 * @param {string} sourceAccountId - G-Adresse des Quellkontos der Transaktion
 */
export function findOperationWarnings(operations, sourceAccountId) {
  const ops = Array.isArray(operations) ? operations : [];
  const unknownTypes = [...new Set(ops.map((op) => op?.type || '?').filter((type) => !DESCRIBED_OPERATION_TYPES.has(type)))];
  const pathPaymentToOther = ops.some((op) => (
    (op?.type === 'pathPaymentStrictSend' || op?.type === 'pathPaymentStrictReceive')
    && !isSameAccount(op.destination, sourceAccountId)
  ));
  const foreignOpSources = [...new Set(ops.filter((op) => isForeignOpSource(op, sourceAccountId)).map((op) => baseAccountOf(op.source)))];
  return { unknownTypes, pathPaymentToOther, foreignOpSources };
}

function shortKey(pk) {
  const val = String(pk || '');
  if (val.length <= 16) return val;
  return `${val.slice(0, 8)}…${val.slice(-8)}`;
}

/**
 * Beschreibt jede Operation als Block fuer die Anzeige (OperationBlocks.jsx).
 *
 * @param {Array<object>} operations - decoded operations from a stellar-sdk Transaction (tx.operations)
 * @param {(key: string, opts?: object) => string} t - react-i18next translate function, bound to the 'multisig' namespace
 * @param {string} [sourceAccountId] - Quellkonto der Transaktion: erkennt Tausche an das eigene Konto und fremde op.source
 * @param {{ poolInfo?: Record<string, { assetA: object, assetB: object }>, locale?: string }} [options]
 *   poolInfo: bekannte Pool-Assets je Pool-ID (kanonisch A/B). Ist poolInfo gesetzt, fehlt
 *   aber ein Pool, wird der Block mit Asset A/B und einem Hinweis beschrieben; ohne poolInfo
 *   (z. B. waehrend des Ladens) ohne Hinweis.
 * @returns {Array<{ type: string, title: string, rows: Array<{ key: string, label: string, value: string, emphasis?: boolean, wrap?: boolean }>, source?: string, warnings: string[] }>}
 *   ein Block je Operation. wrap: lange Adresse oder ID, darf ueberall umbrechen.
 */
export function describeOperations(operations, t, sourceAccountId = '', options = {}) {
  const { poolInfo, locale } = options || {};
  const title = (key, defaultValue, vars = {}) => t(`detail.operations.titles.${key}`, { ...vars, defaultValue });
  const label = (key, defaultValue, vars = {}) => t(`detail.operations.labels.${key}`, { ...vars, defaultValue });

  const amount = (value, unit) => {
    const stroops = parseStroops(value);
    return stroops === null ? `${value ?? '-'} ${unit}` : formatAmountWithUnit(stroops, unit, locale);
  };

  // Volle Adresse; bei M... zusaetzlich das Basiskonto, damit keine fremde G-Adresse verdeckt bleibt.
  const addressRows = (key, labelText, address, extra = {}) => {
    const value = String(address || '-');
    const rows = [{ key, label: labelText, value, wrap: true, ...extra }];
    const base = baseAccountOf(address);
    if (base && base !== value) {
      rows.push({ key: `${key}Base`, label: label('baseAccount', 'Basiskonto'), value: base, wrap: true, ...extra });
    }
    return rows;
  };

  // formatAsset kuerzt den Issuer; die Tabelle nennt ihn deshalb einmal vollstaendig.
  const issuerRows = (...assets) => {
    const seen = new Map();
    assets.flatMap(issuersOf).forEach((item) => seen.set(`${item.code}:${item.issuer}`, item));
    return [...seen.entries()].map(([id, item]) => ({
      key: `issuer:${id}`,
      label: label('issuer', 'Issuer {{code}}', { code: item.code }),
      value: item.issuer,
      wrap: true,
    }));
  };

  const destinationOfPathPayment = (op) => {
    const own = isSameAccount(op.destination, sourceAccountId);
    const rows = addressRows('destination', label('destination', 'Empfänger'), op.destination, own ? {} : { emphasis: true });
    if (own) rows.push({ key: 'ownAccount', label: label('note', 'Hinweis'), value: t('detail.operations.ownAccount', { defaultValue: 'das eigene Konto' }) });
    return rows;
  };

  const pathRows = (op) => [{ key: 'path', label: label('path', 'Pfad'), value: formatPath(op.path) }];

  const poolParts = (op) => {
    const info = poolInfo && poolInfo[op.liquidityPoolId] ? poolInfo[op.liquidityPoolId] : null;
    const assetA = info ? formatAsset(info.assetA) : 'Asset A';
    const assetB = info ? formatAsset(info.assetB) : 'Asset B';
    return {
      info,
      assetA,
      assetB,
      pool: shortKey(op.liquidityPoolId),
      poolRow: { key: 'poolId', label: label('poolId', 'Pool-ID'), value: String(op.liquidityPoolId ?? '-'), wrap: true },
      issuers: info ? issuerRows(info.assetA, info.assetB) : [],
      warnings: poolInfo && !info
        ? [t('detail.operations.liquidityPoolAssetsUnknown', { defaultValue: '(Pool-Assets konnten nicht geladen werden)' })]
        : [],
    };
  };

  const setOptionsRows = (op) => {
    // stellar-sdk decodes an unset setOptions field as null or undefined, never
    // as absent-but-falsy; 0 und '' sind gesetzte Werte.
    const isSet = (value) => value !== undefined && value !== null;
    const rows = [];
    if (isSet(op.masterWeight)) {
      rows.push({ key: 'masterWeight', label: label('masterWeight', 'Master-Gewicht'), value: String(op.masterWeight) });
    }
    if (op.signer) {
      const signerKey = formatSignerKey(op.signer);
      if (Number(op.signer.weight) > 0) {
        rows.push({ key: 'signer', label: label('signer', 'Signer'), value: signerKey, wrap: true });
        rows.push({ key: 'signerWeight', label: label('signerWeight', 'Gewicht für Signer'), value: String(op.signer.weight) });
      } else {
        rows.push({ key: 'signerRemove', label: label('signerRemove', 'Signer entfernen'), value: signerKey, wrap: true, emphasis: true });
      }
    }
    if (isSet(op.lowThreshold)) rows.push({ key: 'lowThreshold', label: label('lowThreshold', 'Threshold niedrig'), value: String(op.lowThreshold) });
    if (isSet(op.medThreshold)) rows.push({ key: 'medThreshold', label: label('medThreshold', 'Threshold mittel'), value: String(op.medThreshold) });
    if (isSet(op.highThreshold)) rows.push({ key: 'highThreshold', label: label('highThreshold', 'Threshold hoch'), value: String(op.highThreshold) });
    if (isSet(op.homeDomain)) {
      rows.push({
        key: 'homeDomain',
        label: label('homeDomain', 'Home-Domain'),
        value: op.homeDomain || t('detail.operations.homeDomainCleared', { defaultValue: 'wird entfernt' }),
        wrap: true,
      });
    }
    if (isSet(op.setFlags)) rows.push({ key: 'setFlags', label: label('setFlags', 'Flags setzen'), value: formatAccountFlags(op.setFlags) });
    if (isSet(op.clearFlags)) rows.push({ key: 'clearFlags', label: label('clearFlags', 'Flags entfernen'), value: formatAccountFlags(op.clearFlags) });
    if (isSet(op.inflationDest)) rows.push(...addressRows('inflationDest', label('inflationDest', 'Inflation-Ziel'), op.inflationDest));
    if (!rows.length) {
      rows.push({ key: 'noFields', label: label('note', 'Hinweis'), value: t('detail.operations.noFieldsSet', { defaultValue: 'Diese Operation setzt keine Felder.' }) });
    }
    return rows;
  };

  const describe = (op) => {
    switch (op?.type) {
      case 'payment':
        return {
          title: title('payment', 'Zahlung'),
          rows: [
            { key: 'amount', label: label('amount', 'Betrag'), value: amount(op.amount, formatAsset(op.asset)), emphasis: true },
            ...addressRows('destination', label('destination', 'Empfänger'), op.destination, { emphasis: true }),
            ...issuerRows(op.asset),
          ],
        };
      case 'createAccount':
        return {
          title: title('createAccount', 'Konto erstellen'),
          rows: [
            ...addressRows('destination', label('newAccount', 'Neues Konto'), op.destination, { emphasis: true }),
            { key: 'startingBalance', label: label('startingBalance', 'Startguthaben'), value: amount(op.startingBalance, 'XLM'), emphasis: true },
          ],
        };
      case 'setOptions':
        return { title: title('setOptions', 'Kontooptionen ändern'), rows: setOptionsRows(op) };
      case 'changeTrust': {
        const line = op.line || op.asset;
        const asset = formatAsset(line);
        const limit = parseStroops(op.limit);
        const assetRow = { key: 'asset', label: label('asset', 'Asset'), value: asset };
        if (limit === 0n) {
          return {
            title: t('detail.operations.changeTrustRemove', { asset, defaultValue: 'Trustline für {{asset}} entfernen' }),
            rows: [assetRow, ...issuerRows(line)],
          };
        }
        const unit = line && isPoolShareAsset(line) ? label('poolShares', 'Pool Shares') : asset;
        return {
          title: title('changeTrust', 'Trustline für {{asset}} setzen', { asset }),
          rows: [
            assetRow,
            {
              key: 'limit',
              label: label('limit', 'Limit'),
              value: limit === TRUSTLINE_LIMIT_MAX_STROOPS
                ? t('detail.operations.limitUnlimited', { defaultValue: 'unbegrenzt' })
                : amount(op.limit, unit),
              emphasis: true,
            },
            ...issuerRows(line),
          ],
        };
      }
      case 'claimClaimableBalance':
        return {
          title: title('claimClaimableBalance', 'Claimable Balance einlösen'),
          rows: [{ key: 'balanceId', label: label('balanceId', 'Balance-ID'), value: String(op.balanceId ?? '-'), wrap: true }],
        };
      case 'pathPaymentStrictSend':
        return {
          title: title('pathPaymentStrictSend', 'Tausch'),
          rows: [
            { key: 'sendAmount', label: label('sendExact', 'Sendet genau'), value: amount(op.sendAmount, formatAsset(op.sendAsset)), emphasis: true },
            { key: 'destMin', label: label('receiveMin', 'Erhält mindestens'), value: amount(op.destMin, formatAsset(op.destAsset)), emphasis: true },
            ...destinationOfPathPayment(op),
            ...pathRows(op),
            ...issuerRows(op.sendAsset, op.destAsset, ...(op.path || [])),
          ],
        };
      case 'pathPaymentStrictReceive':
        return {
          title: title('pathPaymentStrictReceive', 'Tausch'),
          rows: [
            { key: 'sendMax', label: label('sendMax', 'Sendet höchstens'), value: amount(op.sendMax, formatAsset(op.sendAsset)), emphasis: true },
            { key: 'destAmount', label: label('receiveExact', 'Erhält genau'), value: amount(op.destAmount, formatAsset(op.destAsset)), emphasis: true },
            ...destinationOfPathPayment(op),
            ...pathRows(op),
            ...issuerRows(op.sendAsset, op.destAsset, ...(op.path || [])),
          ],
        };
      case 'bumpSequence':
        return {
          title: title('bumpSequence', 'Sequenz des Kontos erhöhen'),
          rows: [{ key: 'bumpTo', label: label('bumpTo', 'Neue Sequenz'), value: String(op.bumpTo ?? '-'), emphasis: true }],
        };
      // Die Operation enthaelt nur die Pool-ID, nicht die Assets; A/B meint die
      // kanonische Reihenfolge des Pools. Der Preis ist definiert als A/B
      // (Menge A je Einheit B), angezeigt als Dezimalzahl.
      case 'liquidityPoolDeposit': {
        const { info, assetA, assetB, pool, poolRow, issuers, warnings } = poolParts(op);
        const pair = info ? `${assetA}/${assetB}` : 'A/B';
        return {
          title: info
            ? title('liquidityPoolDepositAssets', 'Liquidität einzahlen in Pool {{assetA}}/{{assetB}} ({{pool}})', { assetA, assetB, pool })
            : title('liquidityPoolDeposit', 'Liquidität einzahlen in Pool {{pool}}', { pool }),
          rows: [
            poolRow,
            { key: 'maxAmountA', label: label('maxAmountA', 'Höchstbetrag Asset A'), value: amount(op.maxAmountA, assetA), emphasis: true },
            { key: 'maxAmountB', label: label('maxAmountB', 'Höchstbetrag Asset B'), value: amount(op.maxAmountB, assetB), emphasis: true },
            { key: 'minPrice', label: label('minPrice', 'Mindestpreis {{pair}}', { pair }), value: formatPriceDecimal(op.minPrice, locale) },
            { key: 'maxPrice', label: label('maxPrice', 'Höchstpreis {{pair}}', { pair }), value: formatPriceDecimal(op.maxPrice, locale) },
            ...issuers,
          ],
          warnings,
        };
      }
      case 'liquidityPoolWithdraw': {
        const { info, assetA, assetB, pool, poolRow, issuers, warnings } = poolParts(op);
        return {
          title: info
            ? title('liquidityPoolWithdrawAssets', 'Liquidität abheben aus Pool {{assetA}}/{{assetB}} ({{pool}})', { assetA, assetB, pool })
            : title('liquidityPoolWithdraw', 'Liquidität abheben aus Pool {{pool}}', { pool }),
          rows: [
            poolRow,
            { key: 'shares', label: label('poolShares', 'Pool Shares'), value: amount(op.amount, label('poolShares', 'Pool Shares')), emphasis: true },
            { key: 'minAmountA', label: label('minAmountA', 'Mindestbetrag Asset A'), value: amount(op.minAmountA, assetA), emphasis: true },
            { key: 'minAmountB', label: label('minAmountB', 'Mindestbetrag Asset B'), value: amount(op.minAmountB, assetB), emphasis: true },
            ...issuers,
          ],
          warnings,
        };
      }
      case 'accountMerge':
        return {
          title: title('accountMerge', 'Konto zusammenführen'),
          rows: addressRows('destination', label('mergeDestination', 'Zielkonto'), op.destination, { emphasis: true }),
        };
      default:
        return {
          title: t('detail.operations.unknown', { type: op?.type || '?', defaultValue: 'Unbekannte Operation: {{type}}' }),
          rows: [{ key: 'type', label: label('type', 'Typ'), value: op?.type || '?', emphasis: true }],
          warnings: [t('detail.operations.warnUnknownOperation', { defaultValue: 'SKM kann diese Operation nicht im Klartext anzeigen.' })],
        };
    }
  };

  // Regel fuer op.source steht bei isForeignOpSource: gleiches Basiskonto ist keine
  // Warnung; eine abweichende M-Adresse bleibt aber als Zeile sichtbar.
  return (Array.isArray(operations) ? operations : []).map((op) => {
    const { title: blockTitle, rows, warnings = [] } = describe(op);
    const block = { type: op?.type || '?', title: blockTitle, rows, warnings: [...warnings] };
    if (op?.source && op.source !== sourceAccountId) {
      const foreign = isForeignOpSource(op, sourceAccountId);
      block.source = op.source;
      block.rows = [...addressRows('source', label('source', 'Quellkonto'), op.source, foreign ? { emphasis: true } : {}), ...rows];
      if (foreign) block.warnings.unshift(t('detail.operations.warnOpSource', { defaultValue: 'Diese Operation wird von einem anderen Konto ausgeführt.' }));
    }
    return block;
  });
}

export { formatAsset, shortKey };
