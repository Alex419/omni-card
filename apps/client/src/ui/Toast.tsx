import { useCallback, useEffect, useRef, useState } from 'react';

/** One line of news at a time, above your hand. */
export function useToast() {
  const [toast, setToast] = useState<{ text: string; err: boolean; n: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((text: string, err = false) => {
    if (!text) return;
    setToast((t) => ({ text, err, n: (t?.n ?? 0) + 1 }));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { toast, show };
}

export function Toast({ toast }: { toast: { text: string; err: boolean } | null }) {
  return (
    <div
      className={`toast${toast ? ' show' : ''}${toast?.err ? ' err' : ''}`}
      role="status"
      aria-live="polite"
    >
      {toast?.text}
    </div>
  );
}
