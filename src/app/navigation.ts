import { useState } from 'react';
import { Event as CalendarEvent } from '../data/events';

export const APP_SCREENS = [
  'home',
  'events',
  'giving',
  'community',
  'faith',
  'more',
  'calendar',
  'profile',
  'management',
  'superadmin',
] as const;

export type Screen = (typeof APP_SCREENS)[number];

export const APP_URL_OPENED_EVENT = 'kandilo:app-url-opened';
export const APP_CUSTOM_SCHEME = 'kandilo';
export const APP_PRIMARY_WEB_HOST = 'app.kandilo.org';
const APP_FALLBACK_WEB_HOSTS = ['kandilo.app', 'kandilo-2f7a9.firebaseapp.com'];
const APP_WEB_HOSTS = new Set([APP_PRIMARY_WEB_HOST, ...APP_FALLBACK_WEB_HOSTS]);

export interface AppNavigationState {
  currentScreen: Screen;
  selectedCalendarEvent: CalendarEvent | null;
  eventSourceScreen: Screen | null;
}

export interface AppLocationSnapshot {
  pathname: string;
  search: string;
}

export const DEFAULT_SCREEN: Screen = 'home';

export function getInitialScreen(search = typeof window === 'undefined' ? '' : window.location.search): Screen {
  return getGivingCheckoutState(search) ? 'giving' : DEFAULT_SCREEN;
}

export function createInitialAppNavigationState(): AppNavigationState {
  return {
    currentScreen: getInitialScreen(),
    selectedCalendarEvent: null,
    eventSourceScreen: null,
  };
}

export function selectEventForScreen(
  state: AppNavigationState,
  event: CalendarEvent,
  sourceScreen: Screen
): AppNavigationState {
  return {
    ...state,
    currentScreen: 'events',
    selectedCalendarEvent: event,
    eventSourceScreen: sourceScreen,
  };
}

export function closeSelectedEvent(state: AppNavigationState): AppNavigationState {
  return {
    ...state,
    currentScreen: state.eventSourceScreen ?? state.currentScreen,
    selectedCalendarEvent: null,
    eventSourceScreen: null,
  };
}

export function parsePendingInvitationPath(pathname: string): string | null {
  const match = pathname.match(/^\/join\/([^/]+)$/);
  return match?.[1] ?? null;
}

export function getGivingCheckoutState(search: string): 'success' | 'cancel' | null {
  if (!search) {
    return null;
  }

  const checkoutState = new URLSearchParams(search).get('giving');
  return checkoutState === 'success' || checkoutState === 'cancel' ? checkoutState : null;
}

export function replaceWithRootPath(history: Pick<History, 'replaceState'> = window.history): void {
  history.replaceState({}, '', '/');
}

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '//') {
    return '/';
  }

  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

export function getCurrentAppLocationSnapshot(
  location: Pick<Location, 'pathname' | 'search'> = window.location
): AppLocationSnapshot {
  return {
    pathname: normalizePathname(location.pathname),
    search: location.search || '',
  };
}

export function parseExternalAppUrl(urlString: string): AppLocationSnapshot | null {
  try {
    const url = new URL(urlString);

    if (url.protocol === `${APP_CUSTOM_SCHEME}:`) {
      const hostPath = url.hostname && url.hostname !== 'app' ? `/${url.hostname}` : '';
      return {
        pathname: normalizePathname(`${hostPath}${url.pathname}`),
        search: url.search || '',
      };
    }

    if (url.protocol === 'https:' && APP_WEB_HOSTS.has(url.hostname)) {
      return {
        pathname: normalizePathname(url.pathname),
        search: url.search || '',
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function applyExternalAppUrlToHistory(
  urlString: string,
  history: Pick<History, 'replaceState'> = window.history
): AppLocationSnapshot | null {
  const snapshot = parseExternalAppUrl(urlString);
  if (!snapshot) {
    return null;
  }

  history.replaceState({}, '', `${snapshot.pathname}${snapshot.search}`);
  return snapshot;
}

export interface AppNavigationController extends AppNavigationState {
  setCurrentScreen: (screen: Screen) => void;
  handleSelectEvent: (event: CalendarEvent, sourceScreen: Screen) => void;
  handleCloseEventDetail: () => void;
  clearSelectedEvent: () => void;
}

export function useAppNavigation(): AppNavigationController {
  const [state, setState] = useState<AppNavigationState>(createInitialAppNavigationState);

  return {
    ...state,
    setCurrentScreen: (screen) => {
      setState((current) => ({
        ...current,
        currentScreen: screen,
      }));
    },
    handleSelectEvent: (event, sourceScreen) => {
      setState((current) => selectEventForScreen(current, event, sourceScreen));
    },
    handleCloseEventDetail: () => {
      setState((current) => closeSelectedEvent(current));
    },
    clearSelectedEvent: () => {
      setState((current) => ({
        ...current,
        selectedCalendarEvent: null,
      }));
    },
  };
}
