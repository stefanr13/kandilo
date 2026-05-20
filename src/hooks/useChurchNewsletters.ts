import { useEffect, useState } from 'react';
import { subscribeToChurchNewsletters, type FirestoreNewsletter } from '../lib/db/newsletters';

export function useChurchNewsletters(churchId: string | null): {
  newsletters: FirestoreNewsletter[];
  loading: boolean;
} {
  const [newsletters, setNewsletters] = useState<FirestoreNewsletter[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!churchId) {
      setNewsletters([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribe = subscribeToChurchNewsletters(churchId, (n) => {
      setNewsletters(n);
      setLoading(false);
    });
    return unsubscribe;
  }, [churchId]);

  return { newsletters, loading };
}
