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
