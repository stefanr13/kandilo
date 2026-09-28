import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

vi.mock('../lib/firebase/firestore', () => ({ db: {} }));
vi.mock('dompurify', () => ({ default: { addHook: vi.fn(), sanitize: (value: string) => value } }));
import ScheduleScreen from './ScheduleScreen';
import HomeScreen from './HomeScreen';

it('renders the Saints route with an empty month without throwing', () => {
  const html = renderToString(createElement(ScheduleScreen, { events: [], language: 'English', initialTab: 'saints' }));
  expect(html).toContain('Saints');
});

it('renders a published bulletin entry for parish members', () => {
  const html = renderToString(createElement(HomeScreen, {
    events: [], onSelectEvent: vi.fn(), onOpenGiving: vi.fn(), language: 'English', showSaintDays: true,
    activeChurch: { id: 'church-1', name: 'Parish', location: 'City', image: '' },
    newsletters: [{ id: 'bulletin-1', churchId: 'church-1', title: 'Sunday bulletin', content: '<p>News</p>', excerpt: 'News', status: 'published', publishedAt: new Date(), createdBy: 'staff', emailSent: true }],
  }));
  expect(html).toContain('Sunday bulletin');
  expect(html).toContain('Read Bulletin');
  expect(html).not.toContain('St. John of Damascus');
  expect(html).toContain('Commemorations are not available');
} );
