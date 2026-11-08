import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import FeedbackForm from '../FeedbackForm.jsx';

// F11: Der Bugreport sendet die Adresse der Seite ohne Zugriffstoken.
describe('FeedbackForm: Seitenadresse im Bugreport', () => {
  beforeAll(async () => { await i18n.changeLanguage('de'); });
  afterEach(() => { vi.unstubAllGlobals(); window.history.pushState({}, '', '/'); });

  it('enthaelt kein ?token der Job-Seite', async () => {
    window.history.pushState({}, '', '/multisig/jobs/abc?token=geheim&x=1#details');
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<I18nextProvider i18n={i18n}><FeedbackForm /></I18nextProvider>);
    fireEvent.change(container.querySelector('textarea'), { target: { value: 'etwas ist kaputt' } });
    fireEvent.submit(container.querySelector('form'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.url).toContain('/multisig/jobs/abc');
    expect(body.url).toContain('x=1');
    expect(body.url).not.toMatch(/token|geheim/);
  });
});
