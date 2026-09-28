import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Clock, MapPin, ChevronRight, BookOpen, ArrowRight, ArrowLeft, Heart, Church } from 'lucide-react';
import DOMPurify from 'dompurify';
import { getSaintDayDisplay } from '../lib/db/saintDisplay';
import { Event } from '../data/events';
import type { Newsletter } from '../data/newsletters';
import { Language, Church as ChurchType } from '../types';
import { AppTranslations, TRANSLATIONS } from '../translations';
import type { FirestoreNewsletter } from '../lib/db/newsletters';
import type { ChurchPost } from '../lib/db/posts';
import {
  getSaintIndexForDate,
  getSaintDetailForDate,
  getSaintLocalizedText,
  todayDateKey,
  type SaintIndexDay,
  type SaintFullDay,
} from '../lib/db/saints';

type SaintDayPreview = {
  dateKey: string;
  saints: SaintIndexDay;
};

const SANITIZE_CONFIG = {
  ALLOWED_TAGS: ['h1','h2','h3','p','strong','em','ul','ol','li','br','a','blockquote','pre','code','hr'],
  ALLOWED_ATTR: ['href','target','rel'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|\/)/i,
};

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName === 'A' && node instanceof Element && node.getAttribute('target') === '_blank') {
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

function firestoreNewsletterToUI(nl: FirestoreNewsletter, index: number): Newsletter {
  return {
    id: index + 1,
    title: nl.title,
    date: nl.publishedAt?.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) ?? '',
    excerpt: nl.excerpt || nl.content.slice(0, 120) + '…',
    imageUrl: '',
    readTime: `${Math.max(1, Math.ceil(nl.content.split(/\s+/).length / 200))} min read`,
    content: nl.content,
  };
}

function dateFromDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function dateKeyFromDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const date = dateFromDateKey(dateKey);
  date.setDate(date.getDate() + days);
  return dateKeyFromDate(date);
}

