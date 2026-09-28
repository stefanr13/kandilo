import { useState, useEffect, useCallback } from 'react';
import { onIdTokenChanged, type User } from 'firebase/auth';
import { auth } from '../lib/firebase/auth';

interface AuthState {
  user: User | null;
  loading: boolean;
  isSuperAdmin: boolean;
}

export function useAuth(): AuthState {
  const [{ user }, setAuthUser] = useState<{ user: User | null }>({ user: null });
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const repairUserProfile = useCallback(async (u: User) => {
    if (u.isAnonymous || !u.emailVerified) {
      return;
    }

    const { createOrUpdateUserProfile } = await import('../lib/db/profile');
    await createOrUpdateUserProfile(u.uid, {
      email: u.email ?? '',
      displayName: u.displayName ?? u.email ?? 'Guest',
      photoURL: u.photoURL ?? null,
    });
  }, []);

  useEffect(() => {
    let revision = 0;
    let currentUid: string | null = null;
    const unsubscribe = onIdTokenChanged(auth, async (u) => {
      const currentRevision = ++revision;
      setAuthUser({ user: u });
      if (currentUid !== (u?.uid ?? null)) setIsSuperAdmin(false);
      currentUid = u?.uid ?? null;
      if (u) {
        const [claimResult, profileResult] = await Promise.allSettled([
          u.getIdTokenResult(false),
          repairUserProfile(u),
        ]);
        if (currentRevision !== revision) return;
        if (claimResult.status === 'rejected') {
          console.error('Failed to read auth claims:', claimResult.reason);
          setIsSuperAdmin(false);
        } else {
          setIsSuperAdmin(claimResult.value.claims['superAdmin'] === true);
        }
        if (profileResult.status === 'rejected') {
          console.error('Failed to repair user profile:', profileResult.reason);
        }
      } else {
        setIsSuperAdmin(false);
      }
      setLoading(false);
    });
    return () => { revision++; unsubscribe(); };
  }, [repairUserProfile]);

  return { user, loading, isSuperAdmin };
}
