import React, { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';

vi.mock('../../utils/stellar/accountUtils.js', () => ({
  isTestnetAccount: vi.fn(async () => false),
}));

import i18n from '../../i18n.js';
import AddressDropdown from '../AddressDropdown.jsx';
import MultisigConfigForm from '../multisig/MultisigConfigForm.jsx';

const LS_KEY = 'stm_trusted_wallets';
const ADDR_MAIN = 'GAQ6JRJ4IUIXUVZRMGYUGUXFUHYYBRQTWFON4IZEHRS2RY4FCPTEEMWE';
const ADDR_OLD = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
const ADDR_TEST = 'GBZVTOY3PQOEQHYOUMBBCTLHQ3SO2RHJ2LDKXZC4EVNCNBY3L6YSWAW6';

function seedWallets(wallets) {
  localStorage.setItem(LS_KEY, JSON.stringify({ wallets }));
}

function Field({ onSelect, onChange }) {
  const [value, setValue] = useState('');
  return (
    <AddressDropdown
      value={value}
      onChange={(v) => { setValue(v); onChange?.(v); }}
      onSelect={onSelect ? (v) => { setValue(v); onSelect(v); } : undefined}
      options={[]}
      accountPicker
      inputProps={{ 'data-testid': 'addr-input' }}
    />
  );
}

function renderWithI18n(ui) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

const openPicker = () => fireEvent.click(screen.getByRole('button', { name: 'Aus Konten-Liste wählen' }));

describe('AccountListPicker in AddressDropdown', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de');
  });
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('has no picker button unless accountPicker is set', () => {
    renderWithI18n(<AddressDropdown value="" onChange={() => {}} options={[]} />);
    expect(screen.queryByRole('button', { name: 'Aus Konten-Liste wählen' })).toBeNull();
  });

  it('lists the Konten-Liste and passes the chosen address to onSelect', () => {
    seedWallets([
      { address: ADDR_MAIN, label: 'Hauptkonto', isTestnet: false },
      { address: ADDR_TEST, label: 'Spielwiese', isTestnet: true },
    ]);
    const onSelect = vi.fn();
    renderWithI18n(<Field onSelect={onSelect} />);

    openPicker();
    const picker = screen.getByTestId('account-list-picker');
    expect(within(picker).getByText('Hauptkonto')).toBeTruthy();
    expect(within(picker).getByText('Spielwiese')).toBeTruthy();
    expect(within(picker).getByText('(Testnet)')).toBeTruthy();

    fireEvent.click(within(picker).getByText('Hauptkonto'));
    expect(onSelect).toHaveBeenCalledWith(ADDR_MAIN);
    expect(screen.getByTestId('addr-input').value).toBe(ADDR_MAIN);
    expect(screen.queryByTestId('account-list-picker')).toBeNull();
  });

  it('falls back to onChange when the field has no onSelect', () => {
    seedWallets([{ address: ADDR_MAIN, label: 'Hauptkonto', isTestnet: false }]);
    const onChange = vi.fn();
    renderWithI18n(<Field onChange={onChange} />);
    openPicker();
    fireEvent.click(screen.getByText('Hauptkonto'));
    expect(onChange).toHaveBeenCalledWith(ADDR_MAIN);
  });

  it('filters by label or address', () => {
    seedWallets([
      { address: ADDR_MAIN, label: 'Hauptkonto', isTestnet: false },
      { address: ADDR_OLD, label: 'Altes Konto', isTestnet: false },
    ]);
    renderWithI18n(<Field onSelect={() => {}} />);
    openPicker();
    const filter = screen.getByPlaceholderText('Nach Label oder Adresse filtern');

    fireEvent.change(filter, { target: { value: 'alt' } });
    expect(screen.queryByText('Hauptkonto')).toBeNull();
    expect(screen.getByText('Altes Konto')).toBeTruthy();

    fireEvent.change(filter, { target: { value: 'GAQ6' } });
    expect(screen.getByText('Hauptkonto')).toBeTruthy();

    fireEvent.change(filter, { target: { value: 'nichts' } });
    expect(screen.getByText('Kein Konto passt zum Filter.')).toBeTruthy();
  });

  it('marks compromised and deactivated accounts but keeps them selectable', () => {
    seedWallets([
      { address: ADDR_MAIN, label: 'Gehackt', compromised: true, isTestnet: false },
      { address: ADDR_OLD, label: 'Stillgelegt', deactivated: true, isTestnet: false },
    ]);
    const onSelect = vi.fn();
    renderWithI18n(<Field onSelect={onSelect} />);
    openPicker();
    expect(screen.getByText('kompromittiert')).toBeTruthy();
    expect(screen.getByText('deaktiviert')).toBeTruthy();
    fireEvent.click(screen.getByText('Gehackt'));
    expect(onSelect).toHaveBeenCalledWith(ADDR_MAIN);
  });

  it('shows a hint when the Konten-Liste is empty', () => {
    renderWithI18n(<Field onSelect={() => {}} />);
    openPicker();
    expect(screen.getByText(/Noch keine Konten gespeichert/)).toBeTruthy();
  });

  it('closes on Escape', () => {
    seedWallets([{ address: ADDR_MAIN, label: 'Hauptkonto', isTestnet: false }]);
    renderWithI18n(<Field onSelect={() => {}} />);
    openPicker();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('account-list-picker')).toBeNull();
  });
});

describe('MultisigConfigForm signer warnings', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de');
  });
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('warns for compromised and deactivated signers from the Konten-Liste', () => {
    seedWallets([
      { address: ADDR_MAIN, label: 'Gehackt', compromised: true, isTestnet: false },
      { address: ADDR_OLD, label: 'Stillgelegt', deactivated: true, isTestnet: false },
      { address: ADDR_TEST, label: 'Ok', isTestnet: false },
    ]);
    renderWithI18n(
      <MultisigConfigForm
        signers={[{ key: ADDR_MAIN, weight: 1 }, { key: ADDR_OLD, weight: 1 }, { key: ADDR_TEST, weight: 1 }]}
      />
    );
    expect(screen.getAllByText(/als kompromittiert markiert/)).toHaveLength(1);
    expect(screen.getAllByText(/als deaktiviert markiert/)).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Aus Konten-Liste wählen' })).toHaveLength(3);
  });
});
