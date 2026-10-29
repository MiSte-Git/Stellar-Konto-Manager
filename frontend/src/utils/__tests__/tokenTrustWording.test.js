// @vitest-environment node
// Token-Trust-Prinzip: SKM bewertet keine Token, weder als echt noch als unecht. Dieser Test
// prueft die DE-Quelltexte der betroffenen Bereiche auf wertende Begriffe. Ausdrueckliche
// Verneinungen ("keine Empfehlung", "SKM bewertet keine Token", "ob ein Token echt ist" im
// Sinne von "keine Aussage darueber") sind erlaubt und werden vor der Pruefung entfernt.
import { describe, it, expect } from 'vitest';
import wallet from '../../locales/de/wallet.json';
import multisig from '../../locales/de/multisig.json';
import trading from '../../locales/de/trading.json';
import liquidity from '../../locales/de/liquidity.json';

const FORBIDDEN = [
  /betrug/i, /scam/i, /\bfake\b/i, /gefälscht/i, /\bunseriös/i, /\bseriös/i, /vertrauenswürdig/i,
  /legitim/i, /\bechte?[rsn]?\b/i, /empfehl/i, /harmlos/i, /unbedenklich/i, /gefährlich/i,
  /\bsicher(e|er|es)?\s+(token|asset)/i,
];

// Erlaubte Verneinungen, die vor der Pruefung entfernt werden
const ALLOWED = [
  /SKM bewertet keine Token[^.]*\./gi,
  /keine Aussage darüber, ob ein Token echt ist/gi,
  /(keine|kein|nicht|nie|niemals)\s+(Bewertung|Empfehlung|Echtheits\S*|Betrugs\S*)/gi,
  /Das ist keine Empfehlung\./gi,
];

function strings(obj, prefix) {
  if (typeof obj === 'string') return [[prefix, obj]];
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj).flatMap(([k, v]) => strings(v, prefix ? `${prefix}.${k}` : k));
}

const SCOPES = [
  ['wallet.claimable', wallet.claimable],
  ['wallet.batchConvert', wallet.batchConvert],
  ['wallet.home.tokenNote', wallet.home?.tokenNote],
  ['multisig.detail.operations', multisig.detail?.operations],
  ['wallet.activity', wallet.activity],
  ['trading', trading],
  ['liquidity', liquidity],
];

describe('Token-Trust-Prinzip in den Texten', () => {
  it('die gepruefte Bereiche existieren', () => {
    SCOPES.forEach(([name, obj]) => expect(obj, name).toBeTruthy());
  });

  it.each(SCOPES)('%s enthaelt keine wertenden Begriffe', (name, obj) => {
    const violations = strings(obj, name)
      .map(([key, text]) => {
        const cleaned = ALLOWED.reduce((acc, rx) => acc.replace(rx, ''), text);
        const hit = FORBIDDEN.find((rx) => rx.test(cleaned));
        return hit ? `${key}: ${hit} in "${text}"` : null;
      })
      .filter(Boolean);
    expect(violations).toEqual([]);
  });

  it('erkennt eine Wertung tatsaechlich (Selbsttest)', () => {
    const check = (text) => FORBIDDEN.some((rx) => rx.test(ALLOWED.reduce((acc, r) => acc.replace(r, ''), text)));
    expect(check('Dieses Token ist seriös.')).toBe(true);
    expect(check('Das ist ein Betrugsindiz.')).toBe(true);
    expect(check('Das ist kein Betrugsindiz.')).toBe(false);
    expect(check('Das ist keine Empfehlung.')).toBe(false);
  });
});
