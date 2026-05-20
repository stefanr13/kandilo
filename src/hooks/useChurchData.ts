import { useState, useEffect } from 'react';
import {
  subscribeToAllChurchMembersForManagement,
  subscribeToChurchEvents,
  subscribeToChurchNewslettersForManagement,
} from '../lib/db';
import type { FirestoreEvent } from '../lib/db/events';
import type { FirestoreMember } from '../lib/db/memberships';
import type { FirestoreNewsletter } from '../lib/db/newsletters';

interface ChurchData {
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

export function useChurchData(
  churchId: string | null,
  options: ChurchDataOptions = {}
): ChurchData {
  const membersEnabled = options.members ?? true;
  const eventsEnabled = options.events ?? true;
  const newslettersEnabled = options.newsletters ?? true;
  const [members, setMembers] = useState<FirestoreMember[]>([]);
  const [events, setEvents] = useState<FirestoreEvent[]>([]);
  const [newsletters, setNewsletters] = useState<FirestoreNewsletter[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [newslettersLoading, setNewslettersLoading] = useState(true);

  useEffect(() => {
    if (!churchId) {
      setMembers([]);
      setEvents([]);
      setNewsletters([]);
      setMembersLoading(false);
      setEventsLoading(false);
      setNewslettersLoading(false);
      return;
    }

    if (!membersEnabled) {
      setMembers([]);
      setMembersLoading(false);
    } else {
      setMembersLoading(true);
    }

    if (!eventsEnabled) {
      setEvents([]);
      setEventsLoading(false);
    } else {
      setEventsLoading(true);
    }

    if (!newslettersEnabled) {
      setNewsletters([]);
      setNewslettersLoading(false);
    } else {
      setNewslettersLoading(true);
    }

    const unsubMembers = membersEnabled
      ? subscribeToAllChurchMembersForManagement(churchId, (m) => {
          setMembers(m);
          setMembersLoading(false);
        })
      : undefined;

    const unsubEvents = eventsEnabled
      ? subscribeToChurchEvents(churchId, (e) => {
          setEvents(e);
          setEventsLoading(false);
        })
      : undefined;

    const unsubNewsletters = newslettersEnabled
      ? subscribeToChurchNewslettersForManagement(churchId, (n) => {
          setNewsletters(n);
          setNewslettersLoading(false);
        })
      : undefined;

    return () => {
      unsubMembers?.();
      unsubEvents?.();
      unsubNewsletters?.();
    };
  }, [churchId, membersEnabled, eventsEnabled, newslettersEnabled]);

  return { members, events, newsletters, membersLoading, eventsLoading, newslettersLoading };
}
