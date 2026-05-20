import { Suspense, lazy, type ReactElement } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import HomeScreen from '../HomeScreen';
import NoMembershipState from './NoMembershipState';
import AppLoadingScreen from './AppLoadingScreen';
import { FAITH_AI_ENABLED } from '../../config/features';
import { Event } from '../../data/events';
import type { FirestoreNewsletter } from '../../lib/db/newsletters';
import type { ChurchPost } from '../../lib/db/posts';
import { Church, ChurchMembership, Language, Role, Screen } from '../../types';

const CommunityView = lazy(() => import('../CommunityView'));
const FaithAIScreen = lazy(() => import('../FaithAIScreen'));
const FullCalendar = lazy(() => import('../FullCalendar'));
const GivingScreen = lazy(() => import('../GivingScreen'));
const ManagementView = lazy(() => import('../ManagementView'));
const ProfileScreen = lazy(() => import('../ProfileScreen'));
const ScheduleScreen = lazy(() => import('../ScheduleScreen'));
const MoreScreen = lazy(() => import('./MoreScreen'));

interface AppScreenContentProps {
  currentScreen: Screen;
  currentUser: FirebaseUser | null;
  language: Language;
  activeChurch: Church | null;
  activeChurchId: string | null;
  memberships: ChurchMembership[];
  isSuperAdmin: boolean;
  userRole: Role | null;
  events: Event[];
  churchPosts: ChurchPost[];
  newsletters: FirestoreNewsletter[];
  showSaintDays: boolean;
  selectedCalendarEvent: Event | null;
  onScreenChange: (screen: Screen) => void;
  onSelectEvent: (event: Event, sourceScreen: Screen) => void;
  onCloseEventDetail: () => void;
  onClearSelectedEvent: () => void;
  onLanguageChange: (language: Language) => void;
}

export default function AppScreenContent({
  currentScreen,
  currentUser,
  language,
  activeChurch,
  activeChurchId,
  memberships,
  isSuperAdmin,
  userRole,
  events,
  churchPosts,
  newsletters,
  showSaintDays,
  selectedCalendarEvent,
  onScreenChange,
  onSelectEvent,
  onCloseEventDetail,
  onClearSelectedEvent,
  onLanguageChange,
}: AppScreenContentProps) {
  const withLazyScreenFallback = (content: ReactElement) => (
    <Suspense fallback={<AppLoadingScreen variant="panel" />}>{content}</Suspense>
  );

  switch (currentScreen) {
    case 'giving':
      return withLazyScreenFallback(
        <GivingScreen
          onScreenChange={onScreenChange}
          language={language}
          activeChurch={activeChurch}
          activeChurchId={activeChurchId}
          currentUser={currentUser}
        />
      );
    case 'faith':
      if (!FAITH_AI_ENABLED) {
        return null;
      }
      return withLazyScreenFallback(<FaithAIScreen language={language} />);
    case 'events':
      return withLazyScreenFallback(
        <ScheduleScreen
          events={events}
          onShowFullCalendar={() => onScreenChange('calendar')}
          initialSelectedEvent={selectedCalendarEvent}
          onClearInitialEvent={onClearSelectedEvent}
          onCloseDetail={onCloseEventDetail}
          language={language}
        />
      );
    case 'calendar':
      return withLazyScreenFallback(
        <FullCalendar
          events={events}
          onClose={() => onScreenChange('events')}
          onSelectEvent={(event) => onSelectEvent(event, 'calendar')}
          language={language}
          showSaintDays={showSaintDays}
        />
      );
    case 'home':
      return activeChurch ? (
        <HomeScreen
          events={events}
          onSelectEvent={(event) => onSelectEvent(event, 'home')}
          language={language}
          activeChurch={activeChurch}
          churchPosts={churchPosts}
          newsletters={newsletters}
          showSaintDays={showSaintDays}
        />
      ) : (
        <NoMembershipState onOpenProfile={() => onScreenChange('profile')} language={language} />
      );
    case 'profile':
      return withLazyScreenFallback(
        <ProfileScreen
          onBack={() => onScreenChange('home')}
          language={language}
          onLanguageChange={onLanguageChange}
          user={currentUser}
          memberships={memberships}
          isSuperAdmin={isSuperAdmin}
          onOpenMissionControl={() => onScreenChange('superadmin')}
        />
      );
    case 'community':
      return withLazyScreenFallback(<CommunityView language={language} churchId={activeChurchId} />);
    case 'management':
      return activeChurchId ? (
        withLazyScreenFallback(
          <ManagementView
            churchId={activeChurchId}
            userRole={userRole ?? 'member'}
            currentUser={currentUser}
            language={language}
          />
        )
      ) : (
        <div className="flex-1 flex items-center justify-center p-8">
          <p className="text-gray-400 font-bold text-sm text-center">
            Membership is invitation-only. Ask a parish admin or priest to add you before using
            management tools.
          </p>
        </div>
      );
    case 'more':
      return withLazyScreenFallback(
        <MoreScreen
          onOpenProfile={() => onScreenChange('profile')}
          onOpenCommunity={() => onScreenChange('community')}
          language={language}
        />
      );
    default:
      return null;
  }
}
