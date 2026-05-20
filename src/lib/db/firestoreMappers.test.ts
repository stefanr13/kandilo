import { Timestamp } from 'firebase/firestore';
import { describe, expect, it, vi } from 'vitest';
import { mapFirestoreEvent } from './events';
import { mapFirestoreMember } from './memberships';
import { mapFirestoreNewsletter } from './newsletters';
import { mapFirestorePost } from './posts';

vi.mock('../firebase/firestore', () => ({ db: {} }));

function docSnapshot(id: string, data: Record<string, unknown>) {
  return {
    id,
    data: () => data,
  };
}

describe('Firestore document mappers', () => {
  it('maps event timestamps and defaults', () => {
    const start = new Date('2026-05-18T10:00:00Z');
    const end = new Date('2026-05-18T11:00:00Z');

    expect(
      mapFirestoreEvent(
        docSnapshot('event-1', {
          churchId: 'church-1',
          title: 'Liturgy',
          description: 'Sunday service',
          startTime: Timestamp.fromDate(start),
          endTime: Timestamp.fromDate(end),
          location: 'Nave',
          createdBy: 'user-1',
          notificationSent: true,
        })
      )
    ).toMatchObject({
      id: 'event-1',
      churchId: 'church-1',
      title: 'Liturgy',
      startTime: start,
      endTime: end,
      category: 'Divine Liturgy',
      notificationSent: true,
    });
  });

  it('maps church members with safe public-directory defaults', () => {
    expect(
      mapFirestoreMember(
        docSnapshot('user-1', {
          displayName: 'Ana Member',
          email: 'ana@example.com',
          role: 'admin',
          status: 'active',
          joinedAt: Timestamp.fromDate(new Date('2026-05-17T12:00:00Z')),
          showInDirectory: true,
        })
      )
    ).toMatchObject({
      id: 'user-1',
      displayName: 'Ana Member',
      email: 'ana@example.com',
      role: 'admin',
      status: 'active',
      joinedAt: 'May 2026',
      invitedBy: null,
      showInDirectory: true,
    });
  });

  it('maps newsletters and post publication dates', () => {
    const publishedAt = new Date('2026-05-17T12:00:00Z');

    expect(
      mapFirestoreNewsletter(
        docSnapshot('newsletter-1', {
          churchId: 'church-1',
          title: 'Weekly Bulletin',
          status: 'published',
          publishedAt: Timestamp.fromDate(publishedAt),
          emailSent: true,
        })
      )
    ).toMatchObject({
      id: 'newsletter-1',
      churchId: 'church-1',
      title: 'Weekly Bulletin',
      status: 'published',
      publishedAt,
      emailSent: true,
    });

    expect(
      mapFirestorePost(
        docSnapshot('post-1', {
          title: 'Parish Update',
          status: 'draft',
          createdAt: Timestamp.fromDate(publishedAt),
          updatedAt: Timestamp.fromDate(publishedAt),
          publishedAt: Timestamp.fromDate(publishedAt),
        }),
        'church-1',
        'published'
      )
    ).toMatchObject({
      id: 'post-1',
      churchId: 'church-1',
      title: 'Parish Update',
      status: 'published',
      createdAt: publishedAt,
      updatedAt: publishedAt,
      publishedAt,
    });
  });
});
