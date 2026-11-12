// Regression 12.11.2026: Nach Trading, Liquidity, Einloesen usw. blieb der XLM-Saldo in der Kopfzeile
// veraltet, weil nur "Zahlung senden" ihn neu laden liess. Jetzt loest jedes erfolgreiche guardedSubmit
// das Neuladen aus.
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { guardedSubmit } from '../guardedSubmit.js';
import { resetAccountSendGuardMemory } from '../accountSendGuard.js';
import { BALANCE_REFRESH_EVENT } from '../../balanceRefresh.js';

const SRC = Keypair.random();
const DEST = Keypair.random().publicKey();

function build() {
  return async ({ adjustAccount }) => {
    const acc = new Account(SRC.publicKey(), '100');
    const tx = new TransactionBuilder(adjustAccount ? adjustAccount(acc) : acc, { fee: '100', networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.payment({ destination: DEST, amount: '1', asset: Asset.native() }))
      .setTimeout(60).build();
    tx.sign(SRC);
    return { tx, meta: {} };
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetAccountSendGuardMemory();
});

describe('Kopfzeilen-Saldo nach erfolgreichem Senden', () => {
  it('ein erfolgreiches guardedSubmit meldet das Konto zum Neuladen', async () => {
    const seen = [];
    const handler = (e) => seen.push(e.detail.accountId);
    window.addEventListener(BALANCE_REFRESH_EVENT, handler);
    try {
      await guardedSubmit({
        network: 'TESTNET', account: SRC.publicKey(), server: {}, buildTx: build(),
        submit: async () => ({ hash: 'x' }),
      });
      expect(seen).toEqual([SRC.publicKey()]);
    } finally {
      window.removeEventListener(BALANCE_REFRESH_EVENT, handler);
    }
  });

  it('ein fehlgeschlagenes Senden loest kein Neuladen aus', async () => {
    const seen = [];
    const handler = (e) => seen.push(e.detail.accountId);
    window.addEventListener(BALANCE_REFRESH_EVENT, handler);
    try {
      await expect(guardedSubmit({
        network: 'TESTNET', account: SRC.publicKey(), server: {}, buildTx: build(),
        submit: async () => { throw new Error('tx_failed'); },
      })).rejects.toThrow();
      expect(seen).toEqual([]);
    } finally {
      window.removeEventListener(BALANCE_REFRESH_EVENT, handler);
    }
  });
});
