import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import MultisigCreatePage, { FRIENDBOT_TIMEOUT_MS } from '../MultisigCreatePage.jsx';
import { setGlobalNetwork } from '../../utils/globalNetwork.js';
import { confirmNavigation, hasNavigationGuard } from '../../utils/navigationGuard.js';
import { SESSION_LOCKED_EVENT } from '../../utils/sessionSecrets.js';

// Review N21-1 bis N21-4 und Sicherung des Secret Keys auf "Neues Konto erstellen".
// Grundsatz: Der Secret Key eines Kontos, fuer das eine Aktivierung gesendet wurde oder
// gesendet worden sein koennte, verschwindet nicht, bevor der Nutzer die Sicherung bestaetigt.
const hoisted = vi.hoisted(() => ({}));
vi.mock('../../utils/stellar/stellarUtils.js', async (importOriginal) => (await import('../../test/horizonMock.js')).withNetworkServer({
  ...(await importOriginal()),
  getHorizonServer: () => ({
    ledgers: () => ({ order: () => ({ limit: () => ({ call: async () => ({ records: [{ base_reserve_in_stroops: 5000000 }] }) }) }) }),
    loadAccount: async (pk) => {
      hoisted.loads.push(pk);
      if (hoisted.loadError) throw hoisted.loadError;
      // Optional: Antwort von Horizon zurueckhalten (Fenster vor dem Senden)
      if (hoisted.loadGate) await hoisted.loadGate;
      if (pk === hoisted.funderPub) {
        const { Account } = await import('@stellar/stellar-sdk');
        return new Account(pk, '1');
      }
      if (hoisted.existing.has(pk)) {
        const { Account } = await import('@stellar/stellar-sdk');
        return new Account(pk, '1');
      }
      throw Object.assign(new Error('not found'), { response: { status: 404 } });
    },
    submitTransaction: async (tx) => {
      hoisted.submitted += 1;
      hoisted.txs.push(tx);
      if (hoisted.submitImpl) return hoisted.submitImpl(tx);
      return { hash: 'h' };
    },
  }),
}));
vi.mock('../../components/SecretKeyModal.jsx', async () => {
  const { Keypair } = await import('@stellar/stellar-sdk');
  return {
    default: ({ onConfirm, onCancel }) => (
      <div>
        <button
          type="button"
          data-testid="funder-confirm"
          onClick={() => {
            const kp = Keypair.random();
            hoisted.funderPub = kp.publicKey();
            onConfirm([{ keypair: kp, publicKey: kp.publicKey(), weight: 1 }]);
          }}
        >
          confirm
        </button>
        <button type="button" data-testid="funder-cancel" onClick={onCancel}>cancel</button>
      </div>
    ),
  };
});

const tx = (key, opts) => i18n.t(key, opts);
const FRIENDBOT = 'https://friendbot.stellar.org';

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MultisigCreatePage />
    </I18nextProvider>
  );
}

const COSIGNER = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';

// Erzeugt Schluessel ohne sie anzuzeigen (Secret Key startet verborgen)
async function generateHidden(view) {
  await act(async () => { fireEvent.click(view.getByText(tx('multisigCreate:generateKeys'))); });
  return view.container.textContent.match(/G[A-Z2-7]{55}/)[0];
}
// Erzeugt Schluessel und zeigt den Secret Key an, um ihn zu lesen
async function generate(view) {
  const pub = await generateHidden(view);
  await act(async () => { fireEvent.click(view.getByTestId('create-secret-toggle')); });
  const sec = view.getByTestId('create-secret').textContent;
  expect(sec).toMatch(/^S[A-Z2-7]{55}$/);
  return { pub, sec };
}
const confirmBackup = async (view) => {
  // Die Checkbox ist erst nach Anzeigen oder Kopieren des Secret Keys bedienbar
  if (view.getByTestId('create-backup-confirm').disabled) {
    await act(async () => { fireEvent.click(view.getByTestId('create-secret-toggle')); });
  }
  await act(async () => { fireEvent.click(view.getByTestId('create-backup-confirm')); });
  expect(view.getByTestId('create-backup-confirm').checked).toBe(true);
};
const activateOnlyButton = (view) => view.getByTestId('create-activate');
const createButton = (view) => view.getByTestId('create-activate-multisig');
const clickActivateOnly = (view) => act(async () => { fireEvent.click(activateOnlyButton(view)); });
const chooseMode = (view, mode) => act(async () => { fireEvent.click(view.getByTestId(`create-mode-${mode}`)); });
async function enterCosigner(view, value = COSIGNER, index = 0) {
  const input = Array.from(view.container.querySelectorAll('input')).filter((i) => i.placeholder === 'G...')[index];
  await act(async () => { fireEvent.change(input, { target: { value } }); });
}
const friendbotCalls = () => globalThis.fetch.mock.calls.filter(([url]) => String(url).startsWith(FRIENDBOT));

