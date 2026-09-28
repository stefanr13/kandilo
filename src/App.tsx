/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Suspense, lazy, useEffect, useState } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import AppLoadingScreen from './components/app/AppLoadingScreen';
import ComingSoonScreen from './components/app/ComingSoonScreen';
import { COMING_SOON_ENABLED } from './config/features';
import { useAuth } from './hooks/useAuth';
import { usePendingInvitation } from './hooks/usePendingInvitation';
import { getExtraCopy } from './localization/extra';
import {
  APP_URL_OPENED_EVENT,
  getCurrentAppLocationSnapshot,
  parsePublicEventPath,
  type AppLocationSnapshot,
} from './app/navigation';
import type { Language } from './types';

const AuthScreen = lazy(() => import('./components/AuthScreen'));
const InvitationAcceptScreen = lazy(() => import('./components/InvitationAcceptScreen'));
const AuthenticatedApp = lazy(() => import('./components/app/AuthenticatedApp'));
const EventPortalScreen = lazy(() => import('./components/events/EventPortalScreen'));

export default function App() {
  if (COMING_SOON_ENABLED) {
    return <ComingSoonScreen />;
  }

  const { user, loading: authLoading, isSuperAdmin } = useAuth();
  const [language, setLanguage] = useState<Language>('English');
  const { pendingInvitationId, clearPendingInvitation } = usePendingInvitation();
  const [publicEventRoute, setPublicEventRoute] = useState(() => (
    typeof window === 'undefined'
      ? null
      : parsePublicEventPath(getCurrentAppLocationSnapshot(window.location).pathname)
  ));

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const syncPublicEventRoute = (pathname: string) => {
      setPublicEventRoute(parsePublicEventPath(pathname));
    };

    const handlePopState = () => {
      syncPublicEventRoute(getCurrentAppLocationSnapshot(window.location).pathname);
    };

    const handleNativeUrl = (event: Event) => {
      const snapshot = (event as CustomEvent<AppLocationSnapshot>).detail;
      syncPublicEventRoute(snapshot.pathname);
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener(APP_URL_OPENED_EVENT, handleNativeUrl as EventListener);
    syncPublicEventRoute(getCurrentAppLocationSnapshot(window.location).pathname);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener(APP_URL_OPENED_EVENT, handleNativeUrl as EventListener);
    };
  }, []);

  const handleLogin = (lang: Language) => {
    setLanguage(lang);
  };

  const extra = getExtraCopy(language);

  if (publicEventRoute) {
    return (
      <ErrorBoundary language={language}>
        <Suspense fallback={<AppLoadingScreen variant="page" />}>
          <EventPortalScreen slug={publicEventRoute.slug} />
        </Suspense>
      </ErrorBoundary>
    );
  }

  if (authLoading) {
    return <AppLoadingScreen variant="page" />;
  }

  if (!user) {
    return (
      <ErrorBoundary language={language}>
        <Suspense fallback={<AppLoadingScreen variant="page" />}>
          <AuthScreen
            onLogin={handleLogin}
            hideGuestOption={!!pendingInvitationId}
            contextMessage={
              pendingInvitationId
                ? extra.auth.invitationSignInContext
                : undefined
            }
          />
        </Suspense>
      </ErrorBoundary>
    );
  }

  if (pendingInvitationId) {
    return (
      <ErrorBoundary language={language}>
        <Suspense fallback={<AppLoadingScreen variant="page" />}>
          <InvitationAcceptScreen
            invitationId={pendingInvitationId}
            user={user}
            language={language}
            onContinue={clearPendingInvitation}
          />
        </Suspense>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary language={language}>
      <Suspense fallback={<AppLoadingScreen variant="page" />}>
        <AuthenticatedApp
          key={user.uid}
          user={user}
          isSuperAdmin={isSuperAdmin}
          language={language}
          onLanguageChange={setLanguage}
        />
      </Suspense>
    </ErrorBoundary>
  );
}
