import { useEffect, useState } from 'react';
import { Church } from '../types';

interface ActiveChurchSelection {
  activeChurch: Church | null;
  activeChurchId: string | null;
  setActiveChurch: (church: Church) => void;
}

export function useActiveChurchSelection(churches: Church[]): ActiveChurchSelection {
  const [activeChurch, setActiveChurch] = useState<Church | null>(null);
  const activeChurchId = activeChurch?.id ?? null;

  useEffect(() => {
    if (churches.length === 0) {
      if (activeChurchId) {
        setActiveChurch(null);
      }
      return;
    }

    if (!activeChurchId || !churches.some((church) => church.id === activeChurchId)) {
      setActiveChurch(churches[0]);
    }
  }, [churches, activeChurchId]);

  return { activeChurch, activeChurchId, setActiveChurch };
}
