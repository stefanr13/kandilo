import { CalendarDays, MapPin } from 'lucide-react';
import type { EventPortal } from '../../lib/eventPlatform/model';

interface EventFocusChooserProps {
  events: EventPortal[];
  onChoose: (event: EventPortal) => void;
  onSkip: () => void;
}

export default function EventFocusChooser({ events, onChoose, onSkip }: EventFocusChooserProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f3ee] p-5">
      <div className="w-full max-w-3xl rounded-[32px] bg-white p-6 shadow-xl shadow-black/5 lg:p-8">
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#937022]">
          Featured events
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-gray-950">
          Choose the event to open.
        </h1>
        <p className="mt-2 max-w-xl text-sm font-medium text-gray-400">
          More than one of your churches has an active Featured Event.
        </p>

        <div className="mt-7 divide-y divide-gray-100">
          {events.map((event) => (
            <button
              key={event.id}
              type="button"
              onClick={() => onChoose(event)}
              className="grid w-full gap-4 py-5 text-left transition-colors hover:bg-gray-50 sm:grid-cols-[96px_1fr_auto] sm:items-center"
            >
              <div className="aspect-[4/3] overflow-hidden rounded-2xl bg-gray-100">
                {event.heroImageURL ? (
                  <img src={event.heroImageURL} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[#800000]">
                    <CalendarDays size={28} />
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-lg font-black text-gray-950">{event.title}</p>
                <p className="mt-1 flex items-center gap-2 text-xs font-bold text-gray-400">
                  <MapPin size={14} />
                  <span className="truncate">{event.venueName || event.venueAddress || 'Event venue'}</span>
                </p>
              </div>
              <span className="rounded-xl bg-gray-950 px-4 py-3 text-center text-[10px] font-black uppercase tracking-widest text-white">
                Open
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onSkip}
          className="mt-6 w-full rounded-2xl bg-gray-50 px-5 py-4 text-[10px] font-black uppercase tracking-widest text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          Continue to church
        </button>
      </div>
    </div>
  );
}
