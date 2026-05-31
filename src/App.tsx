/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Suspense, lazy, useState } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import AppLoadingScreen from './components/app/AppLoadingScreen';
import ComingSoonScreen from './components/app/ComingSoonScreen';
import { COMING_SOON_ENABLED } from './config/features';
import { useAuth } from './hooks/useAuth';
import { usePendingInvitation } from './hooks/usePendingInvitation';
import { getExtraCopy } from './localization/extra';
import type { Language } from './types';

const AuthScreen = lazy(() => import('./components/AuthScreen'));
const InvitationAcceptScreen = lazy(() => import('./components/InvitationAcceptScreen'));
const EmailVerificationGate = lazy(() => import('./components/app/EmailVerificationGate'));
const AuthenticatedApp = lazy(() => import('./components/app/AuthenticatedApp'));

export default function App() {
  if (COMING_SOON_ENABLED) {
    return <ComingSoonScreen />;
  }

  const { user, loading: authLoading, isSuperAdmin } = useAuth();
  const [language, setLanguage] = useState<Language>('English');
  const [emailVerificationRefreshKey, setEmailVerificationRefreshKey] = useState(0);
  const { pendingInvitationId, clearPendingInvitation } = usePendingInvitation();

  const handleLogin = (lang: Language) => {
    setLanguage(lang);
  };

  const extra = getExtraCopy(language);

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

  if (!user.isAnonymous && user.emailVerified !== true) {
    return (
      <ErrorBoundary language={language}>
        <Suspense fallback={<AppLoadingScreen variant="page" />}>
          <EmailVerificationGate
            key={`${user.uid}:${emailVerificationRefreshKey}`}
            user={user}
            language={language}
            onVerified={() => setEmailVerificationRefreshKey((current) => current + 1)}
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
          user={user}
          isSuperAdmin={isSuperAdmin}
          language={language}
          onLanguageChange={setLanguage}
        />
      </Suspense>
    </ErrorBoundary>
  );
}
