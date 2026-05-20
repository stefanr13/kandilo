import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  type QueryConstraint,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase/firestore';

const PUBLIC_EVENT_LOOKBACK_DAYS = 30;
const PUBLIC_EVENT_LOOKAHEAD_MONTHS = 18;
const PUBLIC_EVENT_LIMIT = 250;

export interface FirestoreEvent {
  id: string;
  churchId: string;
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  location: string;
  category: string;
  createdBy: string;
  notificationSent: boolean;
  commemoration?: string;
}

export function mapFirestoreEvent(d: { id: string; data: () => Record<string, unknown> }): FirestoreEvent {
  const data = d.data();
  return {
    id: d.id,
    churchId: typeof data.churchId === 'string' ? data.churchId : '',
    title: typeof data.title === 'string' ? data.title : '',
    description: typeof data.description === 'string' ? data.description : '',
    startTime:
      data.startTime instanceof Timestamp
        ? data.startTime.toDate()
        : new Date(),
    endTime:
      data.endTime instanceof Timestamp
        ? data.endTime.toDate()
        : new Date(),
    location: typeof data.location === 'string' ? data.location : '',
    category: typeof data.category === 'string' ? data.category : 'Divine Liturgy',
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
    notificationSent: data.notificationSent === true,
    commemoration: typeof data.commemoration === 'string' ? data.commemoration : undefined,
  };
}

export function subscribeToChurchEvents(
  churchId: string,
  callback: (events: FirestoreEvent[]) => void,
  options: { publicWindow?: boolean } = {}
): () => void {
  const constraints: QueryConstraint[] = [
    where('churchId', '==', churchId),
    ...(options.publicWindow
      ? [
          where(
            'startTime',
            '>=',
            Timestamp.fromDate(new Date(Date.now() - PUBLIC_EVENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000))
          ),
          where(
            'startTime',
            '<=',
            Timestamp.fromDate(
              new Date(new Date().setMonth(new Date().getMonth() + PUBLIC_EVENT_LOOKAHEAD_MONTHS))
            )
          ),
        ]
      : []),
    orderBy('startTime', 'asc'),
    ...(options.publicWindow ? [limit(PUBLIC_EVENT_LIMIT)] : []),
  ];

  const q = query(collection(db, 'events'), ...constraints);
  return onSnapshot(q, (snap) => {
    const events: FirestoreEvent[] = snap.docs.map(mapFirestoreEvent);
    callback(events);
  });
}

export async function createEvent(
  churchId: string,
  createdByUid: string,
  data: {
    title: string;
    description: string;
    startTime: Date;
    endTime: Date;
    location: string;
    category: string;
  }
): Promise<string> {
  const ref = await addDoc(collection(db, 'events'), {
    churchId,
    createdBy: createdByUid,
    ...data,
    startTime: Timestamp.fromDate(data.startTime),
    endTime: Timestamp.fromDate(data.endTime),
    notificationSent: false,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function deleteEvent(eventId: string): Promise<void> {
  await deleteDoc(doc(db, 'events', eventId));
}

export async function updateEvent(
  eventId: string,
  data: {
    title: string;
    description: string;
    startTime: Date;
    endTime: Date;
    location: string;
    category: string;
  }
): Promise<void> {
  await updateDoc(doc(db, 'events', eventId), {
    ...data,
    startTime: Timestamp.fromDate(data.startTime),
    endTime: Timestamp.fromDate(data.endTime),
    updatedAt: serverTimestamp(),
  });
}
