// T7: Hinweis mit Knopf, wenn ein Testnet-Konto aus dem Verlauf auf Mainnet geladen wird.
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import TestnetOnlyHint from '../TestnetOnlyHint.jsx';

beforeAll(async () => { await i18n.changeLanguage('de'); });

describe('TestnetOnlyHint', () => {
  it('zeigt den Hinweis und wechselt erst per Klick', () => {
    const onSwitch = vi.fn();
    render(<I18nextProvider i18n={i18n}><TestnetOnlyHint onSwitch={onSwitch} /></I18nextProvider>);
    expect(screen.getByTestId('testnet-only-hint').textContent).toContain('gibt es dieses Konto nur im Testnet');
    expect(onSwitch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Zu Testnet wechseln' }));
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });
});

// Verdrahtung im Kopf (main.jsx ist fuer einen Seitentest zu schwer): nur auf Mainnet, nur bei
// nicht gefundenem Konto mit Testnet-Etikett im Verlauf, Wechsel wie die Testnet-Checkbox.
describe('main.jsx: Verdrahtung des Hinweises', () => {
  it('Bedingung und Wechsel stehen so im Kopf', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(`${globalThis.process.cwd()}/src/main.jsx`, 'utf8');
    expect(src).toContain("notFound && !notFoundOnlyInGate && !devTestnet && isTestnetOnlyRecent(recentWallets, sourcePublicKey)");
    expect(src).toContain("<TestnetOnlyHint onSwitch={() => { setDevTestnet(true); setGlobalNetwork('TESTNET'); }} />");
  });
});
