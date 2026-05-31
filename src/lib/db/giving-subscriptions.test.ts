import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDoc } from 'firebase/firestore';
import {
  getGivingStatus,
  subscribeToChurchAnnualTaxReceiptSummaries,
  subscribeToChurchGivingForReceipts,
  subscribeToUserAnnualTaxReceiptSummaries,
  subscribeToUserGiving,
} from './giving';

interface MockFirestoreDoc {
  id: string;
  data: () => Record<string, unknown>;
}

const firestoreMock = vi.hoisted(() => {
  const mock = {
    docs: [] as MockFirestoreDoc[],
    onSnapshot: vi.fn(),
  };
  mock.onSnapshot = vi.fn((_queryRef, next: (snap: { docs: MockFirestoreDoc[] }) => void) => {
    next({ docs: mock.docs });
    return vi.fn();
  });
  return mock;
});

vi.mock('../firebase/firestore', () => ({ db: {} }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((db, path: string) => ({ db, path })),
  doc: vi.fn(),
  getDoc: vi.fn(),
  limit: vi.fn((count: number) => ({ type: 'limit', count })),
  onSnapshot: firestoreMock.onSnapshot,
  orderBy: vi.fn((field: string, direction?: string) => ({ type: 'orderBy', field, direction })),
  query: vi.fn((...clauses: unknown[]) => clauses),
  Timestamp: class Timestamp {},
  where: vi.fn((field: string, operator: string, value: unknown) => ({
    type: 'where',
    field,
    operator,
    value,
  })),
}));

function docSnapshot(id: string, data: Record<string, unknown>) {
  return {
    id,
    data: () => data,
  };
}

const getDocMock = vi.mocked(getDoc);

