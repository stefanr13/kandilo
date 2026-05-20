import { useEffect, useState } from 'react';
import {
  APP_URL_OPENED_EVENT,
  getCurrentAppLocationSnapshot,
  parsePendingInvitationPath,
  replaceWithRootPath,
  type AppLocationSnapshot,
} from '../app/navigation';

interface PendingInvitationState {
  pendingInvitationId: string | null;
  clearPendingInvitation: () => void;
}

export function usePendingInvitation(): PendingInvitationState {
  const [pendingInvitationId, setPendingInvitationId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return parsePendingInvitationPath(getCurrentAppLocationSnapshot(window.location).pathname);
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const syncFromPathname = (pathname: string) => {
      setPendingInvitationId(parsePendingInvitationPath(pathname));
    };

    const handlePopState = () => {
      syncFromPathname(getCurrentAppLocationSnapshot(window.location).pathname);
    };

    const handleNativeUrl = (event: Event) => {
      const snapshot = (event as CustomEvent<AppLocationSnapshot>).detail;
      syncFromPathname(snapshot.pathname);
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener(APP_URL_OPENED_EVENT, handleNativeUrl as EventListener);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener(APP_URL_OPENED_EVENT, handleNativeUrl as EventListener);
    };
  }, []);

  const clearPendingInvitation = () => {
    if (typeof window !== 'undefined' && pendingInvitationId) {
      replaceWithRootPath(window.history);
    }
    setPendingInvitationId(null);
  };

  return { pendingInvitationId, clearPendingInvitation };
}
