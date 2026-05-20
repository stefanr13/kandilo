import { motion } from 'motion/react';
import { BookOpen, Calendar, Users, Cross } from 'lucide-react';
import type { Language } from '../../types';
import { getExtraCopy } from '../../localization/extra';

interface ManagementDashboardTabProps {
  activeMemberCount: number;
  upcomingEventCount: number;
  sentNewsletterCount: number;
  membersLoading: boolean;
  eventsLoading: boolean;
  newslettersLoading: boolean;
  showSaintDays: boolean;
  savingShowSaintDays: boolean;
  onOpenEvents: () => void;
  onOpenMembers: () => void;
  onOpenPosts: () => void;
  onOpenNewsletters: () => void;
  onOpenNotifications: () => void;
  onToggleShowSaintDays: (value: boolean) => void;
  language: Language;
}

export default function ManagementDashboardTab({
  activeMemberCount,
  upcomingEventCount,
  sentNewsletterCount,
  membersLoading,
  eventsLoading,
  newslettersLoading,
  showSaintDays,
  savingShowSaintDays,
  onOpenEvents,
  onOpenMembers,
  onOpenPosts,
  onOpenNewsletters,
  onOpenNotifications,
  onToggleShowSaintDays,
  language,
}: ManagementDashboardTabProps) {
  const t = getExtraCopy(language).management.dashboard;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-6 xl:p-8 border-b border-gray-100 bg-white flex justify-between items-end">
        <div>
          <span className="text-[#937022] font-black text-[10px] tracking-[0.2em] uppercase mb-2 block">
            {t.eyebrow}
          </span>
          <h2 className="text-3xl font-black text-gray-900 tracking-tighter">{t.title}</h2>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 xl:p-8 scrollbar-hide bg-gray-50/30">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 xl:gap-6 mb-8">
            {[
              {
                label: t.totalMembers,
                value: membersLoading ? '—' : activeMemberCount.toString(),
                change: t.active,
                icon: Users,
                color: 'bg-blue-50 text-blue-600',
              },
              {
                label: t.upcomingEvents,
                value: eventsLoading ? '—' : upcomingEventCount.toString(),
                change: t.scheduled,
                icon: Calendar,
                color: 'bg-amber-50 text-amber-600',
              },
              {
                label: t.publishedBulletins,
                value: newslettersLoading ? '—' : sentNewsletterCount.toString(),
                change: t.published,
                icon: BookOpen,
                color: 'bg-green-50 text-green-600',
              },
            ].map((stat) => (
              <div
                key={stat.label}
                className="bg-white p-6 rounded-[32px] border border-gray-100 shadow-sm"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className={`w-12 h-12 rounded-2xl ${stat.color} flex items-center justify-center`}>
                    <stat.icon size={24} />
                  </div>
                  <span className="text-[10px] font-black text-gray-400 bg-gray-50 px-2 py-1 rounded-lg">
                    {stat.change}
                  </span>
                </div>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">
                  {stat.label}
                </p>
                <h3 className="text-2xl font-black text-gray-900">{stat.value}</h3>
              </div>
            ))}
          </div>

          {/* Parish Features */}
          <div className="bg-white rounded-[32px] xl:rounded-[40px] border border-gray-100 shadow-sm p-6 xl:p-8 mb-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-2xl bg-[#800000]/10 flex items-center justify-center">
                <Cross size={18} className="text-[#800000]" />
              </div>
              <div>
                <h3 className="text-base font-black text-gray-900 tracking-tight">{t.parishFeatures}</h3>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t.featureSub}</p>
              </div>
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between py-4 border-t border-gray-50">
              <div className="flex-1 sm:pr-8">
                <p className="text-sm font-black text-gray-900 mb-0.5">{t.saintDays}</p>
                <p className="text-[11px] text-gray-400 font-medium leading-relaxed">
                  {t.saintDaysSub}
                </p>
              </div>
              <button
                onClick={() => !savingShowSaintDays && onToggleShowSaintDays(!showSaintDays)}
                disabled={savingShowSaintDays}
                className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none ${
                  showSaintDays ? 'bg-[#800000]' : 'bg-gray-200'
                } ${savingShowSaintDays ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                aria-label={t.saintDays}
                role="switch"
                aria-checked={showSaintDays}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                    showSaintDays ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 2xl:grid-cols-3 gap-4 xl:gap-6">
            <div className="2xl:col-span-2 bg-white p-6 xl:p-8 rounded-[32px] xl:rounded-[40px] border border-gray-100 shadow-sm">
              <div className="flex justify-between items-center mb-8">
                <h3 className="text-xl font-black text-gray-900 tracking-tight">{t.stewardshipProgress}</h3>
              </div>
              <div className="space-y-6">
                {[
                  { category: t.funds.general, current: 45000, goal: 60000, percentage: 75 },
                  { category: t.funds.building, current: 12000, goal: 50000, percentage: 24 },
                  { category: t.funds.charity, current: 8000, goal: 10000, percentage: 80 },
                ].map((fund, index) => (
                  <div key={fund.category} className="space-y-2">
                    <div className="flex justify-between items-end">
                      <span className="text-sm font-black text-gray-900">{fund.category}</span>
                      <span className="text-xs font-bold text-gray-400">
                        ${fund.current.toLocaleString()} / ${fund.goal.toLocaleString()}
                      </span>
                    </div>
                    <div className="w-full h-3 bg-gray-50 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${fund.percentage}%` }}
                        transition={{ duration: 1, delay: index * 0.1 }}
                        className="h-full bg-[#800000] rounded-full"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-gray-900 p-6 xl:p-8 rounded-[32px] xl:rounded-[40px] text-white relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#800000] blur-[80px] opacity-20" />
              <h3 className="text-xl font-black mb-6 relative z-10">{t.quickActions}</h3>
              <div className="space-y-4 relative z-10">
                <button
                  onClick={onOpenEvents}
                  className="w-full py-3 bg-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-white/20 transition-all"
                >
                  {t.addEvent}
                </button>
                <button
                  onClick={onOpenPosts}
                  className="w-full py-3 bg-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-white/20 transition-all"
                >
                  {t.writePost}
                </button>
                <button
                  onClick={onOpenNewsletters}
                  className="w-full py-3 bg-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-white/20 transition-all"
                >
                  {t.writeBulletin}
                </button>
                <button
                  onClick={onOpenNotifications}
                  className="w-full py-3 bg-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-white/20 transition-all"
                >
                  {t.sendAlert}
                </button>
                <button
                  onClick={onOpenMembers}
                  className="w-full py-3 bg-white/10 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-white/20 transition-all"
                >
                  {t.viewDirectory}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
