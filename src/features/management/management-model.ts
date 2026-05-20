import { MembershipStatus } from '../../domain/church';
import { FirestoreEvent } from '../../lib/db/events';
import { FirestoreMember } from '../../lib/db/memberships';
import { FirestoreNewsletter } from '../../lib/db/newsletters';

export function filterMembers(
  members: FirestoreMember[],
  searchQuery: string
): FirestoreMember[] {
  const query = searchQuery.trim().toLowerCase();
  if (!query) {
    return members;
  }

  return members.filter(
    (member) =>
      member.displayName.toLowerCase().includes(query) ||
      member.email.toLowerCase().includes(query)
  );
}

export function countActiveMembers(members: FirestoreMember[]): number {
  return members.filter((member) => member.status === 'active').length;
}

export function countUpcomingEvents(
  events: FirestoreEvent[],
  now: Date = new Date()
): number {
  return events.filter((event) => event.startTime > now).length;
}

export function countSentNewsletters(newsletters: FirestoreNewsletter[]): number {
  return newsletters.filter((newsletter) => newsletter.status === 'published').length;
}

export function getNextMemberStatus(
  status: MembershipStatus
): Extract<MembershipStatus, 'active' | 'suspended'> {
  return status === 'suspended' ? 'active' : 'suspended';
}
