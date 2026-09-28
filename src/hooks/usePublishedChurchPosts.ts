import { useChurchSubscription } from './useChurchSubscription';
import { subscribeToPublishedPosts, type ChurchPost } from '../lib/db/posts';

export function usePublishedChurchPosts(churchId: string | null) {
  const { data, loading, error } = useChurchSubscription<ChurchPost>(churchId, subscribeToPublishedPosts);
  return { posts: data, loading, error };
}
