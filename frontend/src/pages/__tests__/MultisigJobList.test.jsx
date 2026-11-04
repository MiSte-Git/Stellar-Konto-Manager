import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import MultisigJobList from '../MultisigJobList.jsx';
import { needsSignatureFrom } from '../../utils/multisig/jobSigningState.js';

const ME_SECRET = 'SDAIDSY2LAXR5HPEJ2CKWQ3QV67VPYLXB6C2ATBY3J7VRKT6YD7SYV6Y';
const hoisted = vi.hoisted(() => ({
  challenge: vi.fn(),
  token: vi.fn(),
  del: vi.fn(),
  sessionSecret: vi.fn(),
}));
vi.mock('../../utils/multisigApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getMultisigJobChallenge: hoisted.challenge,
  getMultisigJobAccessToken: hoisted.token,
  signMultisigJobChallenge: (_secret, _challenge, purpose) => `signature:${purpose}`,
  deleteMultisigJob: hoisted.del,
}));
vi.mock('../../utils/sessionSecrets.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getSessionSecret: hoisted.sessionSecret,
}));

const ME = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';
const OTHER = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
const FOREIGN_ACCOUNT = 'GCZLMFGOQMVLH352AAUEBUBATMKM7OB6GUTJQ47DOXJDYUYKXDJEZQ7B';

const job = (id, o = {}) => ({
  id,
  txHash: `${id}hash`,
  accountId: FOREIGN_ACCOUNT,
  status: 'pending_signatures',
  signers: [{ publicKey: ME, weight: 1 }, { publicKey: OTHER, weight: 1 }],
  collectedSigners: [],
  createdAt: '2026-10-31T12:00:00Z',
  ...o,
});

describe('needsSignatureFrom', () => {
  it('nur wartende Jobs, bei denen ich Signer mit Gewicht bin und noch nicht signiert habe', () => {
    expect(needsSignatureFrom(job('a'), ME)).toBe(true);
    expect(needsSignatureFrom(job('a', { collectedSigners: [{ publicKey: ME }] }), ME)).toBe(false);
    expect(needsSignatureFrom(job('a', { status: 'ready_to_submit' }), ME)).toBe(false);
    expect(needsSignatureFrom(job('a', { status: 'expired' }), ME)).toBe(false);
    expect(needsSignatureFrom(job('a', { signers: [{ publicKey: ME, weight: 0 }] }), ME)).toBe(false);
    expect(needsSignatureFrom(job('a', { signers: [{ publicKey: OTHER, weight: 1 }] }), ME)).toBe(false);
    expect(needsSignatureFrom(job('a'), '')).toBe(false);
    expect(needsSignatureFrom(job('a', { declinedSigners: [{ publicKey: ME }] }), ME)).toBe(false);
  });
});

