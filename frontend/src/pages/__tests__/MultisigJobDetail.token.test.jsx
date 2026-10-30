import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
}));

vi.mock('../../utils/multisigApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getPendingMultisigJob: hoisted.getJob,
  getMultisigJobChallenge: hoisted.challenge,
  signMultisigJobChallenge: () => 'signature',
  getMultisigJobAccessToken: hoisted.accessToken,
}));

vi.mock('../../utils/sessionSecrets.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getSessionSecret: hoisted.sessionSecret,
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
      expect(hoisted.accessToken).toHaveBeenCalledWith('d-reload', SIGNER, 'signature');
    });

    it('erklaert ohne Secret, warum das Token fehlt und was zu tun ist', async () => {
      renderDetail({ jobId: 'd-reload', currentPublicKey: SIGNER });
      expect(await screen.findByText(/bleibt nur bis zum Neuladen der Seite erhalten.*"Secret merken"/)).toBeInTheDocument();
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