function mockFriendbot(...responses) {
  // Je Aufruf die naechste Antwort: Response, Error (Netzfehler) oder Funktion
  const queue = [...responses];
  globalThis.fetch.mockImplementation(async (url) => {
    if (!String(url).startsWith(FRIENDBOT)) return new Response('{}', { status: 200 });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(url);
    return next.clone();
  });
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeAll(async () => { await i18n.changeLanguage('de'); });
beforeEach(() => {
  window.localStorage.clear();
  hoisted.loads = [];
  hoisted.existing = new Set();
  hoisted.submitted = 0;
  hoisted.submitImpl = null;
  hoisted.funderPub = '';
  hoisted.loadGate = null;
  hoisted.loadError = null;
  hoisted.txs = [];
  vi.spyOn(globalThis, 'fetch');
  // Rueckfragen (neue Schluessel ersetzen) bestaetigen
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('Checkbox: Secret Key gesichert ist Pflicht vor jeder Aktivierung', () => {
  it.each(['TESTNET', 'PUBLIC'])('%s: ohne Haken gesperrt, mit Haken moeglich; neue Schluessel setzen den Haken zurueck', async (network) => {
    window.localStorage.setItem('SKM_NETWORK', network);
    mockFriendbot(json(200, { hash: 'fb' }));
    const view = renderPage();
    await generate(view);
    expect(activateOnlyButton(view)).toBeDisabled();
    expect(view.getByTestId('create-keys-finish')).toBeDisabled();
    await chooseMode(view, 'multisig');
    await enterCosigner(view);
    expect(createButton(view)).toBeDisabled();
    await chooseMode(view, 'account');
    // Klick trotz Sperre: nichts passiert
    await clickActivateOnly(view);
    expect(friendbotCalls()).toHaveLength(0);
    expect(view.queryByTestId('funder-confirm')).toBeNull();

    // Gegenprobe: mit Haken geht es
    await confirmBackup(view);
    expect(activateOnlyButton(view)).not.toBeDisabled();
    expect(view.getByTestId('create-keys-finish')).not.toBeDisabled();
    await chooseMode(view, 'multisig');
    expect(createButton(view)).not.toBeDisabled();
    await chooseMode(view, 'account');
    await clickActivateOnly(view);
    if (network === 'TESTNET') {
      await waitFor(() => expect(friendbotCalls()).toHaveLength(1));
    } else {
      await view.findByTestId('funder-confirm');
    }

    // Neue Schluessel: Haken weg (ein offenes Funder-Modal sperrt das Erzeugen, erst abbrechen)
    if (network === 'PUBLIC') {
      await act(async () => { fireEvent.click(view.getByTestId('funder-cancel')); });
    }
    await generate(view);
    expect(view.getByTestId('create-backup-confirm').checked).toBe(false);
    expect(activateOnlyButton(view)).toBeDisabled();
  });
});

describe('Secret Key: Kopieren und Verbergen', () => {
  it('startet verborgen, auch nach jedem neuen Erzeugen; Anzeigen zeigt ihn', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const view = renderPage();
    await generateHidden(view);
    expect(view.container.textContent).not.toMatch(/S[A-Z2-7]{55}/);
    expect(view.getByTestId('create-secret').textContent).toMatch(/^•{56}$/);
    expect(view.getByTestId('create-secret-toggle').textContent).toBe(tx('multisigCreate:secretKey.show'));
    await act(async () => { fireEvent.click(view.getByTestId('create-secret-toggle')); });
    const first = view.getByTestId('create-secret').textContent;
    expect(first).toMatch(/^S[A-Z2-7]{55}$/);

    // Neue Schluessel: wieder verborgen
    await generateHidden(view);
    expect(view.container.textContent).not.toMatch(/S[A-Z2-7]{55}/);
    expect(view.getByTestId('create-secret-toggle').textContent).toBe(tx('multisigCreate:secretKey.show'));
    await act(async () => { fireEvent.click(view.getByTestId('create-secret-toggle')); });
    expect(view.getByTestId('create-secret').textContent).not.toBe(first);
  });

  it('kopiert den Secret Key auch verborgen und kann ihn verbergen und wieder anzeigen', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const view = renderPage();
    await generateHidden(view);
    // Verborgen kopieren: der echte Key landet in der Zwischenablage, nicht in der Seite
    await act(async () => { fireEvent.click(view.getByTestId('create-secret-copy')); });
    const sec = writeText.mock.calls[0][0];
    expect(sec).toMatch(/^S[A-Z2-7]{55}$/);
    expect(view.container.textContent).not.toContain(sec);
    expect(view.getByTestId('create-secret-copy-status').textContent).toBe(tx('multisigCreate:secretKey.copied'));

    await act(async () => { fireEvent.click(view.getByTestId('create-secret-toggle')); });
    expect(view.getByTestId('create-secret').textContent).toBe(sec);
    await act(async () => { fireEvent.click(view.getByTestId('create-secret-toggle')); });
    expect(view.getByTestId('create-secret').textContent).not.toContain(sec);
    expect(view.container.textContent).not.toContain(sec);
    await act(async () => { fireEvent.click(view.getByTestId('create-secret-toggle')); });
    expect(view.getByTestId('create-secret').textContent).toBe(sec);
  });
});

describe('Sitzungssperre: Secret Key verbergen, nicht verwerfen', () => {
  it('skm:session-locked verbirgt den Key; Seite, Vermerk und Waechter bleiben; Anzeigen zeigt ihn wieder', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(json(200, { hash: 'fb' }));
    const view = renderPage();
    const { pub, sec } = await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(view.getByTestId('create-activation')).toBeInTheDocument());

    await act(async () => { window.dispatchEvent(new CustomEvent(SESSION_LOCKED_EVENT)); });
    expect(view.container.textContent).not.toContain(sec);
    expect(view.getByTestId('create-secret').textContent).toBe('•'.repeat(sec.length));
    expect(view.getByTestId('create-secret-toggle').textContent).toBe(tx('multisigCreate:secretKey.show'));
    // Seite, Adresse, Vermerk und Waechter unveraendert
    expect(view.getByTestId('create-activation-pub').textContent).toBe(pub);
    expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusSuccess'));
    expect(view.getByTestId('create-backup-confirm').checked).toBe(true);
    expect(hasNavigationGuard()).toBe(true);

    await act(async () => { fireEvent.click(view.getByTestId('create-secret-toggle')); });
    expect(view.getByTestId('create-secret').textContent).toBe(sec);
  });

  it('Gegenprobe: ohne Sperr-Ereignis bleibt der angezeigte Key sichtbar, andere Ereignisse verbergen ihn nicht', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const view = renderPage();
    const { sec } = await generate(view);
    await act(async () => { window.dispatchEvent(new CustomEvent('stm-session-secret-changed', { detail: {} })); });
    expect(view.getByTestId('create-secret').textContent).toBe(sec);
    expect(view.getByTestId('create-secret-toggle').textContent).toBe(tx('multisigCreate:secretKey.hide'));
  });
});

describe('N21-1: Vermerk bleibt, kein zweiter Versand nach unklarem Ausgang', () => {
  it('Testnet: Friendbot ohne Antwort, zweiter Klick auf Nur aktivieren sendet nicht, Netzwechsel verwirft nicht', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(new TypeError('Failed to fetch'), json(400, { detail: 'account already funded to starting balance' }));
    const view = renderPage();
    const { pub, sec } = await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusAmbiguous')));

    await clickActivateOnly(view);
    await waitFor(() => expect(view.container.textContent).toContain(tx('multisigCreate:activation.stillUnclear')));
    expect(friendbotCalls()).toHaveLength(1);
    expect(view.getByTestId('create-activation')).toBeInTheDocument();

    await act(async () => { setGlobalNetwork('PUBLIC'); });
    expect(view.container.textContent).toContain(pub);
    expect(view.container.textContent).toContain(sec);
    expect(view.getByTestId('create-network-notice').textContent).toBe(tx('createAccount:networkChanged.keptActivated', { network: 'Testnet' }));
  });

  it('Mainnet: Horizon-Timeout, zweiter Klick oeffnet keinen Funder-Dialog und sendet nichts', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    hoisted.submitImpl = async () => { throw new Error('timeout'); };
    const view = renderPage();
    const { pub } = await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await act(async () => { fireEvent.click(await view.findByTestId('funder-confirm')); });
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusAmbiguous')));
    expect(hoisted.submitted).toBe(1);

    await clickActivateOnly(view);
    await waitFor(() => expect(view.container.textContent).toContain(tx('multisigCreate:activation.stillUnclear')));
    expect(view.queryByTestId('funder-confirm')).toBeNull();
    expect(hoisted.submitted).toBe(1);
    // Live geprueft, bevor entschieden wurde
    expect(hoisted.loads.filter((pk) => pk === pub).length).toBeGreaterThanOrEqual(2);

    await act(async () => { setGlobalNetwork('TESTNET'); });
    expect(view.container.textContent).toContain(pub);
  });

  it('Konto existiert inzwischen: zweiter Versuch wertet es als aktiviert und sendet nicht', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(new TypeError('Failed to fetch'));
    const view = renderPage();
    const { pub } = await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusAmbiguous')));
    hoisted.existing.add(pub); // erste Anfrage kam doch an
    await clickActivateOnly(view);
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusSuccess')));
    expect(view.container.textContent).toContain(tx('multisigCreate:alreadyActive'));
    expect(friendbotCalls()).toHaveLength(1);
  });

  it('Aktivieren und Multisig setzen: vor der Aktivierung live geprueft, existierendes Konto wird nicht erneut aktiviert', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(json(200, { hash: 'fb' }));
    const view = renderPage();
    await chooseMode(view, 'multisig');
    const { pub } = await generate(view);
    hoisted.existing.add(pub);
    await enterCosigner(view);
    await confirmBackup(view);
    await act(async () => { fireEvent.click(createButton(view)); });
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusSuccess')));
    await waitFor(() => expect(view.container.textContent).toContain(tx('multisigCreate:createdAndConfigured', { hash: 'h' })));
    expect(friendbotCalls()).toHaveLength(0);
    expect(hoisted.submitted).toBe(1); // nur setOptions

    // Gegenprobe: Konto existiert nicht -> aktiviert ueber Friendbot, genau einmal
    // (Wahl "Konto mit Multisig" bleibt beim Erzeugen neuer Schluessel)
    const next = await generate(view);
    expect(view.getByTestId('create-mode-multisig').checked).toBe(true);
    mockFriendbot(() => { hoisted.existing.add(next.pub); return json(200, { hash: 'fb' }); });
    await enterCosigner(view);
    await confirmBackup(view);
    await act(async () => { fireEvent.click(createButton(view)); });
    await waitFor(() => expect(hoisted.submitted).toBe(2));
    expect(friendbotCalls()).toHaveLength(1);
  });
});

