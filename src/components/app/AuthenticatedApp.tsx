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
import { subscribeToFeaturedEventPortalsForChurches } from '../../lib/db/eventPlatform';
import {
  parsePendingStripeConnectOnboardingState,
  PENDING_STRIPE_CONNECT_STORAGE_KEY,
  stripeConnectReturnMatchesPendingOnboarding,
} from '../../lib/stripe/connect';
import type { Language } from '../../types';
import AppLoadingScreen from './AppLoadingScreen';
import AppScreenContent from './AppScreenContent';
import AppShell from './AppShell';
import ChurchSelectionScreen from './ChurchSelectionScreen';
import EmailVerificationBanner from './EmailVerificationBanner';
import EventFocusChooser from '../events/EventFocusChooser';
import EventPortalScreen from '../events/EventPortalScreen';
import type { EventPortal } from '../../lib/eventPlatform/model';

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
  const { churches, memberships, loading: churchesLoading, getRoleInChurch } = useChurches(user.emailVerified && !user.isAnonymous ? user.uid : null);
  const {
    currentScreen,
    selectedCalendarEvent,
    setCurrentScreen,
    handleSelectEvent,
    handleCloseEventDetail,
    clearSelectedEvent,
  } = useAppNavigation();
  const { activeChurch, activeChurchId, setActiveChurch } = useActiveChurchSelection(churches, {
    autoSelectFirst: churches.length <= 1,
  });
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
  const { events, error: eventsError } = useEvents(needsEvents ? activeChurchId : null);
  const { posts: churchPosts, error: postsError } = usePublishedChurchPosts(needsHomeContent ? activeChurchId : null);
  const { newsletters, error: newslettersError } = useChurchNewsletters(needsHomeContent ? activeChurchId : null);

  // Subscribe to the active church document for feature flags (showSaintDays etc.)
  const [showSaintDays, setShowSaintDays] = useState(false);
  const [focusEvents, setFocusEvents] = useState<EventPortal[]>([]);
  const [selectedFocusEvent, setSelectedFocusEvent] = useState<EventPortal | null>(null);
  const [lastFocusEvent, setLastFocusEvent] = useState<EventPortal | null>(null);
  const [focusEventSkipped, setFocusEventSkipped] = useState(false);
  const previousFocusEventIds = useRef('');
  useEffect(() => {
    if (!activeChurchId || !needsChurchSettings) { setShowSaintDays(false); return; }
    return subscribeToChurch(activeChurchId, (church) => {
      setShowSaintDays(church?.showSaintDays ?? false);
    });
  }, [activeChurchId, needsChurchSettings]);

  useEffect(() => {
    const churchIds = memberships
      .filter((membership) => membership.status === 'active')
      .map((membership) => membership.churchId);
    return subscribeToFeaturedEventPortalsForChurches(
      churchIds,
      (events) => {
        setFocusEvents(events);
        const eventIds = events.map((event) => event.id).sort().join('|');
        setFocusEventSkipped((skipped) => {
          const changed = previousFocusEventIds.current !== '' && previousFocusEventIds.current !== eventIds;
          return events.length === 0 || changed ? false : skipped;
        });
        previousFocusEventIds.current = eventIds;
        setSelectedFocusEvent((current) => (
          current ? events.find((event) => event.id === current.id) ?? null : null
        ));
        setLastFocusEvent((current) => (
          current ? events.find((event) => event.id === current.id) ?? null : null
        ));
      },
      (error) => {
        console.error('Failed to load featured events:', error);
        setFocusEvents([]);
        setSelectedFocusEvent(null);
        setLastFocusEvent(null);
      }
    );
  }, [memberships]);

  useEffect(() => {
    if (focusEventSkipped || selectedFocusEvent || focusEvents.length !== 1) {
      return;
    }
    setSelectedFocusEvent(focusEvents[0]);
  }, [focusEventSkipped, focusEvents, selectedFocusEvent]);

  useEffect(() => {
    if (user.isAnonymous || !user.emailVerified) {
      return;
    }

    void import('../../lib/notifications').then(({ requestNotificationPermission }) =>
      requestNotificationPermission(user.uid, false)
    ).catch((error) => console.warn('Notification registration unavailable:', error));
  }, [user, user.uid, user.emailVerified, user.isAnonymous]);

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
  const shouldShowChurchSelection = !churchesLoading && churches.length > 1 && !activeChurchId;

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

  if (shouldShowChurchSelection) {
    return (
      <ChurchSelectionScreen
        churches={churches}
        language={language}
        onSelect={setActiveChurch}
      />
    );
  }

  if (selectedFocusEvent) {
    return (
      <EventPortalScreen
        slug={selectedFocusEvent.slug}
        showBackToChurch
        onBackToChurch={() => {
          setLastFocusEvent(selectedFocusEvent);
          setFocusEventSkipped(true);
          setSelectedFocusEvent(null);
        }}
      />
    );
  }

  if (!focusEventSkipped && focusEvents.length > 1) {
    return (
      <EventFocusChooser
        events={focusEvents}
        onChoose={(event) => {
          setLastFocusEvent(event);
          setSelectedFocusEvent(event);
        }}
        onSkip={() => setFocusEventSkipped(true)}
      />
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
      verificationBanner={
        !user.isAnonymous && user.emailVerified !== true
          ? <EmailVerificationBanner user={user} language={language} />
          : undefined
      }
      activeEventTitle={lastFocusEvent?.title ?? (focusEvents.length === 1 ? focusEvents[0]?.title : null)}
      onReturnToEvent={
        focusEvents.length > 0
          ? () => {
              const eventToOpen =
                (lastFocusEvent && focusEvents.find((event) => event.id === lastFocusEvent.id))
                ?? (focusEvents.length === 1 ? focusEvents[0] : null);
              if (eventToOpen) {
                setLastFocusEvent(eventToOpen);
                setSelectedFocusEvent(eventToOpen);
              }
              setFocusEventSkipped(false);
            }
          : undefined
      }
    >
      {(eventsError || postsError || newslettersError) && (
        <p role="alert" className="mx-6 mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{eventsError || postsError || newslettersError}</p>
      )}
      {(churchesLoading && churches.length === 0) || waitingForStripeConnectChurch ? (
        <AppLoadingScreen variant="panel" />
      ) : (
        <AnimatePresence mode="wait">
          <AppScreenContent
            key={activeChurchId}
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
