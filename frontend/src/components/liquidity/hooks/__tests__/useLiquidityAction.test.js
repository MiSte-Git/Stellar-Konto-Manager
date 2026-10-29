import { act, renderHook } from '@testing-library/react';
import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import useLiquidityAction from '../useLiquidityAction.js';

const hoisted = vi.hoisted(() => ({ submit: vi.fn() }));

vi.mock('../../../../utils/stellar/stellarUtils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getHorizonServer: () => ({
    loadAccount: async () => { throw new Error('offline'); },
    liquidityPools: () => ({ liquidityPoolId: () => ({ call: async () => { throw new Error('offline'); } }) }),
    feeStats: async () => { throw new Error('offline'); },
    root: async () => ({ network_passphrase: Networks.PUBLIC }),
  }),
}));

vi.mock('../../../../utils/stellar/submitTransactionSafely.js', async (importOriginal) => ({
  ...(await importOriginal()),
  submitTransactionSafely: (...args) => hoisted.submit(...args),
}));

const owner = Keypair.random();
// Stabile Referenz wie bei useTranslation, sonst laedt der Hook bei jedem Render neu.
const t = (key) => key;
const hookProps = { publicKey: owner.publicKey(), network: 'PUBLIC', poolId: 'a'.repeat(64), operationType: 'liquidityPoolDeposit', t };

function buildTx() {
  return new TransactionBuilder(new Account(owner.publicKey(), '1'), { fee: '100', networkPassphrase: Networks.PUBLIC })
    .addOperation(Operation.bumpSequence({ bumpTo: '2' }))
    .setTimeout(60)
    .build();
}

describe('useLiquidityAction send', () => {
  beforeEach(() => {
    hoisted.submit.mockReset();
    hoisted.submit.mockResolvedValue({ hash: 'first' });
  });

  it('wirft beim zweiten send im selben Ablauf, bevor etwas signiert oder gesendet wird', async () => {
    const { result } = renderHook(() => useLiquidityAction(hookProps));
    const secondTx = buildTx();
    let secondError = null;
    act(() => {
      result.current.begin({}, async (server, collected, alive, send) => {
        await send(buildTx());
        try {
          await send(secondTx);
        } catch (err) {
          secondError = err;
        }
        return { hash: 'first' };
      });
    });
    await act(async () => { await result.current.modalProps.onConfirm([{ keypair: owner }]); });

    expect(hoisted.submit).toHaveBeenCalledTimes(1);
    expect(secondError?.message).toBe('submitTransaction.failed:liquidity.alreadySent');
    expect(secondTx.signatures).toHaveLength(0);
    expect(result.current.result).toEqual({ hash: 'first' });
  });

  it('erlaubt in einem neuen Ablauf wieder genau ein send', async () => {
    const { result } = renderHook(() => useLiquidityAction(hookProps));
    hoisted.submit.mockRejectedValueOnce(Object.assign(new Error('rejected'), { response: { status: 400, data: { extras: { result_codes: { transaction: 'tx_bad_seq' } } } } }));
    const work = async (server, collected, alive, send) => {
      const res = await send(buildTx());
      return { hash: res.hash };
    };
    act(() => { result.current.begin({}, work); });
    await act(async () => { await result.current.modalProps.onConfirm([{ keypair: owner }]); });
    expect(result.current.modalProps.errorMessage).toBeTruthy();

    // Erneuter Versuch nach einem eindeutigen Fehlschlag: eigener Ablauf, eigenes send
    await act(async () => { await result.current.modalProps.onConfirm([{ keypair: owner }]); });
    expect(hoisted.submit).toHaveBeenCalledTimes(2);
    expect(result.current.result).toEqual({ hash: 'first' });
  });
});
