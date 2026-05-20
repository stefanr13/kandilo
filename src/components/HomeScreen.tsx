import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Clock, MapPin, ChevronRight, BookOpen, ArrowRight, History, X, ArrowLeft, Share2, Bookmark, Flame, MessageSquare, Heart } from 'lucide-react';
import DOMPurify from 'dompurify';
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

interface HomeScreenProps {
  events: Event[];
  onSelectEvent: (event: Event) => void;
  language: Language;
  activeChurch: ChurchType;
  churchPosts?: ChurchPost[];
  newsletters?: FirestoreNewsletter[];
  showSaintDays?: boolean;
}

export default function HomeScreen({ events, onSelectEvent, language, activeChurch, churchPosts = [], newsletters: firestoreNewsletters = [], showSaintDays = false }: HomeScreenProps) {
  const t = TRANSLATIONS[language].home;
  const [showAllNewsletters, setShowAllNewsletters] = useState(false);
  const [selectedNewsletter, setSelectedNewsletter] = useState<Newsletter | null>(null);
  const NEWSLETTERS = useMemo(() => firestoreNewsletters.map(firestoreNewsletterToUI), [firestoreNewsletters]);
  const [selectedPost, setSelectedPost] = useState<ChurchPost | null>(null);
  const [todaySaints, setTodaySaints] = useState<SaintIndexDay | null>(null);
  const [saintDetail, setSaintDetail] = useState<SaintFullDay | null>(null);
  const [saintDetailLoading, setSaintDetailLoading] = useState(false);
  const [showSaintDetail, setShowSaintDetail] = useState(false);

  useEffect(() => {
    if (!showSaintDays) { setTodaySaints(null); return; }
    getSaintIndexForDate(todayDateKey())
      .then(setTodaySaints)
      .catch(() => setTodaySaints(null));
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

  const latestNewsletter = NEWSLETTERS[0] ?? null;

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
          latestNewsletter={latestNewsletter}
          newsletters={NEWSLETTERS}
          showAllNewsletters={showAllNewsletters}
          setShowAllNewsletters={setShowAllNewsletters}
          setSelectedNewsletter={setSelectedNewsletter}
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

      {/* ── Desktop 2-column grid (hidden on mobile) ─────────────── */}
      <div className="hidden lg:grid lg:w-full lg:max-w-7xl lg:mx-auto lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.85fr)] lg:gap-8 xl:gap-10 lg:px-10 lg:pt-8 lg:items-start">
        {/* Left column: hero card + next event + bulletins */}
        <div className="space-y-8">
          {/* Desktop hero card */}
          <div className="relative h-72 xl:h-80 rounded-3xl overflow-hidden shadow-2xl shadow-black/10">
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

          {/* Upcoming Event */}
          {nextEvent && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">{t.nextEvent}</h2>
                <div className="h-px flex-1 bg-gray-100 ml-4" />
              </div>
              <button
                onClick={() => onSelectEvent(nextEvent)}
                className="w-full bg-white rounded-[32px] overflow-hidden shadow-xl shadow-black/5 border border-gray-50 group transition-all active:scale-[0.98] hover:shadow-2xl"
              >
                <div className="p-8">
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <span className="bg-[#800000] text-white text-[9px] font-black px-2 py-0.5 rounded uppercase tracking-widest mb-2 inline-block">{nextEvent.category}</span>
                      <h3 className="text-2xl font-black text-gray-900 tracking-tight leading-tight">{nextEvent.title}</h3>
                      {nextEvent.commemoration && <p className="text-[10px] font-bold text-[#937022] mt-1">{nextEvent.commemoration}</p>}
                    </div>
                    <div className="w-12 h-12 rounded-2xl bg-gray-50 flex flex-col items-center justify-center ml-4">
                      <span className="text-[10px] font-black text-[#937022] leading-none">{nextEvent.month}</span>
                      <span className="text-lg font-black text-gray-900 leading-none">{nextEvent.date}</span>
                    </div>
                  </div>
                  <div className="flex gap-6 mb-6">
                    <div className="flex items-center gap-2 text-gray-500 text-[11px] font-bold">
                      <Clock size={14} className="text-[#937022]" />
                      {nextEvent.time} – {nextEvent.endTime}
                    </div>
                    <div className="flex items-center gap-2 text-gray-500 text-[11px] font-bold">
                      <MapPin size={14} className="text-[#937022]" />
                      {nextEvent.location}
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-4 border-t border-gray-50">
                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">{t.viewDetails}</span>
                    <div className="w-9 h-9 rounded-full bg-gray-900 flex items-center justify-center text-white group-hover:bg-[#800000] transition-colors">
                      <ArrowRight size={16} />
                    </div>
                  </div>
                </div>
              </button>
            </div>
          )}

          {/* Weekly Bulletins */}
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">{t.weeklyBulletins}</h2>
              {NEWSLETTERS.length > 1 && (
                <button
                  onClick={() => setShowAllNewsletters(!showAllNewsletters)}
                  className="flex items-center gap-1.5 text-[10px] font-black text-[#937022] uppercase tracking-widest hover:opacity-70 transition-opacity"
                >
                  {showAllNewsletters ? t.closeHistory : t.history}
                  {showAllNewsletters ? <X size={12} /> : <History size={12} />}
                </button>
              )}
            </div>
            {NEWSLETTERS.length === 0 ? (
              <div className="bg-gray-50 rounded-[32px] p-8 text-center">
                <BookOpen size={24} className="text-gray-300 mx-auto mb-3" />
                <p className="text-sm font-bold text-gray-400">{t.noBulletins}</p>
              </div>
            ) : (
              <AnimatePresence mode="wait">
                {!showAllNewsletters && latestNewsletter ? (
                  <motion.div
                    key="latest"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="bg-gray-900 rounded-[32px] p-8 text-white relative overflow-hidden shadow-2xl shadow-black/20"
                  >
                    <div className="absolute top-0 right-0 w-64 h-64 bg-[#800000]/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
                    <div className="relative z-10">
                      <div className="flex items-center gap-2 mb-4">
                        <BookOpen size={16} className="text-[#937022]" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50">{latestNewsletter.date}</span>
                      </div>
                      <h3 className="text-2xl font-black tracking-tighter leading-tight mb-4">{latestNewsletter.title}</h3>
                      <p className="text-white/60 text-xs leading-relaxed mb-8 line-clamp-2">{latestNewsletter.excerpt}</p>
                      <button
                        onClick={() => setSelectedNewsletter(latestNewsletter)}
                        className="w-full py-4 bg-white text-gray-900 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-gray-100 transition-all active:scale-95"
                      >
                        {t.readBulletin}
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="archive"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="grid grid-cols-1 xl:grid-cols-2 gap-3"
                  >
                    {NEWSLETTERS.map((news) => (
                      <button
                        key={news.id}
                        onClick={() => setSelectedNewsletter(news)}
                        className="bg-white border border-gray-100 rounded-[24px] p-5 flex items-center gap-4 shadow-sm hover:shadow-md transition-all group text-left"
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-[8px] font-black text-[#937022] uppercase tracking-widest mb-1 block">{news.date}</span>
                          <h4 className="font-black text-gray-900 text-sm leading-tight">{news.title}</h4>
                          <p className="text-[10px] text-gray-400 font-bold mt-1">{news.readTime}</p>
                        </div>
                        <ChevronRight size={16} className="text-gray-200 group-hover:text-gray-400 transition-colors" />
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </div>
        </div>

        {/* Right column: announcements + saint + quick actions */}
        <div className="space-y-8">
          {/* Announcements / Real posts */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">{t.latestAnnouncements}</h2>
              <div className="h-px flex-1 bg-gray-100 ml-4" />
            </div>
            {churchPosts.length > 0 ? (
              <div className="space-y-3">
                {churchPosts.slice(0, 4).map((post, i) => (
                  <div
                    key={post.id}
                    onClick={() => setSelectedPost(post)}
                    className="bg-white p-4 rounded-2xl border border-gray-50 shadow-sm flex items-center gap-4 transition-all cursor-pointer hover:shadow-md hover:border-gray-200"
                  >
                    <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-[#937022]">
                      {i % 2 === 0 ? <Flame size={18} /> : <BookOpen size={18} />}
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
              <div className="bg-gray-50 rounded-2xl p-6 text-center">
                <Flame size={20} className="text-gray-300 mx-auto mb-2" />
                <p className="text-sm font-bold text-gray-400">{t.noAnnouncements}</p>
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Quick Access</h2>
              <div className="h-px flex-1 bg-gray-100 ml-4" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: t.prayer, icon: MessageSquare, color: '#800000' },
                { label: t.candle, icon: Flame, color: '#937022' },
                { label: t.giving, icon: Heart, color: '#800000' },
              ].map((action, i) => (
                <button key={i} className="flex flex-col items-center gap-3 p-4 bg-white rounded-2xl shadow-sm border border-gray-50 hover:shadow-md active:scale-95 transition-all">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${action.color}10`, color: action.color }}>
                    <action.icon size={20} />
                  </div>
                  <span className="text-center text-[9px] font-black text-gray-900 uppercase tracking-widest leading-tight">{action.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Daily Saint */}
          {showSaintDays && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">{t.saintOfDay}</h2>
                <div className="h-px flex-1 bg-gray-100 ml-4" />
              </div>
              <SaintCard
                saints={todaySaints}
                language={language}
                saintDetailLoading={saintDetailLoading}
                onReadLife={() => void openSaintDetail()}
                t={t}
                rounded="rounded-[32px]"
              />
            </div>
          )}
        </div>
      </div>

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
              <div className="flex gap-2">
                <button className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-gray-900 transition-colors">
                  <Bookmark size={20} />
                </button>
                <button className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-gray-900 transition-colors">
                  <Share2 size={20} />
                </button>
              </div>
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
  language,
  saintDetailLoading,
  onReadLife,
  t,
  rounded = 'rounded-[40px]',
}: {
  saints: SaintIndexDay | null;
  language: Language;
  saintDetailLoading: boolean;
  onReadLife: () => void;
  t: AppTranslations['home'];
  rounded?: string;
}) {
  const primaryName = getSaintLocalizedText(saints?.names[0], language) || t.saintName;
  const extraCount = saints ? Math.max(0, saints.names.length - 1) : 0;

  return (
    <div className={`bg-white ${rounded} overflow-hidden shadow-xl shadow-black/5 border border-gray-50`}>
      <div className="h-40 relative bg-gradient-to-br from-[#800000]/10 to-[#937022]/10 flex items-center justify-center">
        <span className="text-6xl select-none">✝</span>
        <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent" />
      </div>
      <div className="px-6 pb-6 -mt-6 relative z-10">
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-50">
          {saints ? (
            <>
              <h3 className="text-base font-black text-gray-900 tracking-tight leading-tight line-clamp-2">{primaryName}</h3>
              {extraCount > 0 && (
                <p className="text-[10px] text-[#937022] font-black uppercase tracking-widest mt-1">
                  +{extraCount} more {extraCount === 1 ? 'commemoration' : 'commemorations'}
                </p>
              )}
            </>
          ) : (
            <h3 className="text-base font-black text-gray-900 tracking-tight">{t.saintName}</h3>
          )}
          <button
            onClick={onReadLife}
            disabled={saintDetailLoading}
            className="mt-3 text-[10px] font-black text-gray-900 uppercase tracking-widest flex items-center gap-2 hover:text-[#937022] transition-colors disabled:opacity-50"
          >
            {saintDetailLoading ? 'Loading…' : t.readLife} <ArrowRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Shared mobile content (reused below lg) ──────────────────────────── */
function MobileContent({
  t, nextEvent, latestNewsletter, newsletters, showAllNewsletters, setShowAllNewsletters, setSelectedNewsletter, onSelectEvent, churchPosts, setSelectedPost, showSaintDays, todaySaints, saintDetailLoading, language, onOpenSaintDetail,
}: {
  t: AppTranslations['home'];
  nextEvent: Event | null;
  latestNewsletter: Newsletter | null;
  newsletters: Newsletter[];
  showAllNewsletters: boolean;
  setShowAllNewsletters: (v: boolean) => void;
  setSelectedNewsletter: (n: Newsletter | null) => void;
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
                  {i % 2 === 0 ? <Flame size={18} /> : <BookOpen size={18} />}
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
            <Flame size={20} className="text-gray-300 mx-auto mb-2" />
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

      {/* Quick Actions */}
      <div className="grid grid-cols-3 gap-4 mb-12">
        {[
          { label: t.prayer, icon: MessageSquare, color: '#800000' },
          { label: t.candle, icon: Flame, color: '#937022' },
          { label: t.giving, icon: Heart, color: '#800000' },
        ].map((action, i) => (
          <button key={i} className="flex flex-col items-center gap-3 p-4 bg-white rounded-3xl shadow-sm border border-gray-50 active:scale-95 transition-all">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ backgroundColor: `${action.color}10`, color: action.color }}>
              <action.icon size={24} />
            </div>
            <span className="text-[10px] font-black text-gray-900 uppercase tracking-widest">{action.label}</span>
          </button>
        ))}
      </div>

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

      {/* Bulletins */}
      <div className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">{t.weeklyBulletins}</h2>
          {newsletters.length > 1 && (
            <button
              onClick={() => setShowAllNewsletters(!showAllNewsletters)}
              className="flex items-center gap-1.5 text-[10px] font-black text-[#937022] uppercase tracking-widest hover:opacity-70 transition-opacity"
            >
              {showAllNewsletters ? t.closeHistory : t.history}
              {showAllNewsletters ? <X size={12} /> : <History size={12} />}
            </button>
          )}
        </div>
        {newsletters.length === 0 ? (
          <div className="bg-gray-50 rounded-[40px] p-8 text-center">
            <BookOpen size={24} className="text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-bold text-gray-400">{t.noBulletins}</p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {!showAllNewsletters && latestNewsletter ? (
              <motion.div
                key="latest"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="bg-gray-900 rounded-[40px] p-8 text-white relative overflow-hidden shadow-2xl shadow-black/20"
              >
                <div className="absolute top-0 right-0 w-64 h-64 bg-[#800000]/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-4">
                    <BookOpen size={16} className="text-[#937022]" />
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/50">{latestNewsletter.date}</span>
                  </div>
                  <h3 className="text-2xl font-black tracking-tighter leading-tight mb-4">{latestNewsletter.title}</h3>
                  <p className="text-white/60 text-xs leading-relaxed mb-8 line-clamp-2">{latestNewsletter.excerpt}</p>
                  <button
                    onClick={() => setSelectedNewsletter(latestNewsletter)}
                    className="w-full py-4 bg-white text-gray-900 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-gray-100 transition-all active:scale-95"
                  >
                    {t.readBulletin}
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="archive"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-3"
              >
                {newsletters.map((news) => (
                  <button
                    key={news.id}
                    onClick={() => setSelectedNewsletter(news)}
                    className="w-full bg-white border border-gray-100 rounded-[28px] p-5 flex items-center gap-5 shadow-sm hover:shadow-md transition-all group text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-[8px] font-black text-[#937022] uppercase tracking-widest mb-1 block">{news.date}</span>
                      <h4 className="font-black text-gray-900 text-sm leading-tight">{news.title}</h4>
                      <p className="text-[10px] text-gray-400 font-bold mt-1">{news.readTime}</p>
                    </div>
                    <ChevronRight size={18} className="text-gray-200 group-hover:text-gray-400 transition-colors" />
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </>
  );
}
