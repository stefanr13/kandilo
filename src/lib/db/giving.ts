import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/firestore';

export type GivingStatus = 'creating' | 'pending' | 'completed' | 'failed' | 'unknown';

export async function getGivingStatus(givingId: string): Promise<GivingStatus> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(givingId)) {
    return 'unknown';
  }

  const snap = await getDoc(doc(db, 'giving', givingId));
  if (!snap.exists()) {
    return 'unknown';
  }

  const status = snap.data().status;
  return status === 'creating' || status === 'pending' || status === 'completed' || status === 'failed'
    ? status
    : 'unknown';
}
