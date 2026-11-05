import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import MultisigJobDetail from '../MultisigJobDetail.jsx';
import { openMultisigJob } from '../../components/multisig/multisigNavigation.js';

const SIGNER = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';
const SECRET = 'SDAIDSY2LAXR5HPEJ2CKWQ3QV67VPYLXB6C2ATBY3J7VRKT6YD7SYV6Y';

const hoisted = vi.hoisted(() => ({
  getJob: vi.fn(),
  challenge: vi.fn(),
  accessToken: vi.fn(),
  sessionSecret: vi.fn(),
  remember: vi.fn(),
}));

vi.mock('../../utils/multisigApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getPendingMultisigJob: hoisted.getJob,
  getMultisigJobChallenge: hoisted.challenge,
  signMultisigJobChallenge: (_secret, _challenge, purpose) => `signature:${purpose}`,
  getMultisigJobAccessToken: hoisted.accessToken,
}));

vi.mock('../../utils/sessionSecrets.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getSessionSecret: hoisted.sessionSecret,
  rememberSessionSecrets: hoisted.remember,
}));

function renderDetail(props) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MultisigJobDetail onBack={() => {}} {...props} />
    </I18nextProvider>
  );
}

describe('MultisigJobDetail: Zugriffstoken', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });
  beforeEach(() => {
    vi.clearAllMocks();
    // Der Job selbst ist hier egal: geprueft wird nur, mit welchem Token er geladen wird.
    hoisted.getJob.mockRejectedValue(new Error('stop'));
    hoisted.sessionSecret.mockResolvedValue('');
    hoisted.challenge.mockResolvedValue({ challenge: 'AAAA' });
    hoisted.accessToken.mockResolvedValue('tok-challenge');
  });
  afterEach(() => { window.history.replaceState({}, '', '/'); });

  it('liest ?token= ein, entfernt es aus der Adresszeile und laedt den Job damit', async () => {
    window.history.replaceState({}, '', '/multisig/jobs/d-1?token=tok-link&ref=mail');
    renderDetail({ jobId: 'd-1', currentPublicKey: SIGNER });
    await waitFor(() => expect(hoisted.getJob).toHaveBeenCalledWith('d-1', 'tok-link'));
    expect(window.location.search).toBe('?ref=mail');
    expect(hoisted.challenge).not.toHaveBeenCalled();
  });

  it('entfernt ?token= auch, wenn das Token schon als Prop kommt', async () => {
    window.history.replaceState({}, '', '/multisig/jobs/d-2?token=tok-prop');
    renderDetail({ jobId: 'd-2', accessToken: 'tok-prop', currentPublicKey: SIGNER });
    await waitFor(() => expect(hoisted.getJob).toHaveBeenCalledWith('d-2', 'tok-prop'));
    expect(window.location.search).toBe('');
  });

  it('nutzt das Token aus Zum Job ohne Prop und ohne URL-Parameter', async () => {
    openMultisigJob('d-3', 'tok-mem');
    renderDetail({ jobId: 'd-3', currentPublicKey: SIGNER });
    await waitFor(() => expect(hoisted.getJob).toHaveBeenCalledWith('d-3', 'tok-mem'));
    expect(window.location.href).not.toContain('tok-mem');
  });

  describe('Neuladen (Token weg, keine URL, keine Prop)', () => {
    beforeEach(() => { window.history.replaceState({}, '', '/multisig/jobs/d-reload'); });

    it('holt das Token per Challenge, wenn ein Secret fuer den Signer da ist', async () => {
      hoisted.sessionSecret.mockResolvedValue(SECRET);
      renderDetail({ jobId: 'd-reload', currentPublicKey: SIGNER });
      await waitFor(() => expect(hoisted.getJob).toHaveBeenCalledWith('d-reload', 'tok-challenge'));
      expect(hoisted.challenge).toHaveBeenCalledWith('d-reload', SIGNER);
      expect(hoisted.accessToken).toHaveBeenCalledWith('d-reload', SIGNER, 'signature:token');
    });

    const OTHER_SECRET = 'SBFKGXZFIZJ5U2RZTPBZ3EUCKQQGT5APKWAHGTQCJQSLD4CXIIHOVYVO';
    const unlockInput = () => screen.getByLabelText('Secret Key');
    const openButton = () => screen.getByRole('button', { name: 'Job öffnen und prüfen' });

    it('fragt ohne gemerktes Secret den Secret Key ab, statt nur einen Fehler zu zeigen', async () => {
      renderDetail({ jobId: 'd-reload', currentPublicKey: SIGNER });
      expect(await screen.findByTestId('job-unlock')).toHaveTextContent(SIGNER);
      expect(hoisted.getJob).not.toHaveBeenCalled();
      expect(hoisted.challenge).not.toHaveBeenCalled();
      expect(openButton()).toBeDisabled();
    });

    it('veralteter Job laut Liste: Erklaerung statt Secret-Key-Abfrage, Abfrage nur auf Wunsch', async () => {
      renderDetail({ jobId: 'd-reload', currentPublicKey: SIGNER, listStatus: 'obsolete_seq' });
      expect(await screen.findByTestId('job-dead')).toHaveTextContent('Sequence-Nummer');
      expect(screen.queryByTestId('job-unlock')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: i18n.t('multisig:detail.dead.showAnyway') }));
      expect(screen.getByTestId('job-unlock')).toBeInTheDocument();
    });

    it('oeffnet den Job mit dem eingegebenen Key ueber die Challenge, ohne ihn zu merken', async () => {
      renderDetail({ jobId: 'd-reload', currentPublicKey: SIGNER });
      await screen.findByTestId('job-unlock');
      fireEvent.change(unlockInput(), { target: { value: SECRET } });
      fireEvent.click(openButton());
      await waitFor(() => expect(hoisted.getJob).toHaveBeenCalledWith('d-reload', 'tok-challenge'));
      expect(hoisted.challenge).toHaveBeenCalledWith('d-reload', SIGNER);
      expect(hoisted.accessToken).toHaveBeenCalledWith('d-reload', SIGNER, 'signature:token');
      expect(hoisted.remember).not.toHaveBeenCalled();
      expect(screen.queryByTestId('job-unlock')).toBeNull();
    });

    it('merkt den Key nur, wenn ausdruecklich gewaehlt', async () => {
      renderDetail({ jobId: 'd-reload', currentPublicKey: SIGNER });
      await screen.findByTestId('job-unlock');
      fireEvent.change(unlockInput(), { target: { value: SECRET } });
      fireEvent.click(screen.getByRole('checkbox', { name: /In dieser Session merken/ }));
      fireEvent.click(openButton());
      await waitFor(() => expect(hoisted.remember).toHaveBeenCalledTimes(1));
      expect(hoisted.remember.mock.calls[0][0]).toBe(SIGNER);
      expect(hoisted.remember.mock.calls[0][1][0].keypair.publicKey()).toBe(SIGNER);
    });

    it('lehnt einen Key eines anderen Kontos und ungueltige Eingaben ab, ohne Challenge', async () => {
      renderDetail({ jobId: 'd-reload', currentPublicKey: SIGNER });
      await screen.findByTestId('job-unlock');
      fireEvent.change(unlockInput(), { target: { value: OTHER_SECRET } });
      fireEvent.click(openButton());
      expect(await screen.findByText(/gehört nicht zum geladenen Konto/)).toBeInTheDocument();
      fireEvent.change(unlockInput(), { target: { value: 'SKAPUTT' } });
      fireEvent.click(openButton());
      expect(await screen.findByText('Ungültiger Secret Key.')).toBeInTheDocument();
      expect(hoisted.challenge).not.toHaveBeenCalled();
    });

    it('holt bei doppeltem Laden nur eine Challenge (kein challenge_missing_or_expired)', async () => {
      hoisted.sessionSecret.mockResolvedValue(SECRET);
      let release;
      hoisted.challenge.mockImplementation(() => new Promise((resolve) => { release = () => resolve({ challenge: 'AAAA' }); }));
      render(
        <React.StrictMode>
          <I18nextProvider i18n={i18n}>
            <MultisigJobDetail jobId="d-reload" currentPublicKey={SIGNER} onBack={() => {}} />
          </I18nextProvider>
        </React.StrictMode>
      );
      await waitFor(() => expect(hoisted.challenge).toHaveBeenCalled());
      await act(async () => { release(); });
      await waitFor(() => expect(hoisted.getJob).toHaveBeenCalledWith('d-reload', 'tok-challenge'));
      expect(hoisted.challenge).toHaveBeenCalledTimes(1);
    });

    it('zeigt verstaendliche Texte statt Fehlercodes', async () => {
      hoisted.challenge.mockResolvedValue({ challenge: 'AAAA' });
      hoisted.accessToken.mockRejectedValue(Object.assign(new Error('challenge_missing_or_expired'), { status: 400 }));
      renderDetail({ jobId: 'd-reload', currentPublicKey: SIGNER });
      await screen.findByTestId('job-unlock');
      fireEvent.change(unlockInput(), { target: { value: SECRET } });
      fireEvent.click(openButton());
      expect(await screen.findByText(/Die Anmeldung am Job ist abgelaufen/)).toBeInTheDocument();
    });

    it('meldet 429 von /challenge beim Unlock mit Wartezeit', async () => {
      hoisted.challenge.mockRejectedValue(Object.assign(new Error('too_many_requests'), { status: 429, retryAfter: 42 }));
      renderDetail({ jobId: 'd-reload', currentPublicKey: SIGNER });
      await screen.findByTestId('job-unlock');
      fireEvent.change(unlockInput(), { target: { value: SECRET } });
      fireEvent.click(openButton());
      expect(await screen.findByText('Der Server meldet zu viele Anfragen. Bitte in 42 Sekunden erneut versuchen.')).toBeInTheDocument();
      expect(hoisted.accessToken).not.toHaveBeenCalled();
    });

    it('meldet 429 von /challenge beim Oeffnen mit gemerktem Secret', async () => {
      hoisted.sessionSecret.mockResolvedValue(SECRET);
      hoisted.challenge.mockRejectedValue(Object.assign(new Error('too_many_requests'), { status: 429 }));
      renderDetail({ jobId: 'd-reload', currentPublicKey: SIGNER });
      expect(await screen.findByText('Der Server meldet zu viele Anfragen. Bitte etwas warten und erneut versuchen.')).toBeInTheDocument();
      expect(hoisted.getJob).not.toHaveBeenCalled();
    });

    it('verlangt nach abgelehntem Token erneut den Key, statt am alten Token festzuhaengen', async () => {
      hoisted.getJob.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { status: 403 }));
      renderDetail({ jobId: 'd-reload', currentPublicKey: SIGNER });
      await screen.findByTestId('job-unlock');
      fireEvent.change(unlockInput(), { target: { value: SECRET } });
      fireEvent.click(openButton());
      expect(await screen.findByText(/Bitte den Secret Key erneut eingeben/)).toBeInTheDocument();
      expect(screen.getByTestId('job-unlock')).toBeInTheDocument();
    });

    it('nennt im Dialog, wenn das Konto kein Signer des Jobs ist', async () => {
      hoisted.challenge.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
      renderDetail({ jobId: 'd-reload', currentPublicKey: SIGNER });
      await screen.findByTestId('job-unlock');
      fireEvent.change(unlockInput(), { target: { value: SECRET } });
      fireEvent.click(openButton());
      expect(await screen.findByText('Dieses Konto ist kein aktiver Signer dieses Auftrags.')).toBeInTheDocument();
      expect(hoisted.getJob).not.toHaveBeenCalled();
    });

    it('verlangt ohne Konto zuerst das Laden des Signer-Kontos', async () => {
      renderDetail({ jobId: 'd-reload', currentPublicKey: '' });
      expect(await screen.findByText(/Bitte zuerst das Konto laden/)).toBeInTheDocument();
      expect(hoisted.getJob).not.toHaveBeenCalled();
    });

    it('nennt einen abgelehnten Signer im Klartext', async () => {
      hoisted.sessionSecret.mockResolvedValue(SECRET);
      hoisted.challenge.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
      renderDetail({ jobId: 'd-reload', currentPublicKey: SIGNER });
      expect(await screen.findByText('Dieses Konto ist kein aktiver Signer dieses Auftrags.')).toBeInTheDocument();
    });
  });
});
