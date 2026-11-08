import { act, renderHook } from '@testing-library/react';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import useTradingMultisig, { requiredWeightFor } from '../hooks/useTradingMultisig.js';
import { getRequiredThreshold } from '../../../utils/getRequiredThreshold.js';
import { readAccountEntry, resetAccountSendGuardMemory, writeAccountEntry } from '../../../utils/submitGuard/accountSendGuard.js';

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

describe('useTradingMultisig - Sperre und Pin gelten schon beim Bauen von Job und XDR (Buendel 4b, M2)', () => {
  const unclear = (o = {}) => ({ hash: 'a'.repeat(64), at: 1000, status: 'ambiguous', maxTime: 2000, seq: '11', source: ACCOUNT, origin: 'payment', ...o });
  const pin = (o = {}) => unclear({ status: 'notApplied', pin: true, seq: '11', at: Date.now(), ...o });
  // prepare wie im Trading: das geladene Konto (Sequence 10) durch adjustAccount schicken.
  const pinAwarePrepare = () => vi.fn(async ({ adjustAccount }) => {
    const loaded = new Account(ACCOUNT, '10');
    const acc = adjustAccount ? adjustAccount(loaded) : loaded;
    const tx = new TransactionBuilder(acc, { fee: '100', networkPassphrase: Networks.PUBLIC })
      .addOperation(Operation.changeTrust({ asset: new Asset('FOO', Keypair.random().publicKey()) }))
      .setTimeout(3600).build();
    return { tx };
  });

  beforeEach(() => { resetAccountSendGuardMemory(); });

  it.each(['job', 'xdr'])('unklarer Eintrag des Kontos: %s wird nicht gebaut, Hinweis, Status-Kasten wird neu gelesen', async (mode) => {
    writeAccountEntry('PUBLIC', ACCOUNT, unclear());
    const onBlocked = vi.fn();
    const { result } = renderMultisig({ onBlocked });
    const action = makeAction({ prepare: pinAwarePrepare() });
    await act(async () => { await result.current.runUnsigned(action, mode); });
    expect(action.prepare).not.toHaveBeenCalled();
    expect(hoisted.createJob).not.toHaveBeenCalled();
    expect(result.current.exportedXdr).toBeNull();
    expect(result.current.preparedJob).toBeNull();
    expect(result.current.error).toBe('common:payment.send.ambiguousResult.unsignedBlockedReason.blocked');
    expect(onBlocked).toHaveBeenCalled();
  });

  it.each(['job', 'xdr'])('offener Pin, Sequence passt nicht mehr: %s wird verweigert, fruehere Transaktion wieder unklar', async (mode) => {
    writeAccountEntry('PUBLIC', ACCOUNT, pin({ seq: '15' })); // Konto steht bei 10, der Pin braucht genau 14
    const { result } = renderMultisig();
    const action = makeAction({ prepare: pinAwarePrepare() });
    await act(async () => { await result.current.runUnsigned(action, mode); });
    expect(hoisted.createJob).not.toHaveBeenCalled();
    expect(result.current.exportedXdr).toBeNull();
    expect(result.current.error).toBe('common:payment.send.ambiguousResult.unsignedBlockedReason.pinConsumed');
    expect(readAccountEntry('PUBLIC', ACCOUNT)).toMatchObject({ status: 'ambiguous', recheck: 'pinConsumed' });
  });

  it('offener Pin, Aktion wendet adjustAccount nicht an: nicht gebaut (nie ohne Pin)', async () => {
    writeAccountEntry('PUBLIC', ACCOUNT, pin());
    const { result } = renderMultisig();
    const action = makeAction(); // Standard-prepare ignoriert adjustAccount
    await act(async () => { await result.current.runUnsigned(action, 'xdr'); });
    expect(result.current.exportedXdr).toBeNull();
    expect(result.current.error).toBe('common:payment.send.ambiguousResult.unsignedBlockedReason.pinConsumed');
  });

  it('Gegenprobe: Pin passt genau (Konto 10, Pin 11): Job und XDR nutzen die Pin-Sequence', async () => {
    writeAccountEntry('PUBLIC', ACCOUNT, pin());
    const { result } = renderMultisig();
    const action = makeAction({ prepare: pinAwarePrepare() });
    await act(async () => { await result.current.runUnsigned(action, 'xdr'); });
    expect(action.prepare).toHaveBeenCalledTimes(1);
    expect(result.current.exportedXdr?.xdr).toBeTruthy();
    const built = (await action.prepare.mock.results[0].value).tx;
    expect(built.sequence).toBe('11');
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
