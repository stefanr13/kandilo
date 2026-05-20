import { useEffect, useMemo, useState } from 'react';
import {
  CalendarCheck,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  Search,
  Users,
} from 'lucide-react';
import type { FirestoreEvent } from '../../lib/db/events';
import type { FirestoreMember } from '../../lib/db/memberships';
import type { Language } from '../../types';
import { getExtraCopy } from '../../localization/extra';
import {
  createEventCheckIn,
  removeEventCheckIn,
  subscribeToEventCheckIns,
  type EventCheckIn,
} from '../../lib/db/checkIns';

interface ManagementScannerTabProps {
  churchId: string;
  currentUserId: string | null;
  events: FirestoreEvent[];
  members: FirestoreMember[];
  eventsLoading: boolean;
  membersLoading: boolean;
  isAdminOrPriest: boolean;
  language: Language;
}

function eventLabel(event: FirestoreEvent, locale?: string): string {
  return `${event.title} · ${event.startTime.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;
}

const LOCALES: Record<Language, string> = {
  English: 'en-US',
  'Srpski (Latinica)': 'sr-Latn',
  'Srpski (Ćirilica)': 'sr-Cyrl',
  Русский: 'ru',
  Română: 'ro',
  Українська: 'uk',
};

export default function ManagementScannerTab({
  churchId,
  currentUserId,
  events,
  members,
  eventsLoading,
  membersLoading,
  isAdminOrPriest,
  language,
}: ManagementScannerTabProps) {
  const [selectedEventId, setSelectedEventId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [checkIns, setCheckIns] = useState<EventCheckIn[]>([]);
  const [checkInsLoading, setCheckInsLoading] = useState(false);
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const t = getExtraCopy(language).management.scanner;
  const locale = LOCALES[language] ?? undefined;

  const sortedEvents = useMemo(() => {
    const now = Date.now();
    return [...events].sort((a, b) => {
      const aFuture = a.endTime.getTime() >= now;
      const bFuture = b.endTime.getTime() >= now;
      if (aFuture !== bFuture) return aFuture ? -1 : 1;
      return a.startTime.getTime() - b.startTime.getTime();
    });
  }, [events]);

  useEffect(() => {
    if (sortedEvents.length === 0) {
      if (selectedEventId) setSelectedEventId('');
      return;
    }

    if (!selectedEventId || !sortedEvents.some((event) => event.id === selectedEventId)) {
      setSelectedEventId(sortedEvents[0].id);
    }
  }, [selectedEventId, sortedEvents]);

  const selectedEvent = sortedEvents.find((event) => event.id === selectedEventId) ?? null;

  useEffect(() => {
    if (!selectedEvent) {
      setCheckIns([]);
      setCheckInsLoading(false);
      return;
    }

    setCheckInsLoading(true);
    const unsubscribe = subscribeToEventCheckIns(
      churchId,
      selectedEvent.id,
      (nextCheckIns) => {
        setCheckIns(nextCheckIns);
        setCheckInsLoading(false);
      },
      (error) => {
        console.error('Failed to subscribe to event check-ins:', error);
        setCheckIns([]);
        setCheckInsLoading(false);
        setMessage(t.loadError);
      }
    );
    return unsubscribe;
  }, [churchId, selectedEvent, t.loadError]);

  const checkedInIds = useMemo(() => new Set(checkIns.map((checkIn) => checkIn.userId)), [checkIns]);

  const activeMembers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return members
      .filter((member) => member.status === 'active')
      .filter((member) => {
        if (!query) return true;
        return (
          member.displayName.toLowerCase().includes(query) ||
          member.email.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => {
        const aChecked = checkedInIds.has(a.id);
        const bChecked = checkedInIds.has(b.id);
        if (aChecked !== bChecked) return aChecked ? -1 : 1;
        return a.displayName.localeCompare(b.displayName);
      });
  }, [checkedInIds, members, searchQuery]);

  const toggleCheckIn = async (member: FirestoreMember) => {
    if (!selectedEvent || !currentUserId || !isAdminOrPriest) {
      return;
    }

    setSavingMemberId(member.id);
    setMessage('');
    try {
      if (checkedInIds.has(member.id)) {
        await removeEventCheckIn(selectedEvent.id, member.id);
      } else {
        await createEventCheckIn({
          churchId,
          eventId: selectedEvent.id,
          userId: member.id,
          memberName: member.displayName,
          memberEmail: member.email,
          checkedInBy: currentUserId,
        });
      }
    } catch (error) {
      console.error('Failed to update event check-in:', error);
      setMessage(t.updateError);
    } finally {
      setSavingMemberId(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-6 xl:p-8 border-b border-gray-100 bg-white">
        <div className="flex flex-col gap-5 sm:flex-row sm:justify-between sm:items-end mb-8">
          <div>
            <span className="text-[#937022] font-black text-[10px] tracking-[0.2em] uppercase mb-2 block">
              {t.eyebrow}
            </span>
            <h2 className="text-3xl font-black text-gray-900 tracking-tighter">
              {t.title}
            </h2>
          </div>
          <div className="bg-gray-50 rounded-2xl px-5 py-3 text-left sm:text-right">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
              {t.checkedIn}
            </p>
            <p className="text-2xl font-black text-gray-900">
              {checkInsLoading ? '—' : checkIns.length}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
          <div className="relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={t.search}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-full bg-gray-50 border-none rounded-2xl pl-12 pr-6 py-4 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-[#800000]/20 transition-all"
            />
          </div>
          <select
            value={selectedEventId}
            onChange={(event) => setSelectedEventId(event.target.value)}
            className="w-full bg-gray-50 border-none rounded-2xl px-5 py-4 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-[#800000]/20 transition-all"
          >
            {sortedEvents.length === 0 ? (
              <option value="">{t.noEventsAvailable}</option>
            ) : (
              sortedEvents.map((event) => (
                <option key={event.id} value={event.id}>
                  {eventLabel(event, locale)}
                </option>
              ))
            )}
          </select>
        </div>
        {message && <p className="mt-3 text-xs font-bold text-red-500">{message}</p>}
      </div>

      <div className="flex-1 overflow-y-auto p-6 xl:p-8 scrollbar-hide bg-gray-50/30">
        {eventsLoading || membersLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 size={32} className="text-[#800000] animate-spin" />
          </div>
        ) : !selectedEvent ? (
          <div className="flex flex-col items-center justify-center h-72 text-center">
            <CalendarCheck size={48} className="text-gray-200 mb-4" />
            <h3 className="text-xl font-black text-gray-900">{t.noEventsTitle}</h3>
            <p className="text-sm text-gray-400 mt-2 max-w-sm">
              {t.noEventsSub}
            </p>
          </div>
        ) : (
          <div className="max-w-6xl mx-auto space-y-5">
            <div className="bg-white rounded-[28px] border border-gray-100 shadow-sm p-5 xl:p-6 flex flex-col sm:flex-row sm:items-center gap-5">
              <div className="w-14 h-14 rounded-2xl bg-[#800000]/10 flex items-center justify-center text-[#800000]">
                <CalendarCheck size={28} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-xl font-black text-gray-900 tracking-tight truncate">
                  {selectedEvent.title}
                </h3>
                <div className="mt-1 flex flex-wrap items-center gap-4 text-xs font-bold text-gray-400">
                  <span className="flex items-center gap-1">
                    <Clock size={14} />
                    {selectedEvent.startTime.toLocaleString(locale, {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users size={14} />
                    {t.activeMembers(members.filter((member) => member.status === 'active').length)}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-[32px] border border-gray-100 overflow-hidden shadow-sm">
              {activeMembers.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                  <Users size={40} className="mb-3 opacity-30" />
                  <p className="font-bold text-sm">{t.noActiveMembers}</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {activeMembers.map((member) => {
                    const checkedIn = checkedInIds.has(member.id);
                    return (
                      <button
                        key={member.id}
                        onClick={() => void toggleCheckIn(member)}
                        disabled={savingMemberId === member.id || !isAdminOrPriest}
                        className="w-full flex flex-col sm:flex-row sm:items-center gap-4 px-5 xl:px-6 py-5 text-left hover:bg-gray-50 transition-colors disabled:opacity-60"
                      >
                        <div className="w-10 h-10 rounded-xl overflow-hidden bg-gray-100 flex items-center justify-center text-gray-400 font-black text-xs flex-shrink-0">
                          {member.photoURL ? (
                            <img src={member.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <span>{member.displayName.charAt(0).toUpperCase()}</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-black text-gray-900 truncate">{member.displayName}</p>
                          <p className="text-[10px] text-gray-400 font-bold truncate">{member.email}</p>
                        </div>
                        <div className={`w-full sm:w-auto flex items-center justify-center gap-2 rounded-2xl px-4 py-2 text-[10px] font-black uppercase tracking-widest ${
                          checkedIn ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-400'
                        }`}>
                          {savingMemberId === member.id ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : checkedIn ? (
                            <CheckCircle2 size={16} />
                          ) : (
                            <Circle size={16} />
                          )}
                          {checkedIn ? t.checkedInAction : t.checkInAction}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
