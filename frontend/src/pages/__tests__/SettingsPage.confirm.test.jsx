import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import { autoAnswerConfirmDialog } from '../../test/confirmDialogHelper.js';

const clearAllTextInputHistories = vi.fn();
vi.mock('../../utils/inputHistory.js', async (orig) => ({ ...(await orig()), clearAllTextInputHistories: (...a) => clearAllTextInputHistories(...a) }));

import SettingsPage from '../SettingsPage.jsx';

function renderPage() {
  return render(<I18nextProvider i18n={i18n}><MemoryRouter><SettingsPage publicKey="" onBack={() => {}} /></MemoryRouter></I18nextProvider>);
}

describe('SettingsPage: eigener Bestaetigungsdialog statt window.confirm', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de');
    clearAllTextInputHistories.mockClear();
  });

  it('Eingabeverlauf loeschen: nutzt den Dialog, kein window.confirm, Abbruch loescht nichts', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    const btn = await screen.findByText(i18n.t('settings:inputHistory.clearAll'));
    const no = autoAnswerConfirmDialog(false);
    fireEvent.click(btn);
    await waitFor(() => expect(no.seen.length).toBe(1));
    no.stop();
    expect(clearAllTextInputHistories).not.toHaveBeenCalled();
    const yes = autoAnswerConfirmDialog(true);
    fireEvent.click(btn);
    await waitFor(() => expect(clearAllTextInputHistories).toHaveBeenCalledTimes(1));
    yes.stop();
    expect(nativeConfirm).not.toHaveBeenCalled();
  });
});
