import type { Event } from '../data/events';

const escapeText = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
const utc = (value: number) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

export function eventCalendarContent(event: Event): string {
  if (!Number.isFinite(event.sortTime) || !Number.isFinite(event.endSortTime) || event.endSortTime! <= event.sortTime!) {
    throw new Error('This event does not have a valid start and end time.');
  }
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kandilo//Parish Events//EN',
    'BEGIN:VEVENT', `UID:${escapeText(event.calendarId ?? String(event.id))}@kandilo.org`,
    `DTSTAMP:${utc(Date.now())}`, `DTSTART:${utc(event.sortTime!)}`, `DTEND:${utc(event.endSortTime!)}`,
    `SUMMARY:${escapeText(event.title)}`, `LOCATION:${escapeText(event.location)}`,
    `DESCRIPTION:${escapeText(event.description)}`, 'BEGIN:VALARM', 'TRIGGER:-PT15M',
    'ACTION:DISPLAY', 'DESCRIPTION:Event reminder', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'];
  // RFC 5545 folds at 75 UTF-8 octets without splitting a code point.
  return lines.map((line) => {
    let result = '', bytes = 0;
    for (const character of line) {
      const size = new TextEncoder().encode(character).length;
      if (bytes + size > 75) { result += '\r\n '; bytes = 1; }
      result += character; bytes += size;
    }
    return result;
  }).join('\r\n') + '\r\n';
}

export async function saveEventToCalendar(event: Event): Promise<void> {
  const file = new File([eventCalendarContent(event)], 'parish-event.ics', { type: 'text/calendar;charset=utf-8' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: event.title });
      return;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      // Some embedded browsers advertise sharing but reject it. Offer the file.
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url; link.download = file.name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
