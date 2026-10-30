import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Account, MuxedAccount } from '@stellar/stellar-sdk';
import i18n from '../../i18n.js';
import GroupfundPage from '../GroupfundPage.jsx';
import GroupfundTile from '../../components/groupfund/GroupfundTile.jsx';
import { clearGroupfundSessions } from '../../components/groupfund/hooks/useGroupfundScan.js';
import { clearDirectoryCache } from '../../utils/expert/expertDirectory.js';
import { G, SENDER_A, SENDER_B, TARGET, effect, opId, payment } from '../../utils/stellar/__tests__/groupfundFixtures.js';

const hoisted = vi.hoisted(() => ({ payments: [], effects: [], balance: '56.0000000', hangNext: false, loadAccount: vi.fn() }));

const page = (records) => ({
  records,
  next: () => (hoisted.hangNext ? new Promise(() => {}) : Promise.resolve({ records: [], next: async () => ({ records: [] }) })),
});

vi.mock('../../utils/stellar/stellarUtils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getHorizonServer: () => ({
    loadAccount: hoisted.loadAccount,
    payments: () => ({ forAccount: () => ({ order: () => ({ limit: () => ({ join: () => ({ call: async () => page(hoisted.payments) }) }) }) }) }),
    effects: () => ({ forAccount: () => ({ order: () => ({ limit: () => ({ call: async () => page(hoisted.effects) }) }) }) }),
  }),
}));

const MUX_ID = '42';
const M = new MuxedAccount(new Account(G, '1'), MUX_ID).accountId();
const inflow = (ledger, fields) => payment(ledger, { to_muxed_id: MUX_ID, ...fields });

// Reset bei Ledger 20: danach 6 XLM (Reserve 1 + Puffer 5), dann 50 XLM Eingang.
function standardData() {
  hoisted.payments = [
    inflow(30, { amount: '50.0000000' }),
    payment(20, { from: G, to: TARGET, amount: '90.0000000' }),
    inflow(10, { from: SENDER_B, amount: '96.0000000' }),
  ];
  hoisted.effects = [
    effect(30, 'account_credited', '50.0000000'),
    effect(20, 'account_debited', '90.0000000'),
    effect(10, 'account_credited', '96.0000000'),
  ];
}

const renderPage = (props = {}) => render(
  <I18nextProvider i18n={i18n}>
    <GroupfundPage publicKey={G} muxedAddress={M} network="PUBLIC" {...props} />
  </I18nextProvider>
);

