import React from 'react';
import { act, render } from '@testing-library/react';
import { Keypair } from '@stellar/stellar-sdk';
import { StoryProvider, useStory } from '../StoryContext.jsx';

// Story-Keypair (zufaellig, nur Testnet): Secret nur im sessionStorage, nie im localStorage
// (AGENTS.md Regel 2, Entscheidung Michael 14.11.2026).
const STORAGE_KEY = 'stellar_story_progress';
const SECRET_KEY = 'stellar_story_keypair';

let story;
function Probe() {
  story = useStory();
  return null;
}
const renderStory = () => render(<StoryProvider onExit={() => {}}><Probe /></StoryProvider>);

describe('StoryContext: Speicherort des Story-Secrets', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    story = null;
  });

  it('neues Keypair: Secret im sessionStorage, Fortschritt ohne Secret im localStorage', async () => {
    renderStory();
    await act(async () => { story.createKeypair(); });
    const kp = story.keypair;
    expect(kp).toBeTruthy();
    expect(sessionStorage.getItem(SECRET_KEY)).toBe(kp.secret());
    const saved = localStorage.getItem(STORAGE_KEY) || '';
    expect(saved).not.toContain(kp.secret());
    expect(JSON.parse(saved)).not.toHaveProperty('keypairSecret');
  });

  it('Altbestand mit Secret im localStorage: wird in den sessionStorage uebernommen und aus dem localStorage entfernt', () => {
    const kp = Keypair.random();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ currentChapter: 2, accountFunded: true, keypairSecret: kp.secret() }));
    renderStory();
    expect(story.keypair.publicKey()).toBe(kp.publicKey());
    expect(story.accountFunded).toBe(true);
    expect(sessionStorage.getItem(SECRET_KEY)).toBe(kp.secret());
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain(kp.secret());
    expect(story.currentChapter).toBe(2);
  });

  it('neuer Tab (sessionStorage leer): kein Keypair, Konto gilt nicht als aktiviert, Fortschritt bleibt', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ currentChapter: 3, accountFunded: true, xp: 50 }));
    renderStory();
    expect(story.keypair).toBeNull();
    expect(story.accountFunded).toBe(false);
    expect(story.currentChapter).toBe(3);
    expect(story.xp).toBe(50);
  });

  it('Zuruecksetzen loescht auch den Secret im sessionStorage', async () => {
    renderStory();
    await act(async () => { story.createKeypair(); });
    await act(async () => { story.reset(); });
    expect(sessionStorage.getItem(SECRET_KEY)).toBeNull();
  });
});
