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

const PUBLIC_POST_LIMIT = 20;

export interface ChurchPost {
  id: string;
  churchId: string;
  authorId: string;
  authorName: string;
  title: string;
  /** TipTap HTML output for rendering */
  contentHtml: string;
  /** TipTap JSON for re-editing */
  contentJSON: object;
  status: 'draft' | 'published';
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
}

type PostMutationInput = {
  title?: string;
  contentHtml?: string;
  contentJSON?: object;
  status?: 'draft' | 'published';
};

export function mapFirestorePost(
  d: { id: string; data: () => Record<string, unknown> },
  churchId: string,
  statusOverride?: ChurchPost['status']
): ChurchPost {
  const data = d.data();
  return {
    id: d.id,
    churchId: typeof data.churchId === 'string' ? data.churchId : churchId,
    authorId: typeof data.authorId === 'string' ? data.authorId : '',
    authorName: typeof data.authorName === 'string' ? data.authorName : '',
    title: typeof data.title === 'string' ? data.title : '',
    contentHtml: typeof data.contentHtml === 'string' ? data.contentHtml : '',
    contentJSON:
      typeof data.contentJSON === 'object' && data.contentJSON !== null
        ? data.contentJSON
        : {},
    status: statusOverride ?? (data.status === 'published' ? 'published' : 'draft'),
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date(),
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : new Date(),
    publishedAt: data.publishedAt instanceof Timestamp ? data.publishedAt.toDate() : null,
  };
}

export async function createPost(
  churchId: string,
  authorId: string,
  authorName: string,
  data: { title: string; contentHtml: string; contentJSON: object; status: 'draft' | 'published' }
): Promise<string> {
  const now = serverTimestamp();
  const ref = await addDoc(collection(db, 'churches', churchId, 'posts'), {
    churchId,
    authorId,
    authorName,
    ...data,
    createdAt: now,
    updatedAt: now,
    publishedAt: data.status === 'published' ? now : null,
  });
  return ref.id;
}

export async function updatePost(
  churchId: string,
  postId: string,
  data: PostMutationInput
): Promise<void> {
  const ref = doc(db, 'churches', churchId, 'posts', postId);
  const patch: PostMutationInput & {
    updatedAt: ReturnType<typeof serverTimestamp>;
    publishedAt?: ReturnType<typeof serverTimestamp>;
  } = {
    ...data,
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

export async function deletePost(churchId: string, postId: string): Promise<void> {
  await deleteDoc(doc(db, 'churches', churchId, 'posts', postId));
}

export function subscribeToPosts(
  churchId: string,
  callback: (posts: ChurchPost[]) => void
): () => void {
  const q = query(
    collection(db, 'churches', churchId, 'posts'),
    orderBy('createdAt', 'desc')
  );
  return onSnapshot(q, (snap) => {
    const posts: ChurchPost[] = snap.docs.map((d) => mapFirestorePost(d, churchId));
    callback(posts);
  });
}

export function subscribeToPublishedPosts(
  churchId: string,
  callback: (posts: ChurchPost[]) => void
): () => void {
  const q = query(
    collection(db, 'churches', churchId, 'posts'),
    where('status', '==', 'published'),
    orderBy('publishedAt', 'desc'),
    limit(PUBLIC_POST_LIMIT)
  );
  return onSnapshot(q, (snap) => {
    const posts: ChurchPost[] = snap.docs.map((d) => mapFirestorePost(d, churchId, 'published'));
    callback(posts);
  });
}
