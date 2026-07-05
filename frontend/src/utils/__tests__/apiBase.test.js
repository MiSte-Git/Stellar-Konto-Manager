import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiUrl, getApiBase } from '../apiBase.js';

const ORIGINAL_BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
const ORIGINAL_DEV_PROXY = import.meta.env.VITE_DEV_PROXY_TARGET;

afterEach(() => {
  import.meta.env.VITE_BACKEND_URL = ORIGINAL_BACKEND_URL;
  import.meta.env.VITE_DEV_PROXY_TARGET = ORIGINAL_DEV_PROXY;
  vi.unstubAllGlobals();
});

describe('getApiBase', () => {
  it('falls back to the same-origin /api when no backend URL is configured', () => {
    import.meta.env.VITE_BACKEND_URL = '';
    expect(getApiBase()).toBe('/api');
  });

  it('appends /api to an absolute backend URL that does not already end with it', () => {
    vi.stubGlobal('location', { hostname: 'skm.example.com', origin: 'https://skm.example.com' });
    import.meta.env.VITE_BACKEND_URL = 'https://backend.example.com';
    expect(getApiBase()).toBe('https://backend.example.com/api');
  });

  it('does not duplicate /api when the configured backend URL already ends with it', () => {
    vi.stubGlobal('location', { hostname: 'skm.example.com', origin: 'https://skm.example.com' });
    import.meta.env.VITE_BACKEND_URL = 'https://backend.example.com/api';
    expect(getApiBase()).toBe('https://backend.example.com/api');
  });

  it('strips trailing slashes from the configured backend URL before appending /api', () => {
    vi.stubGlobal('location', { hostname: 'skm.example.com', origin: 'https://skm.example.com' });
    import.meta.env.VITE_BACKEND_URL = 'https://backend.example.com///';
    expect(getApiBase()).toBe('https://backend.example.com/api');
  });

  it('guards against a production page shipping with a leftover localhost backend URL', () => {
    // If the current page is not itself running on localhost but VITE_BACKEND_URL
    // still points at one (a stale dev build artifact), using it would silently
    // break the app in production - fall back to the same-origin /api instead.
    vi.stubGlobal('location', { hostname: 'skm.example.com', origin: 'https://skm.example.com' });
    import.meta.env.VITE_BACKEND_URL = 'http://localhost:3000';
    expect(getApiBase()).toBe('/api');
  });

  it('honors a localhost backend URL when the page itself is running on localhost (dev mode)', () => {
    vi.stubGlobal('location', { hostname: 'localhost', origin: 'http://localhost:5173' });
    import.meta.env.VITE_BACKEND_URL = 'http://localhost:3000';
    expect(getApiBase()).toBe('http://localhost:3000/api');
  });
});

describe('apiUrl', () => {
  it('joins the base and a path without a double slash', () => {
    import.meta.env.VITE_BACKEND_URL = '';
    expect(apiUrl('/multisig/jobs')).toBe('/api/multisig/jobs');
    expect(apiUrl('multisig/jobs')).toBe('/api/multisig/jobs');
  });

  it('defaults to an empty path', () => {
    import.meta.env.VITE_BACKEND_URL = '';
    expect(apiUrl()).toBe('/api/');
  });
});
