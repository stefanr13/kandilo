import { useState, useEffect } from 'react';
import { subscribeToChurchEvents, type FirestoreEvent } from '../lib/db/events';
import { Event, Category } from '../data/events';

const CATEGORY_COLORS: Record<string, string> = {
  'Divine Liturgy': '#800000',
  'Vespers & Vigil': '#111827',
  'Feast Day': '#D97706',
  'Ministry & Education': '#937022',
  'Community & Social': '#4B5563',
  'Sacramental': '#6366F1',
};

// Deterministic numeric hash of a Firestore string ID, used as picsum seed
function stableNumericId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function firestoreEventToUIEvent(e: FirestoreEvent): Event {
  const start = e.startTime;
  const end = e.endTime;

  const pad = (n: number) => String(n).padStart(2, '0');
  const formatTime = (d: Date) => {
    const h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${pad(h12)}:${pad(m)} ${ampm}`;
  };

  const monthShort = start
    .toLocaleString('en-US', { month: 'short' })
    .toUpperCase();

  return {
    id: stableNumericId(e.id),
    date: String(start.getDate()),
    month: monthShort,
    year: start.getFullYear(),
    sortTime: start.getTime(),
    title: e.title,
    time: formatTime(start),
    endTime: formatTime(end),
    location: e.location,
    description: e.description,
    attendees: 0,
    hasLimitedSpots: false,
    category: e.category as Category,
    city: 'Parish',
    price: 0,
    color: CATEGORY_COLORS[e.category] ?? '#800000',
    commemoration: e.commemoration,
  };
}

export function useEvents(churchId: string | null): { events: Event[]; loading: boolean } {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!churchId) {
      setEvents([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsub = subscribeToChurchEvents(
      churchId,
      (firestoreEvents) => {
        setEvents(firestoreEvents.map(firestoreEventToUIEvent));
        setLoading(false);
      },
      { publicWindow: true }
    );

    return unsub;
  }, [churchId]);

  return { events, loading };
}
