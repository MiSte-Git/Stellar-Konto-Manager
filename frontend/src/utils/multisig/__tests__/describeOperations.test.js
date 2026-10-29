import { describe, expect, it } from 'vitest';
import { Account, Asset, Keypair, LiquidityPoolAsset, LiquidityPoolFeeV18, Networks, Operation, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
import { describeOperations, findOperationWarnings, shortKey } from '../describeOperations.js';

// Mirrors react-i18next's t() signature closely enough for describeOperations()'s
// purposes: interpolates {{var}} placeholders from the options object, ignoring
// the reserved `defaultValue`/`ns` keys, and otherwise falls back to the key path.
function fakeT(key, opts = {}) {
  const { defaultValue, ...vars } = opts;
  let out = defaultValue || key;
  Object.entries(vars).forEach(([k, v]) => {
    out = out.replaceAll(`{{${k}}}`, String(v));
  });
  return out;
}

function buildTx(ops) {
  const source = Keypair.random();
  const account = new Account(source.publicKey(), '100');
  const builder = new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET });
  ops.forEach((op) => builder.addOperation(op));
  return builder.setTimeout(60).build();
}

describe('shortKey', () => {
  it('abbreviates a full public key to first8…last8', () => {
    const kp = Keypair.random();
    const pk = kp.publicKey();
    expect(shortKey(pk)).toBe(`${pk.slice(0, 8)}…${pk.slice(-8)}`);
  });

  it('returns short strings unchanged', () => {
    expect(shortKey('abc')).toBe('abc');
    expect(shortKey('')).toBe('');
  });
});

