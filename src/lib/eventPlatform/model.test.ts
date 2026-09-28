import { describe, expect, it } from 'vitest';
import type { ChurchMembership } from '../../types';
import {
  EMPTY_EVENT_SETUP_CHECKLIST,
  eventSetupReadyForPublish,
  featuredEventsForMemberships,
  isEventFocusActive,
  validateEventTicketScan,
  type EventPortal,
} from './model';

function portal(overrides: Partial<EventPortal> = {}): EventPortal {
  const now = new Date('2026-06-01T12:00:00Z');
  return {
    id: 'event-1',
    organizationId: 'church-1',
    organizationType: 'church',
    churchId: 'church-1',
    title: 'Serbian Fest',
    slug: 'serbian-fest',
    status: 'published',
    startsAt: new Date('2026-06-01T10:00:00Z'),
    endsAt: new Date('2026-06-01T23:00:00Z'),
    venueName: 'Hall',
    venueAddress: '123 Main',
    heroImageURL: '',
    description: 'Food, music, and parish fellowship.',
    modules: ['tickets', 'schedule', 'foodDrink', 'campaigns', 'info'],
    focusEnabled: true,
    focusStartsAt: new Date(now.getTime() - 60_000),
    focusEndsAt: new Date(now.getTime() + 60_000),
    ticketsEnabled: true,
    gateScanningEnabled: true,
    reEntryEnabled: true,
    foodDrinkEnabled: true,
    foodOrderingEnabled: false,
    campaignsEnabled: true,
    setupChecklist: {
      basics: true,
      tickets: true,
      schedule: true,
      foodDrink: true,
      campaigns: true,
      staff: true,
      payments: true,
    },
    ...overrides,
  };
}

describe('event platform model', () => {
  it('treats only published in-window featured events as focus-active', () => {
    const now = new Date('2026-06-01T12:00:00Z');
    expect(isEventFocusActive(portal(), now)).toBe(true);
    expect(isEventFocusActive(portal({ status: 'draft' }), now)).toBe(false);
    expect(isEventFocusActive(portal({ focusEnabled: false }), now)).toBe(false);
    expect(isEventFocusActive(portal({ focusEndsAt: new Date('2026-06-01T11:00:00Z') }), now)).toBe(false);
  });

  it('returns focus events only for active assigned churches', () => {
    const memberships: ChurchMembership[] = [
      {
        churchId: 'church-1',
        churchName: 'A',
        imageURL: '',
        location: '',
        role: 'member',
        status: 'active',
        joinedAt: null,
      },
      {
        churchId: 'church-2',
        churchName: 'B',
        imageURL: '',
        location: '',
        role: 'member',
        status: 'suspended',
        joinedAt: null,
      },
    ];
    const result = featuredEventsForMemberships(
      [portal({ id: 'event-1', churchId: 'church-1' }), portal({ id: 'event-2', churchId: 'church-2' })],
      memberships,
      new Date('2026-06-01T12:00:00Z')
    );
    expect(result.map((event) => event.id)).toEqual(['event-1']);
  });

  it('blocks publish readiness until enabled modules and required operations are complete', () => {
    expect(eventSetupReadyForPublish(EMPTY_EVENT_SETUP_CHECKLIST, portal())).toBe(false);
    expect(eventSetupReadyForPublish(portal().setupChecklist, portal())).toBe(true);
    expect(eventSetupReadyForPublish({ ...portal().setupChecklist, foodDrink: false }, portal())).toBe(false);
    expect(eventSetupReadyForPublish({ ...portal().setupChecklist, foodDrink: false }, portal({ foodDrinkEnabled: false }))).toBe(true);
    expect(eventSetupReadyForPublish({ ...portal().setupChecklist, staff: false }, portal({ gateScanningEnabled: false }))).toBe(true);
    expect(eventSetupReadyForPublish({ ...portal().setupChecklist, staff: false }, portal({ foodOrderingEnabled: true }))).toBe(false);
    expect(eventSetupReadyForPublish(portal().setupChecklist, portal({ title: '' }))).toBe(false);
    expect(eventSetupReadyForPublish(portal().setupChecklist, portal({ endsAt: new Date('2026-06-01T09:00:00Z') }))).toBe(false);
  });

  it('validates ticket scans without trusting display codes alone', () => {
    expect(validateEventTicketScan({ eventId: 'event-1', code: 'ABC123' }, null).result).toBe('invalid');
    expect(validateEventTicketScan(
      { eventId: 'event-1', code: 'ABC123' },
      { eventId: 'event-2', ticketId: 'ticket-1', status: 'paid', scanCount: 0, reEntryEnabled: true, lastScanAt: null }
    ).result).toBe('wrong_event');
    expect(validateEventTicketScan(
      { eventId: 'event-1', code: 'ABC123' },
      { eventId: 'event-1', ticketId: 'ticket-1', status: 'paid', scanCount: 1, reEntryEnabled: true, lastScanAt: null }
    )).toEqual(expect.objectContaining({ result: 'reentry_accepted', requiresStaffConfirmation: true }));
  });
});