describe('Ablauf: Nur Konto / Konto mit Multisig', () => {
  it('Nur Konto ohne Aktivierung: keine Erfolgsmeldung, nichts gesendet; Fertig nennt das fehlende Konto', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(json(200, { hash: 'fb' }));
    const view = renderPage();
    const { sec } = await generate(view);
    expect(view.getByTestId('create-not-activated-hint').textContent).toBe(tx('multisigCreate:step.notActivatedHint'));
    await confirmBackup(view);
    await act(async () => { fireEvent.click(view.getByTestId('create-keys-finish')); });
    const text = view.container.textContent;
    expect(text).toContain(tx('multisigCreate:keys.finishedNotActivated'));
    for (const key of ['createdNoSigners', 'createdAndConfigured', 'activated', 'activatedTestnet', 'alreadyActive']) {
      expect(text).not.toContain(tx(`multisigCreate:${key}`, { hash: '' }));
    }
    // Meldung fuer den Abschluss ohne Aktivierung, nicht die mit Aktivierung
    const result = Array.from(view.container.querySelectorAll('p')).find((p) => p.textContent.startsWith('Abgeschlossen.'));
    expect(result.textContent).toBe(tx('multisigCreate:keys.finishedNotActivated'));
    // Hinweis, keine Erfolgsmeldung: Rolle status, amber, nicht in Erfolgsgruen
    expect(result).toBe(view.getByTestId('create-info'));
    expect(result.getAttribute('role')).toBe('status');
    expect(result.className).toContain('amber');
    expect(result.className).not.toMatch(/green/);
    expect(view.queryByTestId('create-result')).toBeNull();
    expect(text).not.toContain(sec);
    expect(friendbotCalls()).toHaveLength(0);
    expect(hoisted.submitted).toBe(0);
    expect(hasNavigationGuard()).toBe(false);
  });

  it('Fertig ohne Aktivierung verlangt die Pflicht-Checkbox', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const view = renderPage();
    const { sec } = await generate(view);
    expect(view.getByTestId('create-keys-finish')).toBeDisabled();
    await act(async () => { fireEvent.click(view.getByTestId('create-keys-finish')); });
    expect(view.getByTestId('create-secret').textContent).toBe(sec);
    expect(hasNavigationGuard()).toBe(true);
  });

  it('Konto mit Multisig ohne Signer: Button gesperrt, keine Erfolgsmeldung, nichts gesendet', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(json(200, { hash: 'fb' }));
    const view = renderPage();
    await chooseMode(view, 'multisig');
    await generate(view);
    await confirmBackup(view);
    expect(createButton(view)).toBeDisabled();
    expect(view.getByTestId('create-multisig-no-signers')).toBeInTheDocument();
    await act(async () => { fireEvent.click(createButton(view)); });
    expect(view.container.textContent).not.toContain(tx('multisigCreate:createdNoSigners'));
    expect(friendbotCalls()).toHaveLength(0);
    expect(hoisted.submitted).toBe(0);
  });

  it('Konto aktivieren im Testnet ruft Friendbot genau einmal und meldet erst danach Erfolg', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    let answer;
    mockFriendbot(() => new Promise((r) => { answer = r; }));
    const view = renderPage();
    const { pub } = await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(friendbotCalls()).toHaveLength(1));
    expect(String(friendbotCalls()[0][0])).toContain(encodeURIComponent(pub));
    // Vor der Antwort keine Erfolgsmeldung
    expect(view.container.textContent).not.toContain(tx('multisigCreate:activatedTestnet'));
    await act(async () => { answer(json(200, { hash: 'fb' })); });
    await waitFor(() => expect(view.container.textContent).toContain(tx('multisigCreate:activatedTestnet')));
    expect(friendbotCalls()).toHaveLength(1);
    // Aktivierungsschritt entfaellt, weiter im Aktivierungs-Panel
    expect(view.queryByTestId('create-step-activate')).toBeNull();
    expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusSuccess'));
  });

  it('Aktivieren und Multisig setzen mit bereits aktivem Konto (Vermerk, live vorhanden) sendet keine zweite Aktivierung', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(new TypeError('Failed to fetch'));
    const view = renderPage();
    const { pub } = await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusAmbiguous')));
    expect(friendbotCalls()).toHaveLength(1);
    hoisted.existing.add(pub); // Aktivierung kam doch an

    await chooseMode(view, 'multisig');
    await enterCosigner(view);
    await act(async () => { fireEvent.click(createButton(view)); });
    await waitFor(() => expect(view.container.textContent).toContain(tx('multisigCreate:createdAndConfigured', { hash: 'h' })));
    expect(friendbotCalls()).toHaveLength(1);
    expect(hoisted.submitted).toBe(1); // nur setOptions
    expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusSuccess'));
  });

  it('Mainnet: Aktivieren und Multisig setzen mit Vermerk Erfolg setzt nur Multisig ueber das Panel', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    const view = renderPage();
    const { pub } = await generate(view);
    await confirmBackup(view);
    // Startguthaben-Feld gehoert zum Aktivierungsschritt
    expect(view.getByTestId('create-starting-balance')).toBeInTheDocument();
    await clickActivateOnly(view);
    await act(async () => { fireEvent.click(await view.findByTestId('funder-confirm')); });
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusSuccess')));
    expect(hoisted.submitted).toBe(1);
    hoisted.existing.add(pub);

    await chooseMode(view, 'multisig');
    await enterCosigner(view);
    expect(view.queryByTestId('create-activate-multisig')).toBeNull();
    await act(async () => { fireEvent.click(view.getByTestId('create-activation-set-multisig')); });
    await waitFor(() => expect(hoisted.submitted).toBe(2));
    expect(view.queryByTestId('funder-confirm')).toBeNull();
    expect(view.container.textContent).toContain(tx('multisigCreate:createdAndConfigured', { hash: 'h' }));
  });

  it('Wechsel Nur Konto / Mit Multisig behaelt die Schluessel', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const view = renderPage();
    const { pub, sec } = await generate(view);
    await confirmBackup(view);
    await chooseMode(view, 'multisig');
    expect(view.getByTestId('create-mode-multisig').checked).toBe(true);
    expect(view.container.textContent).toContain(pub);
    expect(view.getByTestId('create-secret').textContent).toBe(sec);
    expect(view.getByTestId('create-backup-confirm').checked).toBe(true);
    expect(createButton(view)).toBeInTheDocument();
    await chooseMode(view, 'account');
    expect(view.getByTestId('create-mode-account').checked).toBe(true);
    expect(view.container.textContent).toContain(pub);
    expect(view.getByTestId('create-secret').textContent).toBe(sec);
    expect(activateOnlyButton(view)).toBeInTheDocument();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(hasNavigationGuard()).toBe(true);
  });
});