describe('describeOperations', () => {
  it('returns an empty array for no operations', () => {
    expect(describeOperations([], fakeT)).toEqual([]);
    expect(describeOperations(null, fakeT)).toEqual([]);
    expect(describeOperations(undefined, fakeT)).toEqual([]);
  });

  it('describes a native payment with the exact amount/asset/destination interpolated', () => {
    const dest = Keypair.random().publicKey();
    const tx = buildTx([Operation.payment({ destination: dest, asset: Asset.native(), amount: '12.5' })]);
    const [line] = describeOperations(tx.operations, fakeT);
    expect(line).toBe(`Zahlung: 12.5000000 XLM an ${shortKey(dest)}`);
  });

  it('describes a payment in a non-native asset by its code, not "native"', () => {
    const dest = Keypair.random().publicKey();
    const issuer = Keypair.random().publicKey();
    const asset = new Asset('TRUST', issuer);
    const tx = buildTx([Operation.payment({ destination: dest, asset, amount: '1' })]);
    const [line] = describeOperations(tx.operations, fakeT);
    expect(line).toContain('TRUST');
    expect(line).not.toContain('native');
  });

  it('describes createAccount with destination and starting balance', () => {
    const dest = Keypair.random().publicKey();
    const tx = buildTx([Operation.createAccount({ destination: dest, startingBalance: '5' })]);
    const [line] = describeOperations(tx.operations, fakeT);
    expect(line).toBe(`Konto erstellen: ${shortKey(dest)} mit 5.0000000 XLM Startguthaben`);
  });

  it('describes setOptions masterWeight in isolation', () => {
    const tx = buildTx([Operation.setOptions({ masterWeight: 3 })]);
    const lines = describeOperations(tx.operations, fakeT);
    expect(lines).toEqual(['Master-Gewicht setzen auf 3']);
  });

  it('describes a setOptions signer addition (weight > 0) as signerAdd, not signerRemove', () => {
    const signerKey = Keypair.random().publicKey();
    const tx = buildTx([Operation.setOptions({ signer: { ed25519PublicKey: signerKey, weight: 5 } })]);
    const [line] = describeOperations(tx.operations, fakeT);
    expect(line).toBe(`Gewicht für Signer ${shortKey(signerKey)} auf 5 setzen`);
  });

  it('describes a setOptions signer removal (weight 0) as signerRemove, not signerAdd', () => {
    const signerKey = Keypair.random().publicKey();
    const tx = buildTx([Operation.setOptions({ signer: { ed25519PublicKey: signerKey, weight: 0 } })]);
    const [line] = describeOperations(tx.operations, fakeT);
    expect(line).toBe(`Signer ${shortKey(signerKey)} entfernen`);
  });

  it('describes setOptions thresholds with all three levels interpolated', () => {
    const tx = buildTx([Operation.setOptions({ lowThreshold: 1, medThreshold: 2, highThreshold: 3 })]);
    const [line] = describeOperations(tx.operations, fakeT);
    expect(line).toBe('Thresholds setzen: niedrig=1, mittel=2, hoch=3');
  });

  it('a single setOptions operation combining masterWeight + signer + thresholds expands to three separate lines', () => {
    const signerKey = Keypair.random().publicKey();
    const tx = buildTx([Operation.setOptions({
      masterWeight: 2,
      signer: { ed25519PublicKey: signerKey, weight: 4 },
      lowThreshold: 1,
      medThreshold: 2,
      highThreshold: 3,
    })]);
    const lines = describeOperations(tx.operations, fakeT);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Master-Gewicht');
    expect(lines[1]).toContain('Gewicht für Signer');
    expect(lines[2]).toContain('Thresholds');
  });

  it('describes changeTrust with asset code and limit', () => {
    const issuer = Keypair.random().publicKey();
    const asset = new Asset('TRUST', issuer);
    const tx = buildTx([Operation.changeTrust({ asset, limit: '1000' })]);
    const [line] = describeOperations(tx.operations, fakeT);
    expect(line).toBe(`Trustline für TRUST (${shortKey(issuer)}) setzen (Limit: 1000.0000000)`);
  });

  it('describes accountMerge with the destination account', () => {
    const dest = Keypair.random().publicKey();
    const tx = buildTx([Operation.accountMerge({ destination: dest })]);
    const [line] = describeOperations(tx.operations, fakeT);
    expect(line).toBe(`Konto zusammenführen mit ${shortKey(dest)}`);
  });

  it('falls back to a generic "unknown operation" line for an operation type this app never builds itself, without throwing', () => {
    const tx = buildTx([Operation.manageData({ name: 'x', value: 'y' })]);
    const [line] = describeOperations(tx.operations, fakeT);
    expect(line).toBe('Unbekannte Operation: manageData');
  });

  it('produces one line per operation in a multi-operation transaction, in order', () => {
    const destA = Keypair.random().publicKey();
    const destB = Keypair.random().publicKey();
    const tx = buildTx([
      Operation.createAccount({ destination: destA, startingBalance: '2' }),
      Operation.payment({ destination: destB, asset: Asset.native(), amount: '0.0000001' }),
    ]);
    const lines = describeOperations(tx.operations, fakeT);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Konto erstellen');
    expect(lines[1]).toContain('Zahlung');
  });

  it('interpolation placeholder names exactly match what the translation call passes (regression: G5 stage 2 DeepL renamed placeholders in several locales, e.g. {{destination}} -> {{destino}}/{{destinazione}}/{{bestemming}})', () => {
    // A t() that returns the raw template with placeholders untouched would
    // reveal any name mismatch immediately, since fakeT above only replaces
    // {{amount}}/{{asset}}/{{destination}} etc. - a stray {{destino}} would
    // survive verbatim in the output.
    const dest = Keypair.random().publicKey();
    const tx = buildTx([Operation.accountMerge({ destination: dest })]);
    const [line] = describeOperations(tx.operations, fakeT);
    expect(line).not.toMatch(/\{\{.*\}\}/);
  });

  it('sanity: shortKey output used in assertions above is a validly-shaped ed25519 abbreviation', () => {
    const kp = Keypair.random();
    expect(StrKey.isValidEd25519PublicKey(kp.publicKey())).toBe(true);
  });
});

