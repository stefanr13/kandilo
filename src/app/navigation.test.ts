import { describe, expect, it } from 'vitest';
import {
  closeSelectedEvent,
  applyExternalAppUrlToHistory,
  createInitialAppNavigationState,
  getCurrentAppLocationSnapshot,
  getGivingCheckoutState,
  getInitialScreen,
  parseExternalAppUrl,
  parsePendingInvitationPath,
  selectEventForScreen,
} from './navigation';
import { Event } from '../data/events';

const EVENT: Event = {
  id: 1,
  date: '16',
  month: 'OCT',
  title: 'Divine Liturgy',
  time: '09:00 AM',
  endTime: '11:00 AM',
  location: 'Main Sanctuary',
  description: 'Sunday liturgy',
  attendees: 120,
  hasLimitedSpots: false,
  category: 'Divine Liturgy',
  city: 'Parish',
  price: 0,
  color: '#800000',
};

describe('app navigation', () => {
  it('opens the giving screen when returning from checkout', () => {
    expect(getInitialScreen('?giving=success')).toBe('giving');
    expect(getInitialScreen('?giving=cancel')).toBe('giving');
    expect(getGivingCheckoutState('?giving=failed')).toBeNull();
    expect(getGivingCheckoutState('?churchId=church-1')).toBeNull();
    expect(createInitialAppNavigationState().currentScreen).toBe('home');
  });

  it('parses invitation paths only when they match the expected route', () => {
    expect(parsePendingInvitationPath('/join/invite-123')).toBe('invite-123');
    expect(parsePendingInvitationPath('/join/invite-123/extra')).toBeNull();
    expect(parsePendingInvitationPath('/join/')).toBeNull();
    expect(parsePendingInvitationPath('/profile')).toBeNull();
  });

  it('normalizes current location snapshots for browser routing', () => {
    expect(getCurrentAppLocationSnapshot({ pathname: 'join/invite-123', search: '?x=1' })).toEqual({
      pathname: '/join/invite-123',
      search: '?x=1',
    });
    expect(getCurrentAppLocationSnapshot({ pathname: '', search: '' })).toEqual({
      pathname: '/',
      search: '',
    });
  });

  it('accepts only known app deep link and web hosts', () => {
    expect(parseExternalAppUrl('kandilo://join/invite-123?source=email')).toEqual({
      pathname: '/join/invite-123',
      search: '?source=email',
    });
    expect(parseExternalAppUrl('kandilo://app/?giving=success')).toEqual({
      pathname: '/',
      search: '?giving=success',
    });
    expect(parseExternalAppUrl('https://app.kandilo.org/join/invite-123')).toEqual({
      pathname: '/join/invite-123',
      search: '',
    });
    expect(parseExternalAppUrl('https://kandilo-2f7a9.firebaseapp.com/?giving=cancel')).toEqual({
      pathname: '/',
      search: '?giving=cancel',
    });
    expect(parseExternalAppUrl('http://app.kandilo.org/join/invite-123')).toBeNull();
    expect(parseExternalAppUrl('https://example.com/join/invite-123')).toBeNull();
    expect(parseExternalAppUrl('not-a-url')).toBeNull();
  });

  it('applies accepted external URLs to history', () => {
    const replaceStateCalls: unknown[][] = [];
    const history: Pick<History, 'replaceState'> = {
      replaceState: (data: unknown, unused: string, url?: string | URL | null) => {
        replaceStateCalls.push([data, unused, url]);
      },
    };

    expect(applyExternalAppUrlToHistory('https://app.kandilo.org/?giving=success', history)).toEqual({
      pathname: '/',
      search: '?giving=success',
    });
    expect(replaceStateCalls).toEqual([[{}, '', '/?giving=success']]);
    expect(applyExternalAppUrlToHistory('https://example.com/?giving=success', history)).toBeNull();
    expect(replaceStateCalls).toHaveLength(1);
  });

  it('tracks event selection and returns to the source screen when closed', () => {
    const selectedState = selectEventForScreen(createInitialAppNavigationState(), EVENT, 'home');

    expect(selectedState.currentScreen).toBe('events');
    expect(selectedState.eventSourceScreen).toBe('home');
    expect(selectedState.selectedCalendarEvent).toEqual(EVENT);

    const closedState = closeSelectedEvent(selectedState);
    expect(closedState.currentScreen).toBe('home');
    expect(closedState.selectedCalendarEvent).toBeNull();
    expect(closedState.eventSourceScreen).toBeNull();
  });
});
