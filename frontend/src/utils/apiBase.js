// Utility to resolve the API base URL consistently in dev and prod.
// If VITE_BACKEND_URL is set (absolute or relative), we append /api unless it already ends with /api.
// Otherwise we fall back to the same-origin /api (works with Vite dev proxy and reverse proxy in prod).
export function getApiBase() {
  try {
    const raw = import.meta.env?.VITE_BACKEND_URL || '';
    const base = String(raw).trim().replace(/\/+$/, '');
    if (base) {
      try {
        const currentHost = window?.location?.hostname || '';
        const url = new URL(base, window.location.origin);
        const isLocalhost = (host) => host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
        if (isLocalhost(url.hostname) && !isLocalhost(currentHost)) {
          return '/api';
        }
      } catch {
        // If URL parsing fails, fall through to the original base handling.
      }
      return base.endsWith('/api') ? base : `${base}/api`;
    }
    // Fallback: Vite-Proxy in Dev
    if (import.meta.env?.DEV && import.meta.env?.VITE_DEV_PROXY_TARGET) {
      return '/api';
    }
    return '/api';
  } catch {
    return '/api';
  }
}

export function apiUrl(path = '') {
  const base = getApiBase();
  const clean = String(path || '').replace(/^\/+/, '');
  return `${base}/${clean}`;
}
