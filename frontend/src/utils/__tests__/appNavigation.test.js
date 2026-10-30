import {
  consumePendingMainView,
  consumePendingTrustlineAsset,
  getActiveRouteItemId,
  openAddTrustline,
  openMainView,
  resolveMainItemId,
  setMainMounted,
} from '../appNavigation.js';

describe('appNavigation', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    consumePendingMainView();
  });

  it('ordnet Main-Ansichten Sidebar-Eintraegen zu', () => {
    expect(resolveMainItemId(null)).toBe('home');
    expect(resolveMainItemId('balance')).toBe('home');
    expect(resolveMainItemId('deleteAll')).toBe('listAll');
    expect(resolveMainItemId('multisigJobs')).toBe('multisigJobs');
    expect(resolveMainItemId('gibtsNicht')).toBeNull();
  });

  it('erkennt eigene Routen', () => {
    expect(getActiveRouteItemId('/learn/scam-simulator')).toBe('scamSimulator');
    expect(getActiveRouteItemId('/discover')).toBe('discover');
    expect(getActiveRouteItemId('/quiz')).toBe('quiz');
    expect(getActiveRouteItemId('/story')).toBe('story');
    expect(getActiveRouteItemId('/glossar')).toBe('glossary');
    expect(getActiveRouteItemId('/legal')).toBe('legal');
    expect(getActiveRouteItemId('/')).toBeNull();
    expect(getActiveRouteItemId('/settings')).toBeNull();
  });

  it('oeffnet die Trustline-Seite und liefert das vorgemerkte Asset genau einmal', () => {
    setMainMounted(true);
    const handler = vi.fn();
    window.addEventListener('stm:openMenu', handler);
    openAddTrustline({ code: 'USD', issuer: 'GISSUER' });
    window.removeEventListener('stm:openMenu', handler);
    expect(handler.mock.calls[0][0].detail).toBe('listAll');
    expect(consumePendingTrustlineAsset()).toEqual({ code: 'USD', issuer: 'GISSUER' });
    expect(consumePendingTrustlineAsset()).toBeNull();
  });

  it('merkt die Ansicht vor, wenn Main nicht gemountet ist', () => {
    setMainMounted(false);
    window.history.replaceState({}, '', '/quiz');
    const handler = vi.fn();
    window.addEventListener('stm:openMenu', handler);
    openMainView('payments');
    window.removeEventListener('stm:openMenu', handler);
    expect(handler).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');
    expect(consumePendingMainView()).toBe('payments');
    expect(consumePendingMainView()).toBeNull();
  });

  it('schliesst das Glossar-Overlay, bevor eine Ansicht geoeffnet wird', () => {
    setMainMounted(true);
    window.history.replaceState({}, '', '/glossar');
    const handler = vi.fn();
    window.addEventListener('stm:openMenu', handler);
    openMainView('compare');
    window.removeEventListener('stm:openMenu', handler);
    expect(window.location.pathname).toBe('/');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toBe('compare');
    setMainMounted(false);
  });
});
