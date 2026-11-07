import React, { useCallback, useEffect, useRef, useState } from 'react';
import ConfirmDialog from './ConfirmDialog.jsx';

/** confirm(options) liefert ein Promise<boolean>; dialog muss im JSX stehen. */
export function useConfirmDialog() {
  const [state, setState] = useState(null);
  const resolveRef = useRef(null);
  const settle = useCallback((value) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setState(null);
    if (resolve) resolve(value);
  }, []);
  const confirm = useCallback((options) => new Promise((resolve) => {
    if (resolveRef.current) resolveRef.current(false); // ein offener Dialog wird abgelehnt
    resolveRef.current = resolve;
    setState(options || {});
  }), []);
  // Beim Entfernen der Seite offenen Dialog als abgelehnt beenden.
  useEffect(() => () => { if (resolveRef.current) resolveRef.current(false); }, []);
  const onCancel = useCallback(() => settle(false), [settle]);
  const onConfirm = useCallback(() => settle(true), [settle]);
  const dialog = state ? <ConfirmDialog {...state} onConfirm={onConfirm} onCancel={onCancel} /> : null;
  return { confirm, dialog };
}
