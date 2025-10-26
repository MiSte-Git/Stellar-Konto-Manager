// Utility to resolve the API base URL consistently in dev and prod.
// If VITE_BACKEND_URL is set (absolute or relative), we append /api unless it already ends with /api.
// Otherwise we fall back to the same-origin /api (works with Vite dev proxy and reverse proxy in prod).
export function getApiBase() {
  try {
    const raw = import.meta.env?.VITE_BACKEND_URL || '';
    const base = String(raw).trim().replace(/\/+$/, '');
    if (!base) return '/api';
    return base.endsWith('/api') ? base : `${base}/api`;
  } catch {
    return '/api';
  }
}

export function apiUrl(path = '') {
  const base = getApiBase();
  const clean = String(path || '').replace(/^\/+/, '');
  return `${base}/${clean}`;
}
