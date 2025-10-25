/**
 * Sehr leichter Account-Event-Bus für globale Kontoauswahl/Reload-Events.
 */
export function emitAccountSelected(address, { forceReload = false } = {}) {
  try {
    const addr = String(address || '').trim();
    if (!addr) return;
    const prev = window.sessionStorage?.getItem('stm.currentAccount') || '';
    const changed = prev !== addr;

    window.dispatchEvent(new CustomEvent('stm:accountSelected', { detail: { address: addr, forceReload } }));
    if (forceReload) {
      window.dispatchEvent(new CustomEvent('stm:accountReload', { detail: { address: addr } }));
    }
    if (changed || forceReload) {
      window.sessionStorage?.setItem('stm.currentAccount', addr);
      window.dispatchEvent(new CustomEvent('stm:accountChanged', { detail: { address: addr } }));
    }
  } catch (error) {
    throw new Error('submitTransaction.failed:accountBus.emit:' + (error?.message || 'unknown'));
  }
}

export function onAccountSelected(handler) {
  const selectedHandler = (event) => handler?.(event.detail);
  const reloadHandler = (event) => handler?.({ ...(event.detail || {}), forceReload: true });
  window.addEventListener('stm:accountSelected', selectedHandler);
  window.addEventListener('stm:accountReload', reloadHandler);
  return () => {
    window.removeEventListener('stm:accountSelected', selectedHandler);
    window.removeEventListener('stm:accountReload', reloadHandler);
  };
}