describe('neue Operationstypen und Warnungen', () => {
  const issuer = Keypair.random().publicKey();
  const source = Keypair.random();
  function txFrom(ops) {
    const builder = new TransactionBuilder(new Account(source.publicKey(), '100'), { fee: '100', networkPassphrase: Networks.TESTNET });
    ops.forEach((op) => builder.addOperation(op));
    return builder.setTimeout(60).build();
  }

  it('zeigt einen Token mit Code XLM mit Herausgeber, nicht als natives XLM', () => {
    const fake = new Asset('XLM', issuer);
    const [line] = describeOperations(txFrom([Operation.payment({ destination: issuer, asset: fake, amount: '1' })]).operations, fakeT);
    expect(line).toContain(`XLM (${shortKey(issuer)})`);
  });

  it('beschreibt einen Batch-Convert-Eintrag vollstaendig', () => {
    const spam = new Asset('SPAM', issuer);
    const ops = txFrom([
      Operation.changeTrust({ asset: spam }),
      Operation.claimClaimableBalance({ balanceId: `00000000${'a'.repeat(64)}` }),
      Operation.pathPaymentStrictSend({ sendAsset: spam, sendAmount: '5', destination: source.publicKey(), destAsset: Asset.native(), destMin: '1.2', path: [] }),
      Operation.changeTrust({ asset: spam, limit: '0' }),
    ]).operations;
    const lines = describeOperations(ops, fakeT, source.publicKey());
    expect(lines[1]).toMatch(/^Claimable Balance einlösen: /);
    expect(lines[2]).toBe(`Tausch: 5.0000000 SPAM (${shortKey(issuer)}) gegen mindestens 1.2000000 XLM an das eigene Konto (Pfad: -)`);
    expect(lines[3]).toBe(`Trustline für SPAM (${shortKey(issuer)}) entfernen`);
    expect(findOperationWarnings(ops, source.publicKey())).toEqual({ unknownTypes: [], pathPaymentToOther: false });
  });

  it('warnt, wenn ein Tausch an ein anderes Konto geht', () => {
    const other = Keypair.random().publicKey();
    const ops = txFrom([Operation.pathPaymentStrictSend({ sendAsset: Asset.native(), sendAmount: '5', destination: other, destAsset: new Asset('USD', issuer), destMin: '1', path: [] })]).operations;
    const [line] = describeOperations(ops, fakeT, source.publicKey());
    expect(line).toContain(shortKey(other));
    expect(findOperationWarnings(ops, source.publicKey()).pathPaymentToOther).toBe(true);
  });

  it('beschreibt bumpSequence und meldet unbekannte Typen', () => {
    const ops = txFrom([Operation.bumpSequence({ bumpTo: '101' }), Operation.manageData({ name: 'x', value: 'y' })]).operations;
    expect(describeOperations(ops, fakeT)[0]).toBe('Sequenz des Kontos erhöhen auf 101');
    expect(findOperationWarnings(ops, source.publicKey()).unknownTypes).toEqual(['manageData']);
  });
});

