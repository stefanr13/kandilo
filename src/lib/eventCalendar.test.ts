import { describe, expect, it, vi } from 'vitest';
import { eventCalendarContent, saveEventToCalendar } from './eventCalendar';
import type { Event } from '../data/events';

const event: Event = {
  id: 1, calendarId: 'parish-event', date: '27', month: 'SEP', title: 'Vespers, prayer',
  description: 'First line\nSecond line', location: 'Parish; hall', time: '4:00 PM', endTime: '5:00 PM',
  sortTime: Date.parse('2026-09-27T22:00:00Z'), endSortTime: Date.parse('2026-09-27T23:00:00Z'),
  attendees: 0, hasLimitedSpots: false, category: 'Vespers & Vigil', city: 'Parish', price: 0, color: '#800000',
};

describe('event calendar export', () => {
  it('exports the real absolute times and escapes calendar text', () => {
    const content = eventCalendarContent(event);
    expect(content).toContain('DTSTART:20260927T220000Z\r\nDTEND:20260927T230000Z');
    expect(content).toContain('SUMMARY:Vespers\\, prayer');
    expect(content).toContain('DESCRIPTION:First line\\nSecond line');
    expect(content).toContain('LOCATION:Parish\\; hall');
    expect(content).toContain('TRIGGER:-PT15M');
  });
  it('folds Unicode safely and refuses missing event times', () => {
    const title = 'Вечерња молитва '.repeat(20);
    const content = eventCalendarContent({ ...event, title });
    expect(content.replace(/\r\n /g, '')).toContain(`SUMMARY:${title}`);
    for (const line of content.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(() => eventCalendarContent({ ...event, sortTime: undefined })).toThrow('valid start and end time');
  });
  it('offers the calendar file when a browser advertises sharing but rejects it', async () => {
    const click = vi.fn();
    const link = { href: '', download: '', click, remove: vi.fn() };
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn().mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError')) });
    vi.stubGlobal('document', { createElement: () => link, body: { append: vi.fn() } });
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:calendar');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    try {
      await saveEventToCalendar(event);
      expect(createUrl).toHaveBeenCalledWith(expect.any(File));
      expect(link.download).toBe('parish-event.ics');
      expect(click).toHaveBeenCalledOnce();
      vi.runAllTimers();
      expect(revokeUrl).toHaveBeenCalledWith('blob:calendar');
    } finally {
      vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
    }
  });
});