describe('giving subscriptions', () => {
  beforeEach(() => {
    getDocMock.mockReset();
    firestoreMock.docs = [];
    firestoreMock.onSnapshot.mockClear();
  });

  it('fails closed when checkout return status cannot read the giving document', async () => {
    getDocMock.mockRejectedValueOnce(new Error('permission denied'));

    await expect(getGivingStatus('giving-1')).resolves.toBe('unknown');
  });

  it('maps readable checkout return statuses without exposing receipt details', async () => {
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ status: 'completed' }),
    } as unknown as Awaited<ReturnType<typeof getDoc>>);

    await expect(getGivingStatus('giving-1')).resolves.toBe('completed');
  });

  it('keeps anonymous giving visible in the donor-owned giving subscription', () => {
    firestoreMock.docs = [
      docSnapshot('giving-private', {
        churchId: 'church-1',
        userId: 'member-1',
        donorName: 'Private Donor',
        amountCents: 9900,
        anonymous: true,
        status: 'completed',
      }),
    ];
    const callback = vi.fn();

    subscribeToUserGiving('member-1', callback);

    expect(callback).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'giving-private',
        anonymous: true,
        donorName: '',
        amountCents: 9900,
      }),
    ]);
  });

  it('keeps anonymous annual summaries visible in the donor-owned annual subscription', () => {
    firestoreMock.docs = [
      docSnapshot('annual-private', {
        receiptId: 'annual-private',
        churchId: 'church-1',
        userId: 'member-1',
        donorLabel: 'Private Donor',
        donorAnonymous: true,
        kind: 'annual',
        status: 'sent',
        receiptYear: 2025,
        amountCents: 9900,
      }),
      docSnapshot('single-summary-ignored', {
        receiptId: 'single-summary-ignored',
        churchId: 'church-1',
        userId: 'member-1',
        donorLabel: 'Private Donor',
        donorAnonymous: true,
        kind: 'single',
        status: 'sent',
        amountCents: 5000,
      }),
    ];
    const callback = vi.fn();

    subscribeToUserAnnualTaxReceiptSummaries('member-1', callback);

    expect(callback).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'annual-private',
        receiptId: 'annual-private',
        donorAnonymous: true,
        donorLabel: '',
        kind: 'annual',
        receiptYear: 2025,
      }),
    ]);
  });

  it('constrains church receipt subscriptions to backend-marked public rows', () => {
    firestoreMock.docs = [
      docSnapshot('giving-public', {
        churchId: 'church-1',
        userId: 'member-1',
        donorName: 'Member One',
        donorEmail: '',
        donorNamePublicSafe: true,
        churchReceiptVisible: true,
        receiptManagerGivingSafeVersion: 1,
        amountCents: 5000,
        anonymous: false,
        status: 'completed',
      }),
      docSnapshot('giving-private', {
        churchId: 'church-1',
        userId: 'member-2',
        donorName: 'Hidden Donor',
        donorNamePublicSafe: false,
        amountCents: 9900,
        anonymous: true,
        status: 'completed',
      }),
      docSnapshot('giving-legacy-hidden', {
        churchId: 'church-1',
        userId: 'member-3',
        donorName: 'Legacy Donor',
        donorEmail: '',
        donorNamePublicSafe: true,
        churchReceiptVisible: false,
        amountCents: 7700,
        anonymous: false,
        status: 'completed',
      }),
      docSnapshot('giving-email-label-hidden', {
        churchId: 'church-1',
        userId: 'member-email-label',
        donorName: 'Contact member@example.com',
        donorEmail: '',
        donorNamePublicSafe: false,
        churchReceiptVisible: true,
        amountCents: 7700,
        anonymous: false,
        status: 'completed',
      }),
      docSnapshot('giving-reserved-label-hidden', {
        churchId: 'church-1',
        userId: 'member-reserved-label',
        donorName: 'Anonymous donor',
        donorEmail: '',
        donorNamePublicSafe: true,
        churchReceiptVisible: true,
        receiptManagerGivingSafeVersion: 1,
        amountCents: 7700,
        anonymous: false,
        status: 'completed',
      }),
      docSnapshot('giving-pending-hidden', {
        churchId: 'church-1',
        userId: 'member-4',
        donorName: 'Pending Donor',
        donorEmail: '',
        donorNamePublicSafe: true,
        churchReceiptVisible: true,
        receiptManagerGivingSafeVersion: 1,
        amountCents: 8800,
        anonymous: false,
        status: 'pending',
      }),
      docSnapshot('giving-refunded-public', {
        churchId: 'church-1',
        userId: 'member-5',
        donorName: 'Refunded Donor',
        donorEmail: '',
        donorNamePublicSafe: true,
        churchReceiptVisible: true,
        receiptManagerGivingSafeVersion: 1,
        amountCents: 6600,
        anonymous: false,
        status: 'refunded',
        taxReceiptStatus: 'voided',
      }),
    ];
    const givingCallback = vi.fn();

    subscribeToChurchGivingForReceipts('church-1', givingCallback);

    expect(firestoreMock.onSnapshot.mock.calls.at(-1)?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'where', field: 'churchId', operator: '==', value: 'church-1' }),
        expect.objectContaining({ type: 'where', field: 'anonymous', operator: '==', value: false }),
        expect.objectContaining({ type: 'where', field: 'churchReceiptVisible', operator: '==', value: true }),
        expect.objectContaining({ type: 'where', field: 'donorEmail', operator: '==', value: '' }),
        expect.objectContaining({ type: 'where', field: 'donorNamePublicSafe', operator: '==', value: true }),
        expect.objectContaining({ type: 'where', field: 'receiptManagerGivingSafeVersion', operator: '==', value: 1 }),
        expect.objectContaining({
          type: 'where',
          field: 'status',
          operator: 'in',
          value: ['completed', 'refunded'],
        }),
      ])
    );
    expect(givingCallback).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'giving-public',
        anonymous: false,
        donorName: 'Member One',
      }),
      expect.objectContaining({
        id: 'giving-refunded-public',
        status: 'refunded',
        donorName: 'Refunded Donor',
      }),
    ]);

    firestoreMock.docs = [
      docSnapshot('annual-public', {
        receiptId: 'annual-public',
        churchId: 'church-1',
        userId: 'member-1',
        donorLabel: 'Member One',
        donorAnonymous: false,
        churchReceiptVisible: true,
        donorLabelPublicSafe: true,
        receiptManagerSummarySafe: true,
        receiptManagerSummarySafeVersion: 2,
        kind: 'annual',
        status: 'sent',
        receiptYear: 2025,
        amountCents: 5000,
      }),
      docSnapshot('annual-private', {
        receiptId: 'annual-private',
        churchId: 'church-1',
        userId: 'member-2',
        donorLabel: 'Hidden Donor',
        donorAnonymous: true,
        kind: 'annual',
        status: 'sent',
        receiptYear: 2025,
        amountCents: 9900,
      }),
      docSnapshot('annual-legacy-hidden', {
        receiptId: 'annual-legacy-hidden',
        churchId: 'church-1',
        userId: 'member-3',
        donorLabel: 'Legacy Donor',
        donorAnonymous: false,
        churchReceiptVisible: false,
        donorLabelPublicSafe: false,
        kind: 'annual',
        status: 'sent',
        receiptYear: 2025,
        amountCents: 7700,
      }),
      docSnapshot('annual-unsafe-visible', {
        receiptId: 'annual-unsafe-visible',
        churchId: 'church-1',
        userId: 'member-4',
        donorLabel: 'Unsafe Donor',
        donorAnonymous: false,
        churchReceiptVisible: true,
        donorLabelPublicSafe: false,
        receiptManagerSummarySafe: false,
        receiptManagerSummarySafeVersion: 0,
        kind: 'annual',
        status: 'sent',
        receiptYear: 2025,
        amountCents: 8800,
      }),
      docSnapshot('annual-marker-only-visible', {
        receiptId: 'annual-marker-only-visible',
        churchId: 'church-1',
        userId: 'member-5',
        donorLabel: 'Marker Only Donor',
        donorAnonymous: false,
        churchReceiptVisible: true,
        donorLabelPublicSafe: true,
        receiptManagerSummarySafe: true,
        receiptManagerSummarySafeVersion: 0,
        kind: 'annual',
        status: 'sent',
        receiptYear: 2025,
        amountCents: 8800,
      }),
      docSnapshot('annual-email-label-safe-marker-hidden', {
        receiptId: 'annual-email-label-safe-marker-hidden',
        churchId: 'church-1',
        userId: 'member-6',
        donorLabel: 'member@example.com',
        donorAnonymous: false,
        churchReceiptVisible: true,
        donorLabelPublicSafe: true,
        receiptManagerSummarySafe: true,
        receiptManagerSummarySafeVersion: 2,
        kind: 'annual',
        status: 'sent',
        receiptYear: 2025,
        amountCents: 6600,
      }),
      docSnapshot('annual-reserved-label-safe-marker-hidden', {
        receiptId: 'annual-reserved-label-safe-marker-hidden',
        churchId: 'church-1',
        userId: 'member-7',
        donorLabel: 'Anonymous donor',
        donorAnonymous: false,
        churchReceiptVisible: true,
        donorLabelPublicSafe: true,
        receiptManagerSummarySafe: true,
        receiptManagerSummarySafeVersion: 2,
        kind: 'annual',
        status: 'sent',
        receiptYear: 2025,
        amountCents: 6600,
      }),
      docSnapshot('single-malformed-visible', {
        receiptId: 'single-malformed-visible',
        churchId: 'church-1',
        userId: 'member-1',
        donorLabel: 'Member One',
        donorAnonymous: false,
        churchReceiptVisible: true,
        kind: 'single',
        status: 'sent',
        receiptYear: 2025,
        amountCents: 5000,
      }),
    ];
    const summaryCallback = vi.fn();

    subscribeToChurchAnnualTaxReceiptSummaries('church-1', summaryCallback);

    expect(firestoreMock.onSnapshot.mock.calls.at(-1)?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'where', field: 'churchId', operator: '==', value: 'church-1' }),
        expect.objectContaining({ type: 'where', field: 'kind', operator: '==', value: 'annual' }),
        expect.objectContaining({ type: 'where', field: 'donorAnonymous', operator: '==', value: false }),
        expect.objectContaining({ type: 'where', field: 'churchReceiptVisible', operator: '==', value: true }),
        expect.objectContaining({ type: 'where', field: 'donorLabelPublicSafe', operator: '==', value: true }),
        expect.objectContaining({ type: 'where', field: 'receiptManagerSummarySafe', operator: '==', value: true }),
        expect.objectContaining({ type: 'where', field: 'receiptManagerSummarySafeVersion', operator: '==', value: 2 }),
      ])
    );
    expect(summaryCallback).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'annual-public',
        donorAnonymous: false,
        donorLabelPublicSafe: true,
        donorLabel: 'Member One',
      }),
    ]);
  });
});
