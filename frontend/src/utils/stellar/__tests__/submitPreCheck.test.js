// @vitest-environment node
// Buendel 4b, Teil C: Memo-Pruefung (SEP-29) vor dem POST, getrennt vom Senden. Fehler dabei sind
// "nichts gesendet", nie "unklar". Wartezeit nur beim Laden (GET), nie beim POST.
import { describe, expect, it, vi } from 'vitest';
import {
  Account, AccountRequiresMemoError, Asset, Horizon, Keypair, Networks, NotFoundError, Operation, TransactionBuilder,
} from '@stellar/stellar-sdk';
import { isAccountRequiresMemoError, isNotFoundError, makeMemoRequiredError } from '../memoRequired.js';
import { isTransientLoadError, loadWithBackoff } from '../retryLoad.js';
import {
  AmbiguousSubmitResultError, PreSubmitCheckError, requestTargetOf, submitTransactionSafely, verifyMemoRequired,
} from '../submitTransactionSafely.js';

const SRC = Keypair.random();
const DEST = Keypair.random().publicKey();

function paymentTx() {
  const tx = new TransactionBuilder(new Account(SRC.publicKey(), '100'), { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: DEST, asset: Asset.native(), amount: '1' }))
    .setTimeout(60).build();
  tx.sign(SRC);
  return tx;
}

const noWait = async () => {};
const netErr = () => new TypeError('Failed to fetch');
const httpErr = (status) => Object.assign(new Error(`http ${status}`), { response: { status, data: {} } });
const notFoundLookups = () => ({ transaction: () => ({ call: async () => { throw httpErr(404); } }) });

describe('isAccountRequiresMemoError (echtes SDK)', () => {
  it('erkennt die Klasse des SDK, obwohl deren name "Error" bleibt', () => {
    const err = new AccountRequiresMemoError('account requires memo', DEST, 0);
    expect(err.name).toBe('Error');
    expect(isAccountRequiresMemoError(err)).toBe(true);
  });

  it('erkennt den von SKM selbst geworfenen Fehler', () => {
    expect(isAccountRequiresMemoError(makeMemoRequiredError(DEST))).toBe(true);
  });

  it('erkennt den Fehler, den checkMemoRequired() des echten SDK wirft', async () => {
    const server = new Horizon.Server('https://horizon-testnet.stellar.org');
    server.loadAccount = async () => ({ data_attr: { 'config.memo_required': 'MQ==' } });
    const err = await server.checkMemoRequired(paymentTx()).catch((e) => e);
    expect(isAccountRequiresMemoError(err)).toBe(true);
  });

  it('andere Fehler sind es nicht', () => {
    expect(isAccountRequiresMemoError(new Error('x'))).toBe(false);
    expect(isAccountRequiresMemoError(netErr())).toBe(false);
    expect(isAccountRequiresMemoError(undefined)).toBe(false);
  });
});

