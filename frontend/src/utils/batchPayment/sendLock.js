// Exklusiver Sendevorgang pro Netz: liegt im gemeinsamen Modul (auch fuer "Zahlung senden").
export { LOCK_TTL_MS, tryWithSendLock, withSendLock } from '../submitGuard/sendLock.js';
