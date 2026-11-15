import { classifyFriendbotResponse, classifyHorizonSubmitError, isAccountNotFoundError } from '../activationOutcome.js';

// Review N21-2: Nur eine eindeutige Ablehnung darf den Vermerk einer Aktivierung loeschen.
describe('classifyFriendbotResponse', () => {
  it('2xx ist Erfolg', () => {
    expect(classifyFriendbotResponse(200, '{"hash":"x"}')).toBe('success');
  });

  it.each([
    [400, '{"detail":"account already funded to starting balance"}'],
    [400, '{"detail":"createAccountAlreadyExist"}'],
    [400, '{"extras":{"result_codes":{"transaction":"tx_failed","operations":["op_already_exists"]}}}'],
    [500, 'op_already_exists'],
  ])('Status %s mit "Konto existiert" ist exists', (status, body) => {
    expect(classifyFriendbotResponse(status, body)).toBe('exists');
  });

  it.each([
    [500, 'Internal Server Error'],
    [502, '<html>Bad Gateway</html>'],
    [503, ''],
    [504, '{"detail":"timeout"}'],
    [429, '{"detail":"rate limit exceeded"}'],
    [408, 'Request Timeout'],
  ])('Status %s ist unklar', (status, body) => {
    expect(classifyFriendbotResponse(status, body)).toBe('ambiguous');
  });

  it('4xx ohne erkennbaren Fehlertext ist unklar (leer oder HTML einer Proxy-Seite)', () => {
    expect(classifyFriendbotResponse(400, '')).toBe('ambiguous');
    expect(classifyFriendbotResponse(403, '<html><body>Forbidden</body></html>')).toBe('ambiguous');
    expect(classifyFriendbotResponse(400, '{}')).toBe('ambiguous');
  });

  it('4xx mit Fehlertext ist abgelehnt', () => {
    expect(classifyFriendbotResponse(400, '{"title":"Bad Request","detail":"invalid address"}')).toBe('rejected');
    expect(classifyFriendbotResponse(404, 'not found')).toBe('rejected');
  });
});

describe('classifyHorizonSubmitError', () => {
  const withCodes = (codes) => ({ response: { status: 400, data: { extras: { result_codes: codes } } } });

  it('ohne result_codes (Timeout, Netzfehler) unklar', () => {
    expect(classifyHorizonSubmitError(new Error('timeout'))).toBe('ambiguous');
    expect(classifyHorizonSubmitError({ response: { status: 504, data: { title: 'Timeout' } } })).toBe('ambiguous');
  });

  it('op_already_exists ist exists, andere result_codes abgelehnt', () => {
    expect(classifyHorizonSubmitError(withCodes({ transaction: 'tx_failed', operations: ['op_already_exists'] }))).toBe('exists');
    expect(classifyHorizonSubmitError(withCodes({ transaction: 'tx_failed', operations: ['op_underfunded'] }))).toBe('rejected');
    expect(classifyHorizonSubmitError(withCodes({ transaction: 'tx_bad_seq' }))).toBe('rejected');
  });
});

describe('isAccountNotFoundError', () => {
  it('nur 404 bzw. NotFoundError', () => {
    expect(isAccountNotFoundError({ response: { status: 404 } })).toBe(true);
    expect(isAccountNotFoundError(Object.assign(new Error('x'), { name: 'NotFoundError' }))).toBe(true);
    expect(isAccountNotFoundError(new Error('Network Error'))).toBe(false);
    expect(isAccountNotFoundError({ response: { status: 503 } })).toBe(false);
  });
});

// Nachtrag F-10: classifyHorizonSubmitError prueft result_codes mit derselben Regel wie isAmbiguousSubmitError
// (hasUsableResultCodes aus submitTransactionSafely.js). Ein leeres oder unbrauchbares result_codes-Objekt ist
// unklar statt Ablehnung. Wie bisher strenger als isAmbiguousSubmitError: Ohne brauchbare Codes ist jeder
// Fehler unklar, auch ein 4xx (der Secret Key eines womoeglich gefuellten Kontos bleibt erhalten).
describe('classifyHorizonSubmitError: gleiche Pruefung der result_codes (Nachtrag F-10)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { hasUsableResultCodes, isAmbiguousSubmitError } = await import('../submitTransactionSafely.js');
  // Unter jsdom ist import.meta.url keine file:-URL; Vitest laeuft in frontend/.
  const { cases } = JSON.parse(fs.readFileSync(path.join(globalThis.process.cwd(), '..', 'test', 'assets', 'submit-classification.json'), 'utf8'));
  // 2xx: kein Fehler, den submitTransaction wirft (wie im Test von isAmbiguousSubmitError).
  const errorCases = cases.filter((c) => !(typeof c.status === 'number' && c.status >= 200 && c.status < 300));
  const errorFor = (c) => (c.status === null
    ? new Error('socket hang up')
    : Object.assign(new Error(`status ${c.status}`), { response: { status: c.status, data: c.data } }));
  const codesOf = (err) => err?.response?.data?.extras?.result_codes;

  it('eine Regel an einer Stelle: activationOutcome nutzt hasUsableResultCodes aus submitTransactionSafely.js', () => {
    const source = fs.readFileSync(path.join(globalThis.process.cwd(), 'src', 'utils', 'stellar', 'activationOutcome.js'), 'utf8');
    expect(source).toMatch(/import \{ hasUsableResultCodes \} from '\.\/submitTransactionSafely\.js';/);
    expect(typeof hasUsableResultCodes).toBe('function');
  });

  it.each(errorCases.map((c) => [c.name, c]))('%s', (_name, c) => {
    const err = errorFor(c);
    const kind = classifyHorizonSubmitError(err);
    // Unklar genau dann, wenn keine brauchbaren Codes da sind.
    expect(kind === 'ambiguous').toBe(!hasUsableResultCodes(codesOf(err)));
    // Nie lockerer als die Einordnung beim Senden: Was dort unklar ist, ist hier auch unklar.
    if (isAmbiguousSubmitError(err)) expect(kind).toBe('ambiguous');
  });

  it.each([{}, { operations: [] }, { operations: [1, null] }, { transaction: 5 }, 'tx_failed', ['tx_failed']])(
    'unbrauchbares result_codes %j ist unklar statt Ablehnung', (codes) => {
      expect(classifyHorizonSubmitError({ response: { status: 400, data: { extras: { result_codes: codes } } } })).toBe('ambiguous');
    },
  );

  // Alte Regel wortgleich (Stand vor dem Nachtrag): nur strenger, nie lockerer.
  const oldRule = (err) => {
    const codes = err?.response?.data?.extras?.result_codes;
    if (!codes) return 'ambiguous';
    const ops = Array.isArray(codes.operations) ? codes.operations : [];
    if (ops.includes('op_already_exists')) return 'exists';
    return 'rejected';
  };
  it('nur strenger als vorher: wo die alte Regel unklar sagte, sagt die neue es auch, und exists bleibt exists', () => {
    const errs = [...errorCases.map(errorFor), { response: { status: 400, data: { extras: { result_codes: { operations: ['op_already_exists'] } } } } }];
    let stricter = 0;
    for (const err of errs) {
      const before = oldRule(err);
      const after = classifyHorizonSubmitError(err);
      if (before === 'ambiguous') expect(after).toBe('ambiguous');
      if (before === 'exists') expect(after).toBe('exists');
      if (before === 'rejected' && after === 'ambiguous') stricter += 1;
      if (before === 'rejected') expect(['rejected', 'ambiguous']).toContain(after);
    }
    expect(stricter).toBeGreaterThan(0);
  });
});
