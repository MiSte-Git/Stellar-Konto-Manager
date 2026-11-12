import { act, renderHook, waitFor } from '@testing-library/react';
import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import useTradingMultisig, { requiredWeightFor } from '../hooks/useTradingMultisig.js';
import { setSessionSecrets } from '../../../utils/sessionSecrets.js';
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

// Direkter Weg: ein gemerkter Session-Key, der die Schwelle allein erreicht, signiert ohne Key-Dialog.
describe('useTradingMultisig - start mit gemerktem Session-Key', () => {
  const master = Keypair.random();
  const cosigner = Keypair.random();
  const ACC = master.publicKey();
  const ed = (kp, weight) => ({ key: kp.publicKey(), weight, type: 'ed25519_public_key' });
  const single = { signers: [ed(master, 1)], thresholds: { low_threshold: 0, med_threshold: 1, high_threshold: 1 } };
  const twoOfTwo = { signers: [ed(master, 1), ed(cosigner, 1)], thresholds: { low_threshold: 0, med_threshold: 2, high_threshold: 2 } };
  const oneOfTwo = { signers: [ed(master, 1), ed(cosigner, 1)], thresholds: { low_threshold: 0, med_threshold: 1, high_threshold: 2 } };
  const act1 = (overrides = {}) => makeAction({ accountId: ACC, execute: vi.fn(async () => true), ...overrides });
  const render = (accountInfo, props = {}) => renderMultisig({ accountId: ACC, accountInfo, ...props });

  beforeEach(() => { sessionStorage.clear(); });
  afterEach(() => { sessionStorage.clear(); });

  it('Key gemerkt und reicht allein: execute mit genau diesem Signer, kein Key-Dialog', async () => {
    await setSessionSecrets(ACC, { [ACC]: master.secret() });
    const beginAction = vi.fn();
    const { result } = render(single, { beginAction });
    const action = act1();
    await act(async () => { result.current.start(action); });
    await waitFor(() => expect(action.execute).toHaveBeenCalledTimes(1));
    const [collected] = action.execute.mock.calls[0];
    expect(collected).toHaveLength(1);
    expect(collected[0].keypair.publicKey()).toBe(ACC);
    expect(beginAction).not.toHaveBeenCalled();
    expect(result.current.options).toBeNull();
  });

  it('Gegenprobe: nichts gemerkt: sofort (synchron) der Key-Dialog, kein execute', () => {
    const beginAction = vi.fn();
    const { result } = render(single, { beginAction });
    const action = act1();
    act(() => { result.current.start(action); });
    expect(beginAction).toHaveBeenCalledTimes(1);
    expect(beginAction).toHaveBeenCalledWith(action.type, action.payload, action.execute);
    expect(action.execute).not.toHaveBeenCalled();
  });

  it('Gegenprobe: Key gemerkt, aber sein Gewicht reicht nicht (ein anderer Signer mit 3 schon): Key-Dialog, kein execute', async () => {
    await setSessionSecrets(ACC, { [ACC]: master.secret() });
    const beginAction = vi.fn();
    const info = { signers: [ed(master, 1), ed(cosigner, 3)], thresholds: { low_threshold: 0, med_threshold: 3, high_threshold: 3 } };
    const { result } = render(info, { beginAction });
    const action = act1();
    await act(async () => { result.current.start(action); });
    await waitFor(() => expect(beginAction).toHaveBeenCalledTimes(1));
    expect(action.execute).not.toHaveBeenCalled();
    expect(result.current.options).toBeNull();
  });

  it('Mehrere Signer, aber einer reicht (1 von 2): auch hier signiert der gemerkte Key allein', async () => {
    await setSessionSecrets(ACC, { [ACC]: master.secret() });
    const beginAction = vi.fn();
    const { result } = render(oneOfTwo, { beginAction });
    const action = act1();
    await act(async () => { result.current.start(action); });
    await waitFor(() => expect(action.execute).toHaveBeenCalledTimes(1));
    expect(beginAction).not.toHaveBeenCalled();
  });

  it('Multisig 2 von 2 bleibt unveraendert: Auswahl Job/lokal/XDR, kein Auto-Signieren trotz gemerktem Key', async () => {
    await setSessionSecrets(ACC, { [ACC]: master.secret() });
    const beginAction = vi.fn();
    const { result } = render(twoOfTwo, { beginAction });
    const action = act1();
    await act(async () => { result.current.start(action); });
    expect(result.current.options).toBe(action);
    expect(action.execute).not.toHaveBeenCalled();
    expect(beginAction).not.toHaveBeenCalled();
  });

  it('Lokaler Multisig-Weg bleibt unveraendert: Dialog statt Auto-Signatur', async () => {
    await setSessionSecrets(ACC, { [ACC]: master.secret() });
    const beginAction = vi.fn();
    const { result } = render(twoOfTwo, { beginAction });
    const action = act1();
    await act(async () => { result.current.start(action); });
    act(() => { result.current.setChoice('local'); });
    act(() => { result.current.proceed(); });
    expect(beginAction).toHaveBeenCalledTimes(1);
    expect(action.execute).not.toHaveBeenCalled();
  });

  it('Netz oder Konto wechseln, waehrend der Key gelesen wird: nichts signiert, Hinweis, kein Dialog', async () => {
    await setSessionSecrets(ACC, { [ACC]: master.secret() });
    const beginAction = vi.fn();
    const { result, rerender } = render(single, { beginAction });
    const action = act1();
    await act(async () => {
      result.current.start(action);
      rerender({ accountId: Keypair.random().publicKey(), accountInfo: single, beginAction });
    });
    await waitFor(() => expect(result.current.error).toBe('trading:assetSearch.multisig.contextChanged'));
    expect(action.execute).not.toHaveBeenCalled();
    expect(beginAction).not.toHaveBeenCalled();
  });

  it('Doppelstart waehrend der Key gelesen wird: genau ein execute', async () => {
    await setSessionSecrets(ACC, { [ACC]: master.secret() });
    const { result } = render(single);
    const action = act1();
    await act(async () => { result.current.start(action); result.current.start(action); });
    await waitFor(() => expect(action.execute).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(action.execute).toHaveBeenCalledTimes(1);
  });

  it('wirft execute, kommt eine Meldung statt eines Absturzes; danach ist ein neuer Start moeglich', async () => {
    await setSessionSecrets(ACC, { [ACC]: master.secret() });
    const { result } = render(single);
    const bad = act1({ execute: vi.fn(async () => { throw new Error('boom'); }) });
    await act(async () => { result.current.start(bad); });
    await waitFor(() => expect(result.current.error).not.toBe(''));
    const good = act1();
    await act(async () => { result.current.start(good); });
    await waitFor(() => expect(good.execute).toHaveBeenCalledTimes(1));
  });
});