describe('N21-2: Friendbot-Antworten', () => {
  it.each([
    [500, 'Internal Server Error'],
    [502, '<html>Bad Gateway</html>'],
    [429, '{"detail":"rate limit exceeded"}'],
  ])('Status %s zaehlt als unklar: Vermerk bleibt, Netzwechsel verwirft nicht', async (status, body) => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(new Response(body, { status }));
    const view = renderPage();
    const { pub } = await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusAmbiguous')));
    expect(view.container.textContent).toContain(tx('multisigCreate:activation.friendbotUnclear', { status }));
    await act(async () => { setGlobalNetwork('PUBLIC'); });
    expect(view.container.textContent).toContain(pub);
  });

  it('400 mit "Konto existiert" zaehlt als aktiviert', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(json(400, { status: 400, detail: 'createAccountAlreadyExist' }));
    const view = renderPage();
    await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusSuccess')));
    expect(view.container.textContent).toContain(tx('multisigCreate:alreadyActive'));
  });

  it('Gegenprobe: 400 mit Fehlertext und Konto existiert nicht: abgelehnt, Netzwechsel behaelt die Schluessel ohne Vermerk', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(json(400, { status: 400, detail: 'invalid address' }));
    const view = renderPage();
    const { pub } = await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(view.container.textContent).toContain(tx('multisigCreate:activation.friendbotRejected', { status: 400 })));
    expect(view.queryByTestId('create-activation')).toBeNull();
    await act(async () => { setGlobalNetwork('PUBLIC'); });
    expect(view.container.textContent).toContain(pub);
    expect(view.getByTestId('create-network-notice').textContent).toBe(tx('createAccount:networkChanged.keptKeys', { network: 'Testnet', current: 'Mainnet' }));
  });

  it('400 mit Fehlertext, Konto existiert aber live: aktiviert, nicht abgelehnt', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const view = renderPage();
    const { pub } = await generate(view);
    mockFriendbot(() => { hoisted.existing.add(pub); return json(400, { detail: 'transaction failed' }); });
    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusSuccess')));
  });
});

describe('N21-4: eindeutige Ablehnung nach Netzwechsel', () => {
  function pendingSubmit() {
    let reject;
    hoisted.submitImpl = () => new Promise((_, r) => { reject = r; });
    const rejection = () => Object.assign(new Error('rejected'), { response: { status: 400, data: { extras: { result_codes: { transaction: 'tx_failed' } } } } });
    return () => reject(rejection());
  }

  async function startMainnetActivation(view) {
    const keys = await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await act(async () => { fireEvent.click(await view.findByTestId('funder-confirm')); });
    await waitFor(() => expect(hoisted.submitted).toBe(1));
    return keys;
  }

  it('Ablehnung kommt nach dem Wechsel: Vermerk weg, Schluessel bleiben gesperrt, Hinweis wie ohne Aktivierung', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    const rejectNow = pendingSubmit();
    const view = renderPage();
    const { pub } = await startMainnetActivation(view);
    // Waehrend die Aktivierung laeuft: Wechsel behaelt die Schluessel
    await act(async () => { setGlobalNetwork('TESTNET'); });
    expect(view.container.textContent).toContain(pub);
    expect(view.getByTestId('create-network-notice').textContent).toBe(tx('createAccount:networkChanged.keptActivated', { network: 'Mainnet' }));

    await act(async () => { rejectNow(); });
    await waitFor(() => expect(view.queryByTestId('create-activation')).toBeNull());
    expect(view.container.textContent).toContain(pub);
    expect(view.getByTestId('create-network-notice').textContent).toBe(tx('createAccount:networkChanged.keptKeys', { network: 'Mainnet', current: 'Testnet' }));
    expect(view.getByTestId('create-keys-locked')).toBeInTheDocument();
    // Waechter bleibt: Schluessel verschwinden nur durch den Nutzer
    expect(hasNavigationGuard()).toBe(true);
  });

  it('Gegenprobe: Ablehnung ohne Netzwechsel: Vermerk weg, Schluessel bleiben im selben Netz', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    const rejectNow = pendingSubmit();
    const view = renderPage();
    const { pub } = await startMainnetActivation(view);
    await act(async () => { rejectNow(); });
    await waitFor(() => expect(view.queryByTestId('create-activation')).toBeNull());
    expect(view.container.textContent).toContain(pub);
    expect(view.queryByTestId('create-network-notice')).toBeNull();
  });
});

describe('Verlassen der Seite: beforeunload und Fertig, Key gesichert', () => {
  const beforeUnloadPrevented = () => {
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  };

  it('Waechter ab dem Erzeugen; mit Vermerk weiter gesetzt; nach Fertig entfernt und Key weg', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(json(200, { hash: 'fb' }));
    const view = renderPage();
    // Gegenprobe: ohne Schluessel kein Waechter
    expect(beforeUnloadPrevented()).toBe(false);
    expect(hasNavigationGuard()).toBe(false);
    const { sec } = await generate(view);
    // KS-2: schon nur erzeugt (nichts gesendet) gesetzt
    expect(beforeUnloadPrevented()).toBe(true);
    expect(hasNavigationGuard()).toBe(true);

    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusSuccess')));
    expect(beforeUnloadPrevented()).toBe(true);
    expect(hasNavigationGuard()).toBe(true);

    await act(async () => { fireEvent.click(view.getByTestId('create-activation-finish')); });
    expect(beforeUnloadPrevented()).toBe(false);
    expect(hasNavigationGuard()).toBe(false);
    expect(view.container.textContent).not.toContain(sec);
    expect(view.container.textContent).toContain(tx('multisigCreate:activation.finished'));
  });

  it('Unmount meldet den Waechter ab', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(json(200, { hash: 'fb' }));
    const view = renderPage();
    await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(hasNavigationGuard()).toBe(true));
    view.unmount();
    expect(hasNavigationGuard()).toBe(false);
    expect(beforeUnloadPrevented()).toBe(false);
  });
});

// KS-1: Fenster zwischen Klick und Vermerk (Horizon-Aufrufe). Der Waechter haelt die Seite;
// wird sie trotzdem ausgehaengt, sendet der laufende Ablauf nichts mehr.
describe('KS-1: Seite verlassen, bevor die Aktivierung gesendet ist', () => {
  function holdHorizon() {
    let release;
    hoisted.loadGate = new Promise((r) => { release = r; });
    return () => { hoisted.loadGate = null; release(); };
  }
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

  async function confirmFunderAndHold(view) {
    await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    const confirmButton = await view.findByTestId('funder-confirm');
    const release = holdHorizon();
    await act(async () => { fireEvent.click(confirmButton); });
    await waitFor(() => expect(hoisted.loads).toContain(hoisted.funderPub));
    return release;
  }

  it('Mainnet: Funder bestaetigt, waehrend der Horizon-Aufrufe fragt ein Menuewechsel nach', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    const view = renderPage();
    const release = await confirmFunderAndHold(view);
    window.confirm.mockReturnValue(false);
    // main.jsx fragt bei jedem Menuewechsel ueber confirmNavigation()
    expect(confirmNavigation()).toBe(false);
    expect(window.confirm).toHaveBeenLastCalledWith(tx('multisigCreate:leaveGuard.confirmKeys'));
    expect(beforeUnloadPrevented()).toBe(true);
    // Gegenprobe: ohne Aushaengen laeuft der Ablauf zu Ende und sendet einmal
    release();
    await waitFor(() => expect(hoisted.submitted).toBe(1));
    await waitFor(() => expect(view.getByTestId('create-activation')).toBeInTheDocument());
  });

  it('Mainnet: erzwungenes Aushaengen waehrend der Horizon-Aufrufe: danach wird nichts gesendet', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    const view = renderPage();
    const release = await confirmFunderAndHold(view);
    view.unmount();
    expect(hasNavigationGuard()).toBe(false);
    release();
    await settle();
    expect(hoisted.submitted).toBe(0);
  });

  it('Testnet: Aushaengen waehrend der Live-Pruefung: Friendbot wird nicht aufgerufen', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(json(200, { hash: 'fb' }));
    const view = renderPage();
    const { pub } = await generate(view);
    await confirmBackup(view);
    const release = holdHorizon();
    await clickActivateOnly(view);
    await waitFor(() => expect(hoisted.loads).toContain(pub));
    view.unmount();
    release();
    await settle();
    expect(friendbotCalls()).toHaveLength(0);
  });

  const beforeUnloadPrevented = () => {
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  };
});

