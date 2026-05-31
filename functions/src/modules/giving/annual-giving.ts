import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../shared/firebase';
import {
  broadYearWindow,
  datePartsForReceipt,
  isFullyRefundedGiving,
} from './helpers';

export async function loadAnnualGivingDocs(
  churchId: string,
  userId: string,
  year: number,
  timezone: unknown
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const { start, end } = broadYearWindow(year);
  const snap = await db
    .collection('giving')
    .where('churchId', '==', churchId)
    .where('userId', '==', userId)
    .where('status', '==', 'completed')
    .where('completedAt', '>=', start)
    .where('completedAt', '<', end)
    .orderBy('completedAt', 'asc')
    .get();

  return snap.docs.filter((docSnap) => {
    const completedAt = docSnap.data().completedAt;
    return completedAt instanceof Timestamp && datePartsForReceipt(completedAt, timezone).year === year;
  });
}

export function validAnnualGivingFromSnaps(
  givingSnaps: FirebaseFirestore.DocumentSnapshot[],
  churchId: string,
  userId: string,
  year: number,
  timezone: unknown
): Array<{ snap: FirebaseFirestore.DocumentSnapshot; data: FirebaseFirestore.DocumentData }> {
  return givingSnaps
    .map((snap) => ({ snap, data: snap.data() ?? {} }))
    .filter(({ snap, data }) => {
      const completedAt = data.completedAt;
      return snap.exists
        && data.churchId === churchId
        && data.userId === userId
        && data.status === 'completed'
        && !isFullyRefundedGiving(data)
        && completedAt instanceof Timestamp
        && datePartsForReceipt(completedAt, timezone).year === year;
    });
}
