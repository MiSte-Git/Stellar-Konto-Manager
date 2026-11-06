import { act, renderHook } from '@testing-library/react';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import useTradingMultisig, { requiredWeightFor } from '../hooks/useTradingMultisig.js';
import { getRequiredThreshold } from '../../../utils/getRequiredThreshold.js';

const hoisted = vi.hoisted(() => ({ createJob: vi.fn(), serverNetworks: [] }));

vi.mock('../../../utils/multisigApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  createMultisigJobFromXdr: (...args) => hoisted.createJob(...args),
}));

vi.mock('../../../utils/stellar/stellarUtils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getHorizonServerForNetwork: (network) => {
    hoisted.serverNetworks.push(network);
    return { root: async () => ({ network_passphrase: network === 'TESTNET' ? Networks.TESTNET : Networks.PUBLIC }) };
  },
}));

const ACCOUNT = Keypair.random().publicKey();
const OTHER = Keypair.random().publicKey();
const t = (key) => key;

function buildTx({ source = ACCOUNT, passphrase = Networks.PUBLIC } = {}) {
  return new TransactionBuilder(new Account(source, '10'), { fee: '100', networkPassphrase: passphrase })
    .addOperation(Operation.changeTrust({ asset: new Asset('FOO', Keypair.random().publicKey()) }))
    .setTimeout(3600)
    .build();
}

function makeAction(overrides = {}) {
  return {
    type: 'trustline',
    network: 'PUBLIC',
    accountId: ACCOUNT,
    payload: null,
    execute: vi.fn(),
    prepare: vi.fn(async () => ({ tx: buildTx() })),
    rows: [],
    items: () => [],
    ...overrides,
  };
}

function renderMultisig(props = {}) {
  return renderHook((p) => useTradingMultisig({
    network: 'PUBLIC',
    accountId: ACCOUNT,
    accountInfo: null,
    beginAction: vi.fn(),
    closeSecretModal: vi.fn(),
    t,
    ...p,
  }), { initialProps: props });
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
  hoisted.createJob.mockReset().mockResolvedValue({ id: 'job-1', hash: 'h1', xdr: 'AAAA', requiredWeight: null, collectedSigners: [] });
  hoisted.serverNetworks.length = 0;
});

describe('useTradingMultisig - runUnsigned', () => {
  it('lehnt swap und trustlineSwap als Job direkt ab (ADR 0011), ohne prepare und ohne Job', async () => {
    const { result } = renderMultisig();
    for (const type of ['swap', 'trustlineSwap']) {
      const action = makeAction({ type });
      await act(async () => { await result.current.runUnsigned(action, 'job'); });
      expect(action.prepare).not.toHaveBeenCalled();
      expect(result.current.error).toBe('trading:assetSearch.multisig.swapJobDisabled');
    }
    expect(hoisted.createJob).not.toHaveBeenCalled();
    expect(result.current.preparedJob).toBeNull();
  });

  it('Gegenprobe: Swap als XDR bleibt erlaubt, Trustline als Job geht', async () => {
    const { result } = renderMultisig();
    const swap = makeAction({ type: 'swap' });
    await act(async () => { await result.current.runUnsigned(swap, 'xdr'); });
    expect(swap.prepare).toHaveBeenCalledTimes(1);
    expect(result.current.exportedXdr?.xdr).toBeTruthy();

    await act(async () => { await result.current.runUnsigned(makeAction(), 'job'); });
    expect(hoisted.createJob).toHaveBeenCalledTimes(1);
    expect(hoisted.createJob.mock.calls[0][0]).toMatchObject({ network: 'public', accountId: ACCOUNT });
    expect(result.current.preparedJob?.operationTypes).toEqual(['changeTrust']);
  });

  it('nimmt Netz und Konto aus der Aktion: Abweichung vom Hook-Zustand -> kein prepare, kein Job, kein XDR', async () => {
    const { result } = renderMultisig();
    for (const [mode, overrides] of [['job', { network: 'TESTNET' }], ['xdr', { network: 'TESTNET' }], ['job', { accountId: OTHER }], ['xdr', { accountId: OTHER }]]) {
      const action = makeAction(overrides);
      await act(async () => { await result.current.runUnsigned(action, mode); });
      expect(action.prepare).not.toHaveBeenCalled();
      expect(result.current.error).toBe('trading:assetSearch.multisig.contextChanged');
    }
    expect(hoisted.createJob).not.toHaveBeenCalled();
    expect(result.current.exportedXdr).toBeNull();
    expect(hoisted.serverNetworks).toEqual([]);
  });

  it('bricht nach prepare ab, wenn Quelle oder Passphrase der Transaktion nicht zur Aktion passen', async () => {
    const { result } = renderMultisig();
    const wrongSource = makeAction({ prepare: vi.fn(async () => ({ tx: buildTx({ source: OTHER }) })) });
    await act(async () => { await result.current.runUnsigned(wrongSource, 'job'); });
    expect(result.current.error).toBe('trading:assetSearch.multisig.contextChanged');

    const wrongNet = makeAction({ prepare: vi.fn(async () => ({ tx: buildTx({ passphrase: Networks.TESTNET }) })) });
    await act(async () => { await result.current.runUnsigned(wrongNet, 'xdr'); });
    expect(result.current.error).toBe('trading:assetSearch.multisig.contextChanged');
    expect(hoisted.createJob).not.toHaveBeenCalled();
    expect(result.current.exportedXdr).toBeNull();
  });

  it('bricht ab, wenn das globale Netz waehrend prepare wechselt', async () => {
    const { result } = renderMultisig();
    const action = makeAction({
      prepare: vi.fn(async () => {
        window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
        return { tx: buildTx() };
      }),
    });
    await act(async () => { await result.current.runUnsigned(action, 'xdr'); });
    expect(result.current.exportedXdr).toBeNull();
    expect(result.current.error).toBe('createAccount:networkChanged.funderAborted');
  });

  it('schliesst die offene Auswahl bei Netz- oder Kontowechsel, mit Hinweis', async () => {
    const twoOfTwo = {
      thresholds: { low_threshold: 0, med_threshold: 2, high_threshold: 2 },
      signers: [{ key: ACCOUNT, weight: 1 }, { key: OTHER, weight: 1 }],
    };
    for (const change of [{ network: 'TESTNET' }, { accountId: OTHER }]) {
      const { result, rerender } = renderMultisig({ accountInfo: twoOfTwo });
      act(() => { result.current.start(makeAction()); });
      expect(result.current.options).not.toBeNull();
      rerender({ accountInfo: twoOfTwo, ...change });
      expect(result.current.options).toBeNull();
      expect(result.current.error).toBe('trading:assetSearch.multisig.contextChanged');
      // Weiter danach bewirkt nichts
      act(() => { result.current.proceed(); });
      expect(hoisted.createJob).not.toHaveBeenCalled();
    }
  });
});

describe('requiredWeightFor (T-4)', () => {
  const thresholds = { low_threshold: 1, med_threshold: 0, high_threshold: 3 };
  it('Swap nutzt Medium (pathPaymentStrictSend): bei med 0 gilt low', () => {
    expect(requiredWeightFor('swap', thresholds)).toBe(1);
    expect(requiredWeightFor('trustlineSwap', thresholds)).toBe(1);
    expect(requiredWeightFor('offer', thresholds)).toBe(1);
  });
  it('Gegenprobe: payment haette high verlangt', () => {
    expect(getRequiredThreshold('payment', thresholds)).toBe(3);
  });
});
