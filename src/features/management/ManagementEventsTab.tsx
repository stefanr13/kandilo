import { Calendar, Clock, Edit3, Loader2, Plus, Trash2 } from 'lucide-react';
import type { Language } from '../../types';
import { getExtraCopy } from '../../localization/extra';
import type { FirestoreEvent } from '../../lib/db/events';

interface ManagementEventsTabProps {
  events: FirestoreEvent[];
  eventsLoading: boolean;
  isAdminOrPriest: boolean;
  onDeleteEvent: (eventId: string) => void;
  onCreateEvent: () => void;
  onEditEvent: (event: FirestoreEvent) => void;
  language: Language;
}

const LOCALES: Record<Language, string> = {
  English: 'en-US',
  'Srpski (Latinica)': 'sr-Latn',
  'Srpski (Ćirilica)': 'sr-Cyrl',
  Русский: 'ru',
  Română: 'ro',
  Українська: 'uk',
};

export default function ManagementEventsTab({
  events,
  eventsLoading,
  isAdminOrPriest,
  onDeleteEvent,
  onCreateEvent,
  onEditEvent,
  language,
}: ManagementEventsTabProps) {
  const t = getExtraCopy(language).management.events;
  const locale = LOCALES[language] ?? undefined;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-6 xl:p-8 border-b border-gray-100 bg-white flex flex-col gap-5 sm:flex-row sm:justify-between sm:items-end">
        <div>
          <span className="text-[#937022] font-black text-[10px] tracking-[0.2em] uppercase mb-2 block">
            {t.eyebrow}
          </span>
          <h2 className="text-3xl font-black text-gray-900 tracking-tighter">{t.title}</h2>
        </div>
        {isAdminOrPriest && (
          <button
            onClick={onCreateEvent}
            className="w-full sm:w-auto bg-gray-900 text-white px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-[#800000] transition-all"
          >
            <Plus size={16} />
            {t.add}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-6 xl:p-8 scrollbar-hide">
        {eventsLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 size={32} className="text-[#800000] animate-spin" />
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <Calendar size={40} className="mb-3 opacity-30" />
            <p className="font-bold text-sm">{t.noEvents}</p>
            <p className="text-xs mt-1">{t.noEventsSub}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {events.map((event) => {
              const month = event.startTime
                .toLocaleString(locale, { month: 'short' })
                .toUpperCase();
              const day = event.startTime.getDate().toString();
              const startTime = event.startTime.toLocaleTimeString(locale, {
                hour: '2-digit',
                minute: '2-digit',
              });
              const endTime = event.endTime.toLocaleTimeString(locale, {
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <div
                  key={event.id}
                  className="bg-white p-5 xl:p-6 rounded-[28px] xl:rounded-[32px] border border-gray-100 shadow-sm flex flex-col sm:flex-row sm:items-center gap-5 xl:gap-6 hover:border-[#800000]/20 transition-all group"
                >
                  <div className="w-14 h-14 rounded-2xl bg-gray-50 flex flex-col items-center justify-center text-gray-900 flex-shrink-0">
                    <span className="text-[10px] font-black text-[#937022] leading-none">{month}</span>
                    <span className="text-xl font-black leading-none">{day}</span>
                  </div>
                  <div className="flex-1 min-w-0 w-full">
                    <div className="flex flex-wrap items-center gap-3 mb-1">
                      <h3 className="text-lg font-black text-gray-900 tracking-tight truncate">
                        {event.title}
                      </h3>
                      <span className="px-2 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-widest bg-blue-50 text-blue-700 flex-shrink-0">
                        {event.category}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs font-bold text-gray-400">
                      <div className="flex items-center gap-1">
                        <Clock size={14} />
                        {startTime} – {endTime}
                      </div>
                    </div>
                  </div>
                  {isAdminOrPriest && (
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => onEditEvent(event)}
                        className="p-3 bg-gray-50 text-gray-400 rounded-xl hover:text-gray-900 transition-all"
                      >
                        <Edit3 size={18} />
                      </button>
                      <button
                        onClick={() => onDeleteEvent(event.id)}
                        className="p-3 bg-gray-50 text-red-400 rounded-xl hover:bg-red-50 transition-all"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
