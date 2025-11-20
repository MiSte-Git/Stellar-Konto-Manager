import React from 'react';
import ToastContainer from './toast/ToastContainer.jsx';

export function useToast() {
  const [toasts, setToasts] = React.useState([]);

  const remove = React.useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const notify = React.useCallback((content, { type = 'info', duration = 3000 } = {}) => {
    const id = Math.random().toString(36).slice(2);
    const item = { id, content, type };
    setToasts((list) => [...list, item]);
    if (duration > 0) {
      setTimeout(() => remove(id), duration);
    }
    return id;
  }, [remove]);

  const ToastHost = React.useCallback(() => (
    <ToastContainer toasts={toasts} onClose={remove} />
  ), [toasts, remove]);

  return { notify, ToastHost };
}