function formatSaintDate(dateKey: string): string {
  return dateFromDateKey(dateKey).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getPostPreview(post: ChurchPost): string {
  if (typeof DOMParser === 'undefined') {
    return '';
  }

  const doc = new DOMParser().parseFromString(post.contentHtml, 'text/html');
  return doc.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

interface HomeScreenProps {
  events: Event[];
  onSelectEvent: (event: Event) => void;
  onOpenGiving: () => void;
  language: Language;
  activeChurch: ChurchType;
  churchPosts?: ChurchPost[];
  newsletters?: FirestoreNewsletter[];
  showSaintDays?: boolean;
}

export default function HomeScreen({ events, onSelectEvent, onOpenGiving, language, activeChurch, churchPosts = [], newsletters: firestoreNewsletters = [], showSaintDays = false }: HomeScreenProps) {
  const t = TRANSLATIONS[language].home;
  const [showAllNewsletters, setShowAllNewsletters] = useState(false);
  const [selectedNewsletter, setSelectedNewsletter] = useState<Newsletter | null>(null);
  const NEWSLETTERS = useMemo(() => firestoreNewsletters.map(firestoreNewsletterToUI), [firestoreNewsletters]);
  const [selectedPost, setSelectedPost] = useState<ChurchPost | null>(null);
  const [todaySaints, setTodaySaints] = useState<SaintIndexDay | null>(null);
  const [upcomingSaintDays, setUpcomingSaintDays] = useState<SaintDayPreview[]>([]);
  const [saintDetail, setSaintDetail] = useState<SaintFullDay | null>(null);
  const [saintDetailLoading, setSaintDetailLoading] = useState(false);
  const [showSaintDetail, setShowSaintDetail] = useState(false);

  useEffect(() => {
    if (!showSaintDays) {
      setTodaySaints(null);
      setUpcomingSaintDays([]);
      return;
    }

    let isActive = true;
    const todayKey = todayDateKey();
    const dateKeys = [todayKey, addDaysToDateKey(todayKey, 1), addDaysToDateKey(todayKey, 2)];

    Promise.all(
      dateKeys.map(async (dateKey) => ({
        dateKey,
        saints: await getSaintIndexForDate(dateKey),
      }))
    )
      .then((days) => {
        if (!isActive) return;
        setTodaySaints(days[0]?.saints ?? null);
        setUpcomingSaintDays(
          days.slice(1).filter((day): day is SaintDayPreview => day.saints !== null)
        );
      })
      .catch(() => {
        if (!isActive) return;
        setTodaySaints(null);
        setUpcomingSaintDays([]);
      });

    return () => {
      isActive = false;
    };
  }, [showSaintDays]);

  const openSaintDetail = async () => {
    if (saintDetail) { setShowSaintDetail(true); return; }
    setSaintDetailLoading(true);
    try {
      const detail = await getSaintDetailForDate(todayDateKey());
      setSaintDetail(detail);
      setShowSaintDetail(true);
    } finally {
      setSaintDetailLoading(false);
    }
  };

  const nextEvent = useMemo(() => {
    const now = Date.now();
    const upcoming = events.filter(e => {
      return (e.sortTime ?? 0) >= now;
    });
    return upcoming.sort((a, b) => {
      return (a.sortTime ?? 0) - (b.sortTime ?? 0);
    })[0] ?? events[0] ?? null;
  }, [events]);

  const featuredPost = churchPosts[0] ?? null;
  const secondaryPosts = churchPosts.slice(1, 4);
  const featuredPostPreview = useMemo(
    () => (featuredPost ? getPostPreview(featuredPost) : ''),
    [featuredPost]
  );
  const readMoreLabel = TRANSLATIONS[language].community.readMore;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="pb-24 lg:pb-12"
    >
      {/* ── Mobile hero (hidden on desktop) ─────────────────────── */}
      <div className="mb-8 relative h-80 overflow-hidden lg:hidden">
        <img
          src={activeChurch.image}
          alt={activeChurch.name}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        <div className="absolute bottom-8 left-8 right-8">
          <span className="text-[#937022] font-black text-[10px] tracking-[0.3em] uppercase mb-2 block">{t.yourParish}</span>
          <h3 className="text-4xl font-black text-white tracking-tighter leading-tight">{activeChurch.name}</h3>
          <div className="flex items-center gap-2 text-white/60 text-[10px] font-bold uppercase tracking-widest mt-2">
            <MapPin size={12} className="text-[#937022]" />
            {activeChurch.location}
          </div>
        </div>
      </div>

      {/* ── Mobile content (hidden on desktop) ───────────────────── */}
      <div className="px-8 lg:hidden">
        <MobileContent
          t={t}
          nextEvent={nextEvent}
          onOpenGiving={onOpenGiving}
          onSelectEvent={onSelectEvent}
          churchPosts={churchPosts}
          setSelectedPost={setSelectedPost}
          showSaintDays={showSaintDays}
          todaySaints={todaySaints}
          saintDetailLoading={saintDetailLoading}
          language={language}
          onOpenSaintDetail={() => void openSaintDetail()}
        />
      </div>

      {/* ── Desktop home layout (hidden on mobile) ───────────────── */}
      <div className="hidden lg:block lg:w-full lg:max-w-7xl lg:mx-auto lg:px-8 xl:px-10 lg:pt-6">

        {/* Premium Panoramic Church Banner — clean, atmospheric, and highly integrated */}
        <div className="relative w-full h-40 xl:h-44 rounded-[32px] overflow-hidden mb-10 shadow-lg shadow-black/5 border border-gray-100 group">
          <img
            src={activeChurch.image}
            alt={activeChurch.name}
            className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-[1.02]"
            referrerPolicy="no-referrer"
          />
          {/* Elegant dark gradient overlay for superb text contrast */}
          <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/40 to-transparent" />

          {/* Content floating on the atmospheric church photo background */}
          <div className="absolute inset-0 flex flex-col justify-center px-8 xl:px-10 space-y-1.5">
            <span className="text-[#937022] font-black text-[9px] tracking-[0.3em] uppercase">
              {t.yourParish}
            </span>
            <h1 className="text-2xl xl:text-3xl font-black text-white tracking-tight leading-none">
              {activeChurch.name}
            </h1>
            <p className="text-white/70 text-xs font-medium max-w-xl leading-relaxed">
              Welcome to our digital sanctuary. Here you can follow liturgies, read bulletins, and participate in parish life.
            </p>
          </div>
        </div>

        {/* Reimagined Grid: Left column for Announcements & Weekly Bulletins; Right column for Next Event & Saint of the Day */}
        <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_390px] lg:gap-8 xl:gap-10 lg:items-start">

          {/* Left Column (Wider): Reading Materials (Announcements & Bulletins) */}
          <div className="space-y-10">

            {/* Latest Announcements */}
            <div>
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-[11px] font-black text-gray-500 uppercase tracking-[0.25em]">{t.latestAnnouncements}</h2>
                <div className="h-px flex-1 bg-gray-100 ml-4" />
              </div>

              {featuredPost ? (
                <div className="space-y-6">
                  <button
                    onClick={() => setSelectedPost(featuredPost)}
                    className="group w-full text-left transition-all active:scale-[0.99]"
                  >
                    <div className="overflow-hidden rounded-[28px] border-2 border-[#937022]/15 bg-white p-7 xl:p-8 shadow-xl shadow-black/5 hover:shadow-2xl hover:border-[#800000]/30 transition-all">
                      <div className="flex items-start gap-6">
                        <div className="w-12 h-12 rounded-2xl bg-[#937022]/10 flex items-center justify-center text-[#937022] flex-shrink-0 group-hover:bg-[#800000]/10 group-hover:text-[#800000] transition-colors">
                          <BookOpen size={24} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-4 mb-3">
                            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[#937022] group-hover:text-[#800000] transition-colors">{readMoreLabel}</span>
                            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-400">
                              {featuredPost.publishedAt?.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) ?? ''}
                            </span>
                          </div>
                          <h3 className="text-2xl xl:text-3xl font-black text-gray-900 tracking-tight leading-tight group-hover:text-[#800000] transition-colors">
                            {featuredPost.title}
                          </h3>
                          {featuredPostPreview && (
                            <p className="mt-4 text-sm font-medium leading-relaxed text-gray-500 line-clamp-3">
                              {featuredPostPreview}
                            </p>
                          )}
                        </div>
                        <div className="mt-12 w-11 h-11 rounded-full bg-gray-900 flex items-center justify-center text-white group-hover:bg-[#800000] transition-colors flex-shrink-0 shadow-md">
                          <ArrowRight size={18} />
                        </div>
                      </div>
                    </div>
                  </button>

                  {secondaryPosts.length > 0 && (
                    <div className="overflow-hidden rounded-[24px] border border-gray-100 bg-white shadow-lg shadow-black/5">
                      {secondaryPosts.map((post, i) => (
                        <button
                          key={post.id}
                          onClick={() => setSelectedPost(post)}
                          className="group flex w-full items-center gap-4 border-b border-gray-50 px-6 py-4 text-left last:border-b-0 transition-colors hover:bg-gray-50/70"
                        >
                          <div className="w-9 h-9 rounded-xl bg-gray-50 flex items-center justify-center text-[#937022] group-hover:bg-[#800000]/5 group-hover:text-[#800000] flex-shrink-0 transition-colors">
                            {i % 2 === 0 ? <BookOpen size={17} /> : <Church size={17} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h4 className="text-sm font-black text-gray-900 group-hover:text-[#800000] line-clamp-1 transition-colors">{post.title}</h4>
                            <p className="mt-0.5 text-[9px] font-bold uppercase tracking-widest text-gray-400">
                              {post.publishedAt?.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) ?? ''}
                            </p>
                          </div>
                          <ChevronRight size={14} className="text-gray-300 group-hover:text-[#800000] group-hover:translate-x-1 transition-all" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="overflow-hidden rounded-[24px] border border-gray-100 bg-white shadow-lg shadow-black/5 min-h-[240px] p-8 flex flex-col items-center justify-center text-center">
                  <BookOpen size={26} className="text-gray-300 mb-3" />
                  <p className="text-sm font-bold text-gray-400">{t.noAnnouncements}</p>
                </div>
              )}
            </div>

          </div>

          {/* Right Column (Sidebar): Events & Saints only — Clean, minimal, no "too much action" */}
          <div className="space-y-10">

            {/* Next Event Section */}
            {nextEvent && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-[11px] font-black text-gray-500 uppercase tracking-[0.25em]">{t.nextEvent}</h2>
                  <div className="h-px flex-1 bg-gray-100 ml-4" />
                </div>
                <button
                  onClick={() => onSelectEvent(nextEvent)}
                  className="w-full bg-white rounded-[24px] overflow-hidden shadow-lg shadow-black/5 border border-gray-100 group transition-all active:scale-[0.98] hover:shadow-xl text-left"
                >
                  <div className="p-6">
                    <div className="flex justify-between items-start gap-4 mb-4">
                      <div className="min-w-0">
                        <span className="bg-[#800000] text-white text-[9px] font-black px-2.5 py-1 rounded uppercase tracking-widest mb-2 inline-block leading-none">{nextEvent.category}</span>
                        <h3 className="text-xl font-black text-gray-900 tracking-tight leading-tight group-hover:text-[#800000] transition-colors">{nextEvent.title}</h3>
                        {nextEvent.commemoration && <p className="text-[10px] font-bold text-[#937022] mt-1">{nextEvent.commemoration}</p>}
                      </div>
                      <div className="w-11 h-11 rounded-2xl bg-[#937022]/10 flex flex-col items-center justify-center flex-shrink-0">
                        <span className="text-[9px] font-black text-[#937022] leading-none uppercase">{nextEvent.month}</span>
                        <span className="text-base font-black text-gray-900 leading-none mt-0.5">{nextEvent.date}</span>
                      </div>
                    </div>
                    <div className="space-y-2.5 mb-5">
                      <div className="flex items-center gap-2.5 text-gray-500 text-xs font-bold">
                        <Clock size={15} className="text-[#937022]" />
                        {nextEvent.time} – {nextEvent.endTime}
                      </div>
                      <div className="flex items-center gap-2.5 text-gray-500 text-xs font-bold">
                        <MapPin size={15} className="text-[#937022]" />
                        {nextEvent.location}
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                      <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest group-hover:text-[#800000] transition-colors">{t.viewDetails}</span>
                      <div className="w-9 h-9 rounded-full bg-gray-950 flex items-center justify-center text-white group-hover:bg-[#800000] transition-colors shadow-sm">
                        <ArrowRight size={16} />
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            )}

            {/* Saint of the Day Section */}
            {showSaintDays && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-[11px] font-black text-gray-500 uppercase tracking-[0.25em]">{t.saintOfDay}</h2>
                  <div className="h-px flex-1 bg-gray-100 ml-4" />
                </div>
                <SaintCard
                  saints={todaySaints}
                  upcomingDays={upcomingSaintDays}
                  language={language}
                  saintDetailLoading={saintDetailLoading}
                  onReadLife={() => void openSaintDetail()}
                  t={t}
                  rounded="rounded-[24px]"
                />
              </div>
            )}

          </div>

        </div>
      </div>

      {NEWSLETTERS.length > 0 && (
        <section className="mx-auto mb-10 max-w-7xl px-8" aria-label={t.weeklyBulletins}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold">{t.weeklyBulletins}</h2>
            {NEWSLETTERS.length > 3 && <button type="button" onClick={() => setShowAllNewsletters((value) => !value)} className="text-sm font-bold text-[#800000]">{showAllNewsletters ? t.closeHistory : t.history}</button>}
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {(showAllNewsletters ? NEWSLETTERS : NEWSLETTERS.slice(0, 3)).map((newsletter) => (
              <button key={newsletter.id} type="button" onClick={() => setSelectedNewsletter(newsletter)} className="rounded-2xl border border-gray-100 bg-white p-5 text-left">
                <p className="text-xs text-gray-500">{newsletter.date}</p>
                <h3 className="my-2 font-bold">{newsletter.title}</h3>
                <span className="text-sm font-bold text-[#800000]">{t.readBulletin} →</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Saint Detail Modal */}
      <AnimatePresence>
        {showSaintDetail && saintDetail && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-white flex flex-col"
          >
            <div className="px-6 pb-4 flex items-center justify-between border-b border-gray-50 sticky top-0 bg-white z-10" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1.25rem)' }}>
              <button onClick={() => setShowSaintDetail(false)} className="w-10 h-10 flex items-center justify-center text-gray-900 hover:bg-gray-50 rounded-full transition-colors">
                <ArrowLeft size={24} />
              </button>
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t.saintOfDay}</span>
              <div className="w-10" />
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-hide">
              <div className="max-w-3xl mx-auto px-8 py-10 space-y-10">
                {saintDetail.saints.map((saint, i) => {
                  const name = getSaintLocalizedText(saint.name, language, false);
                  const description = getSaintLocalizedText(saint.description, language, false);
                  if (!name && !description) return null;
                  return (
                    <div key={i} className="space-y-2">
                      {name && <h2 className="text-xl font-black text-gray-900 tracking-tight">{name}</h2>}
                      {description && <p className="text-xs text-gray-500 leading-relaxed">{description}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Post Detail Modal */}
      <AnimatePresence>
        {selectedPost && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-white flex flex-col"
          >
            <div className="px-6 pb-4 flex items-center justify-between border-b border-gray-50 sticky top-0 bg-white z-10" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1.25rem)' }}>
              <button onClick={() => setSelectedPost(null)} className="w-10 h-10 flex items-center justify-center text-gray-900 hover:bg-gray-50 rounded-full transition-colors">
                <ArrowLeft size={24} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-hide">
              <div className="max-w-3xl mx-auto px-8 py-10">
                <span className="text-[#937022] font-black text-[10px] tracking-[0.2em] uppercase mb-3 block">
                  {selectedPost.publishedAt?.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                </span>
                <h1 className="text-3xl font-black text-gray-900 tracking-tight mb-4">{selectedPost.title}</h1>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-8">By {selectedPost.authorName}</p>
                <div
                  className="post-content text-gray-700 text-sm leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selectedPost.contentHtml, SANITIZE_CONFIG) }}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Newsletter Detail Modal (works for both mobile and desktop) */}
      <AnimatePresence>
        {selectedNewsletter && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-white flex flex-col"
          >
            <div className="px-6 pb-4 flex items-center justify-between border-b border-gray-50 sticky top-0 bg-white z-10" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1.25rem)' }}>
              <button
                onClick={() => setSelectedNewsletter(null)}
                className="w-10 h-10 flex items-center justify-center text-gray-900 hover:bg-gray-50 rounded-full transition-colors"
              >
                <ArrowLeft size={24} />
              </button>

            </div>
            <div className="flex-1 overflow-y-auto scrollbar-hide">
              <div className="max-w-3xl mx-auto px-8 py-10">
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-[#937022] font-black text-[10px] tracking-[0.2em] uppercase">{selectedNewsletter.date}</span>
                  <span className="text-gray-300">•</span>
                  <span className="text-gray-400 font-bold text-[10px] uppercase tracking-widest">{selectedNewsletter.readTime}</span>
                </div>
                <h2 className="text-3xl font-black text-gray-900 tracking-tighter leading-tight mb-6">{selectedNewsletter.title}</h2>
                {selectedNewsletter.content ? (
                  <div
                    className="post-content text-gray-700 text-sm leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selectedNewsletter.content, SANITIZE_CONFIG) }}
                  />
                ) : (
                  <div className="space-y-6 text-gray-600 text-sm leading-relaxed">
                    <p className="font-bold text-gray-900 italic text-lg">{selectedNewsletter.excerpt}</p>
                  </div>
                )}
                <div className="h-20" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ── Saint card (shared between mobile and desktop) ─────────────────────── */
function SaintCard({
  saints,
  upcomingDays = [],
  language,
  saintDetailLoading,
  onReadLife,
  t,
  rounded = 'rounded-[40px]',
}: {
  saints: SaintIndexDay | null;
  upcomingDays?: SaintDayPreview[];
  language: Language;
  saintDetailLoading: boolean;
  onReadLife: () => void;
  t: AppTranslations['home'];
  rounded?: string;
}) {
  const [activeTab, setActiveTab] = useState<'today' | 'upcoming'>('today');

  const primaryName = getSaintDayDisplay(saints, language).featuredName;
  const extraCount = saints ? Math.max(0, saints.names.filter((name) => getSaintLocalizedText(name, language, false)).length - 1) : 0;

  return (
    <div className={`bg-white ${rounded} overflow-hidden shadow-xl shadow-black/5 border border-gray-50`}>
      <div className="h-40 relative bg-gradient-to-br from-[#800000]/10 to-[#937022]/10 flex items-center justify-center">
        <span className="text-6xl select-none">✝</span>
        <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent" />
      </div>
      <div className="px-6 pb-6 -mt-6 relative z-10">
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-50">
          {upcomingDays.length > 0 && (
            <div className="flex bg-gray-50 p-1 rounded-xl mb-4 border border-gray-100/50">
              <button
                onClick={() => setActiveTab('today')}
                className={`flex-1 text-center py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${
                  activeTab === 'today'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                {t.saintOfDay}
              </button>
              <button
                onClick={() => setActiveTab('upcoming')}
                className={`flex-1 text-center py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${
                  activeTab === 'upcoming'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                {t.upcomingSaints}
              </button>
            </div>
          )}

          {activeTab === 'today' ? (
            <>
              {primaryName ? (
                <>
                  <h3 className="text-base font-black text-gray-900 tracking-tight leading-tight line-clamp-2">{primaryName}</h3>
                  {extraCount > 0 && (
                    <p className="text-[10px] text-[#937022] font-black uppercase tracking-widest mt-1">
                      +{extraCount} more {extraCount === 1 ? 'commemoration' : 'commemorations'}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-500">{t.noSaintData}</p>
              )}
              {primaryName && <button
                onClick={onReadLife}
                disabled={saintDetailLoading}
                className="mt-3 text-[10px] font-black text-gray-900 uppercase tracking-widest flex items-center gap-2 hover:text-[#937022] transition-colors disabled:opacity-50"
              >
                {saintDetailLoading ? 'Loading…' : t.readLife} <ArrowRight size={12} />
              </button>}
            </>
          ) : (
            <div>
              <div className="space-y-3">
                {upcomingDays.map((day) => {
                  const name = getSaintDayDisplay(day.saints, language).featuredName;
                  const extraCount = Math.max(0, day.saints.names.filter((name) => getSaintLocalizedText(name, language, false)).length - 1);

                  return (
                    <div key={day.dateKey} className="flex items-start gap-3">
                      <span className="w-12 flex-shrink-0 text-[9px] font-black text-[#937022] uppercase tracking-widest pt-0.5">
                        {formatSaintDate(day.dateKey)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-black text-gray-900 leading-tight line-clamp-2">{name}</p>
                        {extraCount > 0 && (
                          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-1">
                            +{extraCount} more
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Shared mobile content (reused below lg) ──────────────────────────── */
function MobileContent({
  t, nextEvent, onOpenGiving, onSelectEvent, churchPosts, setSelectedPost, showSaintDays, todaySaints, saintDetailLoading, language, onOpenSaintDetail,
}: {
  t: AppTranslations['home'];
  nextEvent: Event | null;
  onOpenGiving: () => void;
  onSelectEvent: (e: Event) => void;
  churchPosts: ChurchPost[];
  setSelectedPost: (p: ChurchPost | null) => void;
  showSaintDays: boolean;
  todaySaints: SaintIndexDay | null;
  saintDetailLoading: boolean;
  language: Language;
  onOpenSaintDetail: () => void;
}) {
  return (
    <>
      {/* Announcements / Real posts */}
      <div className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">{t.latestAnnouncements}</h2>
          <div className="h-px flex-1 bg-gray-100 ml-4" />
        </div>
        {churchPosts.length > 0 ? (
          <div className="space-y-3">
            {churchPosts.slice(0, 3).map((post, i) => (
              <div
                key={post.id}
                onClick={() => setSelectedPost(post)}
                className="bg-white p-4 rounded-2xl border border-gray-50 shadow-sm flex items-center gap-4 cursor-pointer active:scale-[0.98] transition-all"
              >
                <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-[#937022]">
                  {i % 2 === 0 ? <BookOpen size={18} /> : <Church size={18} />}
                </div>
                <div className="flex-1">
                  <h4 className="text-xs font-black text-gray-900 line-clamp-1">{post.title}</h4>
                  <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">
                    {post.publishedAt?.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) ?? ''}
                  </p>
                </div>
                <ChevronRight size={14} className="text-gray-300" />
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-gray-50 rounded-3xl p-6 text-center">
            <BookOpen size={20} className="text-gray-300 mx-auto mb-2" />
            <p className="text-sm font-bold text-gray-400">{t.noAnnouncements}</p>
          </div>
        )}
      </div>

      {/* Daily Saint */}
      {showSaintDays && (
        <div className="mb-12">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">{t.saintOfDay}</h2>
            <div className="h-px flex-1 bg-gray-100 ml-4" />
          </div>
          <SaintCard
            saints={todaySaints}
            language={language}
            saintDetailLoading={saintDetailLoading}
            onReadLife={onOpenSaintDetail}
            t={t}
          />
        </div>
      )}

      <button type="button" onClick={onOpenGiving} className="mb-8 flex items-center gap-3 rounded-2xl bg-white px-5 py-4 font-bold text-[#800000] shadow-sm">
        <Heart size={20} /> {t.giving}
      </button>

      {/* Next Event */}
      {nextEvent && (
        <div className="mb-12">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">{t.nextEvent}</h2>
            <div className="h-px flex-1 bg-gray-100 ml-4" />
          </div>
          <button
            onClick={() => onSelectEvent(nextEvent)}
            className="w-full bg-white rounded-[40px] overflow-hidden shadow-xl shadow-black/5 border border-gray-50 group transition-all active:scale-[0.98]"
          >
            <div className="p-8">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <span className="bg-[#800000] text-white text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-widest mb-2 inline-block">{nextEvent.category}</span>
                  <h3 className="text-2xl font-black text-gray-900 tracking-tight leading-tight">{nextEvent.title}</h3>
                  {nextEvent.commemoration && <p className="text-[10px] font-bold text-[#937022] mt-1">{nextEvent.commemoration}</p>}
                </div>
                <div className="w-12 h-12 rounded-2xl bg-gray-50 flex flex-col items-center justify-center">
                  <span className="text-[10px] font-black text-[#937022] leading-none">{nextEvent.month}</span>
                  <span className="text-lg font-black text-gray-900 leading-none">{nextEvent.date}</span>
                </div>
              </div>
              <div className="space-y-3 mb-8">
                <div className="flex items-center gap-3 text-gray-500 text-[11px] font-bold">
                  <Clock size={14} className="text-[#937022]" />{nextEvent.time} – {nextEvent.endTime}
                </div>
                <div className="flex items-center gap-3 text-gray-500 text-[11px] font-bold">
                  <MapPin size={14} className="text-[#937022]" /><span className="text-gray-900">{nextEvent.location}</span>
                </div>
              </div>
              <div className="flex items-center justify-between pt-6 border-t border-gray-50">
                <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{t.viewDetails}</span>
                <div className="w-10 h-10 rounded-full bg-gray-900 flex items-center justify-center text-white group-hover:bg-[#800000] transition-colors">
                  <ArrowRight size={18} />
                </div>
              </div>
            </div>
          </button>
        </div>
      )}

    </>
  );
}
