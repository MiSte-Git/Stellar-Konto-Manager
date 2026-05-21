import { Operation, TransactionBuilder } from '@stellar/stellar-sdk';

export function signTransactionWithCollectedSigners(transaction, collectedSigners = []) {
  const signers = Array.isArray(collectedSigners) ? collectedSigners : [];
  signers.forEach((signer) => {
    try {
      transaction.sign(signer.keypair);
    } catch (error) {
      console.debug?.('sign failed', error);
    }
  });
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
