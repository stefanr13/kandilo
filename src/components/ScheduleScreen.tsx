import { useState, useMemo, useRef, useEffect } from 'react';
import { Calendar, MapPin, Clock, Video, Search, ChevronDown, Info, Bell, Grid, List as ListIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';
import { Event, Category } from '../data/events';
import { Language } from '../types';
import { TRANSLATIONS } from '../translations';
import FullCalendar from './FullCalendar';
import { saveEventToCalendar } from '../lib/eventCalendar';
import { useSaintsForMonth } from '../hooks/useSaintsForMonth';
import { getSaintDayDisplay } from '../lib/db/saintDisplay';

export interface ScheduleScreenProps {
  events: Event[];
  onShowFullCalendar?: () => void;
  initialSelectedEvent?: Event | null;
  onClearInitialEvent?: () => void;
  onCloseDetail?: () => void;
  language: Language;
  initialTab?: 'events' | 'saints';
}

const MONTH_LABELS: Record<string, string> = {
  JAN: 'January',
  FEB: 'February',
  MAR: 'March',
  APR: 'April',
  MAY: 'May',
  JUN: 'June',
  JUL: 'July',
  AUG: 'August',
  SEP: 'September',
  OCT: 'October',
  NOV: 'November',
  DEC: 'December',
};

const LOCALES: Record<Language, string> = {
  English: 'en-US',
  'Srpski (Latinica)': 'sr-Latn',
  'Srpski (Ćirilica)': 'sr-Cyrl',
  Русский: 'ru',
  Română: 'ro',
  Українська: 'uk',
};

type EventsCopy = typeof TRANSLATIONS.English.events;

function getDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getCalendarCells(date: Date): Array<{ day: number | null }> {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const cells: Array<{ day: number | null }> = [];

  for (let i = 0; i < firstWeekday; i++) {
    cells.push({ day: null });
  }
  for (let day = 1; day <= totalDays; day++) {
    cells.push({ day });
  }

  return cells;
}

function SaintsMonthView({
  language,
  t,
  mobile = false,
}: {
  language: Language;
  t: EventsCopy;
  mobile?: boolean;
}) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [selectedDateKey, setSelectedDateKey] = useState(() => {
    const today = new Date();
    return getDateKey(today.getFullYear(), today.getMonth(), today.getDate());
  });
  const locale = LOCALES[language] ?? 'en-US';
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const saintsForMonth = useSaintsForMonth(year, month, true);

  useEffect(() => {
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    if (!selectedDateKey.startsWith(monthPrefix)) {
      const today = new Date();
      const selectedDay =
        today.getFullYear() === year && today.getMonth() === month
          ? today.getDate()
          : 1;
      setSelectedDateKey(getDateKey(year, month, selectedDay));
    }
  }, [month, selectedDateKey, year]);

  const weekDays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const day = new Date(2026, 1, 1 + index);
        return day.toLocaleDateString(locale, { weekday: 'short' }).slice(0, 1);
      }),
    [locale]
  );
  const cells = useMemo(() => getCalendarCells(currentMonth), [currentMonth]);
  const selectedDay = saintsForMonth[selectedDateKey] ?? null;
  const selectedDisplay = getSaintDayDisplay(selectedDay, language);
  const listedDays = Object.values(saintsForMonth)
    .filter((day) => day.names.length > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const monthTitle = currentMonth.toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  });
  const selectedDateTitle = new Date(`${selectedDateKey}T12:00:00`).toLocaleDateString(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const changeMonth = (offset: number) => {
    setCurrentMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{t.saintsOfMonth}</h2>
          <p className="text-gray-500 text-xs mt-1">
            One featured commemoration is shown per day; additional saints stay in the day detail.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest min-w-0">
            {monthTitle}
          </h3>
          <div className="flex gap-1">
            <button
              onClick={() => changeMonth(-1)}
              className="h-9 w-9 rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center justify-center transition-colors"
              title="Previous Month"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => changeMonth(1)}
              className="h-9 w-9 rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200 flex items-center justify-center transition-colors"
              title="Next Month"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className={mobile ? 'space-y-5' : 'grid grid-cols-[minmax(0,1fr)_320px] gap-6 items-start'}>
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-3 sm:p-4">
          <div className="grid grid-cols-7 mb-2">
            {weekDays.map((day, index) => (
              <div key={`${day}-${index}`} className="text-center text-[10px] font-black text-gray-300 uppercase tracking-widest py-2">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-2xl border border-gray-50 bg-gray-50">
            {cells.map((cell, index) => {
              const dateKey = cell.day ? getDateKey(year, month, cell.day) : null;
              const saintDay = dateKey ? saintsForMonth[dateKey] : null;
              const dayDisplay = getSaintDayDisplay(saintDay, language);
              const isSelected = dateKey === selectedDateKey;
              const today = new Date();
              const isToday =
                cell.day === today.getDate() &&
                month === today.getMonth() &&
                year === today.getFullYear();

              return (
                <button
                  key={index}
                  type="button"
                  disabled={!cell.day}
                  onClick={() => dateKey && setSelectedDateKey(dateKey)}
                  className={`min-h-[82px] sm:min-h-[118px] bg-white p-2 text-left transition-colors ${
                    cell.day ? 'hover:bg-gray-50 cursor-pointer' : 'bg-gray-50/70 cursor-default'
                  } ${isSelected ? 'ring-2 ring-inset ring-[#800000]' : ''}`}
                >
                  {cell.day && (
                    <div className="flex h-full flex-col">
                      <span
                        className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-black ${
                          isToday ? 'bg-[#800000] text-white' : isSelected ? 'text-[#800000]' : 'text-gray-400'
                        }`}
                      >
                        {cell.day}
                      </span>
                      {dayDisplay.featuredName && (
                        <div className="mt-2 flex flex-1 flex-col justify-between gap-1">
                          <p className="line-clamp-2 text-[10px] font-black leading-tight text-[#800000] sm:text-[11px]">
                            {dayDisplay.featuredName}
                          </p>
                          {dayDisplay.additionalNames.length + dayDisplay.hiddenAdditionalCount > 0 && (
                            <span className="mt-auto inline-flex w-fit rounded-full bg-[#937022]/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-[#937022]">
                              +{dayDisplay.additionalNames.length + dayDisplay.hiddenAdditionalCount} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <aside className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5">
          <span className="text-[9px] font-black text-[#937022] uppercase tracking-widest">
            {selectedDateTitle}
          </span>
          <p className="mt-4 text-[9px] font-black uppercase tracking-widest text-gray-300">
            Featured commemoration
          </p>
          <h3 className="mt-1 text-lg font-black text-gray-900 tracking-tight">
            {selectedDisplay.featuredName || 'No commemoration listed'}
          </h3>
          {selectedDisplay.additionalNames.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-300">
                Also commemorated
              </p>
              {selectedDisplay.additionalNames.map((name) => (
                <p key={name} className="rounded-2xl bg-gray-50 px-4 py-3 text-xs font-bold leading-snug text-gray-600">
                  {name}
                </p>
              ))}
              {selectedDisplay.hiddenAdditionalCount > 0 && (
                <p className="rounded-2xl bg-[#937022]/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-[#937022]">
                  +{selectedDisplay.hiddenAdditionalCount} additional commemorations
                </p>
              )}
            </div>
          )}
          {!selectedDisplay.featuredName && listedDays.length > 0 && (
            <div className="mt-5 space-y-2">
              {listedDays.slice(0, 5).map((day) => {
                const date = new Date(`${day.date}T12:00:00`);
                const name = getSaintDayDisplay(day, language).featuredName;
                if (!name) return null;
                return (
                  <button
                    key={day.date}
                    type="button"
                    onClick={() => setSelectedDateKey(day.date)}
                    className="w-full rounded-2xl bg-gray-50 px-4 py-3 text-left hover:bg-gray-100 transition-colors"
                  >
                    <span className="text-[9px] font-black uppercase tracking-widest text-[#937022]">
                      {date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })}
                    </span>
                    <p className="mt-0.5 line-clamp-2 text-xs font-bold leading-snug text-gray-700">
                      {name}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function getEventSortTime(event: Event): number {
  if (typeof event.sortTime === 'number') {
    return event.sortTime;
  }
  const monthIndex = Object.keys(MONTH_LABELS).indexOf(event.month);
  const year = event.year ?? new Date().getFullYear();
  return new Date(year, Math.max(monthIndex, 0), Number.parseInt(event.date, 10) || 1).getTime();
}

function getMonthYearTitle(events: Event[]): string {
  const firstEvent = events[0];
  if (!firstEvent) {
    return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date());
  }
  const month = MONTH_LABELS[firstEvent.month] ?? firstEvent.month;
  const year = firstEvent.year ?? new Date().getFullYear();
  return `${month} ${year}`;
}

export default function ScheduleScreen({
  events,
  onShowFullCalendar,
  initialSelectedEvent,
  onClearInitialEvent,
  onCloseDetail,
  language,
  initialTab = 'events',
}: ScheduleScreenProps) {
  const t = TRANSLATIONS[language].events;
  const [activeTab, setActiveTab] = useState<'events' | 'saints'>(initialTab);
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);
  const [selectedCategory, setSelectedCategory] = useState<Category | 'All'>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(initialSelectedEvent || null);
  const [reminderMessage, setReminderMessage] = useState('');

  const filterScrollRef = useRef<HTMLDivElement>(null);
  const categories: Category[] = ['Divine Liturgy', 'Vespers & Vigil', 'Feast Day', 'Ministry & Education', 'Community & Social', 'Sacramental'];

  useEffect(() => {
    const filterScroll = filterScrollRef.current;
    if (filterScroll) {
      const handleWheel = (e: WheelEvent) => {
        if (e.deltaY !== 0) {
          e.preventDefault();
          filterScroll.scrollLeft += e.deltaY;
        }
      };
      filterScroll.addEventListener('wheel', handleWheel, { passive: false });
      return () => filterScroll.removeEventListener('wheel', handleWheel);
    }
  }, []);

  useEffect(() => {
    if (!initialSelectedEvent) {
      return;
    }

    setSelectedEvent(initialSelectedEvent);
    onClearInitialEvent?.();
  }, [initialSelectedEvent, onClearInitialEvent]);

  useEffect(() => {
    const scrollContainer = document.querySelector('main');
    if (scrollContainer) scrollContainer.scrollTo({ top: 0, behavior: 'instant' });
  }, [selectedEvent]);

  const filteredEvents = useMemo(() => {
    return events.filter(event => {
      const matchesCategory = selectedCategory === 'All' || event.category === selectedCategory;
      const matchesSearch = event.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           event.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    }).sort((a, b) => getEventSortTime(a) - getEventSortTime(b));
  }, [events, selectedCategory, searchQuery]);
  const monthYearTitle = getMonthYearTitle(filteredEvents);
  const eventModeLabel = language === 'English' ? 'Parish Events' : t.allEvents;
  const saintsModeLabel = language === 'English' ? 'Saints Calendar' : t.saintsOfMonth;
  const activeModeTitle = activeTab === 'events' ? monthYearTitle : t.saintsOfMonth;
  const activeModeSub = activeTab === 'events' ? t.upcomingSub : t.saintsSub;
  const eventCalendarSub = language === 'English'
    ? 'Parish services and activities only. Saints are kept in their own calendar.'
    : t.upcomingSub;

  const handleSetReminder = async () => {
    if (!selectedEvent) return;
    setReminderMessage('');
    try {
      await saveEventToCalendar(selectedEvent);
      setReminderMessage(t.reminderSet);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.warn('Calendar export failed:', error);
      setReminderMessage('Unable to export this event. Please try again.');
    }
  };

  /* ── Event detail view ─────────────────────────────────────────────── */
  if (selectedEvent) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="pb-24 bg-white min-h-full"
      >
        {/* Hero image */}
        <div className="relative h-72 w-full overflow-hidden lg:h-96">
          <img
            src={`https://picsum.photos/seed/${selectedEvent.id + 100}/1200/600`}
            alt={selectedEvent.title}
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
          <button
            onClick={() => { setSelectedEvent(null); onCloseDetail?.(); }}
            className="absolute left-6 w-10 h-10 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-white/40 transition-colors"
            style={{ top: 'calc(env(safe-area-inset-top) + 0.5rem)' }}
            title="Go Back"
          >
            <ChevronDown className="rotate-90" size={20} />
          </button>
          <div className="absolute bottom-6 left-6 right-6 lg:left-10 lg:right-10">
            <span className="bg-[#800000] text-white text-[10px] font-black px-2 py-0.5 rounded uppercase mb-2 inline-block tracking-widest">{selectedEvent.category}</span>
            <h1 className="text-3xl font-black text-white tracking-tighter leading-tight lg:text-5xl">{selectedEvent.title}</h1>
          </div>
        </div>

        {/* Content — 2-column on desktop */}
        <div className="lg:grid lg:w-full lg:max-w-6xl lg:mx-auto lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] lg:gap-10 lg:px-10 lg:pt-8">
          {/* Main content */}
          <div className="p-8 lg:p-0">
            <div className="flex flex-wrap gap-6 mb-8">
              {[
                { icon: Calendar, label: t.date, value: `${selectedEvent.date} ${selectedEvent.month}, ${selectedEvent.year ?? new Date().getFullYear()}` },
                { icon: Clock, label: t.time, value: `${selectedEvent.time} – ${selectedEvent.endTime}` },
                { icon: MapPin, label: t.location, value: selectedEvent.location },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center text-[#937022]">
                    <Icon size={20} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</p>
                    <p className="text-sm font-bold text-gray-900">{value}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mb-10">
              <h3 className="text-lg font-black text-gray-900 mb-3 tracking-tight">{t.eventDetails}</h3>
              {selectedEvent.commemoration && (
                <div className="mb-4 p-4 bg-[#937022]/5 rounded-2xl border border-[#937022]/10">
                  <p className="text-[10px] font-black text-[#937022] uppercase tracking-widest mb-1">{t.commemoration}</p>
                  <p className="text-sm font-bold text-gray-900">{selectedEvent.commemoration}</p>
                </div>
              )}
              <p className="text-gray-500 text-sm leading-relaxed">
                {selectedEvent.description} We invite all faithful to join us for this sacred gathering.
                Please arrive 15 minutes early for quiet reflection before the event begins.
              </p>
            </div>

            <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100 mb-10">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-[#937022] shadow-sm">
                  <Info size={20} />
                </div>
                <div>
                  <h4 className="text-sm font-black text-gray-900 uppercase tracking-widest mb-1">{t.liturgicalNote}</h4>
                  <p className="text-xs text-gray-500 leading-relaxed">
                    Today's event includes special prayers for the health and salvation of our parish community.
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => void handleSetReminder()}
              className="w-full py-5 bg-[#800000] text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-red-900/20 hover:bg-[#8D1212] transition-all active:scale-95 flex items-center justify-center gap-3"
            >
              <Bell size={18} />
              {t.setReminder}
            </button>
            {reminderMessage && <p role="status" className="mt-3 text-sm text-gray-600">{reminderMessage}</p>}
          </div>

          {/* Desktop sidebar — related events */}
          <div className="hidden lg:block">
            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Other Events</h3>
            <div className="space-y-3">
              {events.filter(e => e.id !== selectedEvent.id).slice(0, 5).map((e) => (
                <button
                  key={e.id}
                  onClick={() => setSelectedEvent(e)}
                  className="w-full bg-gray-50 rounded-2xl p-4 flex gap-3 text-left hover:bg-white hover:shadow-md transition-all border border-transparent hover:border-gray-100"
                >
                  <div className="w-10 h-10 rounded-xl bg-white flex flex-col items-center justify-center shadow-sm border border-gray-100 flex-shrink-0">
                    <span className="text-[8px] font-black text-[#937022] leading-none">{e.month}</span>
                    <span className="text-sm font-black text-gray-900 leading-none">{e.date}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-[8px] font-black text-[#937022] uppercase tracking-widest block">{e.category}</span>
                    <h4 className="text-xs font-black text-gray-900 leading-tight mt-0.5 truncate">{e.title}</h4>
                    <p className="text-[10px] text-gray-400 mt-0.5">{e.time}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  /* ── List view ─────────────────────────────────────────────────────── */
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="pb-24"
    >
      {/* ── Desktop: left-sidebar + main panel ──────────────────────── */}
      <div className="hidden lg:flex lg:min-h-full lg:bg-[#F9F9F9]">
        {/* Sidebar: tabs + search + categories */}
        <div className="w-72 flex-shrink-0 border-r border-gray-100 bg-white px-6 pt-8 pb-6 flex flex-col gap-6 sticky top-0 self-start">
          <div>
            <span className="text-[#937022] font-black text-[10px] tracking-[0.2em] uppercase block mb-1">
              {activeTab === 'events' ? eventModeLabel : saintsModeLabel}
            </span>
            <h1 className="text-3xl font-black text-gray-900 tracking-tighter leading-none">{activeModeTitle}</h1>
            <p className="mt-2 text-xs font-bold leading-relaxed text-gray-400">{activeModeSub}</p>
          </div>

          {/* Tabs */}
          <div className="bg-gray-100 p-1 rounded-2xl flex gap-1 shadow-inner">
            <button
              onClick={() => setActiveTab('events')}
              className={`flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${activeTab === 'events' ? 'bg-white text-[#937022] shadow-md' : 'text-gray-400 hover:text-gray-600'}`}
            >
              {eventModeLabel}
            </button>
            <button
              onClick={() => setActiveTab('saints')}
              className={`flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${activeTab === 'saints' ? 'bg-white text-[#937022] shadow-md' : 'text-gray-400 hover:text-gray-600'}`}
            >
              {saintsModeLabel}
            </button>
          </div>

          {/* Search */}
          {activeTab === 'events' && (
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input
                type="text"
                placeholder={t.searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-gray-50 border border-gray-100 rounded-2xl py-3 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#800000]/20"
              />
            </div>
          )}

          {/* Category filters */}
          {activeTab === 'events' && (
            <div className="space-y-1.5">
              <button
                onClick={() => setSelectedCategory('All')}
                className={`w-full text-left px-4 py-2.5 rounded-xl text-[11px] font-bold transition-all ${selectedCategory === 'All' ? 'bg-gray-900 text-white shadow' : 'text-gray-500 hover:bg-gray-50'}`}
              >
                {t.allActivities}
              </button>
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`w-full text-left px-4 py-2.5 rounded-xl text-[11px] font-bold transition-all ${selectedCategory === cat ? 'bg-[#800000] text-white shadow' : 'text-gray-500 hover:bg-gray-50'}`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={onShowFullCalendar}
            className="w-full py-3 bg-gray-100 rounded-xl text-[11px] font-bold uppercase tracking-widest text-gray-900 hover:bg-gray-200 transition-colors mt-auto"
          >
            {t.seeFullCalendar}
          </button>
        </div>

        {/* Main panel: events grid or saints list */}
        <div className="flex-1 min-w-0 w-full max-w-6xl mx-auto px-8 pt-8 pb-6">
          {activeTab === 'events' ? (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    {viewMode === 'calendar' ? eventModeLabel : t.upcomingEvents}
                  </h2>
                  <p className="text-gray-500 text-xs mt-1">
                    {viewMode === 'calendar' ? eventCalendarSub : t.upcomingSub}
                  </p>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-auto">
                  {/* View Mode Segmented Control */}
                  <div className="bg-gray-100 p-1 rounded-xl flex gap-0.5 shadow-inner">
                    <button
                      onClick={() => setViewMode('calendar')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                        viewMode === 'calendar'
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-400 hover:text-gray-600'
                      }`}
                      title="Calendar View"
                    >
                      <Grid size={12} />
                      Calendar
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                        viewMode === 'list'
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-400 hover:text-gray-600'
                      }`}
                      title="List View"
                    >
                      <ListIcon size={12} />
                      List
                    </button>
                  </div>
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest hidden sm:inline">
                    {filteredEvents.length} events
                  </span>
                </div>
              </div>

              {viewMode === 'calendar' ? (
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4 xl:p-6">
                  <FullCalendar
                    events={events}
                    onSelectEvent={(event) => setSelectedEvent(event)}
                    language={language}
                    showSaintDays={false}
                    isEmbedded={true}
                    selectedCategory={selectedCategory}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                  {filteredEvents.length > 0 ? filteredEvents.map((session) => (
                    <div
                      key={session.id}
                      onClick={() => setSelectedEvent(session)}
                      className="bg-white rounded-2xl p-5 shadow-sm border border-gray-50 cursor-pointer hover:shadow-md hover:border-gray-200 transition-all active:scale-[0.98] flex flex-col gap-3"
                    >
                      <div className="flex gap-4">
                        <div className="flex flex-col items-center justify-start pt-1 min-w-[44px]">
                          <span className="text-2xl font-bold text-[#937022] leading-none">{session.date}</span>
                          <span className="text-[10px] font-bold text-gray-400 mt-1">{session.month}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-[8px] font-black uppercase tracking-widest text-[#937022] mb-1 block">{session.category}</span>
                          <h3 className="font-bold text-gray-900 leading-tight">{session.title}</h3>
                          {session.commemoration && <p className="text-[9px] font-bold text-[#937022] mt-0.5">{session.commemoration}</p>}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-4 text-[11px] text-gray-500 pl-[52px]">
                        <div className="flex items-center gap-1">
                          <Clock size={12} className="text-gray-400" />
                          <span>{session.time}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          {session.isVirtual ? <Video size={12} className="text-gray-400" /> : <MapPin size={12} className="text-gray-400" />}
                          <span className="truncate max-w-[140px]">{session.location}</span>
                        </div>
                      </div>
                      <div className="pl-[52px]">
                        <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{session.description}</p>
                      </div>
                      <div className="pl-[52px]">
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedEvent(session); }}
                          className="px-5 py-2.5 bg-gray-900 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.15em] hover:bg-black transition-all"
                        >
                          {t.viewDetails}
                        </button>
                      </div>
                    </div>
                  )) : (
                    <div className="col-span-2 flex flex-col items-center justify-center py-20 text-center">
                      <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center text-gray-300 mb-4">
                        <Calendar size={32} />
                      </div>
                      <h3 className="font-bold text-gray-900">{t.noEvents}</h3>
                      <p className="text-xs text-gray-400 mt-1">{t.noEventsSub}</p>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <SaintsMonthView language={language} t={t} />
          )}
        </div>
      </div>

      {/* ── Mobile layout (unchanged, but added beautiful View Switcher and Calendar integration) ────────────────────────────────── */}
      <div className="lg:hidden">
        <div className="px-6 pt-8 mb-6">
          <div className="flex justify-center mb-6">
            <div className="bg-gray-100 p-1 rounded-2xl flex gap-1 shadow-inner w-full max-w-xs">
              <button
                onClick={() => setActiveTab('events')}
                className={`flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${activeTab === 'events' ? 'bg-white text-[#937022] shadow-md' : 'text-gray-400 hover:text-gray-600'}`}
              >
                {eventModeLabel}
              </button>
              <button
                onClick={() => setActiveTab('saints')}
                className={`flex-1 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${activeTab === 'saints' ? 'bg-white text-[#937022] shadow-md' : 'text-gray-400 hover:text-gray-600'}`}
              >
                {saintsModeLabel}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="text-[#937022] font-black text-[10px] tracking-[0.2em] uppercase block">
                {activeTab === 'events' ? eventModeLabel : saintsModeLabel}
              </span>
              <h1 className="text-4xl font-black text-gray-900 tracking-tighter leading-none">{activeModeTitle}</h1>
              <p className="mt-2 text-xs font-bold leading-relaxed text-gray-400">{activeModeSub}</p>
            </div>

            {activeTab === 'events' && (
              <div className="bg-gray-100 p-1 rounded-xl flex gap-0.5 shadow-inner flex-shrink-0">
                <button
                  onClick={() => setViewMode('calendar')}
                  className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${
                    viewMode === 'calendar' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  Cal
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${
                    viewMode === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  List
                </button>
              </div>
            )}
          </div>
        </div>

        {activeTab === 'events' ? (
          <>
            {viewMode === 'calendar' ? (
              <div className="px-4 mb-6">
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4">
                  <FullCalendar
                    events={events}
                    onSelectEvent={(event) => setSelectedEvent(event)}
                    language={language}
                    showSaintDays={false}
                    isEmbedded={true}
                    selectedCategory={selectedCategory}
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="px-6 mb-6">
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input
                      type="text"
                      placeholder={t.searchPlaceholder}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-white border border-gray-100 rounded-2xl py-4 pl-12 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#800000]/20 shadow-sm"
                    />
                  </div>
                </div>

                <div ref={filterScrollRef} className="px-6 mb-8 overflow-x-auto scrollbar-hide flex gap-2 cursor-grab active:cursor-grabbing">
                  <button
                    onClick={() => setSelectedCategory('All')}
                    className={`px-5 py-2.5 rounded-full text-[10px] font-bold whitespace-nowrap transition-all ${selectedCategory === 'All' ? 'bg-gray-900 text-white shadow-lg' : 'bg-white text-gray-500 border border-gray-100'}`}
                  >
                    {t.allActivities}
                  </button>
                  {categories.map(cat => (
                    <button key={cat} onClick={() => setSelectedCategory(cat)} className={`px-5 py-2.5 rounded-full text-[10px] font-bold whitespace-nowrap transition-all ${selectedCategory === cat ? 'bg-[#800000] text-white shadow-lg' : 'bg-white text-gray-500 border border-gray-100'}`}>
                      {cat}
                    </button>
                  ))}
                </div>

                <div className="px-6">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h2 className="text-2xl font-bold text-gray-900">{t.upcomingEvents}</h2>
                      <p className="text-gray-500 text-xs mt-1">{t.upcomingSub}</p>
                    </div>
                  </div>
                  <div className="space-y-6 min-h-[300px]">
                    {filteredEvents.length > 0 ? filteredEvents.map((session) => (
                      <div key={session.id} onClick={() => setSelectedEvent(session)} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-50 flex gap-4 cursor-pointer hover:border-gray-200 transition-all active:scale-[0.98]">
                        <div className="flex flex-col items-center justify-start pt-1 min-w-[50px]">
                          <span className="text-2xl font-bold text-[#937022] leading-none">{session.date}</span>
                          <span className="text-[10px] font-bold text-gray-400 mt-1">{session.month}</span>
                        </div>
                        <div className="flex-1">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <span className="text-[8px] font-black uppercase tracking-widest text-[#937022] mb-1 block">{session.category}</span>
                              <h3 className="font-bold text-gray-900 leading-tight pr-4">{session.title}</h3>
                              {session.commemoration && <p className="text-[9px] font-bold text-[#937022] mt-0.5">{session.commemoration}</p>}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-4 text-[11px] text-gray-500 mb-3">
                            <div className="flex items-center gap-1"><Clock size={14} className="text-gray-400" /><span>{session.time} – {session.endTime}</span></div>
                            <div className="flex items-start gap-1">
                              {session.isVirtual ? <Video size={14} className="text-gray-400 mt-0.5" /> : <MapPin size={14} className="text-gray-400 mt-0.5" />}
                              <div className="flex flex-col"><span className="font-bold text-gray-700">{session.city}</span><span className="truncate max-w-[150px]">{session.location}</span></div>
                            </div>
                          </div>
                          <p className="text-xs text-gray-500 leading-relaxed mb-4 line-clamp-2">{session.description}</p>
                          <button onClick={() => setSelectedEvent(session)} className="w-full py-3 bg-gray-900 text-white rounded-xl text-[10px] font-black uppercase tracking-[0.15em] hover:bg-black transition-all active:scale-95">
                            {t.viewDetails}
                          </button>
                        </div>
                      </div>
                    )) : (
                      <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center text-gray-300 mb-4"><Calendar size={32} /></div>
                        <h3 className="font-bold text-gray-900">{t.noEvents}</h3>
                        <p className="text-xs text-gray-400 mt-1">{t.noEventsSub}</p>
                      </div>
                    )}
                  </div>
                  <button onClick={onShowFullCalendar} className="w-full mt-8 py-4 bg-gray-100 rounded-xl text-[11px] font-bold uppercase tracking-widest text-gray-900 hover:bg-gray-200 transition-colors">
                    {t.seeFullCalendar}
                  </button>
                </div>
              </>
            )}
          </>
        ) : (
          <div className="px-6 space-y-6">
            <SaintsMonthView language={language} t={t} mobile />
          </div>
        )}
      </div>
    </motion.div>
  );
}
