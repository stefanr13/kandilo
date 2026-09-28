import { useChurchSubscription } from './useChurchSubscription';
import { subscribeToChurchNewsletters, type FirestoreNewsletter } from '../lib/db/newsletters';

export function useChurchNewsletters(churchId: string | null) {
  const { data, loading, error } = useChurchSubscription<FirestoreNewsletter>(churchId, subscribeToChurchNewsletters);
  return { newsletters: data, loading, error };
}
