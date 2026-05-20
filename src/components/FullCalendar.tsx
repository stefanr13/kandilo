import { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Clock, MapPin, ArrowLeft, Calendar } from 'lucide-react';
import { motion } from 'motion/react';
import { Event, Category } from '../data/events';
import { Language } from '../types';
import { useSaintsForMonth } from '../hooks/useSaintsForMonth';
import { getSaintLocalizedText, getSaintIndexForMonth } from '../lib/db/saints';
import { getExtraCopy } from '../localization/extra';

export interface FullCalendarProps {
  events: Event[];
  onClose: () => void;
  onSelectEvent: (event: Event) => void;
  language?: Language;
  showSaintDays?: boolean;
}

const LOCALES: Record<Language, string> = {
  English: 'en-US',
  'Srpski (Latinica)': 'sr-Latn',
  'Srpski (Ćirilica)': 'sr-Cyrl',
  Русский: 'ru',
  Română: 'ro',
  Українська: 'uk',
};

export default function FullCalendar({
  events,
  onClose,
  onSelectEvent,
  language = 'English',
  showSaintDays = false,
}: FullCalendarProps) {
  const [currentDate, setCurrentDate] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState<number | null>(new Date().getDate());
  const [selectedCategory, setSelectedCategory] = useState<Category | 'All'>('All');
  const copy = getExtraCopy(language).fullCalendar;
  const locale = LOCALES[language] ?? undefined;

  const saintsForMonth = useSaintsForMonth(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    showSaintDays
  );
  const filterScrollRef = useRef<HTMLDivElement>(null);

  // Warm the cache for the adjacent months so navigation feels instant.
  useEffect(() => {
    if (!showSaintDays) return;
    const next = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
    const prev = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
    void getSaintIndexForMonth(next.getFullYear(), next.getMonth());
    void getSaintIndexForMonth(prev.getFullYear(), prev.getMonth());
  }, [currentDate, showSaintDays]);

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

  const daysInMonth = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    
    const days = [];
    // Padding for previous month
    for (let i = 0; i < firstDay; i++) {
      days.push({ day: null, month: 'prev' });
    }
    // Current month days
    for (let i = 1; i <= totalDays; i++) {
      days.push({ day: i, month: 'current' });
    }
    return days;
  }, [currentDate]);

  const monthName = currentDate.toLocaleString(locale, { month: 'long' });
  const year = currentDate.getFullYear();

  const currentMonthShort = currentDate
    .toLocaleString('en-US', { month: 'short' })
    .toUpperCase();
  const weekDays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const day = new Date(2026, 1, 1 + index);
        return day.toLocaleDateString(locale, { weekday: 'short' }).slice(0, 1);
      }),
    [locale]
  );

  const getEventsForDay = (day: number) => {
    return events.filter(e => {
      const matchesDay = parseInt(e.date) === day && e.month === currentMonthShort;
      const matchesCategory = selectedCategory === 'All' || e.category === selectedCategory;
      return matchesDay && matchesCategory;
    });
  };

  const nextMonth = () => setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() + 1)));
  const prevMonth = () => setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() - 1)));

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="absolute inset-0 bg-white z-[60] flex flex-col"
    >
      {/* Header */}
      <div className="px-6 lg:px-10 pb-4 flex items-center justify-between border-b border-gray-50 bg-white sticky top-0 z-10" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1.25rem)' }}>
        <button 
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center text-gray-900 hover:bg-gray-50 rounded-full transition-colors"
        >
          <ArrowLeft size={24} />
        </button>
        <h2 className="text-lg font-black text-gray-900 uppercase tracking-[0.2em]">{copy.title}</h2>
        <div className="w-10"></div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {/* Filters Section */}
        <div className="px-6 pt-6 space-y-4 lg:w-full lg:max-w-7xl lg:mx-auto lg:px-10">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">{copy.filters}</span>
          </div>

          {/* Category Filter */}
          <div 
            ref={filterScrollRef}
            className="overflow-x-auto scrollbar-hide flex gap-2 pb-2 cursor-grab active:cursor-grabbing"
          >
            <button 
              onClick={() => setSelectedCategory('All')}
              className={`px-4 py-2 rounded-full text-[9px] font-bold whitespace-nowrap transition-all uppercase tracking-widest ${
                selectedCategory === 'All' ? 'bg-gray-900 text-white shadow-lg' : 'bg-white text-gray-400 border border-gray-100'
              }`}
            >
              {copy.all}
            </button>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-4 py-2 rounded-full text-[9px] font-bold whitespace-nowrap transition-all uppercase tracking-widest ${
                  selectedCategory === cat ? 'bg-[#800000] text-white shadow-lg' : 'bg-white text-gray-400 border border-gray-100'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Month Selector */}
        <div className="px-6 py-6 flex items-center justify-between lg:w-full lg:max-w-7xl lg:mx-auto lg:px-10">
          <h3 className="text-2xl font-black text-gray-900 tracking-tighter">
            {monthName} <span className="text-gray-300">{year}</span>
          </h3>
          <div className="flex gap-2">
            <button onClick={prevMonth} className="p-2 hover:bg-gray-50 rounded-xl transition-colors text-gray-400">
              <ChevronLeft size={20} />
            </button>
            <button onClick={nextMonth} className="p-2 hover:bg-gray-50 rounded-xl transition-colors text-gray-400">
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="px-4 lg:px-10 lg:w-full lg:max-w-7xl lg:mx-auto lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-8 lg:items-start">
          <div>
            <div className="grid grid-cols-7 mb-2">
              {weekDays.map((d, index) => (
                <div key={`${d}-${index}`} className="text-center text-[10px] font-black text-gray-300 uppercase tracking-widest py-2">
                  {d}
                </div>
              ))}
            </div>
            
            <div className="grid grid-cols-7 gap-px bg-gray-50 border border-gray-50 rounded-3xl overflow-hidden shadow-inner">
              {daysInMonth.map((d, i) => {
                const dayEvents = d.day ? getEventsForDay(d.day) : [];
                const isSelected = selectedDay === d.day;
                const today = new Date();
                const isToday =
                  d.day === today.getDate() &&
                  currentDate.getMonth() === today.getMonth() &&
                  currentDate.getFullYear() === today.getFullYear();

                const mm = String(currentDate.getMonth() + 1).padStart(2, '0');
                const dd = String(d.day).padStart(2, '0');
                const dateKey = d.day ? `${currentDate.getFullYear()}-${mm}-${dd}` : null;
                const daySaints = dateKey ? saintsForMonth[dateKey] : null;
                const primarySaintName = getSaintLocalizedText(daySaints?.names[0], language, false) || null;

                return (
                  <div
                    key={i}
                    onClick={() => d.day && setSelectedDay(d.day)}
                    className={`min-h-[80px] lg:min-h-[118px] bg-white p-1.5 lg:p-2 relative transition-all ${d.day ? 'cursor-pointer hover:bg-gray-50' : 'bg-gray-50/50'}`}
                  >
                    <div className="flex justify-between items-start p-1">
                      <span className={`text-[11px] lg:text-xs font-black ${
                        isToday ? 'bg-[#800000] text-white w-5 h-5 rounded-full flex items-center justify-center' :
                        isSelected ? 'text-[#937022]' : 'text-gray-400'
                      }`}>
                        {d.day}
                      </span>
                    </div>

                    {/* Event dots */}
                    <div className="space-y-0.5 mt-0.5 px-1">
                      {dayEvents.map(event => (
                        <div
                          key={event.id}
                          className="h-1 lg:h-1.5 rounded-full w-full"
                          style={{ backgroundColor: event.color }}
                          title={event.title}
                        />
                      ))}
                    </div>

                    {/* Saint name */}
                    {showSaintDays && primarySaintName && (
                      <p className="px-1 mt-1 text-[7px] lg:text-[9px] font-bold text-[#800000] leading-tight line-clamp-2 opacity-80">
                        {primarySaintName}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Selected Day Schedule */}
          <div className="px-2 py-8 lg:px-0 lg:py-0 lg:sticky lg:top-6">
            <div className="flex items-center justify-between mb-6">
            <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
              {selectedDay
                ? copy.scheduleFor(currentDate.toLocaleString(locale, { month: 'short' }), selectedDay)
                : copy.selectDay}
            </h4>
            <div className="h-px flex-1 bg-gray-100 ml-4"></div>
            </div>

            <div className="space-y-4">
            {selectedDay && getEventsForDay(selectedDay).length > 0 ? (
              getEventsForDay(selectedDay).map(event => (
                <button 
                  key={event.id}
                  onClick={() => {
                    onSelectEvent(event);
                    onClose();
                  }}
                  className="w-full bg-white border border-gray-100 rounded-[28px] p-5 flex items-center gap-5 shadow-sm hover:shadow-md transition-all group text-left"
                >
                  <div 
                    className="w-1.5 h-12 rounded-full flex-shrink-0"
                    style={{ backgroundColor: event.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-[9px] font-black uppercase tracking-widest mb-1 block" style={{ color: event.color }}>
                      {event.category}
                    </span>
                    <h5 className="font-black text-gray-900 text-sm truncate">{event.title}</h5>
                    <div className="flex flex-col gap-1 mt-1.5">
                      <div className="flex items-center gap-1.5 text-gray-400 text-[10px] font-bold">
                        <Clock size={10} className="text-[#937022]" />
                        {event.time} – {event.endTime}
                      </div>
                      <div className="flex items-center gap-1.5 text-gray-400 text-[10px] font-bold">
                        <MapPin size={10} className="text-[#937022]" />
                        <span className="text-gray-700">{event.location}</span>
                        <span className="text-gray-300">•</span>
                        <span>{event.city}</span>
                      </div>
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-gray-200 group-hover:text-gray-400 transition-colors" />
                </button>
              ))
            ) : (
              <div className="text-center py-12 bg-gray-50 rounded-[32px] border border-dashed border-gray-200">
                <Calendar size={32} className="text-gray-200 mx-auto mb-3" />
                <p className="text-xs font-bold text-gray-400">{copy.noEvents}</p>
              </div>
            )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
