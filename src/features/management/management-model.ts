import type { MembershipStatus, Role } from '../../domain/church';
import { canManageTaxReceipts, isAdminOrPriestRole } from '../../domain/roles';
import type { FirestoreEvent } from '../../lib/db/events';
import type { FirestoreMember } from '../../lib/db/memberships';
import type { FirestoreNewsletter } from '../../lib/db/newsletters';
import type { ManagementTab } from './types';

const OPERATION_MANAGEMENT_TABS: readonly ManagementTab[] = [
  'dashboard',
  'members',
  'events',
  'eventPlatform',
  'posts',
  'newsletters',
  'notifications',
  'scanner',
];

export function isManagementTabAllowedForRole(tab: ManagementTab, role: Role): boolean {
  if (tab === 'receipts') {
    return canManageTaxReceipts(role);
  }

  return isAdminOrPriestRole(role) && OPERATION_MANAGEMENT_TABS.includes(tab);
}

export function getDefaultManagementTab(role: Role): ManagementTab {
  if (!isAdminOrPriestRole(role) && canManageTaxReceipts(role)) {
    return 'receipts';
  }

  return 'dashboard';
}

export function coerceManagementTabForRole(tab: ManagementTab, role: Role): ManagementTab {
  return isManagementTabAllowedForRole(tab, role) ? tab : getDefaultManagementTab(role);
}

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
