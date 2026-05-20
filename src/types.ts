import type { FieldValue, Timestamp } from 'firebase/firestore';
import { MembershipStatus, Role } from './domain/church';

export type { Screen } from './app/navigation';
export type {
  Church,
  ChurchDoc,
  ChurchSummary,
  ClergyMember,
  MembershipStatus,
  Role,
  ServiceScheduleEntry,
  SuperAdminChurchInput,
  SuperAdminChurchStats,
} from './domain/church';

export type Language =
  | 'English'
  | 'Srpski (Latinica)'
  | 'Srpski (Ćirilica)'
  | 'Русский'
  | 'Română'
  | 'Українська';

// Firestore document: users/{userId}
export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  preferredLanguage: Language;
  phone?: string;
  ministries?: string[];
  description?: string;
  showInDirectory?: boolean;
  fcmTokens: string[];
  createdAt: Timestamp | FieldValue;
}

// Firestore subcollection: users/{uid}/churchMemberships/{churchId}
// Also mirrored at: churches/{churchId}/members/{uid}
export interface ChurchMembership {
  churchId: string;
  churchName: string;
  imageURL: string;
  location: string;
  role: Role;
  status: MembershipStatus;
  joinedAt: Timestamp | FieldValue | null;
}
