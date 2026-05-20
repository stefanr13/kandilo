import { Suspense, lazy, useEffect, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import type { User } from 'firebase/auth';
import { useAppNavigation } from '../../app/navigation';
import { useActiveChurchSelection } from '../../hooks/useActiveChurchSelection';
import { useChurches } from '../../hooks/useChurches';
import { useChurchNewsletters } from '../../hooks/useChurchNewsletters';
import { useEvents } from '../../hooks/useEvents';
import { usePublishedChurchPosts } from '../../hooks/usePublishedChurchPosts';
import { FAITH_AI_ENABLED } from '../../config/features';
import { subscribeToChurch } from '../../lib/db/churches';
import type { Language } from '../../types';
import AppLoadingScreen from './AppLoadingScreen';
import AppScreenContent from './AppScreenContent';
import AppShell from './AppShell';

const MissionControlScreen = lazy(() => import('../MissionControlScreen'));

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
    if (currentScreen === 'superadmin' && !isSuperAdmin) {
      setCurrentScreen('profile');
    }
  }, [currentScreen, isSuperAdmin, setCurrentScreen]);

  useEffect(() => {
    if (currentScreen === 'faith' && !FAITH_AI_ENABLED) {
      setCurrentScreen('home');
    }
  }, [currentScreen, setCurrentScreen]);

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
      {churchesLoading && churches.length === 0 ? (
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
            onScreenChange={setCurrentScreen}
            onSelectEvent={handleSelectEvent}
            onCloseEventDetail={handleCloseEventDetail}
            onClearSelectedEvent={clearSelectedEvent}
            onLanguageChange={onLanguageChange}
          />
        </AnimatePresence>
      )}
    </AppShell>
  );
}
