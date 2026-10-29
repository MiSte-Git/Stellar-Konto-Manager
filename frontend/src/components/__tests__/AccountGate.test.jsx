import React from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';

import i18n from '../../i18n.js';
import AccountGate from '../AccountGate.jsx';

const ADDR = 'GAQ6JRJ4IUIXUVZRMGYUGUXFUHYYBRQTWFON4IZEHRS2RY4FCPTEEMWE';

function renderGate(props) {
  return render(
    <I18nextProvider i18n={i18n}>
      <AccountGate {...props} />
    </I18nextProvider>
  );
}

describe('AccountGate', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de');
    await i18n.loadNamespaces(['common', 'wallet']);
  });

  it('zeigt bei nicht existierendem Konto Titel, Netz-Hinweis und Adresse', () => {
    renderGate({ title: 'Multisig verwalten', publicKey: ADDR, notFound: true, netName: 'Testnet' });
    expect(screen.getByRole('heading', { name: 'Multisig verwalten' })).toBeTruthy();
    expect(screen.getByText(/Testnet/)).toBeTruthy();
    expect(screen.getByText(ADDR)).toBeTruthy();
  });

  it('zeigt ohne Konto den Eingabe-Hinweis statt der Nicht-gefunden-Meldung', () => {
    renderGate({ title: 'Saldo', notFound: false });
    expect(screen.getByText(/Kein Konto geladen/)).toBeTruthy();
    expect(screen.queryByText(/nicht aktiviert/)).toBeNull();
  });
});
