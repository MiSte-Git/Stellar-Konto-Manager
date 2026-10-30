import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Account, MuxedAccount } from '@stellar/stellar-sdk';
import i18n from '../../../i18n.js';
import WalletHome from '../../../pages/WalletHome.jsx';
import GroupfundPage from '../../../pages/GroupfundPage.jsx';
import IdentityHeaderRows from '../IdentityHeaderRows.jsx';
import { getScanEntry } from '../hooks/groupfundScanStore.js';
import { clearGroupfundSessions } from '../hooks/useGroupfundScan.js';
import { AUTOSCAN_MAX_PAGES_PER_FEED } from '../hooks/useIdentityRound.js';
import { XlmPriceContext } from '../../../utils/xlmPriceContext.js';
import { G, ISSUER, SENDER_A, SENDER_B, TARGET, effect, payment } from '../../../utils/stellar/__tests__/groupfundFixtures.js';

const hoisted = vi.hoisted(() => ({
  paymentPages: [], effectPages: [], effectCalls: 0, paymentCalls: 0, hold: null, failFeeds: null, loadAccount: vi.fn(),
}));

function feedAnswer(pages, index, count) {
  count();
  if (hoisted.failFeeds) return Promise.reject(hoisted.failFeeds);
  const answer = () => ({ records: pages[index] || [], next: () => feedAnswer(pages, index + 1, count) });
  return hoisted.hold ? hoisted.hold.then(answer) : Promise.resolve(answer());
}

function chain(onCall) {
  const state = {};
  const self = {
    forAccount: () => self,
    order: () => self,
    limit: (n) => { state.limit = n; return self; },
    join: () => { state.joined = true; return self; },
    cursor: () => self,
    claimant: () => self,
    call: () => onCall(state),
  };
  return self;
}

vi.mock('../../../utils/stellar/stellarUtils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getHorizonServer: () => ({
    loadAccount: hoisted.loadAccount,
    // Der Verlauf der Startseite fragt ebenfalls payments ab, gezaehlt wird nur der Scan.
    payments: () => chain((state) => (state.limit === 200 && state.joined
      ? feedAnswer(hoisted.paymentPages, 0, () => { hoisted.paymentCalls += 1; })
      : Promise.resolve({ records: [] }))),
    effects: () => chain(() => feedAnswer(hoisted.effectPages, 0, () => { hoisted.effectCalls += 1; })),
    claimableBalances: () => chain(() => Promise.resolve({ records: [] })),
  }),
}));

const muxed = (id) => new MuxedAccount(new Account(G, '1'), id).accountId();
const M_A = muxed('42');
const M_B = muxed('43');
const price = { value: 0.5, symbol: 'CHF ', locale: 'de' };
const inflow = (ledger, fields) => payment(ledger, { to_muxed_id: '42', ...fields });

const account = (balance = '56.0000000') => ({ balances: [{ asset_type: 'native', balance }], subentry_count: 0, num_sponsoring: 0, num_sponsored: 0 });

function standardData() {
  hoisted.paymentPages = [[
    inflow(30, { amount: '50.0000000' }),
    payment(20, { from: G, to: TARGET, amount: '90.0000000' }),
    inflow(10, { from: SENDER_B, amount: '96.0000000' }),
  ]];
  hoisted.effectPages = [[
    effect(30, 'account_credited', '50.0000000'),
    effect(20, 'account_debited', '90.0000000'),
    effect(10, 'account_credited', '96.0000000'),
  ]];
}

const wrap = (node) => (
  <I18nextProvider i18n={i18n}>
    <XlmPriceContext.Provider value={price}>{node}</XlmPriceContext.Provider>
  </I18nextProvider>
);
const home = (props = {}) => <WalletHome publicKey={G} muxedAddress={M_A} onAction={() => {}} {...props} />;
const header = (props = {}) => <IdentityHeaderRows publicKey={G} muxedAddress={M_A} muxedId="42" network="PUBLIC" balanceText="56.0000000" {...props} />;
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });

