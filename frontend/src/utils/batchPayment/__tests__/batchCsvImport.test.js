import { Keypair } from '@stellar/stellar-sdk';
import { detectDelimiter, parseBatchCsv, parseCsv, MAX_IMPORT_BYTES } from '../batchCsvImport.js';

const A = Keypair.random().publicKey();
const B = Keypair.random().publicKey();
const ISSUER = Keypair.random().publicKey();
const SECRET = Keypair.random().secret();
const enc = (s) => new TextEncoder().encode(s);

describe('parseCsv / detectDelimiter', () => {
  it('erkennt Semikolon, Komma, Tab aus der Kopfzeile, ignoriert Trenner in Anfuehrungszeichen', () => {
    expect(detectDelimiter('Sender;Empfänger;Betrag')).toBe(';');
    expect(detectDelimiter('Sender,Empfänger,Betrag')).toBe(',');
    expect(detectDelimiter('Sender\tEmpfänger\tBetrag')).toBe('\t');
    expect(detectDelimiter('"a;b;c",x,y')).toBe(',');
  });
  it('Anfuehrungszeichen, doppelte Anfuehrungszeichen, Zeilenumbruch im Feld, CRLF', () => {
    const { records, error } = parseCsv('a,b\r\n"x, ""y""","z\nw"\r\n', ',');
    expect(error).toBeNull();
    expect(records[1]).toEqual({ line: 2, cells: ['x, "y"', 'z\nw'] });
  });
  it('kaputte Anfuehrungszeichen sind ein Dateifehler', () => {
    expect(parseCsv('a,b\n"x"y,z', ',').error).toEqual({ code: 'importBadQuotes', line: 2 });
    expect(parseCsv('a,b\n"offen,z', ',').error.code).toBe('importBadQuotes');
  });
});

