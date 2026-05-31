import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/firestore';
import { ChurchMembership, MembershipStatus, Role } from '../../types';

const PUBLIC_DIRECTORY_LIMIT = 500;

export function subscribeToUserMemberships(
  uid: string,
  callback: (memberships: ChurchMembership[]) => void,
  onError?: (error: unknown) => void
): () => void {
  const ref = collection(db, 'users', uid, 'churchMemberships');
  return onSnapshot(
    ref,
    (snap) => {
      const memberships: ChurchMembership[] = snap.docs
        .filter((d) => {
          const data = d.data();
          return (data.status as MembershipStatus) === 'active' && data.churchActive !== false;
        })
        .map((d) => {
          const data = d.data();
          return {
            churchId: d.id,
            churchName: data.churchName ?? '',
            imageURL: data.imageURL ?? '',
            location: data.location ?? '',
            role: data.role as Role,
            status: data.status as MembershipStatus,
            churchActive: data.churchActive !== false,
            joinedAt: data.joinedAt,
          };
        });
      callback(memberships);
    },
    (error) => {
      onError?.(error);
    }
  );
}

export async function getUserRoleInChurch(uid: string, churchId: string): Promise<Role | null> {
  const ref = doc(db, 'churches', churchId, 'members', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data().role as Role;
}

// Use the `sendInvitation` Cloud Function instead of writing directly to Firestore.
// Direct writes bypass the invitation email and expiry.
export async function createPendingInvitation(
  _churchId: string,
  _churchName: string,
  _invitedByUid: string,
  _inviteeEmail: string
): Promise<string> {
  throw new Error(
    'createPendingInvitation is deprecated. Use the sendInvitation Cloud Function via the frontend API layer instead.'
  );
}

export interface FirestoreMember {
  id: string;
  displayName: string;
  email: string;
  photoURL: string;
  role: Role;
  status: MembershipStatus;
  joinedAt: string;
  invitedBy: string | null;
  baptismalName?: string;
  phone?: string;
  family?: string;
  ministry?: string;
  description?: string;
  showInDirectory?: boolean;
}

export function subscribeToChurchMembers(
  churchId: string,
  callback: (members: FirestoreMember[]) => void
): () => void {
  const ref = query(
    collection(db, 'churches', churchId, 'members'),
    where('status', '==', 'active'),
    where('showInDirectory', '==', true),
    limit(PUBLIC_DIRECTORY_LIMIT)
  );
  return onSnapshot(ref, (snap) => {
    callback(snap.docs.map(mapFirestoreMember));
  });
}

export function subscribeToAllChurchMembersForManagement(
  churchId: string,
  callback: (members: FirestoreMember[]) => void
): () => void {
  const ref = collection(db, 'churches', churchId, 'members');
  return onSnapshot(ref, (snap) => {
    callback(snap.docs.map(mapFirestoreMember));
  });
}

export function mapFirestoreMember(d: { id: string; data: () => Record<string, unknown> }): FirestoreMember {
  const data = d.data();
  return {
    id: d.id,
    displayName: typeof data.displayName === 'string' ? data.displayName : 'Unknown',
    email: typeof data.email === 'string' ? data.email : '',
    photoURL: typeof data.photoURL === 'string' ? data.photoURL : '',
    role: data.role as Role,
    status: data.status as MembershipStatus,
    joinedAt:
      data.joinedAt instanceof Timestamp
        ? data.joinedAt.toDate().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
        : '—',
    invitedBy: typeof data.invitedBy === 'string' ? data.invitedBy : null,
    baptismalName: typeof data.baptismalName === 'string' ? data.baptismalName : '',
    phone: typeof data.phone === 'string' ? data.phone : '',
    family: typeof data.family === 'string' ? data.family : '',
    ministry: typeof data.ministry === 'string' ? data.ministry : '',
    description: typeof data.description === 'string' ? data.description : '',
    showInDirectory: data.showInDirectory === true,
  };
}

export async function updateMemberRole(
  churchId: string,
  targetUserId: string,
  newRole: Role
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'churches', churchId, 'members', targetUserId), { role: newRole });
  batch.update(doc(db, 'users', targetUserId, 'churchMemberships', churchId), { role: newRole });
  await batch.commit();
}

export async function updateMemberStatus(
  churchId: string,
  targetUserId: string,
  newStatus: MembershipStatus
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'churches', churchId, 'members', targetUserId), { status: newStatus });
  batch.update(doc(db, 'users', targetUserId, 'churchMemberships', churchId), {
    status: newStatus,
  });
  await batch.commit();
}
