import { useState, useEffect } from 'react';
import { subscribeToUserMemberships } from '../lib/db/memberships';
import { toChurch } from '../domain/church';
import { Church, ChurchMembership, Role } from '../types';

interface UseChurchesResult {
  memberships: ChurchMembership[];
  churches: Church[];
  loading: boolean;
  getRoleInChurch: (churchId: string) => Role | null;
}

export function useChurches(uid: string | null | undefined): UseChurchesResult {
  const [memberships, setMemberships] = useState<ChurchMembership[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setMemberships([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsub = subscribeToUserMemberships(uid, (ms) => {
      setMemberships(ms);
      setLoading(false);
    });
    return unsub;
  }, [uid]);

  const churches: Church[] = memberships.map((membership) =>
    toChurch({
      id: membership.churchId,
      name: membership.churchName,
      location: membership.location,
      imageURL: membership.imageURL,
    })
  );

  const getRoleInChurch = (churchId: string): Role | null => {
    return memberships.find((m) => m.churchId === churchId)?.role ?? null;
  };

  return { memberships, churches, loading, getRoleInChurch };
}
