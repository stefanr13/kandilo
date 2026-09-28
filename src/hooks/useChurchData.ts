import { useChurchSubscription } from './useChurchSubscription';
import {
  subscribeToAllChurchMembersForManagement,
  subscribeToChurchEvents,
  subscribeToChurchNewslettersForManagement,
} from '../lib/db';
import type { FirestoreEvent } from '../lib/db/events';
import type { FirestoreMember } from '../lib/db/memberships';
import type { FirestoreNewsletter } from '../lib/db/newsletters';

interface ChurchData {
  error: string;
  members: FirestoreMember[];
  events: FirestoreEvent[];
  newsletters: FirestoreNewsletter[];
  membersLoading: boolean;
  eventsLoading: boolean;
  newslettersLoading: boolean;
}

interface ChurchDataOptions {
  members?: boolean;
  events?: boolean;
  newsletters?: boolean;
}

const subscribeEvents = (churchId: string, next: (events: FirestoreEvent[]) => void, onError: (error: Error) => void) =>
  subscribeToChurchEvents(churchId, next, { onError });

export function useChurchData(churchId: string | null, options: ChurchDataOptions = {}): ChurchData {
  const members = useChurchSubscription(options.members === false ? null : churchId, subscribeToAllChurchMembersForManagement);
  const events = useChurchSubscription(options.events === false ? null : churchId, subscribeEvents);
  const newsletters = useChurchSubscription(options.newsletters === false ? null : churchId, subscribeToChurchNewslettersForManagement);
  return { members: members.data, events: events.data, newsletters: newsletters.data,
    membersLoading: members.loading, eventsLoading: events.loading, newslettersLoading: newsletters.loading,
    error: members.error || events.error || newsletters.error,
  };
}