// KS-2: Schluessel ohne Aktivierung durch SKM (Adresse kann von aussen gefuellt werden)
describe('KS-2: Waechter fuer erzeugte Schluessel ohne Aktivierung', () => {
  const beforeUnloadPrevented = () => {
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  };

  it('Menuewechsel und Reload fragen nach; nach Schluessel verwerfen nicht mehr', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    const view = renderPage();
    const { sec } = await generate(view);
    window.confirm.mockReturnValue(false);
    expect(confirmNavigation()).toBe(false);
    expect(window.confirm).toHaveBeenLastCalledWith(tx('multisigCreate:leaveGuard.confirmKeys'));
    expect(beforeUnloadPrevented()).toBe(true);
    expect(view.getByTestId('create-secret').textContent).toBe(sec);

    // Verwerfen abgebrochen: alles bleibt
    await act(async () => { fireEvent.click(view.getByTestId('create-keys-discard')); });
    expect(hasNavigationGuard()).toBe(true);
    expect(view.getByTestId('create-secret').textContent).toBe(sec);

    // Gegenprobe: Verwerfen bestaetigt -> keine Rueckfrage, kein beforeunload
    window.confirm.mockReturnValue(true);
    await act(async () => { fireEvent.click(view.getByTestId('create-keys-discard')); });
    expect(view.container.textContent).not.toContain(sec);
    expect(hasNavigationGuard()).toBe(false);
    expect(beforeUnloadPrevented()).toBe(false);
    window.confirm.mockClear();
    expect(confirmNavigation()).toBe(true);
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('Schluessel verwerfen und Fertig sind waehrend eines laufenden Ablaufs gesperrt', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    let answer;
    mockFriendbot(() => new Promise((r) => { answer = r; }));
    const view = renderPage();
    const { sec } = await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(friendbotCalls()).toHaveLength(1));
    expect(view.getByTestId('create-keys-discard')).toBeDisabled();
    expect(view.getByTestId('create-activation-finish')).toBeDisabled();
    await act(async () => { fireEvent.click(view.getByTestId('create-keys-discard')); });
    expect(view.getByTestId('create-secret').textContent).toBe(sec);
    await act(async () => { answer(json(200, { hash: 'fb' })); });
    await waitFor(() => expect(view.getByTestId('create-keys-discard')).not.toBeDisabled());
    expect(view.getByTestId('create-activation-finish')).not.toBeDisabled();
  });
});

// KS-4: Friendbot ohne Antwort endet nach FRIENDBOT_TIMEOUT_MS als unklarer Ausgang
describe('KS-4: Friendbot mit Timeout', () => {
  const flush = () => act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });
  let signals;
  function friendbotHangs() {
    signals = [];
    globalThis.fetch.mockImplementation((url, opts) => {
      if (!String(url).startsWith(FRIENDBOT)) return Promise.resolve(new Response('{}', { status: 200 }));
      signals.push(opts?.signal);
      return new Promise((_, reject) => {
        opts?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    });
  }

  it('keine Antwort: nach dem Timeout unklar, Vermerk gesetzt, kein zweiter Versand', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    friendbotHangs();
    const view = renderPage();
    const { pub, sec } = await generate(view);
    await confirmBackup(view);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await clickActivateOnly(view);
      await flush();
      expect(friendbotCalls()).toHaveLength(1);
      expect(signals[0]).toBeDefined();
      await act(async () => { vi.advanceTimersByTime(FRIENDBOT_TIMEOUT_MS - 1); });
      await flush();
      expect(signals[0].aborted).toBe(false);
      expect(view.container.textContent).not.toContain(tx('multisigCreate:activation.friendbotTimeout', { seconds: 30 }));
      await act(async () => { vi.advanceTimersByTime(1); });
      await flush();
    } finally {
      vi.useRealTimers();
    }
    expect(signals[0].aborted).toBe(true);
    await waitFor(() => expect(view.container.textContent).toContain(tx('multisigCreate:activation.friendbotTimeout', { seconds: 30 })));
    expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusAmbiguous'));
    expect(view.getByTestId('create-activation-pub').textContent).toBe(pub);
    expect(view.getByTestId('create-secret').textContent).toBe(sec);
    expect(hasNavigationGuard()).toBe(true);
    expect(activateOnlyButton(view)).not.toBeDisabled();
    // Zweiter Klick: Vermerk ohne sichtbares Konto -> kein zweiter Versand
    await clickActivateOnly(view);
    await waitFor(() => expect(view.container.textContent).toContain(tx('multisigCreate:activation.stillUnclear')));
    expect(friendbotCalls()).toHaveLength(1);
  });

  it('Gegenprobe: Antwort vor dem Timeout: aktiviert, Timer geloescht, kein Abbruch', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    signals = [];
    globalThis.fetch.mockImplementation(async (url, opts) => {
      if (String(url).startsWith(FRIENDBOT)) signals.push(opts?.signal);
      return json(200, { hash: 'fb' });
    });
    const view = renderPage();
    await generate(view);
    await confirmBackup(view);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await clickActivateOnly(view);
      await flush();
      await act(async () => { vi.advanceTimersByTime(FRIENDBOT_TIMEOUT_MS * 2); });
    } finally {
      vi.useRealTimers();
    }
    expect(signals[0].aborted).toBe(false);
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusSuccess')));
  });
});

// ---------------------------------------------------------------------------------------
// Review-Runde: H1, M1 bis M4
// ---------------------------------------------------------------------------------------
const OTHER = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';
const numberInputs = (view) => Array.from(view.container.querySelectorAll('input[type="number"]'));
const setSignerCount = (view, n) => act(async () => {
  const input = numberInputs(view).find((i) => i.max === '20');
  fireEvent.change(input, { target: { value: String(n) } });
});

describe('H1: gesendete Signer-Gewichte sind die geprueften', () => {
  it('leeres erstes Feld: Signer in Feld 2 behaelt sein Gewicht, Master 0 sperrt nicht', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const view = renderPage();
    await chooseMode(view, 'multisig');
    const { pub } = await generate(view);
    mockFriendbot(() => { hoisted.existing.add(pub); return json(200, { hash: 'fb' }); });
    await setSignerCount(view, 2);
    await enterCosigner(view, COSIGNER, 1); // Feld 1 bleibt leer
    // Gewichte: Zeilen 0 und 1, danach Master, Low, Med, High
    const inputs = () => numberInputs(view).filter((i) => i.max === '255');
    await act(async () => { fireEvent.change(inputs()[1], { target: { value: '5' } }); });
    await act(async () => { fireEvent.change(inputs()[2], { target: { value: '0' } }); });
    // Angezeigte Summe = 5 (nur Feld 2 zaehlt)
    expect(view.container.textContent).toContain(tx('multisigConfig:thresholdSum', { sum: 5 }));
    await confirmBackup(view);
    expect(createButton(view)).not.toBeDisabled();
    await act(async () => { fireEvent.click(createButton(view)); });
    await waitFor(() => expect(hoisted.submitted).toBe(1));
    const ops = hoisted.txs[0].operations;
    expect(ops).toHaveLength(2); // Master/Schwellen + genau ein Signer
    expect(ops[0].masterWeight).toBe(0);
    expect(ops[1].signer.ed25519PublicKey).toBe(COSIGNER);
    expect(ops[1].signer.weight).toBe(5);
  });
});

