import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Polls `fn` immediately and then every `intervalMs` (when `intervalMs` > 0).
 * Keeps the previous data while refetching (no flicker). Errors are kept in `error`.
 */
export function usePolling<T>(fn: () => Promise<T>, intervalMs: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const d = await fnRef.current();
      if (mine === seq.current) {
        setData(d);
        setError(undefined);
      }
    } catch (e) {
      if (mine === seq.current) setError(e as Error);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    const loop = async () => {
      await refresh();
      if (!stopped && intervalMs > 0) timer = setTimeout(loop, intervalMs);
    };
    loop();
    return () => {
      stopped = true;
      seq.current++;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, refresh, ...deps]);

  return { data, error, loading, refresh };
}
