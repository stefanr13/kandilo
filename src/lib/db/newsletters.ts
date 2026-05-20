import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase/firestore';

const PUBLIC_NEWSLETTER_LIMIT = 20;

export type NewsletterStatus = 'draft' | 'published';

export interface FirestoreNewsletter {
  id: string;
  churchId: string;
  title: string;
  content: string;
  excerpt: string;
  status: NewsletterStatus;
  publishedAt: Date | null;
  createdBy: string;
  emailSent: boolean;
}

type NewsletterMutationInput = {
  title: string;
  content: string;
  excerpt: string;
  status: NewsletterStatus;
};

export async function createNewsletter(
  churchId: string,
  createdBy: string,
  data: NewsletterMutationInput
): Promise<string> {
  const now = serverTimestamp();
  const ref = await addDoc(collection(db, 'newsletters'), {
    churchId,
    title: data.title,
    content: data.content,
    excerpt: data.excerpt,
    status: data.status === 'published' ? 'draft' : data.status,
    publishedAt: null,
    createdBy,
    emailSent: false,
    createdAt: now,
    updatedAt: now,
  });

  if (data.status === 'published') {
    await updateDoc(ref, {
      status: 'published',
      publishedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  return ref.id;
}

export async function updateNewsletter(
  newsletterId: string,
  data: NewsletterMutationInput
): Promise<void> {
  const ref = doc(db, 'newsletters', newsletterId);
  const patch: Partial<NewsletterMutationInput> & {
    updatedAt: ReturnType<typeof serverTimestamp>;
    publishedAt?: ReturnType<typeof serverTimestamp>;
  } = {
    title: data.title,
    content: data.content,
    excerpt: data.excerpt,
    status: data.status,
    updatedAt: serverTimestamp(),
  };

  if (data.status === 'published') {
    const snap = await getDoc(ref);
    if (!snap.data()?.publishedAt) {
      patch.publishedAt = serverTimestamp();
    }
  }

  await updateDoc(ref, patch);
}

export async function deleteNewsletter(newsletterId: string): Promise<void> {
  await deleteDoc(doc(db, 'newsletters', newsletterId));
}

export function subscribeToChurchNewsletters(
  churchId: string,
  callback: (newsletters: FirestoreNewsletter[]) => void
): () => void {
  const q = query(
    collection(db, 'newsletters'),
    where('churchId', '==', churchId),
    where('status', '==', 'published'),
    orderBy('createdAt', 'desc'),
    limit(PUBLIC_NEWSLETTER_LIMIT)
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(mapFirestoreNewsletter));
  });
}

export function subscribeToChurchNewslettersForManagement(
  churchId: string,
  callback: (newsletters: FirestoreNewsletter[]) => void
): () => void {
  const q = query(
    collection(db, 'newsletters'),
    where('churchId', '==', churchId),
    orderBy('createdAt', 'desc')
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(mapFirestoreNewsletter));
  });
}

export function mapFirestoreNewsletter(d: { id: string; data: () => Record<string, unknown> }): FirestoreNewsletter {
  const data = d.data();
  return {
    id: d.id,
    churchId: typeof data.churchId === 'string' ? data.churchId : '',
    title: typeof data.title === 'string' ? data.title : '',
    content: typeof data.content === 'string' ? data.content : '',
    excerpt: typeof data.excerpt === 'string' ? data.excerpt : '',
    status: data.status === 'published' ? 'published' : 'draft',
    publishedAt:
      data.publishedAt instanceof Timestamp
        ? data.publishedAt.toDate()
        : null,
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
    emailSent: data.emailSent === true,
  };
}
