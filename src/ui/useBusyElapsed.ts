import { useEffect, useState } from 'react';

export function useBusyElapsedSeconds(busy: boolean): number | undefined {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!busy) {
      setStartedAt(null);
      return;
    }
    const started = Date.now();
    setStartedAt(started);
    setNow(started);
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [busy]);

  if (startedAt == null) return undefined;
  return Math.max(0, Math.floor((now - startedAt) / 1_000));
}
