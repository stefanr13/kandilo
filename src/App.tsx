/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Suspense, lazy, useState } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import AppLoadingScreen from './components/app/AppLoadingScreen';
import { useAuth } from './hooks/useAuth';
import { usePendingInvitation } from './hooks/usePendingInvitation';
import { getExtraCopy } from './localization/extra';
import type { Language } from './types';

const AuthScreen = lazy(() => import('./components/AuthScreen'));
const InvitationAcceptScreen = lazy(() => import('./components/InvitationAcceptScreen'));
const AuthenticatedApp = lazy(() => import('./components/app/AuthenticatedApp'));

export default function App() {
  const { user, loading: authLoading, isSuperAdmin } = useAuth();
  const [language, setLanguage] = useState<Language>('English');
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
