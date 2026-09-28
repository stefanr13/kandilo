import { useEffect, useState } from 'react';
import { Church } from '../types';

interface ActiveChurchSelection {
  activeChurch: Church | null;
  activeChurchId: string | null;
  setActiveChurch: (church: Church) => void;
}

interface UseActiveChurchSelectionOptions {
  autoSelectFirst?: boolean;
}

export function useActiveChurchSelection(
  churches: Church[],
  options: UseActiveChurchSelectionOptions = {}
): ActiveChurchSelection {
  const [activeChurch, setActiveChurch] = useState<Church | null>(null);
  const activeChurchId = activeChurch?.id ?? null;
  const { autoSelectFirst = true } = options;

  useEffect(() => {
    if (churches.length === 0) {
      if (activeChurchId) {
        setActiveChurch(null);
      }
      return;
    }

    const hasSelectedChurch = churches.some((church) => church.id === activeChurchId);
    if (activeChurchId && !hasSelectedChurch) {
      setActiveChurch(null);
      return;
    }

    if (!activeChurchId && autoSelectFirst) {
      setActiveChurch(churches[0]);
    }
  }, [churches, activeChurchId, autoSelectFirst]);

  return { activeChurch, activeChurchId, setActiveChurch };
}
