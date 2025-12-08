// src/config.js
export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
export const HORIZON_URL = import.meta.env.VITE_HORIZON_URL;
export const FEEDBACK_EMAIL = import.meta.env.VITE_FEEDBACK_EMAIL || 'support@skm.steei.de';
// Feature switch to hide/show the donate button without removing logic.
export const SHOW_DONATE_BUTTON = false;
