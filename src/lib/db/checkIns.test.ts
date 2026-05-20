import { describe, expect, it, vi } from 'vitest';
import { eventCheckInId } from './checkIns';

vi.mock('../firebase/firestore', () => ({ db: {} }));

describe('event check-in helpers', () => {
  it('uses the same deterministic id shape as Firestore rules', () => {
    expect(eventCheckInId('event-123', 'user-456')).toBe('event-123_user-456');
  });
});
