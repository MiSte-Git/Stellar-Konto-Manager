import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../../i18n.js';
import AssetPickerField from '../AssetPickerField.jsx';

const ISSUER_A = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const ISSUER_B = 'GATHPDLDMA5UAHHUUBFAQNW7B3573IUMEGPZGXMT25CNUPY4BOYFAV7F';
const ISSUER_C = 'GD5KJP276E7CZT43PAI5KAEXCUDZMFFMV4X5AGFKBR7Q7IAZZ5BXZVKM';
const short = (key) => `${key.slice(0, 8)}...${key.slice(-8)}`;

const sameCodeResults = [
  { assetCode: 'TESTLP', assetIssuer: ISSUER_A, numAccounts: '3' },
  { assetCode: 'TESTLP', assetIssuer: ISSUER_B, numAccounts: '1', homeDomain: 'example.org' },
  { assetCode: 'TESTLP', assetIssuer: ISSUER_C, numAccounts: '' },
];

function renderPicker(props = {}) {
  const onSelect = vi.fn();
  const view = render(
    <I18nextProvider i18n={i18n}>
      <AssetPickerField
        label="Token suchen"
        placeholder=""
        searchLabel="Suchen"
        selectedLabel="Gewähltes Token"
        query=""
        onQueryChange={() => {}}
        onSearch={() => {}}
        loading={false}
        error=""
        selected={null}
        onSelect={onSelect}
        results={sameCodeResults}
        formatTrustlineCount={(item) => String(Number(item.numAccounts))}
        {...props}
      />
    </I18nextProvider>
  );
  return { ...view, onSelect };
}

describe('AssetPickerField Trefferliste', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });

  it('zeigt Ueberschrift mit Anzahl und Code, den festen Issuer-Hinweis und den Auswahl-Hinweis', () => {
    renderPicker();
    const box = screen.getByTestId('asset-picker-results');
    expect(box).toHaveTextContent('3 Tokens mit dem Code TESTLP gefunden');
    expect(box).toHaveTextContent('Gleicher Code heißt nicht gleiches Token. Ein Token ist nur durch Code und Issuer eindeutig. Prüfe den Issuer, bevor du wählst.');
    expect(box).toHaveTextContent('Treffer anklicken, um ein Token zu wählen.');
  });

  it('nennt ohne gemeinsamen Code nur die Anzahl, auch im Singular', () => {
    const { rerender } = renderPicker({ results: [sameCodeResults[0], { assetCode: 'OTHER', assetIssuer: ISSUER_B, numAccounts: '2' }] });
    expect(screen.getByTestId('asset-picker-results')).toHaveTextContent('2 Tokens gefunden');
    rerender(
      <I18nextProvider i18n={i18n}>
        <AssetPickerField label="" placeholder="" searchLabel="" selectedLabel="" query="" onQueryChange={() => {}} onSearch={() => {}}
          loading={false} error="" selected={null} onSelect={() => {}} results={[sameCodeResults[1]]} formatTrustlineCount={() => '1'} />
      </I18nextProvider>
    );
    expect(screen.getByTestId('asset-picker-results')).toHaveTextContent('1 Token mit dem Code TESTLP gefunden');
  });

  it('beschriftet je Treffer Issuer (gekuerzt, voll im title), Home-Domain nur falls vorhanden und Trustlines mit Pluralform', () => {
    renderPicker();
    const [first, second, third] = screen.getAllByRole('option');
    expect(first).toHaveTextContent(`Issuer: ${short(ISSUER_A)}`);
    expect(within(first).getByText(short(ISSUER_A))).toHaveAttribute('title', ISSUER_A);
    expect(first).toHaveTextContent('3 Trustlines');
    expect(first).not.toHaveTextContent('Home-Domain');
    expect(within(first).getByText('3 Trustlines')).toHaveAttribute('title', 'Anzahl Konten mit Trustline für dieses Asset');
    expect(second).toHaveTextContent('1 Trustline');
    expect(second).not.toHaveTextContent('1 Trustlines');
    expect(second).toHaveTextContent('Home-Domain: example.org');
    expect(third).toHaveTextContent('Trustlines: —');
  });

  it('behaelt die gelieferte Reihenfolge bei (keine Sortierung nach Trustlines)', () => {
    renderPicker();
    const issuers = screen.getAllByRole('option').map((el) => within(el).getByTitle(/^G/).getAttribute('title'));
    expect(issuers).toEqual([ISSUER_A, ISSUER_B, ISSUER_C]);
  });

  it('waehlt per Klick und per Tastatur', () => {
    const { onSelect } = renderPicker();
    const options = screen.getAllByRole('option');
    fireEvent.click(options[1]);
    expect(onSelect).toHaveBeenLastCalledWith(sameCodeResults[1]);
    fireEvent.keyDown(options[2], { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith(sameCodeResults[2]);
  });

  it('markiert den gewaehlten Treffer mit Haken und aria-selected, Auswahl-Hinweis entfaellt, Box zeigt die Home-Domain', () => {
    renderPicker({ selected: sameCodeResults[1] });
    const options = screen.getAllByRole('option');
    expect(options.map((el) => el.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(options[1]).toHaveTextContent('✓');
    expect(options[0]).not.toHaveTextContent('✓');
    expect(screen.queryByText('Treffer anklicken, um ein Token zu wählen.')).toBeNull();
    expect(screen.getByTestId('asset-picker-selected')).toHaveTextContent('Home-Domain: example.org');
  });

  it('kopiert den Issuer, ohne den Treffer zu waehlen', async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    const { onSelect } = renderPicker();
    const [first] = screen.getAllByRole('option');
    fireEvent.click(within(first).getByRole('button', { name: 'Issuer kopieren' }));
    expect(writeText).toHaveBeenCalledWith(ISSUER_A);
    expect(onSelect).not.toHaveBeenCalled();
    expect(await within(first).findByRole('button', { name: 'Kopiert' })).toBeInTheDocument();
  });

  it('zeigt ohne Treffer keine Liste und keine Hinweise', () => {
    renderPicker({ results: [] });
    expect(screen.queryByTestId('asset-picker-results')).toBeNull();
    expect(screen.queryByText(/Treffer anklicken/)).toBeNull();
  });
});
