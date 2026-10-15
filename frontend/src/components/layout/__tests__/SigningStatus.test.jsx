import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../i18n.js';
import SigningStatus from '../SigningStatus.jsx';
import { publishActiveAccount } from '../../../utils/appNavigation.js';
import { hasSessionSecrets, setSessionSecrets } from '../../../utils/sessionSecrets.js';

const ACCOUNT = 'GAQ6JRJ4IUIXUVZRMGYUGUXFUHYYBRQTWFON4IZEHRS2RY4FCPTEEMWE';
const OTHER = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
const SECRET = 'SDAIDSY2LAXR5HPEJ2CKWQ3QV67VPYLXB6C2ATBY3J7VRKT6YD7SYV6Y';

function renderIt(props) {
  return render(
    <I18nextProvider i18n={i18n}>
      <SigningStatus {...props} />
    </I18nextProvider>
  );
}

describe('SigningStatus', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de');
  });

  beforeEach(() => {
    sessionStorage.clear();
    act(() => publishActiveAccount(''));
  });

  it('rendert nichts ohne geladenes Konto', () => {
    renderIt();
    expect(screen.queryByTestId('signing-status')).toBeNull();
  });

  it('zeigt Nur ansehen ohne Secret und keinen Sperren-Button', () => {
    renderIt();
    act(() => publishActiveAccount(ACCOUNT));
    expect(screen.getByTestId('signing-status-chip')).toHaveAttribute('data-state', 'viewOnly');
    expect(screen.getByText('Nur ansehen')).toBeInTheDocument();
    expect(screen.queryByTestId('signing-status-lock')).toBeNull();
  });

  it('wechselt auf Signieren moeglich nach dem Change-Event und sperrt alle Konten', async () => {
    renderIt();
    act(() => publishActiveAccount(ACCOUNT));
    // setSessionSecrets feuert das Change-Event selbst, kein manueller Dispatch noetig
    await act(async () => {
      await setSessionSecrets(ACCOUNT, { [ACCOUNT]: SECRET, [OTHER]: SECRET });
      await setSessionSecrets(OTHER, { [OTHER]: SECRET });
    });
    const chip = screen.getByTestId('signing-status-chip');
    expect(chip).toHaveAttribute('data-state', 'canSign');
    expect(chip).toHaveTextContent('Signieren möglich');
    expect(chip).toHaveTextContent('2');
    expect(chip.getAttribute('title')).not.toContain(SECRET);

    fireEvent.click(screen.getByTestId('signing-status-lock'));
    expect(hasSessionSecrets(ACCOUNT)).toBe(false);
    expect(hasSessionSecrets(OTHER)).toBe(false);
    expect(screen.getByTestId('signing-status-chip')).toHaveAttribute('data-state', 'viewOnly');
    expect(screen.getByText('Gesperrt')).toBeInTheDocument();
    expect(screen.queryByTestId('signing-status-lock')).toBeNull();
  });

  it('bietet Sperren an, wenn nur ein anderes Konto Secrets hat', async () => {
    renderIt();
    await act(async () => { await setSessionSecrets(OTHER, { [OTHER]: SECRET }); });
    act(() => publishActiveAccount(ACCOUNT));
    expect(screen.getByTestId('signing-status-chip')).toHaveAttribute('data-state', 'viewOnly');
    expect(screen.getByTestId('signing-status-lock')).toBeInTheDocument();
  });
});