describe('M1: Checkbox erst nach Anzeigen oder Kopieren', () => {
  it('gesperrt mit Hinweis, Anzeigen gibt sie frei, neue Schluessel sperren wieder', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const view = renderPage();
    await generateHidden(view);
    expect(view.getByTestId('create-backup-confirm')).toBeDisabled();
    expect(view.getByTestId('create-backup-needs-reveal').textContent).toBe(tx('multisigCreate:backup.needsReveal'));
    await act(async () => { fireEvent.click(view.getByTestId('create-backup-confirm')); });
    expect(view.getByTestId('create-backup-confirm').checked).toBe(false);
    expect(activateOnlyButton(view)).toBeDisabled();

    await act(async () => { fireEvent.click(view.getByTestId('create-secret-toggle')); });
    expect(view.getByTestId('create-backup-confirm')).not.toBeDisabled();
    expect(view.queryByTestId('create-backup-needs-reveal')).toBeNull();
    await act(async () => { fireEvent.click(view.getByTestId('create-backup-confirm')); });
    expect(view.getByTestId('create-backup-confirm').checked).toBe(true);

    await generateHidden(view);
    expect(view.getByTestId('create-backup-confirm')).toBeDisabled();
    expect(view.getByTestId('create-backup-confirm').checked).toBe(false);
  });

  it('erfolgreiches Kopieren gibt frei, fehlgeschlagenes nicht', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const writeText = vi.fn(async () => { throw new Error('denied'); });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const original = document.execCommand;
    document.execCommand = vi.fn(() => false);
    try {
      const view = renderPage();
      await generateHidden(view);
      await act(async () => { fireEvent.click(view.getByTestId('create-secret-copy')); });
      expect(view.getByTestId('create-secret-copy-status').textContent).toBe(tx('multisigCreate:secretKey.copyFailed'));
      expect(view.getByTestId('create-backup-confirm')).toBeDisabled();

      writeText.mockImplementation(async () => {});
      await act(async () => { fireEvent.click(view.getByTestId('create-secret-copy')); });
      expect(view.getByTestId('create-backup-confirm')).not.toBeDisabled();
      // Der Key blieb dabei verborgen
      expect(view.container.textContent).not.toMatch(/S[A-Z2-7]{55}/);
    } finally {
      document.execCommand = original;
    }
  });
});