describe('GroupfundPage', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });
  beforeEach(() => {
    window.localStorage.clear();
    clearGroupfundSessions();
    clearDirectoryCache();
    standardData();
    hoisted.loadAccount.mockReset();
    hoisted.loadAccount.mockImplementation(async () => ({ balances: [{ asset_type: 'native', balance: '56.0000000' }], subentry_count: 0, num_sponsoring: 0, num_sponsored: 0 }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: 'listed', name: 'Beispielbörse', tags: ['exchange'] }) })));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('zeigt die aktuelle Runde prominent und nennt die Summe nie Saldo', async () => {
    renderPage();
    const summary = await screen.findByTestId('groupfund-summary');
    await waitFor(() => expect(summary).toHaveTextContent('50,0 XLM'));
    expect(summary).toHaveTextContent('Eingänge über diese M-Adresse');
    expect(summary).toHaveTextContent('kein Guthaben');
    expect(summary).not.toHaveTextContent('Saldo');
    expect(summary).not.toHaveTextContent('96,0 XLM');
    expect(screen.getByTestId('groupfund-g-balance')).toHaveTextContent('Saldo des G-Kontos: 56,0 XLM');
    expect(screen.getByTestId('groupfund-g-balance')).toHaveTextContent('Die verfügbaren Mittel liegen auf dem G-Konto.');
  });

  it('listet Absender mit Brutto, Netto und erklaert die Ausgaenge ohne Kennzeichen', async () => {
    renderPage();
    const row = await screen.findByTestId('groupfund-sender');
    expect(row).toHaveTextContent(SENDER_A);
    expect(row).toHaveTextContent('Brutto-Eingänge50,0 XLM');
    expect(row).toHaveTextContent('Netto50,0 XLM');
    expect(row).toHaveTextContent('Ausgänge ohne Kennzeichen0,0 XLM');
    expect(screen.getByTestId('groupfund-unmarked-hint')).toHaveTextContent('nicht verrechnet');
    expect(within(row).getByRole('link')).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('wechselt ohne neuen Scan auf eine fruehere Runde', async () => {
    renderPage();
    await screen.findByTestId('groupfund-sender');
    const select = screen.getByLabelText('Runde');
    const options = within(select).getAllByRole('option');
    fireEvent.change(select, { target: { value: options[1].value } });
    expect(await screen.findByText(SENDER_B)).toBeInTheDocument();
    expect(screen.getByTestId('groupfund-summary')).toHaveTextContent('96,0 XLM');
    expect(hoisted.loadAccount).toHaveBeenCalledTimes(1);
  });

  it('verwirft eine Grenze, merkt das und stellt sie wieder her', async () => {
    const view = renderPage();
    await screen.findByTestId('groupfund-sender');
    fireEvent.click(within(screen.getByTestId('groupfund-boundary')).getByRole('button', { name: 'Verwerfen' }));
    await waitFor(() => expect(screen.getByTestId('groupfund-summary')).toHaveTextContent('146,0 XLM'));
    expect(screen.getByTestId('groupfund-history-end')).toBeInTheDocument();
    view.unmount();
    renderPage();
    await waitFor(() => expect(screen.getByTestId('groupfund-summary')).toHaveTextContent('146,0 XLM'));
    fireEvent.click(screen.getByRole('button', { name: 'Wiederherstellen' }));
    await waitFor(() => expect(screen.getByTestId('groupfund-summary')).toHaveTextContent('50,0 XLM'));
  });

  it('setzt eine ausgehende Zahlung als manuelle Grenze', async () => {
    hoisted.payments = [
      inflow(40, { amount: '1.0000000' }),
      payment(35, { from: G, to: TARGET, amount: '2.0000000' }),
      ...hoisted.payments,
    ];
    hoisted.effects = [effect(40, 'account_credited', '1.0000000'), effect(35, 'account_debited', '2.0000000'), ...hoisted.effects];
    hoisted.loadAccount.mockImplementation(async () => ({ balances: [{ asset_type: 'native', balance: '55.0000000' }], subentry_count: 0 }));
    renderPage();
    await waitFor(() => expect(screen.getByTestId('groupfund-summary')).toHaveTextContent('51,0 XLM'));
    fireEvent.click(within(screen.getByTestId('groupfund-candidate')).getByRole('button', { name: 'Als Grenze setzen' }));
    await waitFor(() => expect(screen.getByTestId('groupfund-summary')).toHaveTextContent('1,0 XLM'));
    expect(JSON.parse(window.localStorage.getItem(`skm.groupfund.v1:PUBLIC:${G}`)).manual[0].opId).toBe(opId(35));
  });

  it('der Puffer aendert die Erkennung und wird gespeichert', async () => {
    renderPage();
    await screen.findByTestId('groupfund-sender');
    fireEvent.change(screen.getByLabelText('Puffer in XLM'), { target: { value: '4' } });
    await waitFor(() => expect(screen.getByTestId('groupfund-summary')).toHaveTextContent('146,0 XLM'));
    expect(JSON.parse(window.localStorage.getItem(`skm.groupfund.v1:PUBLIC:${G}`)).bufferXlm).toBe('4');
  });

  it('fragt das Directory nicht automatisch ab, nur auf Knopfdruck, und zeigt das Tag sachlich', async () => {
    renderPage();
    const row = await screen.findByTestId('groupfund-sender');
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Börsen-Tags prüfen' })); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toContain('trade/assets/expert');
    expect(within(row).getByTestId('directory-tag')).toHaveTextContent('exchange');
    const hint = within(row).getByTestId('groupfund-exchange-hint');
    expect(hint).toHaveTextContent('Im StellarExpert-Directory ist diese Adresse mit dem Tag exchange gelistet. Name im Directory: Beispielbörse.');
    expect(hint).not.toHaveTextContent('gehört');
    expect(hint).not.toHaveTextContent('landet');
  });

  it('nennt ohne Namen im Directory keinen Namen, auch nicht StellarExpert als Eigentuemer', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: 'listed', name: '', tags: ['exchange'] }) });
    renderPage();
    const row = await screen.findByTestId('groupfund-sender');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Börsen-Tags prüfen' })); });
    expect(within(row).getByTestId('groupfund-exchange-hint').textContent).toBe('Im StellarExpert-Directory ist diese Adresse mit dem Tag exchange gelistet.');
  });

  it('meldet ein Limit bei StellarExpert nicht als Ausfall', async () => {
    hoisted.payments = [inflow(30, { amount: '1.0000000' }), inflow(29, { from: SENDER_B, amount: '1.0000000' }), inflow(28, { from: TARGET, amount: '1.0000000' })];
    hoisted.effects = [];
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: 'unavailable' }) });
    renderPage();
    await screen.findAllByTestId('groupfund-sender');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Börsen-Tags prüfen' })); });
    expect(await screen.findByText(/Abfragelimit ist vermutlich erreicht/)).toBeInTheDocument();
  });

  it('bricht die Directory-Abfrage beim Verlassen der Seite ab', async () => {
    hoisted.payments = Array.from({ length: 9 }, (_, i) => inflow(30 + i, { from: [SENDER_A, SENDER_B, TARGET][i % 3] }));
    hoisted.effects = [];
    let signal;
    fetch.mockImplementation((_url, options) => { signal = options.signal; return new Promise(() => {}); });
    const view = renderPage();
    await screen.findAllByTestId('groupfund-sender');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Börsen-Tags prüfen' })); });
    expect(signal.aborted).toBe(false);
    view.unmount();
    expect(signal.aborted).toBe(true);
  });

  it('bietet im Testnet keine Directory-Pruefung an', async () => {
    renderPage({ network: 'TESTNET' });
    await screen.findByTestId('groupfund-sender');
    expect(screen.queryByRole('button', { name: 'Börsen-Tags prüfen' })).toBeNull();
    expect(screen.getByText('Börsen-Tags gibt es nur im Public-Netz.')).toBeInTheDocument();
  });

  it('weist auf trade-Effects und die Kontoerstellung hin', async () => {
    hoisted.payments = [
      ...hoisted.payments.slice(0, 1),
      payment(25, { type: 'create_account', account: G, funder: SENDER_B, starting_balance: '10.0000000', from: undefined, to: undefined }),
    ];
    hoisted.effects = [effect(30, 'account_credited', '50.0000000'), effect(26, 'trade', undefined, { sold_asset_type: 'native' })];
    renderPage();
    expect(await screen.findByTestId('groupfund-unsure')).toHaveTextContent('manuell');
    expect(screen.getByTestId('groupfund-account-created')).toHaveTextContent('create_account');
  });

  it('arbeitet im Memo-Modus ohne M-Adresse mit derselben Logik', async () => {
    hoisted.payments = [payment(30, { amount: '7.0000000', transaction: { memo: 'GF-1' } })];
    hoisted.effects = [effect(30, 'account_credited', '7.0000000')];
    renderPage({ muxedAddress: '' });
    expect(screen.getByRole('radio', { name: 'Muxed-ID' })).toBeDisabled();
    expect(hoisted.loadAccount).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Memo der Einzahlungen'), { target: { value: 'GF-1' } });
    await waitFor(() => expect(screen.getByTestId('groupfund-summary')).toHaveTextContent('7,0 XLM'));
    expect(screen.getByTestId('groupfund-summary')).toHaveTextContent('Eingänge mit diesem Memo');
  });

  it('meldet Horizon-Fehler und bricht nicht zusammen', async () => {
    hoisted.loadAccount.mockRejectedValue(Object.assign(new Error('Not Found'), { response: { status: 404 } }));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Horizon-Daten konnten nicht geladen werden: Not Found');
  });

  it('die Kachel scannt nicht selbst und zeigt die Sitzungssumme', async () => {
    const tile = () => render(
      <I18nextProvider i18n={i18n}>
        <GroupfundTile publicKey={G} muxedAddress={M} network="PUBLIC" locale="de" onOpen={() => {}} />
      </I18nextProvider>
    );
    const first = tile();
    expect(screen.getByTestId('groupfund-tile')).toHaveTextContent('Eingänge dieser M-Adresse');
    expect(hoisted.loadAccount).not.toHaveBeenCalled();
    first.unmount();
    const view = renderPage();
    await screen.findByTestId('groupfund-sender');
    view.unmount();
    tile();
    const shown = screen.getByTestId('groupfund-tile');
    expect(shown).toHaveTextContent('50,0 XLM');
    expect(shown).toHaveTextContent(/Aktuelle Runde, Stand .*\d/);
  });

  it('die Kachel speichert keine unvollstaendige Runde', async () => {
    // Volle Seite ohne Reset: Der Scan muss weiterlaufen, die Folgeseite kommt nicht.
    hoisted.hangNext = true;
    hoisted.effects = [];
    hoisted.payments = Array.from({ length: 200 }, (_, i) => inflow(5000 - i, { amount: '1.0000000' }));
    const view = renderPage();
    await waitFor(() => expect(screen.getByTestId('groupfund-summary')).toHaveTextContent('200,0 XLM'));
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(await screen.findByTestId('groupfund-incomplete')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Scan abgebrochen');
    view.unmount();
    hoisted.hangNext = false;
    render(<I18nextProvider i18n={i18n}><GroupfundTile publicKey={G} muxedAddress={M} network="PUBLIC" locale="de" onOpen={() => {}} /></I18nextProvider>);
    expect(screen.getByTestId('groupfund-tile')).not.toHaveTextContent('200,0 XLM');
    expect(screen.getByTestId('groupfund-tile')).toHaveTextContent('Eingänge dieser M-Adresse');
  });

  it('zeigt Abfluss, Saldo danach und Quelle der Grenze', async () => {
    renderPage();
    await screen.findByTestId('groupfund-sender');
    const boundary = screen.getByTestId('groupfund-boundary');
    expect(boundary).toHaveTextContent('Abfluss 90,0 XLM');
    expect(boundary).toHaveTextContent('Saldo des G-Kontos danach 6,0 XLM');
    expect(boundary).toHaveTextContent('erkannt');
  });

  it('zeigt verworfene Grenzen auch dann, wenn sie nicht mehr erkannt werden', async () => {
    const view = renderPage();
    await screen.findByTestId('groupfund-sender');
    fireEvent.click(within(screen.getByTestId('groupfund-boundary')).getByRole('button', { name: 'Verwerfen' }));
    await screen.findByTestId('groupfund-dismissed');
    view.unmount();
    hoisted.payments = hoisted.payments.filter((record) => record.from !== G);
    clearGroupfundSessions();
    renderPage();
    const dismissed = await screen.findByTestId('groupfund-dismissed');
    expect(dismissed).toHaveTextContent('Abfluss 90,0 XLM');
    fireEvent.click(within(dismissed).getByRole('button', { name: 'Wiederherstellen' }));
    expect(screen.queryByTestId('groupfund-dismissed')).toBeNull();
  });

  it('wechselt sichtbar auf die aktuelle Runde, wenn die gewaehlte wegfaellt', async () => {
    renderPage();
    await screen.findByTestId('groupfund-sender');
    const select = screen.getByLabelText('Runde');
    fireEvent.change(select, { target: { value: within(select).getAllByRole('option')[1].value } });
    await screen.findByText(SENDER_B);
    hoisted.payments = hoisted.payments.filter((record) => record.from !== G);
    hoisted.loadAccount.mockImplementation(async () => ({ balances: [{ asset_type: 'native', balance: '146.0000000' }], subentry_count: 0 }));
    hoisted.effects = hoisted.effects.filter((e) => e.type === 'account_credited');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Neu laden' })); });
    expect(await screen.findByTestId('groupfund-round-gone')).toHaveTextContent('Die gewählte Runde gibt es nicht mehr.');
    expect(screen.getByLabelText('Runde')).toHaveValue('current');
  });

  it('behaelt die gewaehlte fruehere Runde beim Neu laden', async () => {
    renderPage();
    await screen.findByTestId('groupfund-sender');
    const select = screen.getByLabelText('Runde');
    const value = within(select).getAllByRole('option')[1].value;
    fireEvent.change(select, { target: { value } });
    await screen.findByText(SENDER_B);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Neu laden' })); });
    await waitFor(() => expect(screen.getByLabelText('Runde')).toHaveValue(value));
    expect(screen.queryByTestId('groupfund-round-gone')).toBeNull();
  });

  it('nennt bei eigenem Zeitraum ohne Anwendung neutral die Auswahl', async () => {
    renderPage();
    await screen.findByTestId('groupfund-sender');
    fireEvent.change(screen.getByLabelText('Runde'), { target: { value: 'range' } });
    expect(screen.getByTestId('groupfund-summary')).toHaveTextContent('Zeitraum wählen.');
    expect(screen.getByTestId('groupfund-summary')).not.toHaveTextContent('keine Eingänge');
  });

  it('warnt bei unbekanntem Merge-Betrag in Runde und Zeile', async () => {
    hoisted.payments = [
      payment(30, { type: 'account_merge', account: SENDER_B, into: G, into_muxed_id: MUX_ID, from: undefined, to: undefined, amount: undefined }),
      payment(20, { from: G, to: TARGET, amount: '90.0000000' }),
    ];
    hoisted.effects = [effect(20, 'account_debited', '90.0000000')];
    hoisted.loadAccount.mockImplementation(async () => ({ balances: [{ asset_type: 'native', balance: '3.0000000' }], subentry_count: 0 }));
    renderPage();
    expect(await screen.findByTestId('groupfund-amount-unknown-note')).toHaveTextContent('Für 1 account_merge fehlt der Betrag.');
    expect(screen.getByTestId('groupfund-amount-unknown')).toBeInTheDocument();
    expect(screen.getByTestId('groupfund-summary')).toHaveTextContent('mindestens 0,0 XLM');
    const row = screen.getByTestId('groupfund-sender');
    expect(row).toHaveTextContent('Brutto-Eingängemindestens 0,0 XLM');
    expect(row).toHaveTextContent('Netto0,0 XLM (unvollständig)');
  });

  it('die Kachel zeigt bei unbekanntem Betrag keine Zahl, sondern einen Hinweis mit Link', async () => {
    hoisted.payments = [
      inflow(40, { amount: '7.0000000' }),
      payment(30, { type: 'account_merge', account: SENDER_B, into: G, into_muxed_id: MUX_ID, from: undefined, to: undefined, amount: undefined }),
      payment(20, { from: G, to: TARGET, amount: '90.0000000' }),
    ];
    hoisted.effects = [effect(40, 'account_credited', '7.0000000'), effect(20, 'account_debited', '90.0000000')];
    hoisted.loadAccount.mockImplementation(async () => ({ balances: [{ asset_type: 'native', balance: '10.0000000' }], subentry_count: 0 }));
    const view = renderPage();
    await screen.findByTestId('groupfund-amount-unknown-note');
    await waitFor(() => expect(screen.getByTestId('groupfund-summary')).toHaveTextContent('mindestens 7,0 XLM'));
    view.unmount();
    const onOpen = vi.fn();
    render(<I18nextProvider i18n={i18n}><GroupfundTile publicKey={G} muxedAddress={M} network="PUBLIC" locale="de" onOpen={onOpen} /></I18nextProvider>);
    const tile = screen.getByTestId('groupfund-tile');
    expect(tile).not.toHaveTextContent('7,0 XLM');
    expect(tile).not.toHaveTextContent('Aktuelle Runde, Stand');
    expect(screen.getByTestId('groupfund-tile-incomplete')).toHaveTextContent('Diese Runde enthält unvollständige Beträge.');
    fireEvent.click(screen.getByRole('button', { name: 'Details ansehen' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('nennt in der Grenzen-Liste Eingaenge der Transaktion und unbekannte Werte', async () => {
    hoisted.payments = [
      inflow(40, { amount: '7.0000000' }),
      payment(30, { from: G, to: TARGET, amount: '2.0000000' }),
      payment(20, { index: 2, from: G, to: TARGET, amount: '100.0000000' }),
      inflow(20, { index: 1, amount: '3.0000000' }),
    ];
    hoisted.effects = [effect(40, 'account_credited', '7.0000000'), effect(20, 'account_debited', '100.0000000', { index: 2 }), effect(20, 'account_credited', '3.0000000', { index: 1 })];
    hoisted.loadAccount.mockImplementation(async () => ({ balances: [{ asset_type: 'native', balance: '10.0000000' }], subentry_count: 0 }));
    renderPage();
    expect(await screen.findByTestId('groupfund-boundary-incoming')).toHaveTextContent('zählen zu keiner Runde');
    expect(screen.getByTestId('groupfund-candidate')).toHaveTextContent('Abfluss unbekannt');
    expect(screen.getByTestId('groupfund-candidate')).toHaveTextContent('Saldo des G-Kontos danach unbekannt');
  });

  it('nennt JSON als massgebliches Format', async () => {
    renderPage();
    await screen.findByTestId('groupfund-sender');
    expect(screen.getByTestId('groupfund-export-hint')).toHaveTextContent('JSON ist das maßgebliche Format');
    expect(screen.getByTestId('groupfund-export-hint')).toHaveTextContent('Excel');
  });

  it('zeigt den Dust-Hinweis je Einzelzahlung', async () => {
    hoisted.payments = [inflow(30, { amount: '0.0060000' }), inflow(29, { amount: '0.0060000' })];
    hoisted.effects = [];
    renderPage();
    expect(await screen.findByTestId('activity-dust')).toBeInTheDocument();
  });
});
