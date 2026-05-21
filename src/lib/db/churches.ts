import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/firestore';
import { ChurchSummary, mapChurchSummary } from '../../domain/church';

const DISCOVER_CHURCH_LIMIT = 100;

export async function listAllChurches(): Promise<ChurchSummary[]> {
  const snap = await getDocs(query(
    collection(db, 'churches'),
    where('isActive', '==', true),
    limit(DISCOVER_CHURCH_LIMIT)
  ));
  return snap.docs.map((snapshot) => mapChurchSummary(snapshot.id, snapshot.data()));
}

export async function getChurchById(churchId: string): Promise<ChurchSummary | null> {
  const snapshot = await getDoc(doc(db, 'churches', churchId));
  if (!snapshot.exists()) {
    return null;
  }

  return mapChurchSummary(snapshot.id, snapshot.data());
}

export async function joinChurch(
  uid: string,
  displayName: string,
  email: string,
  photoURL: string,
  church: ChurchSummary
): Promise<void> {
  const memberName = displayName.trim() || email;
  const batch = writeBatch(db);
  const joinedAt = serverTimestamp();

  batch.set(doc(db, 'churches', church.id, 'members', uid), {
    userId: uid,
    churchId: church.id,
    role: 'member',
    status: 'active',
    displayName: memberName,
    email,
    photoURL,
    joinedAt,
    showInDirectory: true,
  });
  batch.set(doc(db, 'users', uid, 'churchMemberships', church.id), {
    churchId: church.id,
    churchName: church.name,
    location: church.location,
    imageURL: church.imageURL,
    role: 'member',
    status: 'active',
    joinedAt,
  });

  await batch.commit();
}

/**
 * Subscribes to the church document and calls back with the full ChurchSummary
 * on every change. Returns an unsubscribe function.
 */
export function subscribeToChurch(
  churchId: string,
  onData: (church: ChurchSummary | null) => void
): () => void {
  return onSnapshot(doc(db, 'churches', churchId), (snap) => {
    onData(snap.exists() ? mapChurchSummary(snap.id, snap.data()) : null);
  });
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
