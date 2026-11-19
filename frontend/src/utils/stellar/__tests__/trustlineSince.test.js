import { findTrustlineSince, MAX_PAGES, PAGE_SIZE } from '../trustlineSince.js';

const PK = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';
const ISSUER = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';

function serverWith(pages) {
  const calls = [];
  const server = {
    effects: () => {
      const q = { cursor: '' };
      const b = {
        forAccount: (a) => { q.account = a; return b; },
        order: (o) => { q.order = o; return b; },
        limit: (l) => { q.limit = l; return b; },
        cursor: (c) => { q.cursor = c; return b; },
        call: async () => { calls.push({ ...q }); const p = pages[calls.length - 1]; if (p instanceof Error) throw p; return p || { records: [] }; },
      };
      return b;
    },
  };
  return { server, calls };
}
const filler = (n, start = 0, date = '2026-01-01T00:00:00Z') => Array.from({ length: n }, (_, i) => ({ type: 'account_debited', paging_token: `p${start + i}`, created_at: date }));
const created = (code, issuer, at) => ({ type: 'trustline_created', asset_code: code, asset_issuer: issuer, created_at: at, paging_token: 'c' });

describe('findTrustlineSince', () => {
  it('findet die neueste Anlage genau dieses Assets (Code mit Schreibweise), Effekte des Kontos neueste zuerst', async () => {
    const { server, calls } = serverWith([{ records: [
      created('usdc', ISSUER, '2026-05-01T00:00:00Z'),
      { type: 'trustline_removed', asset_code: 'USDC', asset_issuer: ISSUER, created_at: '2026-04-01T00:00:00Z' },
      created('USDC', ISSUER, '2026-03-01T10:00:00Z'),
      created('USDC', ISSUER, '2025-01-01T00:00:00Z'),
    ] }]);
    expect(await findTrustlineSince({ server, account: PK, code: 'USDC', issuer: ISSUER })).toEqual({ status: 'found', at: '2026-03-01T10:00:00Z' });
    expect(calls[0]).toMatchObject({ account: PK, order: 'desc', limit: PAGE_SIZE, cursor: '' });
  });

  it('blaettert per cursor des letzten Eintrags, nicht ueber next', async () => {
    const { server, calls } = serverWith([{ records: filler(PAGE_SIZE) }, { records: [created('USDC', ISSUER, '2024-02-02T00:00:00Z')] }]);
    const progress = [];
    const r = await findTrustlineSince({ server, account: PK, code: 'USDC', issuer: ISSUER, onProgress: (p) => progress.push(p) });
    expect(r).toEqual({ status: 'found', at: '2024-02-02T00:00:00Z' });
    expect(calls[1].cursor).toBe(`p${PAGE_SIZE - 1}`);
    expect(progress).toEqual([1]);
  });

  it('nach hoechstens MAX_PAGES Seiten: aelter als der aelteste gesehene Eintrag', async () => {
    const pages = Array.from({ length: MAX_PAGES + 2 }, (_, i) => ({ records: filler(PAGE_SIZE, i * PAGE_SIZE, `2026-0${(9 - i) > 0 ? 9 - i : 1}-01T00:00:00Z`) }));
    const { server, calls } = serverWith(pages);
    const r = await findTrustlineSince({ server, account: PK, code: 'USDC', issuer: ISSUER });
    expect(calls).toHaveLength(MAX_PAGES);
    expect(r.status).toBe('olderThan');
    expect(r.oldest).toBe(pages[MAX_PAGES - 1].records[PAGE_SIZE - 1].created_at);
  });

  it('kurze letzte Seite ohne Treffer: nicht im verfuegbaren Verlauf; 404 ebenso; anderer Fehler wirft', async () => {
    expect(await findTrustlineSince({ server: serverWith([{ records: filler(3) }]).server, account: PK, code: 'USDC', issuer: ISSUER }))
      .toEqual({ status: 'notInHistory', oldest: '2026-01-01T00:00:00Z' });
    const nf = Object.assign(new Error('nf'), { response: { status: 404 } });
    expect(await findTrustlineSince({ server: serverWith([nf]).server, account: PK, code: 'USDC', issuer: ISSUER }))
      .toEqual({ status: 'notInHistory', oldest: null });
    await expect(findTrustlineSince({ server: serverWith([new Error('down')]).server, account: PK, code: 'USDC', issuer: ISSUER })).rejects.toThrow('down');
  });

  it('abgebrochen: kein Ergebnis, keine weitere Seite', async () => {
    const { server, calls } = serverWith([{ records: filler(PAGE_SIZE) }, { records: [] }]);
    expect(await findTrustlineSince({ server, account: PK, code: 'USDC', issuer: ISSUER, isCancelled: () => true })).toBeNull();
    expect(calls).toHaveLength(1);
  });
});
