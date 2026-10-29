import { Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { toStroops } from './liquidityPools.js';

export function signTransactionWithCollectedSigners(transaction, collectedSigners = []) {
  const signers = Array.isArray(collectedSigners) ? collectedSigners : [];
  const failures = [];
  signers.forEach((signer) => {
    try {
      transaction.sign(signer.keypair);
    } catch (error) {
      failures.push(error);
    }
  });
  if (failures.length > 0) {
    console.error('[SKM] Signing failed for one or more signers:', failures);
    throw new Error('submitTransaction.failed:signingFailed');
  }
  return transaction;
}

export function buildChangeTrustTransaction({
  account,
  asset,
  limit,
  fee,
  networkPassphrase,
}) {
  return new TransactionBuilder(account, { fee, networkPassphrase })
    .addOperation(Operation.changeTrust({ asset, limit }))
    .setTimeout(60)
    .build();
}

export function buildPathPaymentStrictSendTransaction({
  account,
  sendAsset,
  sendAmount,
  destination,
  destAsset,
  destMin,
  path = [],
  fee,
  networkPassphrase,
}) {
  return new TransactionBuilder(account, { fee, networkPassphrase })
    .addOperation(Operation.pathPaymentStrictSend({
      sendAsset,
      sendAmount,
      destination,
      destAsset,
      destMin,
      path,
    }))
    .setTimeout(60)
    .build();
}

export function buildChangeTrustAndPathPaymentStrictSendTransaction({
  account,
  trustAsset,
  trustLimit,
  sendAsset,
  sendAmount,
  destination,
  destAsset,
  destMin,
  path = [],
  fee,
  networkPassphrase,
}) {
  return new TransactionBuilder(account, { fee, networkPassphrase })
    .addOperation(Operation.changeTrust({ asset: trustAsset, limit: trustLimit }))
    .addOperation(Operation.pathPaymentStrictSend({
      sendAsset,
      sendAmount,
      destination,
      destAsset,
      destMin,
      path,
    }))
    .setTimeout(60)
    .build();
}

export function buildManageSellOfferTransaction({
  account,
  selling,
  buying,
  amount,
  price,
  offerId = '0',
  fee,
  networkPassphrase,
}) {
  return new TransactionBuilder(account, { fee, networkPassphrase })
    .addOperation(Operation.manageSellOffer({
      selling,
      buying,
      amount,
      price,
      offerId: String(offerId || '0'),
    }))
    .setTimeout(60)
    .build();
}

/**
 * Liquidity-Pool-Einzahlung als eine atomare Transaktion:
 * changeTrust je fehlendes Asset (nie fuer XLM und nie fuer ein Asset, dessen
 * Issuer das Konto selbst ist), changeTrust(poolAsset) falls noetig, dann
 * liquidityPoolDeposit. Betraege als Dezimal-Strings, Preise als
 * { n, d } (siehe quoteDeposit).
 */
export function buildLiquidityDepositTransaction({
  account,
  missingTrustAssets = [],
  poolAsset,
  needPoolTrust,
  liquidityPoolId,
  maxAmountA,
  maxAmountB,
  minPrice,
  maxPrice,
  fee,
  networkPassphrase,
  timeoutSeconds = 60,
}) {
  const builder = new TransactionBuilder(account, { fee, networkPassphrase });
  const accountId = account.accountId();
  (Array.isArray(missingTrustAssets) ? missingTrustAssets : []).forEach((asset) => {
    if (!asset || asset.isNative()) throw new Error('submitTransaction.failed:liquidity.invalidInput');
    if (asset.getIssuer() === accountId) return;
    builder.addOperation(Operation.changeTrust({ asset }));
  });
  if (needPoolTrust) {
    if (!poolAsset) throw new Error('submitTransaction.failed:liquidity.invalidInput');
    builder.addOperation(Operation.changeTrust({ asset: poolAsset }));
  }
  builder.addOperation(Operation.liquidityPoolDeposit({
    liquidityPoolId,
    maxAmountA,
    maxAmountB,
    minPrice,
    maxPrice,
  }));
  return builder.setTimeout(timeoutSeconds).build();
}

/**
 * Liquidity-Pool-Abhebung: liquidityPoolWithdraw, optional danach
 * changeTrust(poolAsset, limit 0). Das Entfernen ist nur zulaessig, wenn amount
 * dem gesamten Share-Bestand des Kontos (account.balances) entspricht; sonst
 * wuerde die Transaktion ohnehin scheitern (Pool-Trustline mit Restbestand).
 */
export function buildLiquidityWithdrawTransaction({
  account,
  liquidityPoolId,
  amount,
  minAmountA,
  minAmountB,
  removePoolTrust = false,
  poolAsset,
  fee,
  networkPassphrase,
  timeoutSeconds = 60,
}) {
  if (removePoolTrust) {
    const line = (account?.balances || []).find(
      (b) => b.asset_type === 'liquidity_pool_shares' && b.liquidity_pool_id === liquidityPoolId
    );
    if (!line || !poolAsset || toStroops(line.balance) !== toStroops(amount)) {
      throw new Error('submitTransaction.failed:liquidity.removeTrustPartial');
    }
  }
  const builder = new TransactionBuilder(account, { fee, networkPassphrase })
    .addOperation(Operation.liquidityPoolWithdraw({ liquidityPoolId, amount, minAmountA, minAmountB }));
  if (removePoolTrust) builder.addOperation(Operation.changeTrust({ asset: poolAsset, limit: '0' }));
  return builder.setTimeout(timeoutSeconds).build();
}