describe('MultisigJobList: Filter', () => {
  const urls = [];
  beforeEach(() => {
    urls.length = 0;
    window.localStorage.setItem('SKM_NETWORK', 'TESTNET');
    vi.spyOn(window, 'fetch').mockImplementation(async (url) => {
      urls.push(String(url));
      const list = String(url).includes('signer=')
        ? [job('fremd-offen'), job('fremd-signiert', { collectedSigners: [{ publicKey: ME }] })]
        : [job('eigen-abgelaufen', { accountId: ME, status: 'expired' })];
      return { ok: true, json: async () => list };
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  const renderList = () => render(
    <I18nextProvider i18n={i18n}>
      <MultisigJobList publicKey={ME} onBack={() => {}} onOpenDetail={() => {}} />
    </I18nextProvider>
  );

  it('zeigt mit "nur noch signieren" die Jobs fremder Konten, auch ohne die zweite Checkbox, und ohne missingSigners vom Backend', async () => {
    renderList();
    const assigned = screen.getByRole('checkbox', { name: /Auch Aufträge, bei denen ich Signer bin/ });
    fireEvent.click(assigned);
    expect(assigned).not.toBeChecked();
    await waitFor(() => expect(screen.getByText(/eigen-abgel/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox', { name: /Nur Aufträge, die ich noch signieren muss/ }));
    await waitFor(() => expect(screen.getByText(/fremd-offen/)).toBeInTheDocument());
    expect(screen.queryByText(/fremd-signiert/)).toBeNull();
    expect(screen.queryByText(/eigen-abgel/)).toBeNull();
    expect(urls.some((u) => u.includes(`signer=${ME}`))).toBe(true);
    expect(assigned).toBeChecked();
    expect(assigned).toBeDisabled();
  });

  it('Netzwerkfehler (Safari: Load failed) zeigt eine verstaendliche Meldung statt des rohen Texts', async () => {
    window.fetch.mockImplementation(async () => { throw new TypeError('Load failed'); });
    renderList();
    const box = await screen.findByTestId('job-list-error');
    expect(box).toHaveTextContent(i18n.t('multisig:list.loadFailedNetwork'));
    expect(box).toHaveTextContent('Load failed');
  });

  it('bietet kein Loeschen aller Testnet-Jobs mehr an', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText(/eigen-abgel/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Testnet-Jobs löschen/ })).toBeNull();
  });

  describe('Ausblenden und Loeschen', () => {
    beforeEach(() => {
      Object.values(hoisted).forEach((fn) => fn.mockReset());
      hoisted.challenge.mockResolvedValue({ challenge: 'AAAA' });
      hoisted.token.mockImplementation(async (id) => `tok-${id}`);
      hoisted.del.mockResolvedValue({ ok: true });
      hoisted.sessionSecret.mockResolvedValue('');
      window.fetch.mockImplementation(async (url) => {
        urls.push(String(url));
        const list = String(url).includes('signer=')
          ? [job('fremd-offen', { declinedSigners: [{ publicKey: OTHER }] }), job('fremd-gesendet', { status: 'submitted_success' })]
          : [job('eigen-abgelaufen', { accountId: ME, status: 'expired' }), job('eigen-abgelehnt', { accountId: ME, status: 'rejected' })];
        return { ok: true, json: async () => list };
      });
    });

    it('blendet nur lokal aus und wieder ein', async () => {
      const view = renderList();
      await waitFor(() => expect(screen.getAllByTestId('job-row')).toHaveLength(4));
      fireEvent.click(screen.getAllByRole('button', { name: 'Ausblenden' })[0]);
      expect(screen.getAllByTestId('job-row')).toHaveLength(3);
      view.unmount();
      renderList();
      await waitFor(() => expect(screen.getAllByTestId('job-row')).toHaveLength(3));
      fireEvent.click(screen.getByRole('checkbox', { name: /Ausgeblendete anzeigen \(1\)/ }));
      expect(screen.getAllByTestId('job-row')).toHaveLength(4);
      fireEvent.click(screen.getByRole('button', { name: 'Einblenden' }));
      expect(screen.queryByRole('checkbox', { name: /Ausgeblendete anzeigen/ })).toBeNull();
      expect(screen.getAllByTestId('job-row')).toHaveLength(4);
    });

    it('waehlt nur abgeschlossene Jobs und loescht sie mit dem eingegebenen Key', async () => {
      renderList();
      await waitFor(() => expect(screen.getAllByTestId('job-row')).toHaveLength(4));
      expect(screen.getByRole('checkbox', { name: 'Job fremd-offen auswählen' })).toBeDisabled();
      expect(screen.getAllByText(/abgelehnt/).length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole('checkbox', { name: 'Alle abgeschlossenen auswählen' }));
      fireEvent.click(screen.getByRole('button', { name: 'Auswahl löschen (3)' }));
      const panel = await screen.findByTestId('job-delete-panel');
      fireEvent.change(screen.getByLabelText('Secret Key zum Löschen'), { target: { value: 'SKAPUTT' } });
      fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));
      expect(await screen.findByText('Ungültiger Secret Key.')).toBeInTheDocument();
      expect(hoisted.del).not.toHaveBeenCalled();
      expect(panel).toBeInTheDocument();
    });

    it('loescht mit gemerktem Key ohne Abfrage und meldet Fehler je Job', async () => {
      hoisted.sessionSecret.mockResolvedValue(ME_SECRET);
      hoisted.token.mockImplementation(async (id) => {
        if (id === 'fremd-gesendet') throw Object.assign(new Error('forbidden'), { status: 403 });
        return `tok-${id}`;
      });
      renderList();
      await waitFor(() => expect(screen.getAllByTestId('job-row')).toHaveLength(4));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Alle abgeschlossenen auswählen' }));
      fireEvent.click(screen.getByRole('button', { name: 'Auswahl löschen (3)' }));
      await screen.findByTestId('job-delete-panel');
      expect(screen.queryByLabelText('Secret Key zum Löschen')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));
      const result = await screen.findByTestId('job-delete-result');
      expect(result).toHaveTextContent('2 Jobs gelöscht.');
      expect(result).toHaveTextContent('kein Signer');
      expect(hoisted.del.mock.calls.map((c) => c[0]).sort()).toEqual(['eigen-abgelaufen', 'eigen-abgelehnt']);
      expect(hoisted.del).toHaveBeenCalledWith('eigen-abgelaufen', 'tok-eigen-abgelaufen');
      expect(hoisted.token).toHaveBeenCalledWith('eigen-abgelaufen', ME, 'signature:token');
    });
    it('bricht bei 429 ab, meldet die nicht versuchten Jobs und loest bei Doppelklick nur einen Lauf aus', async () => {
      hoisted.sessionSecret.mockResolvedValue(ME_SECRET);
      hoisted.del.mockImplementationOnce(async () => ({ ok: true }));
      hoisted.del.mockImplementationOnce(async () => { throw Object.assign(new Error('too_many'), { status: 429 }); });
      renderList();
      await waitFor(() => expect(screen.getAllByTestId('job-row')).toHaveLength(4));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Alle abgeschlossenen auswählen' }));
      fireEvent.click(screen.getByRole('button', { name: 'Auswahl löschen (3)' }));
      await screen.findByTestId('job-delete-panel');
      const button = screen.getByRole('button', { name: 'Löschen' });
      fireEvent.click(button);
      fireEvent.click(button);
      const result = await screen.findByTestId('job-delete-result');
      expect(result).toHaveTextContent('1 Jobs gelöscht.');
      expect(result).toHaveTextContent('zu viele Anfragen gemeldet. 2 Jobs');
      expect(hoisted.del).toHaveBeenCalledTimes(2);
    });
  });
});
