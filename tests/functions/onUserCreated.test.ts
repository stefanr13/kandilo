import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestoreMock = vi.hoisted(() => {
  const create = vi.fn();
  const doc = vi.fn(() => ({ create }));
  const collection = vi.fn(() => ({ doc }));
  return { collection, create, doc };
});

const functionsMock = vi.hoisted(() => {
  const onCreate = vi.fn((handler: unknown) => ({ handler }));
  const user = vi.fn(() => ({ onCreate }));
  const auth = vi.fn(() => ({ user }));
  const region = vi.fn(() => ({ auth }));
  return { auth, onCreate, region, user };
});

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
}));

vi.mock('../../functions/src/shared/firebase', () => ({
  db: {
    collection: firestoreMock.collection,
  },
}));

vi.mock('firebase-functions/v1', () => ({
  region: functionsMock.region,
}));

vi.mock('firebase-functions/logger', () => loggerMock);

import { bootstrapUserProfileDocument } from '../../functions/src/onUserCreated';

describe('bootstrapUserProfileDocument', () => {
  beforeEach(() => {
    firestoreMock.collection.mockClear();
    firestoreMock.create.mockReset();
    firestoreMock.doc.mockClear();
    loggerMock.info.mockClear();
  });

  it('creates new profiles with blank private tax receipt fields', async () => {
    firestoreMock.create.mockResolvedValue(undefined);

    await expect(bootstrapUserProfileDocument({
      uid: 'donor-1',
      email: 'donor@example.com',
      displayName: 'Donor One',
      photoURL: 'https://example.com/donor.jpg',
    })).resolves.toBe('created');

    expect(firestoreMock.collection).toHaveBeenCalledWith('users');
    expect(firestoreMock.doc).toHaveBeenCalledWith('donor-1');
    expect(firestoreMock.create).toHaveBeenCalledWith(expect.objectContaining({
      email: 'donor@example.com',
      displayName: 'Donor One',
      photoURL: 'https://example.com/donor.jpg',
      taxReceiptLegalName: '',
      taxReceiptAddress: {
        line1: '',
        line2: '',
        city: '',
        region: '',
        postalCode: '',
        country: '',
      },
    }));
    expect(firestoreMock.create.mock.calls[0]?.[0]).toHaveProperty('createdAt');
  });

  it('skips existing profile documents without overwriting donor receipt identity', async () => {
    const alreadyExists = Object.assign(new Error('already exists'), { code: 6 });
    firestoreMock.create.mockRejectedValue(alreadyExists);

    await expect(bootstrapUserProfileDocument({
      uid: 'donor-1',
      email: 'donor@example.com',
      displayName: 'Donor One',
    })).resolves.toBe('skipped_existing');

    expect(firestoreMock.create).toHaveBeenCalledTimes(1);
  });

  it('recognizes string already-exists errors from alternate Firestore runtimes', async () => {
    const alreadyExists = Object.assign(new Error('already exists'), { code: 'already-exists' });
    firestoreMock.create.mockRejectedValue(alreadyExists);

    await expect(bootstrapUserProfileDocument({
      uid: 'donor-1',
      email: 'donor@example.com',
    })).resolves.toBe('skipped_existing');
  });

  it('does not create a profile for auth users without email addresses', async () => {
    await expect(bootstrapUserProfileDocument({
      uid: 'phone-only-user',
      displayName: 'Phone Only',
    })).resolves.toBe('skipped_no_email');

    expect(firestoreMock.collection).not.toHaveBeenCalled();
    expect(firestoreMock.create).not.toHaveBeenCalled();
  });

  it('rethrows unexpected Firestore write failures', async () => {
    const unavailable = Object.assign(new Error('unavailable'), { code: 14 });
    firestoreMock.create.mockRejectedValue(unavailable);

    await expect(bootstrapUserProfileDocument({
      uid: 'donor-1',
      email: 'donor@example.com',
    })).rejects.toThrow('unavailable');
  });
});
