import { useEffect, useState } from 'react';

type Subscribe<T> = (churchId: string, next: (rows: T[]) => void, error: (error: Error) => void) => () => void;

export function useChurchSubscription<T>(churchId: string | null, subscribe: Subscribe<T>) {
  const [state, setState] = useState<{ churchId: string | null; data: T[]; loading: boolean; error: string }>({
    churchId: null, data: [], loading: Boolean(churchId), error: '',
  });
  useEffect(() => {
    let active = true;
    setState({ churchId, data: [], loading: Boolean(churchId), error: '' });
    if (!churchId) return;
    const unsubscribe = subscribe(churchId, (data) => {
      if (active) setState({ churchId, data, loading: false, error: '' });
    }, (error) => {
      console.error('Parish subscription failed:', error);
      if (active) setState({ churchId, data: [], loading: false, error: 'Unable to load parish content. Please check your connection and try again.' });
    });
    return () => { active = false; unsubscribe(); };
  }, [churchId, subscribe]);
  return state.churchId === churchId ? state : { churchId, data: [] as T[], loading: Boolean(churchId), error: '' };
}
