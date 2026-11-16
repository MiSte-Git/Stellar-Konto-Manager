import { clearMultisigJobTokens, openMultisigJob, takeMultisigJobToken } from '../multisigNavigation.js';
import { SESSION_LOCKED_EVENT } from '../../../utils/sessionSecrets.js';

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

  it('#10: Link mit ?token= wird nicht uebernommen, aber aus der Adresszeile entfernt; uebrige Parameter und Hash bleiben', () => {
    window.history.replaceState({ keep: 1 }, '', '/multisig/jobs/nav-3?token=tok-3&lang=de#signers');
    const replace = vi.spyOn(window.history, 'replaceState');
    // Gegenprobe zum alten Verhalten: dort kam tok-3 zurueck.
    expect(takeMultisigJobToken('nav-3')).toBeNull();
    expect(replace).toHaveBeenCalledTimes(1);
    replace.mockRestore();
    expect(window.location.pathname).toBe('/multisig/jobs/nav-3');
    expect(window.location.search).toBe('?lang=de');
    expect(window.location.hash).toBe('#signers');
    expect(window.history.state).toEqual({ keep: 1 });
    // erneutes Lesen (main.jsx liest bei jedem popstate): kein weiterer Eingriff
    const again = vi.spyOn(window.history, 'replaceState');
    expect(takeMultisigJobToken('nav-3')).toBeNull();
    expect(again).not.toHaveBeenCalled();
    again.mockRestore();
  });

  it('#10: ein Token aus der App bleibt, auch wenn die URL ein fremdes ?token= traegt', () => {
    openMultisigJob('nav-4', 'tok-4');
    window.history.replaceState({}, '', '/multisig/jobs/nav-4?token=fremd');
    expect(takeMultisigJobToken('nav-4')).toBe('tok-4');
    expect(window.location.search).toBe('');
  });

  it('#10: Sperren und Kontowechsel leeren die gemerkten Tokens', () => {
    openMultisigJob('nav-7', 'tok-7');
    expect(takeMultisigJobToken('nav-7')).toBe('tok-7');
    window.dispatchEvent(new CustomEvent(SESSION_LOCKED_EVENT));
    expect(takeMultisigJobToken('nav-7')).toBeNull();
    openMultisigJob('nav-8', 'tok-8');
    clearMultisigJobTokens();
    expect(takeMultisigJobToken('nav-8')).toBeNull();
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

// Verdrahtung in main.jsx (zu schwer fuer einen Seitentest): Kontowechsel leert die Tokens,
// das Job-Detail wird je Job neu aufgebaut (kein Token aus dem vorigen Job im Ref, V2).
describe('main.jsx: Verdrahtung #10', () => {
  it('leert die Tokens beim Kontowechsel und gibt dem Job-Detail key={activeJobId}', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(`${globalThis.process.cwd()}/src/main.jsx`, 'utf8');
    expect(src).toContain('<MultisigJobDetail key={activeJobId} jobId={activeJobId}');
    const effect = src.slice(src.indexOf('const tokenAccountRef'), src.indexOf('}, [sourcePublicKey]);', src.indexOf('const tokenAccountRef')));
    expect(effect).toContain('clearMultisigJobTokens();');
  });
});
