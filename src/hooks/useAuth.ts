import { useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../lib/firebase/auth';

interface AuthState {
  user: User | null;
  loading: boolean;
  isSuperAdmin: boolean;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const checkSuperAdminClaim = useCallback(async (u: User) => {
    // Force-refresh to pick up custom claims set after sign-in
    const token = await u.getIdTokenResult(false);
    setIsSuperAdmin(token.claims['superAdmin'] === true);
  }, []);

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
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const [claimResult, profileResult] = await Promise.allSettled([
          checkSuperAdminClaim(u),
          repairUserProfile(u),
        ]);
        if (claimResult.status === 'rejected') {
          console.error('Failed to read auth claims:', claimResult.reason);
          setIsSuperAdmin(false);
        }
        if (profileResult.status === 'rejected') {
          console.error('Failed to repair user profile:', profileResult.reason);
        }
      } else {
        setIsSuperAdmin(false);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, [checkSuperAdminClaim, repairUserProfile]);

  return { user, loading, isSuperAdmin };
}