describe('parseBatchCsv', () => {
  it('deutsche Kopfzeile mit BOM, Semikolon, Dezimalkomma, Asset-Formen, Memo-Typen', () => {
    const csv = `\uFEFFSender;Empfänger;Asset;Betrag;Memo Typ;Memo\n${A};${B};XLM;1,5;;Miete\n${A};${B};USDC:${ISSUER};2;id;42\n${A};${B};USDC-${ISSUER};3;kein;\n`;
    const r = parseBatchCsv(enc(csv));
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.line, x.row.assetKey, x.row.amount, x.row.memoType, x.row.memoVal])).toEqual([
      [2, 'XLM', '1,5', 'text', 'Miete'],
      [3, `USDC:${ISSUER}`, '2', 'id', '42'],
      [4, `USDC:${ISSUER}`, '3', 'none', ''],
    ]);
    expect(r.rows[0].row.source).toBe(A);
  });

  it('englische Kopfzeile, Komma, Spalten in anderer Reihenfolge; leere unbekannte Spalte stoert nicht', async () => {
    const r = parseBatchCsv(enc(`amount,destination,source,note\n5,${B},${A},\n`));
    expect(r.ok).toBe(true);
    expect(r.rows[0].row).toMatchObject({ source: A, dest: B, amount: '5', assetKey: 'XLM', memoType: 'none' });
    expect(r.noAssetColumn).toBe(true);
  });

  it('CI-2: unbekannte Spalte mit Inhalt ist ein Dateifehler (nie still XLM statt Token)', () => {
    const r = parseBatchCsv(enc(`Sender;Empfänger;Betrag;Währung (Code);Memo ID\n${A};${B};1000;USDC;42\n`));
    expect(r.ok).toBe(false);
    expect(r.error).toEqual({ code: 'importUnknownColumns', columns: ['Währung (Code)', 'Memo ID'] });
  });

  it('CI-2: Spaltenpaar asset_code / asset_issuer wie der SKM-Export; Formelschutz-Rest im Memo abgelehnt', () => {
    const csv = `\uFEFFfrom;to;amount;asset_code;asset_issuer;memo\n${A};${B};250.0000000;USDC;${ISSUER};Lohn\n${A};${B};1;XLM;;x\n${A};${B};1;USDC;${ISSUER};'-42\n`;
    const r = parseBatchCsv(enc(csv));
    expect(r.ok).toBe(true);
    expect(r.rows.map((x) => x.row.assetKey)).toEqual([`USDC:${ISSUER}`, 'XLM']);
    expect(r.errors).toEqual([{ line: 4, code: 'importMemoFormulaPrefix' }]);
    expect(parseBatchCsv(enc(`Sender;Empfänger;Betrag;asset_code\n${A};${B};1;USDC\n`)).error.code).toBe('importAssetColumns');
  });

  it('CI-1: mehr oder weniger Zellen als die Kopfzeile sind Zeilenfehler, leere Zellen am Ende erlaubt', () => {
    const r = parseBatchCsv(enc(`Sender,Empfänger,Betrag,Memo\n${A},${B},10,5,12345\n${A},${B},10\n${A},${B},10,ok,,\n`));
    expect(r.errors).toEqual([
      { line: 2, code: 'importColumnCount', cells: 5, width: 4 },
      { line: 3, code: 'importColumnCount', cells: 3, width: 4 },
    ]);
    expect(r.rows.map((x) => x.line)).toEqual([4]);
  });

  it('CI-3/CI-4: 1,000 und 12,500 mehrdeutig, Apostroph nur als Tausendergruppe', () => {
    const r = parseBatchCsv(enc(`Sender;Empfänger;Betrag\n${A};${B};1,000\n${A};${B};12,500\n${A};${B};1'5\n${A};${B};1''000\n${A};${B};1'0000\n${A};${B};1'000,5\n${A};${B};12,5\n`));
    expect(r.errors.map((e) => e.code)).toEqual(['importAmountAmbiguous', 'importAmountAmbiguous', 'amountInvalid', 'amountInvalid', 'amountInvalid']);
    expect(r.rows.map((x) => x.row.amount)).toEqual(["1'000,5", '12,5']);
    const quoted = parseBatchCsv(enc(`Sender,Empfänger,Betrag\n${A},${B},"1,000"\n`));
    expect(quoted.errors).toEqual([{ line: 2, code: 'importAmountAmbiguous' }]);
  });

  it('CI-5/CI-6: Secret in der Kopfzeile oder ueber Zellen verteilt, ohne Inhalt im Ergebnis', () => {
    const h = parseBatchCsv(enc(`Sender;Empfänger;Betrag;${SECRET}\n`));
    expect(h).toEqual({ ok: false, error: { code: 'containsSecret' } });
    const half = Math.floor(SECRET.length / 2);
    const r = parseBatchCsv(enc(`Sender;Empfänger;Betrag;Memo Typ;Memo\n${A};${B};1;${SECRET.slice(0, half)};${SECRET.slice(half)}\n`));
    expect(r.rows).toEqual([]);
    expect(r.errors).toEqual([{ line: 2, code: 'containsSecret' }]);
    expect(JSON.stringify(r)).not.toContain(SECRET.slice(0, 20));
  });

  it('CI-7/CI-8: zu lange Felder und Steuer- oder Formatzeichen werden abgelehnt, auch grosse Eingabe schnell', () => {
    const r = parseBatchCsv(enc(`Sender;Empfänger;Betrag;Memo\n${A};${B};1;${'x'.repeat(201)}\n${A};${B};1;a\u202Eb\n${A};${B};1;a\u0007b\n`));
    expect(r.errors.map((e) => e.code)).toEqual(['importFieldTooLong', 'importInvalidCharacters', 'importInvalidCharacters']);
    const big = `Sender;Empfänger;Betrag;Memo\n${A};${B};1;${'S'.repeat(MAX_IMPORT_BYTES - 200)}\n`;
    const t0 = Date.now();
    expect(parseBatchCsv(enc(big)).errors[0].code).toBe('importFieldTooLong');
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it('CI-12: Kopfzeile in NFD (macOS) und Leerzeichen vor Anfuehrungszeichen', () => {
    const nfd = 'Empfänger'.normalize('NFD');
    const r = parseBatchCsv(enc(`Sender, ${nfd}, Betrag\n${A}, ${B}, "5"\n`));
    expect(r.ok).toBe(true);
    expect(r.rows[0].row).toMatchObject({ dest: B, amount: '5' });
  });

  it('fehlerhafte Zeilen werden nicht uebernommen, mit Zeilennummer', () => {
    const csv = [
      'Sender;Empfänger;Betrag;Memo Typ;Memo',
      `${A};${B};1.000;;`,
      `kaputt;${B};1;;`,
      `${A};;1;;`,
      `${A};${B};0;;`,
      `${A};${B};1;foo;x`,
      `${A};${B};1;kein;x`,
      `${A};${B};1;hash;nichthex`,
      '',
      `${A};${B};7;;ok`,
    ].join('\n');
    const r = parseBatchCsv(enc(csv));
    expect(r.errors).toEqual([
      { line: 2, code: 'importAmountAmbiguous' },
      { line: 3, code: 'sourceInvalid' },
      { line: 4, code: 'destMissing' },
      { line: 5, code: 'amountInvalid' },
      { line: 6, code: 'importMemoTypeInvalid' },
      { line: 7, code: 'importMemoWithoutType' },
      { line: 8, code: 'memoInvalid' },
    ]);
    expect(r.rows.map((x) => x.line)).toEqual([10]);
  });

  it('Secret Key in irgendeiner Spalte: Zeile nie uebernommen, Inhalt nicht im Ergebnis', () => {
    const r = parseBatchCsv(enc(`Sender;Empfänger;Betrag;Memo\n${A};${B};1;${SECRET}\n`));
    expect(r.rows).toEqual([]);
    expect(r.errors).toEqual([{ line: 2, code: 'containsSecret' }]);
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it('Dateifehler: nicht UTF-8, zu gross, Pflichtspalten fehlen, leer', () => {
    expect(parseBatchCsv(new Uint8Array([0x53, 0x65, 0xff, 0x0a])).error.code).toBe('importNotUtf8');
    expect(parseBatchCsv(new Uint8Array(MAX_IMPORT_BYTES + 1)).error.code).toBe('importTooLarge');
    expect(parseBatchCsv(enc('Sender;Betrag\nx;1')).error).toEqual({ code: 'importMissingColumns', missing: ['dest'] });
    expect(parseBatchCsv(enc('')).error.code).toBe('importEmpty');
  });

  it('fake XLM mit Issuer wird abgelehnt', () => {
    const r = parseBatchCsv(enc(`Sender,Empfänger,Asset,Betrag\n${A},${B},XLM:${ISSUER},1\n`));
    expect(r.errors).toEqual([{ line: 2, code: 'assetFakeXlm' }]);
  });
});
