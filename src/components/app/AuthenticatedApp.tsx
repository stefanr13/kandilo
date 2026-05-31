import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import type { User } from 'firebase/auth';
import {
  APP_URL_OPENED_EVENT,
  getCurrentAppLocationSnapshot,
  getStripeConnectReturnState,
  replaceWithRootPath,
  useAppNavigation,
  type AppLocationSnapshot,
  type StripeConnectReturnState,
} from '../../app/navigation';
import { useActiveChurchSelection } from '../../hooks/useActiveChurchSelection';
import { useChurches } from '../../hooks/useChurches';
import { useChurchNewsletters } from '../../hooks/useChurchNewsletters';
import { useEvents } from '../../hooks/useEvents';
import { usePublishedChurchPosts } from '../../hooks/usePublishedChurchPosts';
import { FAITH_AI_ENABLED } from '../../config/features';
import { subscribeToChurch } from '../../lib/db/churches';
import {
  parsePendingStripeConnectOnboardingState,
  PENDING_STRIPE_CONNECT_STORAGE_KEY,
  stripeConnectReturnMatchesPendingOnboarding,
} from '../../lib/stripe/connect';
import type { Language } from '../../types';
import AppLoadingScreen from './AppLoadingScreen';
import AppScreenContent from './AppScreenContent';
import AppShell from './AppShell';

const MissionControlScreen = lazy(() => import('../MissionControlScreen'));

interface StripeConnectReturnSignal extends StripeConnectReturnState {
  sequence: number;
}

function createStripeConnectReturnSignal(
  search: string,
  sequence: number
): StripeConnectReturnSignal | null {
  const state = getStripeConnectReturnState(search);
  if (!state || typeof window === 'undefined') {
    return null;
  }

  const pending = parsePendingStripeConnectOnboardingState(
    window.sessionStorage.getItem(PENDING_STRIPE_CONNECT_STORAGE_KEY)
  );
  return stripeConnectReturnMatchesPendingOnboarding(pending, state.churchId, state.returnState)
    ? { ...state, sequence }
    : null;
}

interface AuthenticatedAppProps {
  user: User;
  isSuperAdmin: boolean;
  language: Language;
  onLanguageChange: (language: Language) => void;
}

