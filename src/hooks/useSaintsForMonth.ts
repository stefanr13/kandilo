import { useEffect, useRef, useState } from 'react';
import { getSaintIndexForMonth, type SaintIndexDay } from '../lib/db/saints';

/**
 * Loads all saint_index documents for the given month when showSaintDays is true.
 * Returns a map keyed by YYYY-MM-DD, or an empty object when disabled.
 * Cancels in-flight fetches on month/enabled change to avoid stale state.
 */
export function useSaintsForMonth(
  year: number,
  month: number,
  enabled: boolean
): Record<string, SaintIndexDay> {
  const [saints, setSaints] = useState<Record<string, SaintIndexDay>>({});
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setSaints({});
      return;
    }

    cancelRef.current = false;
    setSaints({});

    getSaintIndexForMonth(year, month)
      .then((data) => {
        if (!cancelRef.current) setSaints(data);
      })
      .catch((err) => {
        console.warn('useSaintsForMonth: failed to load', err);
      });

    return () => {
      cancelRef.current = true;
    };
  }, [year, month, enabled]);

  return saints;
}
