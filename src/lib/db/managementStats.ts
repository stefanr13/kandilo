import {
  collection,
  getCountFromServer,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import { db } from '../firebase/firestore';

export interface ChurchManagementStats {
  activeMemberCount: number;
  upcomingEventCount: number;
  sentNewsletterCount: number;
}

export async function getChurchManagementStats(churchId: string): Promise<ChurchManagementStats> {
  const now = Timestamp.fromDate(new Date());
  const activeMembersQuery = query(
    collection(db, 'churches', churchId, 'members'),
    where('status', '==', 'active')
  );
  const upcomingEventsQuery = query(
    collection(db, 'events'),
    where('churchId', '==', churchId),
    where('startTime', '>', now)
  );
  const publishedNewslettersQuery = query(
    collection(db, 'newsletters'),
    where('churchId', '==', churchId),
    where('status', '==', 'published')
  );

  const [membersSnap, eventsSnap, newslettersSnap] = await Promise.all([
    getCountFromServer(activeMembersQuery),
    getCountFromServer(upcomingEventsQuery),
    getCountFromServer(publishedNewslettersQuery),
  ]);

  return {
    activeMemberCount: membersSnap.data().count,
    upcomingEventCount: eventsSnap.data().count,
    sentNewsletterCount: newslettersSnap.data().count,
  };
}