export default function AuthenticatedApp({
  user,
  isSuperAdmin,
  language,
  onLanguageChange,
}: AuthenticatedAppProps) {
  const { churches, memberships, loading: churchesLoading, getRoleInChurch } = useChurches(user.uid);
  const {
    currentScreen,
    selectedCalendarEvent,
    setCurrentScreen,
    handleSelectEvent,
    handleCloseEventDetail,
    clearSelectedEvent,
  } = useAppNavigation();
  const { activeChurch, activeChurchId, setActiveChurch } = useActiveChurchSelection(churches);
  const userRole = activeChurchId ? getRoleInChurch(activeChurchId) : null;
  const [stripeConnectReturnSignal, setStripeConnectReturnSignal] =
    useState<StripeConnectReturnSignal | null>(() => {
      if (typeof window === 'undefined') {
        return null;
      }

      return createStripeConnectReturnSignal(window.location.search, 0);
    });
  const routedStripeConnectReturnSequence = useRef<number | null>(null);
  const initialManagementTab = stripeConnectReturnSignal ? 'receipts' : null;
  const needsEvents = currentScreen === 'home' || currentScreen === 'events' || currentScreen === 'calendar';
  const needsHomeContent = currentScreen === 'home';
  const needsChurchSettings = currentScreen === 'home' || currentScreen === 'calendar';
  const { events } = useEvents(needsEvents ? activeChurchId : null);
  const { posts: churchPosts } = usePublishedChurchPosts(needsHomeContent ? activeChurchId : null);
  const { newsletters } = useChurchNewsletters(needsHomeContent ? activeChurchId : null);

  // Subscribe to the active church document for feature flags (showSaintDays etc.)
  const [showSaintDays, setShowSaintDays] = useState(false);
  useEffect(() => {
    if (!activeChurchId || !needsChurchSettings) { setShowSaintDays(false); return; }
    return subscribeToChurch(activeChurchId, (church) => {
      setShowSaintDays(church?.showSaintDays ?? false);
    });
  }, [activeChurchId, needsChurchSettings]);

  useEffect(() => {
    if (user.isAnonymous || !user.emailVerified) {
      return;
    }

    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      void import('../../lib/notifications').then(({ requestNotificationPermission }) =>
        requestNotificationPermission(user.uid)
      );
    }
  }, [user]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const syncStripeConnectReturn = (snapshot: AppLocationSnapshot) => {
      setStripeConnectReturnSignal((current) => (
        createStripeConnectReturnSignal(snapshot.search, (current?.sequence ?? 0) + 1)
      ));
    };

    const handlePopState = () => {
      syncStripeConnectReturn(getCurrentAppLocationSnapshot(window.location));
    };

    const handleNativeUrl = (event: Event) => {
      syncStripeConnectReturn((event as CustomEvent<AppLocationSnapshot>).detail);
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener(APP_URL_OPENED_EVENT, handleNativeUrl as EventListener);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener(APP_URL_OPENED_EVENT, handleNativeUrl as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || stripeConnectReturnSignal) {
      return;
    }

    if (getStripeConnectReturnState(window.location.search)) {
      replaceWithRootPath(window.history);
      setCurrentScreen('home');
    }
  }, [setCurrentScreen, stripeConnectReturnSignal]);

  useEffect(() => {
    if (!stripeConnectReturnSignal) {
      return;
    }

    if (routedStripeConnectReturnSequence.current === stripeConnectReturnSignal.sequence) {
      return;
    }

    if (churchesLoading && churches.length === 0) {
      return;
    }

    const returnedChurch = churches.find((church) => church.id === stripeConnectReturnSignal.churchId);
    if (returnedChurch && activeChurchId !== returnedChurch.id) {
      setActiveChurch(returnedChurch);
    }

    routedStripeConnectReturnSequence.current = stripeConnectReturnSignal.sequence;
    setCurrentScreen('management');

    if (typeof window !== 'undefined') {
      replaceWithRootPath(window.history);
    }
  }, [
    activeChurchId,
    churches,
    churchesLoading,
    setActiveChurch,
    setCurrentScreen,
    stripeConnectReturnSignal,
  ]);

  useEffect(() => {
    if (currentScreen === 'superadmin' && !isSuperAdmin) {
      setCurrentScreen('profile');
    }
  }, [currentScreen, isSuperAdmin, setCurrentScreen]);

  useEffect(() => {
    if (currentScreen === 'faith' && !FAITH_AI_ENABLED) {
      setCurrentScreen('home');
    }
  }, [currentScreen, setCurrentScreen]);

  const handleStripeConnectReturnConsumed = useCallback(() => {
    setStripeConnectReturnSignal(null);
  }, []);

  const waitingForStripeConnectChurch = Boolean(
    stripeConnectReturnSignal
    && churches.some((church) => church.id === stripeConnectReturnSignal.churchId)
    && activeChurchId !== stripeConnectReturnSignal.churchId
  );

  if (currentScreen === 'superadmin') {
    if (!isSuperAdmin) {
      return null;
    }
    return (
      <Suspense fallback={<AppLoadingScreen variant="page" />}>
        <MissionControlScreen onBack={() => setCurrentScreen('profile')} currentUser={user} />
      </Suspense>
    );
  }

  return (
    <AppShell
      currentScreen={currentScreen}
      onScreenChange={setCurrentScreen}
      language={language}
      userRole={userRole}
      churches={churches}
      activeChurch={activeChurch}
      onChurchChange={setActiveChurch}
    >
      {(churchesLoading && churches.length === 0) || waitingForStripeConnectChurch ? (
        <AppLoadingScreen variant="panel" />
      ) : (
        <AnimatePresence mode="wait">
          <AppScreenContent
            currentScreen={currentScreen}
            currentUser={user}
            language={language}
            activeChurch={activeChurch}
            activeChurchId={activeChurchId}
            memberships={memberships}
            isSuperAdmin={isSuperAdmin}
            userRole={userRole}
            events={events}
            churchPosts={churchPosts}
            newsletters={newsletters}
            showSaintDays={showSaintDays}
            selectedCalendarEvent={selectedCalendarEvent}
            initialManagementTab={initialManagementTab}
            stripeConnectReturnStatus={stripeConnectReturnSignal?.status ?? null}
            stripeConnectReturnSequence={stripeConnectReturnSignal?.sequence ?? null}
            onScreenChange={setCurrentScreen}
            onSelectEvent={handleSelectEvent}
            onCloseEventDetail={handleCloseEventDetail}
            onClearSelectedEvent={clearSelectedEvent}
            onLanguageChange={onLanguageChange}
            onStripeConnectReturnConsumed={handleStripeConnectReturnConsumed}
          />
        </AnimatePresence>
      )}
    </AppShell>
  );
}
