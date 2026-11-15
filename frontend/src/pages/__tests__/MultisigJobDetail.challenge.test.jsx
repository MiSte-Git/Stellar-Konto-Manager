// F-6 (Review Fable): Schickt der Server eine Nonce, die nicht genau 32 Byte strikte base64 ist, signiert das
// Job-Detail nichts und fragt kein Token an; die Ansicht nennt den Grund. Echte signMultisigJobChallenge,
// ersetzt sind der Server und die rohe Signatur.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { Buffer } from 'buffer';
import { Keypair } from '@stellar/stellar-sdk';
import i18n from '../../i18n.js';
import MultisigJobDetail from '../MultisigJobDetail.jsx';

const kp = Keypair.random();
const hoisted = vi.hoisted(() => ({ getJob: vi.fn(), challenge: vi.fn(), accessToken: vi.fn(), sessionSecret: vi.fn() }));

vi.mock('../../utils/multisigApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getPendingMultisigJob: hoisted.getJob,
  getMultisigJobChallenge: hoisted.challenge,
  getMultisigJobAccessToken: hoisted.accessToken,
}));
// Nur die rohe Ed25519-Signatur ersetzt: unter jsdom scheitert sie an der Uint8Array-Realm-Grenze (der
// Unit-Test signMultisigJobChallenge.test.js laeuft deshalb in node). Die Pruefung der Nonce bleibt echt.
vi.mock('../../utils/signers/keyMaterial.js', async (importOriginal) => ({
  ...(await importOriginal()),
  signChallengeMessage: () => new Uint8Array(64),
}));
vi.mock('../../utils/sessionSecrets.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getSessionSecret: hoisted.sessionSecret,
}));

const renderDetail = () => render(
  <I18nextProvider i18n={i18n}>
    <MultisigJobDetail onBack={() => {}} jobId="c-1" currentPublicKey={kp.publicKey()} />
  </I18nextProvider>
);

describe('MultisigJobDetail: ungueltige Challenge (F-6)', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/multisig/jobs/c-1');
    hoisted.getJob.mockResolvedValue({ id: 'c-1', status: 'pending_signatures' });
    hoisted.sessionSecret.mockResolvedValue(kp.secret());
    hoisted.accessToken.mockResolvedValue('tok');
  });

  it('22-Byte-Nonce: nichts signiert, kein Token angefragt, Hinweis auf die ungueltige Anmeldung', async () => {
    hoisted.challenge.mockResolvedValue({ challenge: Buffer.alloc(22, 7).toString('base64') });
    renderDetail();
    expect(await screen.findByText(i18n.t('multisig:detail.access.invalidChallenge'))).toBeInTheDocument();
    expect(hoisted.accessToken).not.toHaveBeenCalled();
  });

  it('Gegenprobe: 32-Byte-Nonce wird signiert und gegen das Token getauscht', async () => {
    hoisted.challenge.mockResolvedValue({ challenge: Buffer.alloc(32, 7).toString('base64') });
    renderDetail();
    await waitFor(() => expect(hoisted.accessToken).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(i18n.t('multisig:detail.access.invalidChallenge'))).toBeNull();
  });
});