describe('Liquidity-Pool-Operationen', () => {
  const issuer = Keypair.random().publicKey();
  const usd = new Asset('USD', issuer);
  const poolAsset = new LiquidityPoolAsset(Asset.native(), usd, LiquidityPoolFeeV18);
  const poolId = 'a468d41d8e9b8f3c7209651608b74b7db7ac9952dcae0cdf24871d1d9c7b0088';

  it('beschreibt liquidityPoolDeposit mit gekuerzter Pool-ID, Maximalbetraegen und Preisgrenzen', () => {
    const tx = buildTx([Operation.liquidityPoolDeposit({ liquidityPoolId: poolId, maxAmountA: '100', maxAmountB: '50.5', minPrice: '1.9', maxPrice: '2.1' })]);
    const [line] = describeOperations(tx.operations, fakeT);
    expect(line).toBe(`Liquidität einzahlen in Pool ${shortKey(poolId)}: höchstens 100.0000000 Asset A und 50.5000000 Asset B, Preis A/B zwischen 1.9 und 2.1`);
    expect(findOperationWarnings(tx.operations, '').unknownTypes).toEqual([]);
  });

  it('beschreibt liquidityPoolWithdraw mit Shares und Mindestbetraegen', () => {
    const tx = buildTx([Operation.liquidityPoolWithdraw({ liquidityPoolId: poolId, amount: '10', minAmountA: '1', minAmountB: '2.25' })]);
    const [line] = describeOperations(tx.operations, fakeT);
    expect(line).toBe(`Liquidität abheben aus Pool ${shortKey(poolId)}: 10.0000000 Pool Shares gegen mindestens 1.0000000 Asset A und 2.2500000 Asset B`);
    expect(findOperationWarnings(tx.operations, '').unknownTypes).toEqual([]);
  });

  it('zeigt changeTrust mit Pool-Asset als Pool A/B statt als XLM (setzen und entfernen)', () => {
    const tx = buildTx([
      Operation.changeTrust({ asset: poolAsset }),
      Operation.changeTrust({ asset: poolAsset, limit: '0' }),
    ]);
    const [set, remove] = describeOperations(tx.operations, fakeT);
    expect(set).toBe(`Trustline für Pool XLM/USD (${shortKey(issuer)}) setzen (Limit: 922337203685.4775807)`);
    expect(remove).toBe(`Trustline für Pool XLM/USD (${shortKey(issuer)}) entfernen`);
  });

  it('beschreibt Deposit und Withdraw mit echten Pool-Assets, Preis als Dezimalzahl', () => {
    const tx = buildTx([
      Operation.liquidityPoolDeposit({ liquidityPoolId: poolId, maxAmountA: '100', maxAmountB: '50.5', minPrice: { n: 1, d: 3 }, maxPrice: { n: 2, d: 3 } }),
      Operation.liquidityPoolWithdraw({ liquidityPoolId: poolId, amount: '10', minAmountA: '1', minAmountB: '2.25' }),
    ]);
    const poolInfo = { [poolId]: { assetA: Asset.native(), assetB: usd } };
    const [deposit, withdraw] = describeOperations(tx.operations, fakeT, '', { poolInfo, locale: 'de' });
    const usdLabel = `USD (${shortKey(issuer)})`;
    expect(deposit).toBe(`Liquidität einzahlen in Pool XLM/${usdLabel} (${shortKey(poolId)}): höchstens 100.0000000 XLM und 50.5000000 ${usdLabel}, Preis XLM/${usdLabel} zwischen 0,3333333 und 0,6666667`);
    expect(withdraw).toBe(`Liquidität abheben aus Pool XLM/${usdLabel} (${shortKey(poolId)}): 10.0000000 Pool Shares gegen mindestens 1.0000000 XLM und 2.2500000 ${usdLabel}`);
  });

  it('faellt ohne Pool-Info auf Asset A/B mit Hinweis zurueck, ohne poolInfo (Laden) ohne Hinweis', () => {
    const tx = buildTx([Operation.liquidityPoolWithdraw({ liquidityPoolId: poolId, amount: '10', minAmountA: '1', minAmountB: '2' })]);
    const [missing] = describeOperations(tx.operations, fakeT, '', { poolInfo: {} });
    expect(missing).toContain('1.0000000 Asset A und 2.0000000 Asset B');
    expect(missing).toContain('(Pool-Assets konnten nicht geladen werden)');
    const [loading] = describeOperations(tx.operations, fakeT);
    expect(loading).not.toContain('nicht geladen');
  });

  it('formatiert sehr kleine Preise lesbar statt in Exponentenschreibweise', () => {
    const tx = buildTx([Operation.liquidityPoolDeposit({ liquidityPoolId: poolId, maxAmountA: '1', maxAmountB: '1', minPrice: { n: 1, d: 300000000 }, maxPrice: { n: 1, d: 3 } })]);
    const [line] = describeOperations(tx.operations, fakeT, '', { locale: 'de' });
    expect(line).toContain('zwischen 0,000000003333333 und 0,3333333');
  });
});
