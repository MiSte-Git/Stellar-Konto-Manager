import {
  clearSendPaymentDraft, draftGeneration, findSentPayment, readSendPaymentDraft, recordSentPayment, writeSendPaymentDraft,
} from '../sendPaymentDraft.js';
import { clearAllSessionSecrets } from '../sessionSecrets.js';

const SECRET = 'SDAIDSY2LAXR5HPEJ2CKWQ3QV67VPYLXB6C2ATBY3J7VRKT6YD7SYV6Y';
const base = { network: 'PUBLIC', account: 'GA', dest: 'GB', amount: '5', assetKey: 'XLM', memoType: 'text', memoVal: 'r1' };

beforeEach(() => clearSendPaymentDraft());

describe('sendPaymentDraft', () => {
  it('returns the draft only for its own network', () => {
    writeSendPaymentDraft({ dest: 'GB', amount: '5', network: 'PUBLIC' });
    expect(readSendPaymentDraft('PUBLIC')?.amount).toBe('5');
    expect(readSendPaymentDraft('TESTNET')).toBeNull();
  });

  it('does not keep fields that look like a secret key', () => {
    writeSendPaymentDraft({ dest: SECRET, amount: '5', memoVal: `x ${SECRET}`, network: 'PUBLIC' });
    const d = readSendPaymentDraft('PUBLIC');
    expect(d.dest).toBe('');
    expect(d.memoVal).toBe('');
    expect(d.amount).toBe('5');
  });

  it('F11: filters autoFilledMemo and the values of initial, which do not come from an input field', () => {
    writeSendPaymentDraft({ dest: 'GB', autoFilledMemo: `memo ${SECRET}`, initial: { recipient: SECRET, amount: 5, memoText: `x ${SECRET}`, label: 'ok' }, network: 'PUBLIC' });
    const d = readSendPaymentDraft('PUBLIC');
    expect(d.autoFilledMemo).toBe('');
    expect(d.initial).toEqual({ recipient: '', amount: 5, memoText: '', label: 'ok' });
    expect(JSON.stringify(d)).not.toContain(SECRET);
  });

  it('F11: keeps harmless autoFilledMemo and the same initial object (the page recognizes initial by identity)', () => {
    const initial = { recipient: 'GB', amount: 5, memoText: 'r1' };
    writeSendPaymentDraft({ dest: 'GB', autoFilledMemo: 'r1', initial, network: 'PUBLIC' });
    const d = readSendPaymentDraft('PUBLIC');
    expect(d.autoFilledMemo).toBe('r1');
    expect(d.initial).toBe(initial);
  });

  it('F11: a missing or null autoFilledMemo and initial stay as they are', () => {
    writeSendPaymentDraft({ dest: 'GB', autoFilledMemo: null, initial: undefined, network: 'PUBLIC' });
    const d = readSendPaymentDraft('PUBLIC');
    expect(d.autoFilledMemo).toBeNull();
    expect(d.initial).toBeUndefined();
  });

  it('ignores writes from an instance mounted before the lock', () => {
    const gen = draftGeneration();
    expect(writeSendPaymentDraft({ amount: '1', network: 'PUBLIC' }, gen)).toBe(true);
    clearAllSessionSecrets();
    expect(readSendPaymentDraft('PUBLIC')).toBeNull();
    expect(writeSendPaymentDraft({ amount: '2', network: 'PUBLIC' }, gen)).toBe(false);
    expect(readSendPaymentDraft('PUBLIC')).toBeNull();
    expect(writeSendPaymentDraft({ amount: '3', network: 'PUBLIC' }, draftGeneration())).toBe(true);
  });

  it('remembers sent payments per account, network and exact data', () => {
    recordSentPayment(base, { hash: 'h1', at: 1000 });
    expect(findSentPayment(base, 2000)).toMatchObject({ hash: 'h1', status: 'success' });
    expect(findSentPayment({ ...base, account: 'GC' }, 2000)).toBeNull();
    expect(findSentPayment({ ...base, network: 'TESTNET' }, 2000)).toBeNull();
    expect(findSentPayment({ ...base, amount: '6' }, 2000)).toBeNull();
    expect(findSentPayment({ ...base, memoType: 'id' }, 2000)).toBeNull();
    expect(findSentPayment({ ...base, dest: ' GB ' }, 2000)).not.toBeNull();
    expect(findSentPayment(base, 1000 + 21 * 60 * 60 * 1000)).toBeNull();
  });

  it('ignores the memo value when there is no memo, and forgets everything on lock', () => {
    recordSentPayment({ ...base, memoType: 'none', memoVal: 'alt' }, { status: 'ambiguous', at: 1000 });
    expect(findSentPayment({ ...base, memoType: 'none', memoVal: '' }, 2000)?.status).toBe('ambiguous');
    clearAllSessionSecrets();
    expect(findSentPayment({ ...base, memoType: 'none', memoVal: '' }, 2000)).toBeNull();
  });
});
