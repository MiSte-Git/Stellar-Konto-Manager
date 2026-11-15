// Regression: Nach erfolgreichem Admin-Login stuerzte die Seite mit "Rendered more hooks than during the previous
// render" ab. Die fruehen returns (authState loading, nicht angemeldet) standen vor weiteren Hooks (useMemo,
// useCallback), beim Wechsel zu angemeldet liefen also mehr Hooks als vorher. Gilt fuer den Login und fuer
// eine schon bestehende Session (loading -> authed).
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n.js';
import BugTrackerAdmin from '../BugTrackerAdmin.tsx';

const REPORT = {
  id: 7, ts: '2026-11-15T10:00:00Z', url: 'https://example.test/x', language: 'de', userAgent: 'test',
  title: 'Knopf fehlt im Dialog', description: 'Beschreibung', category: 'bug', status: 'open', priority: 'normal', page: 'other',
};

function mockFetch({ authenticated }) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url);
    calls.push(u);
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    if (u.includes('admin/check')) return json({ authenticated });
    if (u.includes('admin/login')) return json({ ok: true });
    if (u.includes('bugreport')) return json({ items: [REPORT], total: 1 });
    return json({}, 404);
  });
  return calls;
}

const renderPage = () => render(
  <I18nextProvider i18n={i18n}>
    <BugTrackerAdmin />
  </I18nextProvider>
);

describe('BugTrackerAdmin: Hooks vor den fruehen returns', () => {
  let consoleError;
  beforeAll(async () => { await i18n.changeLanguage('de'); });
  beforeEach(() => { consoleError = vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { consoleError.mockRestore(); });
  const hookErrors = () => consoleError.mock.calls.flat().map(String).filter((m) => /Rendered more hooks|change in the order of Hooks/.test(m));

  it('gesperrt, dann Login erfolgreich: keine Fehlermeldung, die Liste erscheint', async () => {
    mockFetch({ authenticated: false });
    renderPage();
    expect(await screen.findByText(i18n.t('common:bugReport.admin.locked'))).toBeInTheDocument();
    fireEvent.change(document.querySelector('input[type="password"]'), { target: { value: 'geheim' } });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common:bugReport.admin.confirm') }));
    expect(await screen.findByText('Knopf fehlt im Dialog')).toBeInTheDocument();
    expect(screen.queryByText(i18n.t('common:bugReport.admin.locked'))).toBeNull();
    expect(hookErrors()).toEqual([]);
  });

  it('bestehende Session (loading -> authed): keine Fehlermeldung, die Liste erscheint', async () => {
    mockFetch({ authenticated: true });
    renderPage();
    expect(await screen.findByText('Knopf fehlt im Dialog')).toBeInTheDocument();
    expect(hookErrors()).toEqual([]);
  });

  it('Gegenprobe: ohne Login bleibt die Seite gesperrt und laedt keine Berichte', async () => {
    const calls = mockFetch({ authenticated: false });
    renderPage();
    expect(await screen.findByText(i18n.t('common:bugReport.admin.locked'))).toBeInTheDocument();
    await waitFor(() => expect(calls.some((u) => u.includes('admin/check'))).toBe(true));
    expect(calls.some((u) => u.includes('bugreport'))).toBe(false);
    expect(hookErrors()).toEqual([]);
  });
});
