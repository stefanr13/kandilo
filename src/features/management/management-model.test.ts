import { describe, expect, it } from 'vitest';
import {
  countActiveMembers,
  countSentNewsletters,
  countUpcomingEvents,
  filterMembers,
  getNextMemberStatus,
} from './management-model';
import type { FirestoreEvent } from '../../lib/db/events';
import type { FirestoreMember } from '../../lib/db/memberships';
import type { FirestoreNewsletter } from '../../lib/db/newsletters';

const MEMBERS: FirestoreMember[] = [
  {
    id: 'member-1',
    email: 'ana@example.com',
    displayName: 'Ana Member',
    role: 'member',
    status: 'active',
    joinedAt: 'May 2026',
    invitedBy: null,
    photoURL: '',
    phone: '',
    ministry: '',
    description: '',
    showInDirectory: true,
  },
  {
    id: 'member-2',
    email: 'mark@example.com',
    displayName: 'Mark Admin',
    role: 'admin',
    status: 'suspended',
    joinedAt: 'May 2026',
    invitedBy: null,
    photoURL: '',
    phone: '',
    ministry: '',
    description: '',
    showInDirectory: true,
  },
];

function newsletter(id: string, status: FirestoreNewsletter['status'], emailSent: boolean): FirestoreNewsletter {
  return {
    id,
    churchId: 'church-1',
    title: id,
    content: 'Content',
    excerpt: 'Excerpt',
    status,
    publishedAt: status === 'published' ? new Date('2026-05-17T12:00:00Z') : null,
    createdBy: 'user-1',
    emailSent,
  };
}

describe('management model', () => {
  it('filters members and counts active memberships', () => {
    expect(filterMembers(MEMBERS, 'ana')).toEqual([MEMBERS[0]]);
    expect(countActiveMembers(MEMBERS)).toBe(1);
    expect(getNextMemberStatus('active')).toBe('suspended');
    expect(getNextMemberStatus('suspended')).toBe('active');
  });

  it('counts upcoming events against the provided clock', () => {
    const events = [
      { startTime: new Date('2026-05-18T10:00:00Z') },
      { startTime: new Date('2026-05-16T10:00:00Z') },
    ] as FirestoreEvent[];

    expect(countUpcomingEvents(events, new Date('2026-05-17T10:00:00Z'))).toBe(1);
  });

  it('counts published bulletins even when email delivery is still pending', () => {
    expect(countSentNewsletters([
      newsletter('draft', 'draft', false),
      newsletter('published-pending-email', 'published', false),
      newsletter('published-sent', 'published', true),
    ])).toBe(2);
  });
});
