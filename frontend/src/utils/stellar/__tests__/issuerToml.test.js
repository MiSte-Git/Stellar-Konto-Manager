import { issuerTomlInfo } from '../issuerToml.js';

const ISSUER = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
const loaded = (matches) => ({ loading: false, error: '', toml: { status: 'loaded', url: 'https://x.example/.well-known/stellar.toml', currencies: matches, matches } });

describe('issuerTomlInfo', () => {
  it('Zustaende: laden, notChecked ohne Fehler, Fehler, nicht geladen, nicht gelistet', () => {
    expect(issuerTomlInfo(null).state).toBe('loading');
    expect(issuerTomlInfo({ loading: true, toml: { status: 'notChecked' } }).state).toBe('loading');
    expect(issuerTomlInfo({ loading: false, error: '', toml: { status: 'notChecked' } }).state).toBe('loading');
    expect(issuerTomlInfo({ loading: false, error: 'x', toml: { status: 'notChecked' } }).state).toBe('unavailable');
    expect(issuerTomlInfo({ loading: false, error: '', toml: { status: 'failed' } }).state).toBe('unavailable');
    expect(issuerTomlInfo({ loading: false, error: '', toml: { status: 'noHomeDomain' } }).state).toBe('unavailable');
    expect(issuerTomlInfo(loaded([])).state).toBe('notListed');
  });

  it('Felder in fester Reihenfolge, unbekannte Felder und image nicht als Feld', () => {
    const info = issuerTomlInfo(loaded([{
      code: 'USDC', issuer: ISSUER, desc: 'Ein Stablecoin', name: 'USD Coin', status: 'Live',
      display_decimals: 2, is_asset_anchored: true, anchor_asset_type: 'fiat', anchor_asset: 'USD',
      image: 'https://x.example/logo.png', foo: 'bar',
    }]));
    expect(info.state).toBe('ok');
    expect(info.entries.map((e) => e.key)).toEqual(['name', 'desc', 'status', 'anchor_asset_type', 'anchor_asset', 'is_asset_anchored', 'display_decimals']);
    expect(info.entries.find((e) => e.key === 'status')).toMatchObject({ value: 'live', known: true });
    expect(info.hasImage).toBe(true);
    expect(info.multiple).toBe(false);
  });

  it('falsche Typen fallen weg: Objekte, Arrays, negative oder zu grosse Zahlen, Ja/Nein als Text', () => {
    const info = issuerTomlInfo(loaded([{
      name: { a: 1 }, desc: ['x'], display_decimals: 9, fixed_number: -1, max_number: 1.5,
      is_unlimited: 'yes', regulated: 'true', status: 'irgendwas',
    }]));
    const byKey = Object.fromEntries(info.entries.map((e) => [e.key, e]));
    expect(byKey.name).toBeUndefined();
    expect(byKey.desc).toBeUndefined();
    expect(byKey.display_decimals).toBeUndefined();
    expect(byKey.fixed_number).toBeUndefined();
    expect(byKey.max_number).toBeUndefined();
    expect(byKey.is_unlimited).toBeUndefined();
    expect(byKey.regulated.value).toBe(true);
    expect(byKey.status).toMatchObject({ value: 'irgendwas', known: false });
  });

  it('Steuerzeichen und Richtungszeichen raus, lange Texte gekuerzt', () => {
    const info = issuerTomlInfo(loaded([{ name: 'US‮DC\u0007 Coin​', desc: 'a'.repeat(700), conditions: 'Zeile1\r\nZeile2\n\n\n\nZeile3' }]));
    const byKey = Object.fromEntries(info.entries.map((e) => [e.key, e]));
    expect(byKey.name.value).toBe('USDC  Coin');
    expect(byKey.desc.value.length).toBe(600);
    expect(byKey.desc.truncated).toBe(true);
    expect(byKey.conditions.value).toBe('Zeile1\nZeile2\n\nZeile3');
  });

  it('leerer Eintrag, mehrfach gelistet, image ohne https', () => {
    const info = issuerTomlInfo(loaded([{ code: 'X', image: 'http://x.example/a.png' }, { code: 'X' }]));
    expect(info.state).toBe('empty');
    expect(info.multiple).toBe(true);
    expect(info.hasImage).toBe(false);
  });
});
