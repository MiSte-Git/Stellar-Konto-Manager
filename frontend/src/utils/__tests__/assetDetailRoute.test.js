import {
  assetDetailPath, isAssetDetailPath, parseAssetDetailPath, readTradingAssetFromSearch, tradingWithAssetSubpath,
} from '../assetDetailRoute.js';

const ISSUER = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
// Gleiche Form, aber falsche Pruefsumme (letztes Zeichen geaendert)
const BAD_CHECKSUM = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKN';

describe('assetDetailRoute', () => {
  it('Pfad hin und zurueck', () => {
    const path = assetDetailPath('LDEX', ISSUER);
    expect(path.endsWith(`/assets/LDEX-${ISSUER}`)).toBe(true);
    expect(parseAssetDetailPath(path)).toEqual({ code: 'LDEX', issuer: ISSUER });
    expect(parseAssetDetailPath(`${path}/`)).toEqual({ code: 'LDEX', issuer: ISSUER });
  });

  it('andere Pfade sind keine Detailseite', () => {
    expect(parseAssetDetailPath('/')).toBeNull();
    expect(parseAssetDetailPath('/trading/assets')).toBeNull();
    expect(parseAssetDetailPath(`/assets/LDEX-${ISSUER}/extra`)).toBeNull();
    expect(isAssetDetailPath('/assets')).toBe(false);
  });

  it('ungueltiges Asset: Detailseite mit invalid, Pruefsumme zaehlt', () => {
    expect(parseAssetDetailPath(`/assets/LDEX-${BAD_CHECKSUM}`)).toMatchObject({ invalid: true });
    expect(parseAssetDetailPath(`/assets/TOOLONGCODE123-${ISSUER}`)).toMatchObject({ invalid: true });
    expect(parseAssetDetailPath('/assets/LDEX')).toMatchObject({ invalid: true });
    expect(parseAssetDetailPath('/assets/%E0%A4%A')).toMatchObject({ invalid: true });
    expect(isAssetDetailPath(`/assets/LDEX-${BAD_CHECKSUM}`)).toBe(true);
  });

  it('Trading-Vorbelegung per ?asset=', () => {
    const sub = tradingWithAssetSubpath('LDEX', ISSUER);
    const qs = sub.slice(sub.indexOf('?'));
    expect(readTradingAssetFromSearch(qs)).toEqual({ code: 'LDEX', issuer: ISSUER });
    expect(readTradingAssetFromSearch(`?asset=LDEX:${BAD_CHECKSUM}`)).toBeNull();
    expect(readTradingAssetFromSearch(`?asset=LDEX:${ISSUER}:x`)).toBeNull();
    expect(readTradingAssetFromSearch('?asset=')).toBeNull();
    expect(readTradingAssetFromSearch('')).toBeNull();
  });
});
