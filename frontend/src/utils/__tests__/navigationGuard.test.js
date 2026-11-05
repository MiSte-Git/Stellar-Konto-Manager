import { RESTORE_TIMEOUT_MS, confirmNavigation, hasNavigationGuard, registerNavigationGuard } from '../navigationGuard.js';
import { navigateToPath } from '../appNavigation.js';

// Navigationswaechter (Review N21-3): fragt vor dem Verlassen nach, bei Abbrechen bleibt die Seite.
describe('navigationGuard', () => {
  let confirmSpy;
  let unregister = null;
  // Spaeter registrierter Listener steht fuer Router und Main
  const later = vi.fn();

  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    later.mockReset();
    window.addEventListener('popstate', later);
  });
  afterEach(async () => {
    unregister?.();
    unregister = null;
    window.removeEventListener('popstate', later);
    confirmSpy.mockRestore();
    // Freigabe einer bestaetigten Rueckfrage gilt bis zum naechsten Task
    await new Promise((r) => setTimeout(r, 0));
  });

  const beforeUnloadPrevented = () => {
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    return ev.defaultPrevented;
  };

  it('ohne Waechter: keine Rueckfrage, kein beforeunload', () => {
    expect(hasNavigationGuard()).toBe(false);
    expect(confirmNavigation()).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(beforeUnloadPrevented()).toBe(false);
  });

  it('mit Waechter: fragt mit dem Text der Seite, beforeunload gesetzt; nach Abmelden beides weg', () => {
    unregister = registerNavigationGuard(() => 'Key sichern?');
    expect(hasNavigationGuard()).toBe(true);
    expect(beforeUnloadPrevented()).toBe(true);
    expect(confirmNavigation()).toBe(false);
    expect(confirmSpy).toHaveBeenCalledWith('Key sichern?');

    unregister();
    unregister = null;
    expect(hasNavigationGuard()).toBe(false);
    expect(beforeUnloadPrevented()).toBe(false);
  });

  it('Browser-Zurueck mit Abbrechen: URL wiederhergestellt, Router/Main sehen das Ereignis nicht', () => {
    unregister = registerNavigationGuard('Bleiben?');
    // Browser hat die URL schon geaendert, dann kommt popstate
    window.history.replaceState({}, '', '/quiz');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(later).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');
  });

  it('Gegenprobe: Browser-Zurueck mit Bestaetigen geht durch, ohne zweite Rueckfrage im selben Ereignis', () => {
    unregister = registerNavigationGuard('Bleiben?');
    confirmSpy.mockReturnValue(true);
    window.history.replaceState({}, '', '/quiz');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(later).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/quiz');
    // z. B. setMenuSelection in main.jsx, ausgeloest vom selben popstate
    expect(confirmNavigation()).toBe(true);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it('navigateToPath auf eine eigene Route: fragt, bei Abbrechen bleibt die URL', () => {
    unregister = registerNavigationGuard('Bleiben?');
    expect(navigateToPath('story')).toBe(false);
    expect(window.location.pathname).toBe('/');
    expect(later).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    expect(navigateToPath('story')).toBe(true);
    expect(window.location.pathname).toBe('/story');
    expect(later).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledTimes(2);
  });

  // KS-5: Abbrechen hinterlaesst keinen zusaetzlichen History-Eintrag
  it('Browser-Zurueck abbrechen: zurueck auf den alten Eintrag ohne neuen; zweimal Zurueck ohne Schleife', async () => {
    window.history.pushState({}, '', '/page');
    unregister = registerNavigationGuard('Bleiben?');
    const len = window.history.length;

    window.history.back();
    await vi.waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(window.location.pathname).toBe('/page'));
    await new Promise((r) => setTimeout(r, 20));
    expect(window.history.length).toBe(len);
    expect(later).not.toHaveBeenCalled();

    // Zweites Zurueck: wieder genau eine Rueckfrage, gleicher Stand
    window.history.back();
    await vi.waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(window.location.pathname).toBe('/page'));
    await new Promise((r) => setTimeout(r, 20));
    expect(window.history.length).toBe(len);
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(later).not.toHaveBeenCalled();

    // Gegenprobe: Bestaetigen geht wirklich zurueck
    confirmSpy.mockReturnValue(true);
    window.history.back();
    await vi.waitFor(() => expect(window.location.pathname).toBe('/'));
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('Link mit pushState + popstate abbrechen: Schritt rueckgaengig, Zurueck fuehrt nicht auf das abgebrochene Ziel', async () => {
    unregister = registerNavigationGuard('Bleiben?');
    const startIdx = window.history.state?.__skmIdx;
    expect(Number.isInteger(startIdx)).toBe(true);
    // So oeffnen Story, Quiz usw. ihre Route
    window.history.pushState({}, '', '/story');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(window.location.pathname).toBe('/'));
    await new Promise((r) => setTimeout(r, 20));
    // Wieder am alten Eintrag (nicht an einem neuen dahinter)
    expect(window.history.state?.__skmIdx).toBe(startIdx);
    expect(later).not.toHaveBeenCalled();

    window.history.back();
    await new Promise((r) => setTimeout(r, 30));
    expect(window.location.pathname).not.toBe('/story');
  });

  it('bestehender History-State bleibt beim Nummerieren erhalten', () => {
    window.history.pushState({ usr: 1, key: 'k', idx: 3 }, '', '/x');
    expect(window.history.state).toMatchObject({ usr: 1, key: 'k', idx: 3 });
    expect(Number.isInteger(window.history.state.__skmIdx)).toBe(true);
    window.history.replaceState({ a: 1 }, '', '/y');
    expect(window.history.state).toMatchObject({ a: 1 });
  });

  it('Glossar per pushState + popstate (Glossar-Link) und Schliessen per Zurueck: keine Rueckfrage', async () => {
    unregister = registerNavigationGuard('Bleiben?');
    window.history.pushState({}, '', '/glossar');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(later).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/glossar');

    window.history.back();
    await vi.waitFor(() => expect(window.location.pathname).toBe('/'));
    await vi.waitFor(() => expect(later).toHaveBeenCalledTimes(2));
    expect(confirmSpy).not.toHaveBeenCalled();
    // Backup-Overlay ebenso, auch mit Anker im Glossar-Link
    expect(navigateToPath('settings/backup')).toBe(true);
    expect(navigateToPath('')).toBe(true);
    expect(navigateToPath('glossar#g-multisigCorporate')).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
    // Gegenprobe: vom Overlay auf eine andere Route fragt
    expect(navigateToPath('story')).toBe(false);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  it('Overlays (Glossar) lassen Main gemountet: keine Rueckfrage', () => {
    unregister = registerNavigationGuard('Bleiben?');
    expect(navigateToPath('glossar')).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
    // Overlay schliessen (zurueck zur Startroute von Main): ebenfalls ohne Rueckfrage
    expect(navigateToPath('')).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');
  });
  // KS-6: Links innerhalb der App fragen wie ein Menuewechsel nach
  describe('Link-Klicks', () => {
    let link;
    let reached;
    const onReach = (e) => { reached += 1; e.preventDefault(); }; // jsdom navigiert sonst

    const makeLink = (href, attrs = {}) => {
      const a = document.createElement('a');
      a.setAttribute('href', href);
      Object.entries(attrs).forEach(([k, v]) => a.setAttribute(k, v));
      const span = document.createElement('span');
      span.textContent = 'Link';
      a.appendChild(span);
      document.body.appendChild(a);
      a.addEventListener('click', onReach);
      return a;
    };
    // Klick auf ein Kind des Links (wie Text oder Icon in einem echten Link)
    const click = (a, init = {}) => {
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
      a.firstChild.dispatchEvent(ev);
      return ev;
    };

    beforeEach(() => { reached = 0; });
    afterEach(() => { link?.remove(); link = null; });

    it('interner Link mit Waechter: Rueckfrage, Abbrechen blockiert, Bestaetigen laesst durch', () => {
      unregister = registerNavigationGuard('Bleiben?');
      link = makeLink('/legal');
      const ev = click(link);
      expect(confirmSpy).toHaveBeenCalledWith('Bleiben?');
      expect(ev.defaultPrevented).toBe(true);
      expect(reached).toBe(0);

      confirmSpy.mockReturnValue(true);
      click(link);
      expect(confirmSpy).toHaveBeenCalledTimes(2);
      expect(reached).toBe(1);
      // Nachfolgende Pruefung im selben Ereignis (z. B. navigateToPath im onClick) fragt nicht erneut
      expect(confirmNavigation()).toBe(true);
      expect(confirmSpy).toHaveBeenCalledTimes(2);
    });

    it('auch Links mit absoluter URL gleicher Origin und Query fragen nach', () => {
      unregister = registerNavigationGuard('Bleiben?');
      link = makeLink(`${window.location.origin}/trading/pools?pool=x`);
      click(link);
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(reached).toBe(0);
    });

    it('extern, target=_blank, Download, Strg/Cmd/Shift/Mitteltaste: keine Rueckfrage', () => {
      unregister = registerNavigationGuard('Bleiben?');
      const cases = [
        [makeLink('https://example.org/x'), {}],
        [makeLink('/legal', { target: '_blank' }), {}],
        [makeLink('/legal', { download: '' }), {}],
        [makeLink('/legal'), { ctrlKey: true }],
        [makeLink('/legal'), { metaKey: true }],
        [makeLink('/legal'), { shiftKey: true }],
        [makeLink('/legal'), { button: 1 }],
        [makeLink('mailto:a@example.org'), {}],
      ];
      cases.forEach(([a, init]) => { click(a, init); a.remove(); });
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(reached).toBe(cases.length);
    });

    it('Overlay-Link und reiner Anker: keine Rueckfrage', () => {
      unregister = registerNavigationGuard('Bleiben?');
      const a1 = makeLink('/glossar#g-multisig');
      const a2 = makeLink('#oben');
      click(a1); click(a2);
      a1.remove(); a2.remove();
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(reached).toBe(2);
    });

    it('Gegenprobe: ohne Waechter laufen Links unveraendert', () => {
      link = makeLink('/legal');
      const ev = click(link);
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(reached).toBe(1);
      expect(ev.defaultPrevented).toBe(true); // nur durch onReach
    });

    it('bestaetigter Link mit Seitenwechsel: beforeunload fragt nicht ein zweites Mal', () => {
      unregister = registerNavigationGuard('Bleiben?');
      confirmSpy.mockReturnValue(true);
      link = makeLink('/legal');
      click(link);
      expect(beforeUnloadPrevented()).toBe(false);
    });
  });

  // KS-7: Overlay auf einer anderen Route als der Startroute geoeffnet
  it('Glossar auf anderer Route geoeffnet, Schliessen per Zurueck: keine Rueckfrage', async () => {
    window.history.pushState({}, '', '/trading/assets');
    unregister = registerNavigationGuard('Bleiben?');
    window.history.pushState({}, '', '/glossar');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(confirmSpy).not.toHaveBeenCalled();

    window.history.back();
    await vi.waitFor(() => expect(window.location.pathname).toBe('/trading/assets'));
    await vi.waitFor(() => expect(later).toHaveBeenCalledTimes(2));
    expect(confirmSpy).not.toHaveBeenCalled();

    // Gegenprobe: vom Overlay auf eine andere Route als die Herkunft fragt weiter
    expect(navigateToPath('glossar')).toBe(true);
    expect(navigateToPath('story')).toBe(false);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });

  // Randfall 1: Anker-Sprung legt einen Eintrag ohne State an
  it('Anker-Sprung: keine Rueckfrage, Eintrag wird fortlaufend nummeriert', async () => {
    window.history.pushState({}, '', '/page');
    unregister = registerNavigationGuard('Bleiben?');
    const startIdx = window.history.state.__skmIdx;
    window.location.hash = 'abschnitt';
    await vi.waitFor(() => expect(later).toHaveBeenCalledTimes(1));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(window.history.state?.__skmIdx).toBe(startIdx + 1);
    // Folgende Eintraege bleiben nummeriert
    window.history.pushState({}, '', '/page2');
    expect(window.history.state.__skmIdx).toBe(startIdx + 2);
  });

  it('Abbrechen auf einem Eintrag ohne Nummer: keine doppelte Nummer', () => {
    window.history.pushState({}, '', '/page');
    unregister = registerNavigationGuard('Bleiben?');
    const startIdx = window.history.state.__skmIdx;
    // Fremder State-Typ bleibt unnummeriert
    window.history.pushState('fremd', '', '/foreign');
    expect(window.history.state).toBe('fremd');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/page');
    // Frueher: neuer Eintrag mit der Nummer des alten (startIdx) -> falsche Schritte bei history.go
    expect(window.history.state?.__skmIdx).not.toBe(startIdx);
    // Position unbekannt: Der Eintrag bleibt ohne Nummer (weitere Abbrueche legen einen
    // Eintrag an, springen aber nie falsch). Fuer die folgenden Tests neu nummerieren.
    window.history.__skmRawReplace({ ...window.history.state, __skmIdx: 0 }, '');
  });

  // Randfall 2: history.go ohne Wirkung darf kein spaeteres popstate verschlucken
  it('Abbrechen ohne Rueckweg-popstate: spaeteres Vor wird nicht verschluckt', async () => {
    window.history.pushState({}, '', '/a');
    window.history.pushState({}, '', '/page');
    unregister = registerNavigationGuard('Bleiben?');
    // Nur der Rueckweg des Waechters (go(+1)) bleibt ohne Wirkung, Browser-Zurueck nicht
    const realGo = window.history.go.bind(window.history);
    const goSpy = vi.spyOn(window.history, 'go').mockImplementation((d) => { if (d < 0) realGo(d); });
    try {
      window.history.back();
      await vi.waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
      expect(goSpy).toHaveBeenCalledWith(1);
    } finally {
      goSpy.mockRestore();
    }
    // Nutzer verlaesst die Seite (z. B. Fertig) und geht spaeter wieder vor
    unregister();
    unregister = null;
    await new Promise((r) => setTimeout(r, RESTORE_TIMEOUT_MS + 50));
    expect(window.location.pathname).toBe('/a');
    window.history.forward();
    await vi.waitFor(() => expect(window.location.pathname).toBe('/page'));
    await vi.waitFor(() => expect(later).toHaveBeenCalledTimes(1));
  });
});
