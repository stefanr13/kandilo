import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase/storage';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function randomSuffix(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function extensionForType(contentType: string): string {
  switch (contentType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'bin';
  }
}

export async function uploadUserAvatar(uid: string, file: File): Promise<{ url: string; path: string }> {
  if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
    throw new Error('Profile photos must be JPG, PNG, or WebP images.');
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error('Profile photos must be smaller than 5 MB.');
  }

  const ext = extensionForType(file.type);
  const path = `users/${uid}/avatar/avatar-${randomSuffix()}.${ext}`;
  const avatarRef = ref(storage, path);

  await uploadBytes(avatarRef, file, {
    contentType: file.type,
    customMetadata: { ownerUid: uid },
  });

  return {
    url: await getDownloadURL(avatarRef),
    path,
  };
}