describe('loadWithBackoff', () => {
  it('wiederholt nur kurzzeitige Fehler, mit Wartezeit, und liefert dann das Ergebnis', async () => {
    const sleep = vi.fn(async () => {});
    const load = vi.fn().mockRejectedValueOnce(netErr()).mockRejectedValueOnce(httpErr(503)).mockResolvedValue('ok');
    await expect(loadWithBackoff(load, { sleep })).resolves.toBe('ok');
    expect(load).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });

  it('gibt nach allen Versuchen den letzten Fehler weiter', async () => {
    const load = vi.fn().mockRejectedValue(netErr());
    await expect(loadWithBackoff(load, { sleep: noWait })).rejects.toThrow('Failed to fetch');
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('wiederholt weder 4xx noch den Fehler "Konto verlangt Memo"', async () => {
    for (const err of [httpErr(404), httpErr(400), makeMemoRequiredError(DEST)]) {
      const load = vi.fn().mockRejectedValue(err);
      await expect(loadWithBackoff(load, { sleep: noWait })).rejects.toBe(err);
      expect(load).toHaveBeenCalledTimes(1);
    }
    expect(isTransientLoadError(httpErr(429))).toBe(true);
  });
});

describe('submitTransactionSafely: Pruefung vor dem POST', () => {
  it('Netzfehler beim Laden des Zielkontos (echte SDK-Pruefung): PreSubmitCheckError, es wird NICHT gesendet', async () => {
    const server = new Horizon.Server('https://horizon-testnet.stellar.org');
    server.loadAccount = vi.fn(async () => { throw netErr(); });
    const post = vi.spyOn(server.httpClient, 'post').mockResolvedValue({ data: {} });
    const err = await submitTransactionSafely(server, paymentTx(), { sleep: noWait }).catch((e) => e);
    expect(err).toBeInstanceOf(PreSubmitCheckError);
    expect(err).not.toBeInstanceOf(AmbiguousSubmitResultError);
    expect(err.message).toBe('submitTransaction.failed:memoCheck.unreachable');
    expect(post).not.toHaveBeenCalled();
    expect(server.loadAccount).toHaveBeenCalledTimes(3); // nur das Laden wurde wiederholt
  });

  it('Ziel verlangt Memo (echte SDK-Pruefung): der SDK-Fehler kommt durch, es wird NICHT gesendet', async () => {
    const server = new Horizon.Server('https://horizon-testnet.stellar.org');
    server.loadAccount = vi.fn(async () => ({ data_attr: { 'config.memo_required': 'MQ==' } }));
    const post = vi.spyOn(server.httpClient, 'post').mockResolvedValue({ data: {} });
    const err = await submitTransactionSafely(server, paymentTx(), { sleep: noWait }).catch((e) => e);
    expect(isAccountRequiresMemoError(err)).toBe(true);
    expect(post).not.toHaveBeenCalled();
    expect(server.loadAccount).toHaveBeenCalledTimes(1); // keine Wiederholung
  });

  it('Laden klappt beim zweiten Versuch: der POST wird genau einmal gesendet', async () => {
    const server = {
      checkMemoRequired: vi.fn().mockRejectedValueOnce(netErr()).mockResolvedValue(undefined),
      submitTransaction: vi.fn(async () => ({ hash: 'h', successful: true })),
    };
    await submitTransactionSafely(server, paymentTx(), { sleep: noWait });
    expect(server.checkMemoRequired).toHaveBeenCalledTimes(2);
    expect(server.submitTransaction).toHaveBeenCalledTimes(1);
    expect(server.submitTransaction.mock.calls[0][1]).toEqual({ skipMemoRequiredCheck: true });
  });

  it('skipMemoRequiredCheck: keine SDK-Pruefung, der POST traegt die Option', async () => {
    const server = { checkMemoRequired: vi.fn(), submitTransaction: vi.fn(async () => ({ hash: 'h' })) };
    await submitTransactionSafely(server, paymentTx(), { skipMemoRequiredCheck: true });
    expect(server.checkMemoRequired).not.toHaveBeenCalled();
    expect(server.submitTransaction.mock.calls[0][1]).toEqual({ skipMemoRequiredCheck: true });
  });

  it('der POST selbst wird nie wiederholt: Netzfehler -> genau ein POST, danach "unklar"', async () => {
    const tx = paymentTx();
    const server = {
      checkMemoRequired: vi.fn(async () => {}),
      submitTransaction: vi.fn(async () => { throw netErr(); }),
      transactions: () => ({ transaction: () => ({ call: async () => { throw netErr(); } }) }),
    };
    vi.useFakeTimers();
    try {
      const promise = submitTransactionSafely(server, tx, { sleep: noWait }).catch((e) => e);
      await vi.runAllTimersAsync();
      expect(await promise).toBeInstanceOf(AmbiguousSubmitResultError);
    } finally {
      vi.useRealTimers();
    }
    expect(server.submitTransaction).toHaveBeenCalledTimes(1);
  });

  it('Server ohne checkMemoRequired (z.B. Test-Doubles): wie bisher, POST ohne zweiten Parameter', async () => {
    const server = { submitTransaction: vi.fn(async () => ({ hash: 'h' })) };
    await submitTransactionSafely(server, paymentTx());
    expect(server.submitTransaction.mock.calls[0]).toHaveLength(1);
  });
});

describe('Diagnose: echte Methode und URL', () => {
  it('requestTargetOf liefert Methode und URL ohne Query (auch unter cause)', () => {
    expect(requestTargetOf({ config: { url: 'https://h.example/accounts/GABC?x=1', method: 'get' } }))
      .toEqual({ method: 'GET', url: 'https://h.example/accounts/GABC' });
    expect(requestTargetOf({ cause: { config: { url: '/transactions', baseURL: 'https://h.example/api/', method: 'post' } } }))
      .toEqual({ method: 'POST', url: 'https://h.example/transactions' });
    expect(requestTargetOf(new Error('x'))).toBeNull();
    expect(requestTargetOf({ config: { url: 'http://[kaputt' } })).toBeNull();
  });

  it('PreSubmitCheckError traegt die GET-Anfrage, die gescheitert ist', () => {
    const cause = Object.assign(netErr(), { config: { url: 'https://h.example/accounts/GDEST', method: 'get' } });
    expect(new PreSubmitCheckError(cause).request).toEqual({ method: 'GET', url: 'https://h.example/accounts/GDEST' });
  });

  it('Diagnose eines unklaren POST enthaelt die echte URL und Methode des Fehlers', async () => {
    const cause = Object.assign(netErr(), { config: { url: 'https://h.example/transactions?tx=SECRET', method: 'post' } });
    const server = {
      serverURL: 'https://fallback.example',
      submitTransaction: vi.fn(async () => { throw cause; }),
      transactions: notFoundLookups,
    };
    vi.useFakeTimers();
    try {
      const promise = submitTransactionSafely(server, paymentTx(), { skipMemoRequiredCheck: true }).catch((e) => e);
      await vi.runAllTimersAsync();
      const err = await promise;
      expect(err.diagnostics.request).toMatchObject({ method: 'POST', url: 'https://h.example/transactions' });
      expect(JSON.stringify(err.diagnostics)).not.toContain('SECRET');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('N11: 404 wird ueber die SDK-Klasse erkannt, nicht ueber response.status', () => {
  it('NotFoundError mit beliebigem Body (HTML, leer, ohne "status") ist ein 404', () => {
    expect(isNotFoundError(new NotFoundError('Not Found', { status: 404 }))).toBe(true);
    expect(isNotFoundError(new NotFoundError('Not Found', '<html>proxy</html>'))).toBe(true);
    expect(isNotFoundError(new NotFoundError('Not Found', undefined))).toBe(true);
  });

  it('ein Fehler, der nur wie ein 404 aussieht, ist keiner', () => {
    expect(isNotFoundError(httpErr(404))).toBe(false);
    expect(isNotFoundError(netErr())).toBe(false);
    expect(isNotFoundError(undefined)).toBe(false);
  });

  it('loadWithBackoff wiederholt NotFoundError nie, auch wenn der Body keinen Status traegt', async () => {
    const sleep = vi.fn(async () => {});
    const load = vi.fn().mockRejectedValue(new NotFoundError('Not Found', '<html>proxy</html>'));
    await expect(loadWithBackoff(load, { sleep })).rejects.toBeInstanceOf(NotFoundError);
    expect(load).toHaveBeenCalledTimes(1);
    expect(isTransientLoadError(new NotFoundError('Not Found', {}))).toBe(false);
  });

  it('echtes checkMemoRequired: ein NotFoundError des Ziels (nicht aktiviert) ist keine Sperre', async () => {
    const server = new Horizon.Server('https://horizon-testnet.stellar.org');
    server.loadAccount = async () => { throw new NotFoundError('Not Found', '<html>proxy</html>'); };
    await expect(verifyMemoRequired(server, paymentTx())).resolves.toBeUndefined();
  });
});

describe('verifyMemoRequired (Pruefung der gebauten Transaktion, fail-closed)', () => {
  it('Ziel verlangt Memo: AccountRequiresMemoError, nicht PreSubmitCheckError', async () => {
    const server = new Horizon.Server('https://horizon-testnet.stellar.org');
    server.loadAccount = async () => ({ data_attr: { 'config.memo_required': 'MQ==' } });
    await expect(verifyMemoRequired(server, paymentTx())).rejects.toSatisfy(isAccountRequiresMemoError);
  });

  it('Netzfehler: nach Wiederholungen des Ladens PreSubmitCheckError, kein POST', async () => {
    const server = new Horizon.Server('https://horizon-testnet.stellar.org');
    server.loadAccount = vi.fn(async () => { throw netErr(); });
    server.submitTransaction = vi.fn();
    await expect(verifyMemoRequired(server, paymentTx(), { sleep: noWait })).rejects.toBeInstanceOf(PreSubmitCheckError);
    expect(server.loadAccount).toHaveBeenCalledTimes(3);
    expect(server.submitTransaction).not.toHaveBeenCalled();
  });

  it('Server ohne checkMemoRequired: gesperrt (fail-closed), anders als bei submitTransactionSafely mit Test-Doubles', async () => {
    await expect(verifyMemoRequired({}, paymentTx())).rejects.toBeInstanceOf(PreSubmitCheckError);
  });
});