describe('Identitaetsmodus: Karte, Kopfbereich, gemeinsamer Scan', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    clearGroupfundSessions();
    hoisted.effectCalls = 0;
    hoisted.paymentCalls = 0;
    hoisted.hold = null;
    hoisted.failFeeds = null;
    standardData();
    hoisted.loadAccount.mockReset();
    hoisted.loadAccount.mockImplementation(async () => account());
  });

  describe('Karte', () => {
    it('zeigt die Eingaenge der Runde gross und das Guthaben nur beim Basiskonto', async () => {
      render(wrap(home()));
      const xlm = await screen.findByTestId('identity-round-xlm');
      await waitFor(() => expect(xlm).toHaveTextContent('50,0 XLM'));
      expect(screen.getByText('Eingänge über diese M-Adresse')).toBeInTheDocument();
      expect(screen.getByTestId('identity-round-since')).toHaveTextContent(/^seit .*\d/);
      const round = screen.getByTestId('identity-round');
      expect(round).not.toHaveTextContent('Guthaben');
      expect(round).not.toHaveTextContent('Saldo');
      const base = screen.getByTestId('identity-base-balance');
      expect(base).toHaveTextContent('Guthaben Basiskonto');
      expect(base).toHaveTextContent('gemeinsam für alle M-Adressen dieses Kontos');
      expect(base).toHaveTextContent('Gesamt');
      expect(base).toHaveTextContent('Verfügbar');
      expect(base).toHaveTextContent('Reserviert');
      expect(base).toHaveTextContent('CHF');
      expect(round).not.toHaveTextContent('CHF');
      expect(screen.getByText('Eine M-Adresse hat kein eigenes Guthaben. Eingänge werden über die Muxed-ID dem G-Konto zugeordnet.')).toBeInTheDocument();
      expect(screen.getByText('Assets des Basiskontos')).toBeInTheDocument();
    });

    it('bleibt ohne Identitaetsmodus wie bisher und scannt nicht', async () => {
      render(wrap(home({ muxedAddress: '' })));
      expect(await screen.findByTestId('wallet-home-xlm')).toBeInTheDocument();
      expect(screen.getByText('Guthaben')).toBeInTheDocument();
      expect(screen.queryByTestId('identity-round')).toBeNull();
      expect(screen.queryByTestId('identity-base-balance')).toBeNull();
      expect(screen.getByRole('button', { name: 'Senden' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Empfangen' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Tauschen' })).toBeInTheDocument();
      expect(screen.queryByTestId('identity-actions-hint')).toBeNull();
      await flush();
      expect(hoisted.effectCalls).toBe(0);
    });

    it('zeigt waehrend des Scans den Ladezustand, den G-Saldo schon vorher', async () => {
      hoisted.hold = new Promise(() => {});
      render(wrap(home()));
      expect(await screen.findByTestId('identity-base-balance')).toHaveTextContent('Guthaben Basiskonto');
      await waitFor(() => expect(hoisted.paymentCalls).toBe(1));
      expect(screen.getByTestId('identity-round-pending')).toHaveAttribute('aria-busy', 'true');
    });

    it('zeigt bei einem Scan-Fehler weiter den G-Saldo', async () => {
      hoisted.failFeeds = Object.assign(new Error('kaputt'), { response: { status: 400 } });
      render(wrap(home()));
      expect(await screen.findByTestId('identity-round-failed')).toHaveTextContent('Die Eingänge konnten nicht geladen werden.');
      expect(screen.getByTestId('identity-base-balance')).toHaveTextContent('Guthaben Basiskonto');
    });

    it('nennt weitere Assets, Netto und Ausgaenge ohne Kennzeichen nur, wenn es sie gibt', async () => {
      hoisted.paymentPages[0].unshift(
        inflow(33, { amount: '3.0000000', asset_type: 'credit_alphanum4', asset_code: 'USD', asset_issuer: ISSUER }),
        payment(32, { from: G, to: SENDER_A, amount: '1.0000000', from_muxed_id: '42' }),
        payment(31, { from: G, to: SENDER_A, amount: '2.0000000' }),
      );
      hoisted.effectPages[0].unshift(effect(32, 'account_debited', '1.0000000'), effect(31, 'account_debited', '2.0000000'));
      hoisted.loadAccount.mockImplementation(async () => account('53.0000000'));
      render(wrap(home()));
      expect(await screen.findByTestId('identity-round-others')).toHaveTextContent('3,0 USD');
      expect(screen.getByTestId('identity-round-net')).toHaveTextContent('49,0 XLM');
      const unmarked = screen.getByTestId('identity-round-unmarked');
      expect(unmarked).toHaveTextContent('Ausgänge ohne Kennzeichen: 2,0 XLM');
      expect(unmarked).toHaveTextContent('Nicht verrechnet');
    });

    it('zeigt ohne Rueckzahlungen und weitere Assets keine dieser Zeilen', async () => {
      render(wrap(home()));
      await screen.findByTestId('identity-round');
      expect(screen.queryByTestId('identity-round-others')).toBeNull();
      expect(screen.queryByTestId('identity-round-net')).toBeNull();
      expect(screen.queryByTestId('identity-round-unmarked')).toBeNull();
    });

    it('uebernimmt mindestens und unvollstaendig bei unbekanntem Betrag', async () => {
      hoisted.paymentPages[0].unshift(
        payment(32, { from: G, to: SENDER_B, amount: '1.0000000', from_muxed_id: '42' }),
        payment(31, { type: 'account_merge', account: SENDER_B, into: G, into_muxed_id: '42', from: undefined, to: undefined, amount: undefined }),
      );
      hoisted.effectPages[0].unshift(effect(32, 'account_debited', '1.0000000'));
      hoisted.loadAccount.mockImplementation(async () => account('55.0000000'));
      render(wrap(home()));
      await waitFor(() => expect(screen.getByTestId('identity-round-xlm')).toHaveTextContent('mindestens 50,0 XLM'));
      expect(screen.getByTestId('identity-round-net')).toHaveTextContent('(unvollständig)');
      expect(screen.getByTestId('identity-round-unknown')).toHaveTextContent('Für 1 account_merge fehlt der Betrag.');
    });

    it('stoppt den Autoscan nach 10 Seiten je Feed mit Markierung mindestens', async () => {
      const onAction = vi.fn();
      hoisted.paymentPages = Array.from({ length: 15 }, (_, i) => Array.from({ length: 200 }, (__, n) => inflow(90000 - i * 1000 - n, { amount: '1.0000000' })));
      hoisted.effectPages = Array.from({ length: 15 }, (_, i) => Array.from({ length: 200 }, (__, n) => effect(90000 - i * 1000 - n, 'account_credited', '1.0000000')));
      render(wrap(home({ onAction })));
      expect(await screen.findByTestId('identity-round-limited')).toHaveTextContent('weiter scannen');
      expect(AUTOSCAN_MAX_PAGES_PER_FEED).toBe(10);
      expect(hoisted.effectCalls).toBeLessThanOrEqual(10);
      expect(hoisted.paymentCalls).toBeLessThanOrEqual(10);
      const xlm = screen.getByTestId('identity-round-xlm');
      expect(xlm).toHaveTextContent(/^mindestens /);
      expect(screen.getByTestId('identity-round-since')).toHaveTextContent('seit Beginn der geladenen Historie');
      window.localStorage.setItem(`skm.groupfund.v1:PUBLIC:${G}`, JSON.stringify({ mode: 'memo', memo: 'x' }));
      fireEvent.click(screen.getByRole('button', { name: 'Details' }));
      expect(onAction).toHaveBeenCalledWith('groupfund');
      expect(JSON.parse(window.localStorage.getItem(`skm.groupfund.v1:PUBLIC:${G}`))).toMatchObject({ mode: 'muxed', memo: 'x' });
    });

    it('der Refresh-Button scannt neu', async () => {
      render(wrap(home()));
      await screen.findByTestId('identity-round');
      await waitFor(() => expect(hoisted.effectCalls).toBe(1));
      fireEvent.click(screen.getByRole('button', { name: 'Aktualisieren' }));
      await waitFor(() => expect(hoisted.effectCalls).toBe(2));
    });

    it('kein erneuter Scan beim Seitenwechsel', async () => {
      const view = render(wrap(home()));
      await screen.findByTestId('identity-round');
      await waitFor(() => expect(hoisted.effectCalls).toBe(1));
      view.unmount();
      await flush();
      render(wrap(home()));
      await screen.findByTestId('identity-round');
      await flush();
      expect(hoisted.effectCalls).toBe(1);
    });
  });

  describe('Aktionsbuttons', () => {
    it('sagt, was wirklich passiert, und loest dieselben Aktionen aus wie bisher', async () => {
      const onAction = vi.fn();
      render(wrap(home({ onAction })));
      fireEvent.click(await screen.findByRole('button', { name: 'Senden vom Basiskonto' }));
      fireEvent.click(screen.getByRole('button', { name: 'Auf M-Adresse empfangen' }));
      fireEvent.click(screen.getByRole('button', { name: 'Tauschen vom Basiskonto' }));
      expect(onAction.mock.calls.map(([id]) => id)).toEqual(['sendPayment', 'receive', 'tradingAssets']);
      expect(screen.getByTestId('identity-actions-hint')).toHaveTextContent('Senden wechselt zuerst zum Basiskonto.');
    });
  });

  describe('Kopfbereich', () => {
    it('zeigt das Guthaben beim Basis-G-Konto und bei der M-Adresse nur Eingaenge', async () => {
      render(wrap(header()));
      await waitFor(() => expect(screen.getByTestId('identity-header-round')).toHaveTextContent('Eingänge aktuelle Runde: 50,0 XLM'));
      expect(screen.getByTestId('identity-header-base')).toHaveTextContent('Guthaben: 56.0000000');
      expect(screen.getByTestId('identity-header-round')).not.toHaveTextContent('Guthaben');
      expect(screen.getByTestId('identity-header-round')).not.toHaveTextContent('Saldo');
    });

    it('zeigt einen dezenten Ladezustand', async () => {
      hoisted.hold = new Promise(() => {});
      render(wrap(header()));
      expect(screen.getByTestId('identity-header-round')).toHaveTextContent('wird geladen');
      await flush();
    });

    it('nennt weitere Assets als +N weitere', async () => {
      hoisted.paymentPages[0].unshift(inflow(33, { amount: '3.0000000', asset_type: 'credit_alphanum4', asset_code: 'USD', asset_issuer: ISSUER }));
      render(wrap(header()));
      await waitFor(() => expect(screen.getByTestId('identity-header-round')).toHaveTextContent('50,0 XLM +1 weitere'));
    });

    it('Konto fehlt im Netz: nicht verfuegbar, kein Feed-Abruf, kein Fehlerstatus', async () => {
      hoisted.loadAccount.mockRejectedValue(Object.assign(new Error('Not Found'), { response: { status: 404 } }));
      render(wrap(header()));
      await waitFor(() => expect(screen.getByTestId('identity-header-round')).toHaveTextContent('nicht verfügbar'));
      expect(hoisted.paymentCalls).toBe(0);
      expect(hoisted.effectCalls).toBe(0);
      const entry = getScanEntry('PUBLIC', G);
      expect(entry.status).toBe('idle');
      expect(entry.error).toBe('');
    });

    it('Konto als fehlend bekannt: Es startet gar nichts, nach Aktivierung schon', async () => {
      const view = render(wrap(header({ accountMissing: true })));
      await flush();
      expect(hoisted.loadAccount).not.toHaveBeenCalled();
      expect(screen.getByTestId('identity-header-round')).toHaveTextContent('nicht verfügbar');
      view.rerender(wrap(header({ accountMissing: false })));
      await waitFor(() => expect(screen.getByTestId('identity-header-round')).toHaveTextContent('50,0 XLM'));
    });

    it('bleibt bei einem Scan-Fehler bedienbar', async () => {
      hoisted.failFeeds = Object.assign(new Error('kaputt'), { response: { status: 400 } });
      render(wrap(header()));
      await waitFor(() => expect(screen.getByTestId('identity-header-round')).toHaveTextContent('nicht verfügbar'));
      expect(screen.getByTestId('identity-header-base')).toHaveTextContent('Guthaben: 56.0000000');
    });
  });

  describe('gemeinsamer Scan', () => {
    it('Kopfbereich, Karte und Groupfund-Seite loesen nur einen Scan aus', async () => {
      render(wrap(<>{header()}{home()}<GroupfundPage publicKey={G} muxedAddress={M_A} network="PUBLIC" /></>));
      await waitFor(() => expect(screen.getByTestId('groupfund-summary')).toHaveTextContent('50,0 XLM'));
      await flush();
      expect(hoisted.effectCalls).toBe(1);
      expect(hoisted.paymentCalls).toBe(1);
      expect(getScanEntry('PUBLIC', G).status).toBe('done');
    });

    it('andere M-Adresse desselben Kontos: keine neuen Abfragen, sofort andere Summe', async () => {
      hoisted.paymentPages[0].unshift(inflow(35, { to_muxed_id: '43', amount: '7.0000000' }));
      hoisted.effectPages[0].unshift(effect(35, 'account_credited', '7.0000000'));
      hoisted.loadAccount.mockImplementation(async () => account('63.0000000'));
      const view = render(wrap(header()));
      await waitFor(() => expect(screen.getByTestId('identity-header-round')).toHaveTextContent('50,0 XLM'));
      const calls = hoisted.effectCalls + hoisted.paymentCalls;
      const accountLoads = hoisted.loadAccount.mock.calls.length;
      view.rerender(wrap(header({ muxedAddress: M_B, muxedId: '43' })));
      expect(screen.getByTestId('identity-header-round')).toHaveTextContent('7,0 XLM');
      await flush();
      expect(hoisted.effectCalls + hoisted.paymentCalls).toBe(calls);
      expect(hoisted.loadAccount.mock.calls.length).toBe(accountLoads);
    });

    it('andere M-Adresse waehrend des Scans: Der Scan laeuft weiter', async () => {
      let release;
      hoisted.hold = new Promise((resolve) => { release = resolve; });
      const view = render(wrap(header()));
      await waitFor(() => expect(hoisted.paymentCalls).toBe(1));
      view.rerender(wrap(header({ muxedAddress: M_B, muxedId: '43' })));
      await flush();
      expect(getScanEntry('PUBLIC', G).status).toBe('scanning');
      hoisted.hold = null;
      await act(async () => { release(); });
      await waitFor(() => expect(getScanEntry('PUBLIC', G).status).toBe('done'));
    });

    it.each([
      ['Netzwerk', { network: 'TESTNET' }, 'TESTNET', G],
      ['G-Konto', { publicKey: SENDER_A }, 'PUBLIC', SENDER_A],
    ])('%s-Wechsel bricht den laufenden Scan ab und startet neu', async (_name, props, network, accountId) => {
      let release;
      hoisted.hold = new Promise((resolve) => { release = resolve; });
      const view = render(wrap(<IdentityHeaderRows key="a" publicKey={G} muxedAddress={M_A} muxedId="42" network="PUBLIC" balanceText="1" />));
      await waitFor(() => expect(hoisted.paymentCalls).toBe(1));
      view.rerender(wrap(<IdentityHeaderRows key="b" publicKey={G} muxedAddress={M_A} muxedId="42" network="PUBLIC" balanceText="1" {...props} />));
      await flush();
      expect(getScanEntry('PUBLIC', G).status).toBe('idle');
      expect(getScanEntry(network, accountId).status).toBe('scanning');
      hoisted.hold = null;
      await act(async () => { release(); });
      await flush();
      expect(getScanEntry('PUBLIC', G).scan.payments).toHaveLength(0);
    });

    it('Puffer und Grenzkorrekturen wirken live in Kopf, Karte und Seite', async () => {
      render(wrap(<>{header()}{home()}<GroupfundPage publicKey={G} muxedAddress={M_A} network="PUBLIC" /></>));
      await waitFor(() => expect(screen.getByTestId('groupfund-summary')).toHaveTextContent('50,0 XLM'));
      expect(screen.getByTestId('identity-header-round')).toHaveTextContent('50,0 XLM');

      // Puffer 4: Der Saldo danach (6 XLM) liegt ueber der Grenze, es gibt keinen Reset mehr.
      fireEvent.change(screen.getByLabelText('Puffer in XLM'), { target: { value: '4' } });
      await waitFor(() => expect(screen.getByTestId('identity-header-round')).toHaveTextContent('146,0 XLM'));
      expect(screen.getByTestId('identity-round-xlm')).toHaveTextContent('146,0 XLM');
      expect(screen.getByTestId('groupfund-summary')).toHaveTextContent('146,0 XLM');

      fireEvent.change(screen.getByLabelText('Puffer in XLM'), { target: { value: '5' } });
      await waitFor(() => expect(screen.getByTestId('identity-header-round')).toHaveTextContent('50,0 XLM'));

      // Grenze verwerfen
      fireEvent.click(within(screen.getByTestId('groupfund-boundary')).getByRole('button', { name: 'Verwerfen' }));
      await waitFor(() => expect(screen.getByTestId('identity-header-round')).toHaveTextContent('146,0 XLM'));
      expect(screen.getByTestId('identity-round-xlm')).toHaveTextContent('146,0 XLM');
    });
  });
});
