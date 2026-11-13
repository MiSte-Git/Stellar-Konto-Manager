import React from 'react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import SettingsPanel from '../SettingsPanel.jsx';

// Review B-2 (ADR 0012, K6): Im Editor der Konten-Liste wird eine C-Adresse als Contract
// gekennzeichnet; G-Adressen bleiben ohne Etikett. Gespeichert wird wie bisher.
const ADDR_G = 'GAQ6JRJ4IUIXUVZRMGYUGUXFUHYYBRQTWFON4IZEHRS2RY4FCPTEEMWE';
const ADDR_C = 'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR';

describe('SettingsPanel Konten-Liste: Kontotyp', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('de');
  });
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('stm_trusted_wallets', JSON.stringify({ wallets: [
      { address: ADDR_G, label: 'Haupt' },
      { address: ADDR_C, label: 'Vertrag' },
    ] }));
  });

  it('kennzeichnet nur die Zeile mit der C-Adresse', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <SettingsPanel showDisplay={false} showNetwork={false} />
      </I18nextProvider>
    );
    const rowC = screen.getByDisplayValue(ADDR_C).closest('tr');
    const rowG = screen.getByDisplayValue(ADDR_G).closest('tr');
    expect(rowC.querySelector('[data-testid="address-kind-contract"]')).not.toBeNull();
    expect(rowG.querySelector('[data-testid="address-kind-contract"]')).toBeNull();
  });
});