describe('M2: Fertig bei unklarer Aktivierung, Checkbox nach Vermerk', () => {
  async function ambiguousActivation() {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(new TypeError('Failed to fetch'));
    const view = renderPage();
    const { pub, sec } = await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusAmbiguous')));
    return { view, pub, sec };
  }

  it('mit Vermerk ist die Checkbox gesetzt und gesperrt', async () => {
    const { view } = await ambiguousActivation();
    const box = view.getByTestId('create-backup-confirm');
    expect(box.checked).toBe(true);
    expect(box).toBeDisabled();
    await act(async () => { fireEvent.click(box); });
    expect(view.getByTestId('create-backup-confirm').checked).toBe(true);
  });

  it('Konto nicht sichtbar: Warnung in der Seite, nichts verworfen bis zur Bestaetigung, kein window.confirm', async () => {
    const { view, pub, sec } = await ambiguousActivation();
    window.confirm.mockClear();
    await act(async () => { fireEvent.click(view.getByTestId('create-activation-finish')); });
    const warn = await view.findByTestId('create-finish-warning');
    expect(warn.textContent).toContain(tx('multisigCreate:finishWarn.missing'));
    expect(view.getByTestId('create-secret').textContent).toBe(sec);
    expect(view.container.textContent).toContain(pub);
    expect(hasNavigationGuard()).toBe(true);
    expect(window.confirm).not.toHaveBeenCalled();

    // Abbrechen behaelt die Schluessel
    await act(async () => { fireEvent.click(view.getByTestId('create-finish-cancel')); });
    expect(view.queryByTestId('create-finish-warning')).toBeNull();
    expect(view.container.textContent).toContain(pub);
    expect(hasNavigationGuard()).toBe(true);

    // Bestaetigen verwirft
    await act(async () => { fireEvent.click(view.getByTestId('create-activation-finish')); });
    await act(async () => { fireEvent.click(await view.findByTestId('create-finish-confirm')); });
    expect(view.container.textContent).not.toContain(pub);
    expect(view.container.textContent).not.toContain(sec);
    expect(view.container.textContent).toContain(tx('multisigCreate:activation.finished'));
    expect(hasNavigationGuard()).toBe(false);
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('Konto inzwischen vorhanden: wie Erfolg, ohne Warnung', async () => {
    const { view, pub } = await ambiguousActivation();
    hoisted.existing.add(pub);
    await act(async () => { fireEvent.click(view.getByTestId('create-activation-finish')); });
    await waitFor(() => expect(view.container.textContent).toContain(tx('multisigCreate:activation.finished')));
    expect(view.queryByTestId('create-finish-warning')).toBeNull();
    expect(view.container.textContent).not.toContain(pub);
    expect(hasNavigationGuard()).toBe(false);
  });

  it('Horizon nicht erreichbar: nicht verworfen, Warnung mit anderem Text', async () => {
    const { view, pub } = await ambiguousActivation();
    hoisted.loadError = Object.assign(new Error('Network Error'), { response: { status: 503 } });
    await act(async () => { fireEvent.click(view.getByTestId('create-activation-finish')); });
    const warn = await view.findByTestId('create-finish-warning');
    expect(warn.textContent).toContain(tx('multisigCreate:finishWarn.unknown'));
    expect(view.container.textContent).toContain(pub);
    expect(hasNavigationGuard()).toBe(true);
  });

  it('Vermerk mit Erfolg: Fertig ohne Warnung', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(json(200, { hash: 'fb' }));
    const view = renderPage();
    await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusSuccess')));
    await act(async () => { fireEvent.click(view.getByTestId('create-activation-finish')); });
    expect(view.queryByTestId('create-finish-warning')).toBeNull();
    expect(view.container.textContent).toContain(tx('multisigCreate:activation.finished'));
    // Gegenprobe zur Farbe: nach Aktivierung Erfolgsmeldung, kein Hinweis
    expect(view.getByTestId('create-result').textContent).toBe(tx('multisigCreate:activation.finished'));
    expect(view.queryByTestId('create-info')).toBeNull();
  });

  it('Warnung nennt das Netz der Aktivierung und verschwindet, wenn sich der Status aendert', async () => {
    const { view, pub } = await ambiguousActivation();
    await act(async () => { fireEvent.click(view.getByTestId('create-activation-finish')); });
    const warn = await view.findByTestId('create-finish-warning');
    expect(warn.textContent).toContain(tx('multisigCreate:finishWarn.title', { network: tx('network:testnet') }));
    // Konto kommt an, erneutes Aktivieren wertet es live als aktiviert: Status wechselt
    hoisted.existing.add(pub);
    await clickActivateOnly(view);
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusSuccess')));
    expect(view.queryByTestId('create-finish-warning')).toBeNull();
    expect(view.container.textContent).toContain(pub);
    expect(friendbotCalls()).toHaveLength(1);
  });

  it('Netzwechsel waehrend der Warnung: Warnung weg, Schluessel bleiben; Fertig prueft danach neu im Netz der Aktivierung', async () => {
    const { view, pub } = await ambiguousActivation();
    await act(async () => { fireEvent.click(view.getByTestId('create-activation-finish')); });
    await view.findByTestId('create-finish-warning');
    await act(async () => { setGlobalNetwork('PUBLIC'); });
    expect(view.queryByTestId('create-finish-warning')).toBeNull();
    expect(view.container.textContent).toContain(pub);
    expect(hasNavigationGuard()).toBe(true);
    // Zurueckwechseln bringt die alte Warnung nicht zurueck
    await act(async () => { setGlobalNetwork('TESTNET'); });
    expect(view.queryByTestId('create-finish-warning')).toBeNull();
    // Fertig aus dem Mainnet heraus: neue Pruefung, Warnung nennt Testnet
    await act(async () => { setGlobalNetwork('PUBLIC'); });
    hoisted.loads = [];
    await act(async () => { fireEvent.click(view.getByTestId('create-activation-finish')); });
    const warn = await view.findByTestId('create-finish-warning');
    expect(warn.textContent).toContain(tx('multisigCreate:finishWarn.title', { network: tx('network:testnet') }));
    expect(hoisted.loads).toContain(pub);
    expect(view.container.textContent).toContain(pub);
  });
});

describe('M3: Sperre waehrend busy und bei offenem Funder-Modal', () => {
  const lockedControls = (view) => [
    ...Array.from(view.container.querySelectorAll('input[name="createMode"], input[name="network"]')),
    ...Array.from(view.container.querySelectorAll('input[placeholder="G..."]')),
    ...numberInputs(view),
    view.getByTestId('create-keys-discard'),
    view.getByText(tx('multisigCreate:generateKeys')).closest('button'),
    view.getByTestId('create-backup-confirm'),
  ];

  it('busy: Modus, Netz, Signer, Gewichte, Schwellen, Erzeugen, Verwerfen gesperrt; danach wieder frei', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    let answer;
    mockFriendbot(() => new Promise((r) => { answer = r; }));
    const view = renderPage();
    await chooseMode(view, 'multisig');
    const { pub } = await generate(view);
    await enterCosigner(view);
    await confirmBackup(view);
    await act(async () => { fireEvent.click(createButton(view)); });
    await waitFor(() => expect(friendbotCalls()).toHaveLength(1));
    const controls = lockedControls(view);
    expect(controls.length).toBeGreaterThan(8);
    controls.forEach((c) => expect(c).toBeDisabled());
    // Klicks auf gesperrte Bedienelemente aendern nichts
    await act(async () => { fireEvent.click(view.getByTestId('create-mode-account')); });
    expect(view.getByTestId('create-mode-multisig').checked).toBe(true);
    hoisted.existing.add(pub);
    await act(async () => { answer(json(200, { hash: 'fb' })); });
    await waitFor(() => expect(view.container.textContent).toContain(tx('multisigCreate:createdAndConfigured', { hash: 'h' })));
    expect(view.container.querySelector('input[name="createMode"]')).not.toBeDisabled();
    expect(view.getByText(tx('multisigCreate:generateKeys')).closest('button')).not.toBeDisabled();
  });

  it('Mainnet: offenes Funder-Modal sperrt wie busy; Abbruch gibt frei, ohne Erfolgsmeldung und ohne Vermerk', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    const view = renderPage();
    await chooseMode(view, 'multisig');
    await generate(view);
    await enterCosigner(view);
    await confirmBackup(view);
    await act(async () => { fireEvent.click(createButton(view)); });
    await view.findByTestId('funder-confirm');
    lockedControls(view).forEach((c) => expect(c).toBeDisabled());
    expect(view.getByTestId('create-starting-balance')).toBeDisabled();
    expect(view.getByTestId('create-keys-finish')).toBeDisabled();
    // Erzeugen trotz Klick nicht moeglich
    window.confirm.mockClear();
    await act(async () => { fireEvent.click(view.getByText(tx('multisigCreate:generateKeys'))); });
    expect(window.confirm).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(view.getByTestId('funder-cancel')); });
    expect(view.queryByTestId('funder-confirm')).toBeNull();
    expect(hoisted.submitted).toBe(0);
    expect(view.queryByTestId('create-activation')).toBeNull();
    const text = view.container.textContent;
    for (const key of ['activated', 'activatedTestnet', 'alreadyActive', 'createdAndConfigured']) {
      expect(text).not.toContain(tx(`multisigCreate:${key}`, { hash: '' }));
    }
    lockedControls(view).forEach((c) => {
      // Die Checkbox wird nach Abbruch wieder bedienbar, ebenso alle anderen
      expect(c).not.toBeDisabled();
    });
  });
});

describe('M4: Signer-Vorpruefung', () => {
  async function setup() {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(json(200, { hash: 'fb' }));
    const view = renderPage();
    await chooseMode(view, 'multisig');
    const keys = await generate(view);
    await confirmBackup(view);
    return { view, ...keys };
  }

  it('ungueltiger Signer: Meldung am Feld, Aktivieren gesperrt, nichts gesendet', async () => {
    const { view } = await setup();
    await enterCosigner(view, 'GAAAAAAAAAAAAAAAAAAAA');
    expect(view.getByTestId('signer-error-0').textContent).toBe(tx('multisigCreate:multisig.signerInvalid'));
    expect(createButton(view)).toBeDisabled();
    await act(async () => { fireEvent.click(createButton(view)); });
    expect(friendbotCalls()).toHaveLength(0);
    expect(hoisted.submitted).toBe(0);
    await enterCosigner(view, COSIGNER);
    expect(view.queryByTestId('signer-error-0')).toBeNull();
    expect(createButton(view)).not.toBeDisabled();
  });

  it('eigener neuer Public Key als Signer: gesperrt', async () => {
    const { view, pub } = await setup();
    await enterCosigner(view, pub);
    expect(view.getByTestId('signer-error-0').textContent).toBe(tx('multisigCreate:multisig.signerOwnKey'));
    expect(createButton(view)).toBeDisabled();
    expect(friendbotCalls()).toHaveLength(0);
  });

  it('Duplikat: zweites Feld markiert, gesperrt; Mainnet fragt dann nicht nach dem Funder', async () => {
    const { view } = await setup();
    await setSignerCount(view, 2);
    await enterCosigner(view, COSIGNER, 0);
    await enterCosigner(view, COSIGNER, 1);
    expect(view.queryByTestId('signer-error-0')).toBeNull();
    expect(view.getByTestId('signer-error-1').textContent).toBe(tx('multisigCreate:multisig.signerDuplicate'));
    expect(createButton(view)).toBeDisabled();
    await enterCosigner(view, OTHER, 1);
    expect(view.queryByTestId('signer-error-1')).toBeNull();
    expect(createButton(view)).not.toBeDisabled();
  });

  it('Mainnet: ungueltiger Signer oeffnet kein Funder-Modal', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    const view = renderPage();
    await chooseMode(view, 'multisig');
    await generate(view);
    await confirmBackup(view);
    await enterCosigner(view, 'GBAD');
    expect(createButton(view)).toBeDisabled();
    await act(async () => { fireEvent.click(createButton(view)); });
    expect(view.queryByTestId('funder-confirm')).toBeNull();
    expect(hoisted.submitted).toBe(0);
  });
});

