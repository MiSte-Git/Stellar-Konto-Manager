import { filterAssets, matchesAssetQuery } from '../assetFilter.js';

const ISSUER = 'GCTAWY73CNMLONWUID7TMJT55NW4MS2MHMW26O222UGG2PRFE6ZXEH7N';
const OTHER = 'GDEUQ2MX3YXMITFOTC3CO3GW5V3XE3IVG7JKLZZAOZ7WFYIN256INDUS';
const POOL = '36009c163d095cc05a20f415f9ae2709993c1430506931075376005ada4696d2';
const assets = [
  { code: 'LDEX', issuer: ISSUER },
  { code: 'LLOYDSCE', issuer: OTHER },
  { code: 'ldex', issuer: OTHER },
  { isPool: true, code: '', issuer: POOL, pairCodes: ['XLM', 'LDEX'] },
];

describe('assetFilter', () => {
  it('leere Suche zeigt alles', () => {
    expect(filterAssets(assets, '  ')).toHaveLength(4);
  });
  it('Code ohne Gross-/Kleinschreibung, trifft auch Schreibvarianten und Pools mit dem Code', () => {
    expect(filterAssets(assets, 'ldex').map((a) => a.issuer)).toEqual([ISSUER, OTHER, POOL]);
  });
  it('Issuer als Teilstring', () => {
    expect(filterAssets(assets, 'EH7N').map((a) => a.code)).toEqual(['LDEX']);
    expect(filterAssets(assets, 'indus').map((a) => a.code)).toEqual(['LLOYDSCE', 'ldex']);
  });
  it('CODE:ISSUER verlangt beides', () => {
    expect(filterAssets(assets, `LDEX:${OTHER}`).map((a) => a.code)).toEqual(['ldex']);
    expect(filterAssets(assets, 'LLOYDS:GCTA')).toHaveLength(0);
  });
  it('Pool ueber Paar und Pool-ID', () => {
    expect(matchesAssetQuery(assets[3], 'xlm / ldex')).toBe(true);
    expect(matchesAssetQuery(assets[3], '36009c')).toBe(true);
    expect(matchesAssetQuery(assets[3], 'usdc')).toBe(false);
  });
});
