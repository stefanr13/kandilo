import {
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  collection,
} from 'firebase/firestore';
import { db } from '../firebase/firestore';

export interface EventCheckIn {
  id: string;
  churchId: string;
  eventId: string;
  userId: string;
  memberName: string;
  memberEmail: string;
  checkedInBy: string;
  checkedInAt: Date;
}

export function eventCheckInId(eventId: string, userId: string): string {
  return `${eventId}_${userId}`;
}

export function subscribeToEventCheckIns(
  churchId: string,
  eventId: string,
  callback: (checkIns: EventCheckIn[]) => void,
  onError?: (error: Error) => void
): () => void {
  const q = query(
    collection(db, 'eventCheckIns'),
    where('churchId', '==', churchId),
    where('eventId', '==', eventId),
    orderBy('checkedInAt', 'desc')
  );

  return onSnapshot(
    q,
    (snap) => {
      callback(
        snap.docs.map((snapshot) => {
          const data = snapshot.data();
          return {
            id: snapshot.id,
            churchId: data.churchId ?? churchId,
            eventId: data.eventId ?? eventId,
            userId: data.userId ?? '',
            memberName: data.memberName ?? '',
            memberEmail: data.memberEmail ?? '',
            checkedInBy: data.checkedInBy ?? '',
            checkedInAt: data.checkedInAt instanceof Timestamp ? data.checkedInAt.toDate() : new Date(),
          };
        })
      );
    },
    onError
  );
}

export async function createEventCheckIn(input: {
  churchId: string;
  eventId: string;
  userId: string;
  memberName: string;
  memberEmail: string;
  checkedInBy: string;
}): Promise<void> {
  const id = eventCheckInId(input.eventId, input.userId);
  await setDoc(doc(db, 'eventCheckIns', id), {
    ...input,
    checkedInAt: serverTimestamp(),
  });
}

export async function removeEventCheckIn(eventId: string, userId: string): Promise<void> {
  await deleteDoc(doc(db, 'eventCheckIns', eventCheckInId(eventId, userId)));
}