describe('Multisig jetzt setzen: gleiche Voraussetzungen wie der Hauptweg', () => {
  it('ungueltiger Signer sperrt auch den Button im Aktivierungs-Panel', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(json(200, { hash: 'fb' }));
    const view = renderPage();
    await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusSuccess')));
    await chooseMode(view, 'multisig');
    expect(view.getByTestId('create-activation-no-signers')).toBeInTheDocument();
    expect(view.getByTestId('create-activation-set-multisig')).toBeDisabled();
    await enterCosigner(view, 'GNOPE');
    expect(view.getByTestId('create-activation-set-multisig')).toBeDisabled();
    await enterCosigner(view, COSIGNER);
    expect(view.getByTestId('create-activation-set-multisig')).not.toBeDisabled();
  });
});

describe('Signer-Gewicht 0 ist ungueltig', () => {
  // Gewichtsfelder: Zeilen, danach Master, Low, Med, High
  const weightInputs = (view) => numberInputs(view).filter((i) => i.max === '255');
  // Master 1, Schwellen 1/1/1: ohne Gewichtspruefung haette die Sicherheitspruefung nichts zu beanstanden
  async function lowThresholds(view) {
    const inputs = weightInputs(view);
    const n = inputs.length;
    for (const input of inputs.slice(n - 3)) {
      await act(async () => { fireEvent.change(input, { target: { value: '1' } }); });
    }
  }
  async function setWeight(view, row, value) {
    await act(async () => { fireEvent.change(weightInputs(view)[row], { target: { value } }); });
  }

  it('Testnet: Meldung am Gewichtsfeld, Aktivieren gesperrt, nichts gesendet; Gewicht 1 gibt frei', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const view = renderPage();
    await chooseMode(view, 'multisig');
    const { pub } = await generate(view);
    mockFriendbot(() => { hoisted.existing.add(pub); return json(200, { hash: 'fb' }); });
    await enterCosigner(view);
    await lowThresholds(view);
    await setWeight(view, 0, '0');
    await confirmBackup(view);
    expect(view.getByTestId('signer-weight-error-0').textContent).toBe(tx('multisigCreate:multisig.signerWeightZero'));
    expect(weightInputs(view)[0].getAttribute('aria-invalid')).toBe('true');
    expect(createButton(view)).toBeDisabled();
    await act(async () => { fireEvent.click(createButton(view)); });
    expect(friendbotCalls()).toHaveLength(0);
    expect(hoisted.submitted).toBe(0);
    expect(view.container.textContent).not.toContain(tx('multisigCreate:createdAndConfigured', { hash: 'h' }));

    // Gegenprobe: Gewicht 1, gesendet wird genau dieser Signer mit Gewicht 1
    await setWeight(view, 0, '1');
    expect(view.queryByTestId('signer-weight-error-0')).toBeNull();
    await act(async () => { fireEvent.click(createButton(view)); });
    await waitFor(() => expect(view.container.textContent).toContain(tx('multisigCreate:createdAndConfigured', { hash: 'h' })));
    const signerOps = hoisted.txs[0].operations.filter((op) => op.signer);
    expect(signerOps).toHaveLength(1);
    expect(signerOps[0].signer.weight).toBe(1);
  });

  it('leeres Feld mit Gewicht 0 ist kein Fehler (Feld faellt heraus)', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const view = renderPage();
    await chooseMode(view, 'multisig');
    await generate(view);
    await setSignerCount(view, 2);
    await enterCosigner(view, COSIGNER, 0);
    await setWeight(view, 1, '0');
    expect(view.queryByTestId('signer-weight-error-1')).toBeNull();
    await confirmBackup(view);
    expect(createButton(view)).not.toBeDisabled();
  });

  it('Mainnet: Gewicht 0 oeffnet kein Funder-Modal', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'PUBLIC');
    const view = renderPage();
    await chooseMode(view, 'multisig');
    await generate(view);
    await enterCosigner(view);
    await lowThresholds(view);
    await setWeight(view, 0, '0');
    await confirmBackup(view);
    expect(createButton(view)).toBeDisabled();
    await act(async () => { fireEvent.click(createButton(view)); });
    expect(view.queryByTestId('funder-confirm')).toBeNull();
    expect(hoisted.submitted).toBe(0);
  });

  it('Multisig jetzt setzen: Gewicht 0 sperrt den Button im Panel', async () => {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    mockFriendbot(json(200, { hash: 'fb' }));
    const view = renderPage();
    await generate(view);
    await confirmBackup(view);
    await clickActivateOnly(view);
    await waitFor(() => expect(view.getByTestId('create-activation').textContent).toContain(tx('multisigCreate:activation.statusSuccess')));
    await chooseMode(view, 'multisig');
    await enterCosigner(view);
    await lowThresholds(view);
    expect(view.getByTestId('create-activation-set-multisig')).not.toBeDisabled();
    await setWeight(view, 0, '0');
    expect(view.getByTestId('create-activation-set-multisig')).toBeDisabled();
    const before = hoisted.submitted;
    await act(async () => { fireEvent.click(view.getByTestId('create-activation-set-multisig')); });
    expect(hoisted.submitted).toBe(before);
  });
});

describe('Signer-Schreibweise: Kleinschreibung und Leerzeichen', () => {
  async function setup() {
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    const view = renderPage();
    await chooseMode(view, 'multisig');
    const keys = await generate(view);
    await confirmBackup(view);
    return { view, ...keys };
  }

  it('Kleinschreibung ist ungueltig und sperrt', async () => {
    const { view } = await setup();
    await enterCosigner(view, COSIGNER.toLowerCase());
    expect(view.getByTestId('signer-error-0').textContent).toBe(tx('multisigCreate:multisig.signerInvalid'));
    expect(createButton(view)).toBeDisabled();
  });

  it('Leerzeichen innerhalb der Adresse ist ungueltig', async () => {
    const { view } = await setup();
    await enterCosigner(view, `${COSIGNER.slice(0, 20)} ${COSIGNER.slice(20)}`);
    expect(view.getByTestId('signer-error-0').textContent).toBe(tx('multisigCreate:multisig.signerInvalid'));
    expect(createButton(view)).toBeDisabled();
  });

  it('Leerzeichen am Rand werden entfernt; gesendet wird die bereinigte Adresse', async () => {
    const { view, pub } = await setup();
    mockFriendbot(() => { hoisted.existing.add(pub); return json(200, { hash: 'fb' }); });
    await enterCosigner(view, `  ${COSIGNER} `);
    expect(view.queryByTestId('signer-error-0')).toBeNull();
    await act(async () => { fireEvent.click(createButton(view)); });
    await waitFor(() => expect(hoisted.submitted).toBe(1));
    const signerOps = hoisted.txs[0].operations.filter((op) => op.signer);
    expect(signerOps.map((op) => op.signer.ed25519PublicKey)).toEqual([COSIGNER]);
  });

  it('Duplikat auch mit Leerzeichen am Rand und eigener Key in Kleinschreibung', async () => {
    const { view, pub } = await setup();
    await setSignerCount(view, 2);
    await enterCosigner(view, COSIGNER, 0);
    await enterCosigner(view, ` ${COSIGNER}  `, 1);
    expect(view.getByTestId('signer-error-1').textContent).toBe(tx('multisigCreate:multisig.signerDuplicate'));
    expect(createButton(view)).toBeDisabled();
    await enterCosigner(view, pub.toLowerCase(), 1);
    expect(view.getByTestId('signer-error-1').textContent).toBe(tx('multisigCreate:multisig.signerInvalid'));
    expect(createButton(view)).toBeDisabled();
  });
});
