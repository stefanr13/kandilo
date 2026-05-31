import { beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeToUserMemberships } from './memberships';

interface MockFirestoreDoc {
  id: string;
  data: () => Record<string, unknown>;
}

const firestoreMock = vi.hoisted(() => {
  const mock = {
    docs: [] as MockFirestoreDoc[],
    error: null as unknown,
    unsubscribe: vi.fn(),
    onSnapshot: vi.fn(),
  };
  mock.onSnapshot = vi.fn((
    _ref,
    next: (snap: { docs: MockFirestoreDoc[] }) => void,
    error?: (value: unknown) => void
  ) => {
    if (mock.error) {
      error?.(mock.error);
      return mock.unsubscribe;
    }

    next({ docs: mock.docs });
    return mock.unsubscribe;
  });
  return mock;
});

vi.mock('../firebase/firestore', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((db, ...segments: string[]) => ({ db, path: segments.join('/') })),
  doc: vi.fn(),
  getDoc: vi.fn(),
  limit: vi.fn(),
  onSnapshot: firestoreMock.onSnapshot,
  query: vi.fn((...clauses: unknown[]) => clauses),
  Timestamp: class Timestamp {},
  where: vi.fn(),
  writeBatch: vi.fn(),
}));

function membershipSnapshot(id: string, data: Record<string, unknown>): MockFirestoreDoc {
  return {
    id,
    data: () => data,
  };
}

describe('membership subscriptions', () => {
  beforeEach(() => {
    firestoreMock.docs = [];
    firestoreMock.error = null;
    firestoreMock.unsubscribe.mockClear();
    firestoreMock.onSnapshot.mockClear();
  });

  it('maps only active church membership fanout rows for the signed-in user', () => {
    firestoreMock.docs = [
      membershipSnapshot('church-1', {
        churchName: 'St. Nicholas',
        imageURL: 'https://example.com/church.jpg',
        location: 'Chicago, IL',
        role: 'treasurer',
        status: 'active',
        churchActive: true,
        joinedAt: 'joined',
      }),
      membershipSnapshot('church-2', {
        churchName: 'Inactive Parish',
        role: 'member',
        status: 'active',
        churchActive: false,
      }),
      membershipSnapshot('church-3', {
        churchName: 'Pending Parish',
        role: 'member',
        status: 'pending',
      }),
    ];
    const callback = vi.fn();

    const unsubscribe = subscribeToUserMemberships('treasurer-1', callback);

    expect(firestoreMock.onSnapshot.mock.calls.at(-1)?.[0]).toEqual({
      db: {},
      path: 'users/treasurer-1/churchMemberships',
    });
    expect(callback).toHaveBeenCalledWith([
      expect.objectContaining({
        churchId: 'church-1',
        churchName: 'St. Nicholas',
        role: 'treasurer',
        status: 'active',
        churchActive: true,
      }),
    ]);
    expect(unsubscribe).toBe(firestoreMock.unsubscribe);
  });

  it('routes auth-switch permission denials through the explicit listener error handler', () => {
    const permissionDenied = Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
    firestoreMock.error = permissionDenied;
    const callback = vi.fn();
    const onError = vi.fn();

    subscribeToUserMemberships('member-1', callback, onError);

    expect(callback).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(permissionDenied);
  });
});
