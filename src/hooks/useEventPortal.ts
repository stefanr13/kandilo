import { useEffect, useState } from 'react';
import { callFunction } from '../lib/api/client';
import {
  mapEventPortal, mapEventTicketTier, mapEventScheduleItem, mapEventPerformer,
  mapEventMenuItem, mapEventCampaign, mapEventAnnouncement,
} from '../lib/db/eventPlatform';
import type {
  EventPortal, EventTicketTier, EventScheduleItem, EventPerformer,
  EventMenuItem, EventCampaign, EventAnnouncement,
} from '../lib/eventPlatform/model';

export interface EventPortalData {
  portal: EventPortal | null;
  ticketTiers: EventTicketTier[];
  scheduleItems: EventScheduleItem[];
  performers: EventPerformer[];
  menuItems: EventMenuItem[];
  campaigns: EventCampaign[];
  announcements: EventAnnouncement[];
  loading: boolean;
  error: string;
}

const EMPTY: EventPortalData = {
  portal: null, ticketTiers: [], scheduleItems: [], performers: [],
  menuItems: [], campaigns: [], announcements: [], loading: true, error: '',
};
type PublicRow = Record<string, unknown> & { id: string };
type PublicContent = { portal: PublicRow | null } & Partial<Record<
  'ticketTiers' | 'scheduleItems' | 'performers' | 'menuItems' | 'campaigns' | 'announcements', PublicRow[]>>;
const snapshot = (data: PublicRow) => ({ id: data.id, data: () => data });

export function useEventPortal(slug: string | null): EventPortalData {
  const [state, setState] = useState({ slug, data: EMPTY });
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    setState({ slug, data: EMPTY });
    const refresh = async () => {
      try {
        if (!slug) throw new Error('Event link is not valid.');
        const content = await callFunction<{ eventId: string }, PublicContent>('getPublicEventContent', { eventId: slug });
        const data: EventPortalData = {
          portal: content.portal ? mapEventPortal(snapshot(content.portal)) : null,
          ticketTiers: (content.ticketTiers ?? []).map((row) => mapEventTicketTier(snapshot(row))).sort((a, b) => a.priceCents - b.priceCents),
          scheduleItems: (content.scheduleItems ?? []).map((row) => mapEventScheduleItem(snapshot(row))).sort((a, b) => a.startTime.getTime() - b.startTime.getTime()),
          performers: (content.performers ?? []).map((row) => mapEventPerformer(snapshot(row))),
          menuItems: (content.menuItems ?? []).map((row) => mapEventMenuItem(snapshot(row))).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
          campaigns: (content.campaigns ?? []).map((row) => mapEventCampaign(snapshot(row))),
          announcements: (content.announcements ?? []).map((row) => mapEventAnnouncement(snapshot(row))),
          loading: false, error: '',
        };
        if (!stopped) setState({ slug, data });
      } catch (error) {
        console.error('Failed to load public event:', error);
        if (!stopped) setState({ slug, data: { ...EMPTY, loading: false, error: 'Unable to load this event right now. Please try again.' } });
      } finally {
        if (!stopped && slug) timer = setTimeout(refresh, 30_000);
      }
    };
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [slug]);
  return state.slug === slug ? state.data : EMPTY;
}
