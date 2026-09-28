import {
  doc,
  getDoc,
  onSnapshot,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/firestore';
import { ChurchSummary, mapChurchSummary } from '../../domain/church';
import { listActiveChurches } from '../api/churches';

export async function listAllChurches(): Promise<ChurchSummary[]> {
  return listActiveChurches();
}

export async function getChurchById(churchId: string): Promise<ChurchSummary | null> {
  const snapshot = await getDoc(doc(db, 'churches', churchId));
  if (!snapshot.exists()) {
    return null;
  }

  return mapChurchSummary(snapshot.id, snapshot.data());
}

/**
 * Subscribes to the church document and calls back with the full ChurchSummary
 * on every change. Returns an unsubscribe function.
 */
export function subscribeToChurch(
  churchId: string,
  onData: (church: ChurchSummary | null) => void,
  onError?: (error: Error) => void
): () => void {
  return onSnapshot(doc(db, 'churches', churchId), (snap) => {
    onData(snap.exists() ? mapChurchSummary(snap.id, snap.data()) : null);
  }, onError);
}

/**
 * Toggles the showSaintDays feature flag on a church document.
 * Allowed by Firestore rules for: priest (via priestMayEditChurchMetadata) and
 * admin (via adminMayEditChurchSettings).
 */
export async function updateChurchShowSaintDays(
  churchId: string,
  value: boolean
): Promise<void> {
  await updateDoc(doc(db, 'churches', churchId), { showSaintDays: value });
}

export async function leaveChurch(uid: string, churchId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'churches', churchId, 'members', uid));
  batch.delete(doc(db, 'users', uid, 'churchMemberships', churchId));
  await batch.commit();
}
