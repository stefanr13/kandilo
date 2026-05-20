import { useEffect, useState } from 'react';
import { subscribeToPublishedPosts, type ChurchPost } from '../lib/db/posts';

export function usePublishedChurchPosts(churchId: string | null): {
  posts: ChurchPost[];
  loading: boolean;
} {
  const [posts, setPosts] = useState<ChurchPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!churchId) {
      setPosts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribe = subscribeToPublishedPosts(churchId, (data) => {
      setPosts(data);
      setLoading(false);
    });
    return unsubscribe;
  }, [churchId]);

  return { posts, loading };
}
