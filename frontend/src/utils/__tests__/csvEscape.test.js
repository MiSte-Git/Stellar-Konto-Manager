import { describe, expect, it } from 'vitest';
import { csvEscape, csvLine } from '../csvEscape.js';

describe('csvEscape (F2 - CSV/spreadsheet formula injection guard)', () => {
  it('leaves plain text untouched', () => {
    expect(csvEscape('hello world', ',')).toBe('hello world');
  });

  it('quotes cells containing the delimiter', () => {
    expect(csvEscape('a,b', ',')).toBe('"a,b"');
  });

  it('quotes and escapes embedded quotes', () => {
    expect(csvEscape('say "hi"', ',')).toBe('"say ""hi"""');
  });

  it('quotes cells containing newlines', () => {
    expect(csvEscape('line1\nline2', ',')).toBe('"line1\nline2"');
  });

  it('neutralizes a leading "=" formula trigger', () => {
    expect(csvEscape('=SUM(A1:A9)', ',')).toBe("'=SUM(A1:A9)");
  });

  it('neutralizes a leading "+" formula trigger', () => {
    expect(csvEscape('+1+1', ',')).toBe("'+1+1");
  });

  it('neutralizes a leading "-" formula trigger', () => {
    expect(csvEscape('-2+3', ',')).toBe("'-2+3");
  });

  it('neutralizes a leading "@" formula trigger (Excel legacy macro call)', () => {
    // Also contains the delimiter, so the whole cell gets quoted too.
    expect(csvEscape('@SUM(1,2)', ',')).toBe('"\'@SUM(1,2)"');
  });

  it('neutralizes a leading tab and carriage return', () => {
    expect(csvEscape('\t=1+1', ',')).toBe("'\t=1+1");
    expect(csvEscape('\r=1+1', ',')).toBe('"\'\r=1+1"');
  });

  it('quotes cells containing a carriage return', () => {
    expect(csvEscape('line1\rline2', ',')).toBe('"line1\rline2"');
  });

  it('combines the leading-quote neutralization with delimiter quoting', () => {
    expect(csvEscape('=1,2', ',')).toBe('"\'=1,2"');
  });

  it('does not treat a formula char in the middle of the text as dangerous', () => {
    expect(csvEscape('total = 5', ',')).toBe('total = 5');
  });

  it('treats null/undefined as an empty string', () => {
    expect(csvEscape(null, ',')).toBe('');
    expect(csvEscape(undefined, ',')).toBe('');
  });

  it('respects a custom delimiter (e.g. semicolon)', () => {
    expect(csvEscape('a;b', ';')).toBe('"a;b"');
    expect(csvEscape('a,b', ';')).toBe('a,b');
  });
});

describe('csvLine', () => {
  it('schuetzt Text-Zellen und laesst echte Zahlen stehen', () => {
    expect(csvLine(['=HYPERLINK("x")', -1.5, 0, '12.5000000', null], ';')).toBe('"\'=HYPERLINK(""x"")";-1.5;0;12.5000000;');
  });

  it('setzt Zellen mit dem Trennzeichen in Anfuehrungszeichen', () => {
    expect(csvLine(['a;b', 'c,d'], ';')).toBe('"a;b";c,d');
    expect(csvLine(['a;b', 'c,d'], ',')).toBe('a;b,"c,d"');
  });

  it('behandelt ein Memo als Text, auch wenn es wie eine negative Zahl aussieht', () => {
    expect(csvLine(['-5', '@cmd'], ';')).toBe("'-5;'@cmd");
  });
});
