import { openMultisigJob, takeMultisigJobToken } from '../multisigNavigation.js';

describe('Zugriffstoken fuer Multisig-Jobs', () => {
  afterEach(() => { window.history.replaceState({}, '', '/'); });

  it('Zum Job: URL ohne Token, Token im Speicher', () => {
    const popstate = vi.fn();
    window.addEventListener('popstate', popstate);
    openMultisigJob('nav-1', 'tok-1');
    window.removeEventListener('popstate', popstate);
    expect(window.location.pathname).toBe('/multisig/jobs/nav-1');
    expect(window.location.search).toBe('');
    expect(window.history.state).toEqual({});
    expect(popstate).toHaveBeenCalledTimes(1);
    expect(takeMultisigJobToken('nav-1')).toBe('tok-1');
  });

  it('nutzt fuer den Eintrag im Verlauf pushState ohne Token', () => {
    const push = vi.spyOn(window.history, 'pushState');
    openMultisigJob('nav-2', 'tok-2');
    expect(push.mock.calls[0][2]).toBe('/multisig/jobs/nav-2');
    push.mockRestore();
  });

  it('Link mit ?token=: uebernimmt das Token per replaceState, uebrige Parameter und Hash bleiben', () => {
    window.history.replaceState({ keep: 1 }, '', '/multisig/jobs/nav-3?token=tok-3&lang=de#signers');
    const replace = vi.spyOn(window.history, 'replaceState');
    expect(takeMultisigJobToken('nav-3')).toBe('tok-3');
    expect(replace).toHaveBeenCalledTimes(1);
    replace.mockRestore();
    expect(window.location.pathname).toBe('/multisig/jobs/nav-3');
    expect(window.location.search).toBe('?lang=de');
    expect(window.location.hash).toBe('#signers');
    expect(window.history.state).toEqual({ keep: 1 });
    // erneutes Lesen (main.jsx liest bei jedem popstate): Token bleibt, kein weiterer Eingriff
    const again = vi.spyOn(window.history, 'replaceState');
    expect(takeMultisigJobToken('nav-3')).toBe('tok-3');
    expect(again).not.toHaveBeenCalled();
    again.mockRestore();
  });

  it('ordnet das Token dem Job aus der URL zu', () => {
    window.history.replaceState({}, '', '/multisig/jobs/nav-4?token=tok-4');
    expect(takeMultisigJobToken('nav-andere')).toBeNull();
    expect(takeMultisigJobToken('nav-4')).toBe('tok-4');
  });

  it('laesst ?token= auf anderen Seiten stehen und liefert ohne Token null', () => {
    window.history.replaceState({}, '', '/settings?token=fremd');
    expect(takeMultisigJobToken('nav-5')).toBeNull();
    expect(window.location.search).toBe('?token=fremd');
  });

  it('merkt ohne Token nichts vor', () => {
    openMultisigJob('nav-6');
    expect(window.location.search).toBe('');
    expect(takeMultisigJobToken('nav-6')).toBeNull();
  });
});
