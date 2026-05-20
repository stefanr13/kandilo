import { motion } from 'motion/react';
import {
  Calendar,
  CheckCircle2,
  Church,
  DollarSign,
  Loader2,
  Newspaper,
  XCircle,
} from 'lucide-react';
import { SuperAdminChurchStats } from '../../types';

interface MissionControlAnalyticsTabProps {
  stats: SuperAdminChurchStats[];
  statsLoading: boolean;
}

export default function MissionControlAnalyticsTab({
  stats,
  statsLoading,
}: MissionControlAnalyticsTabProps) {
  return (
    <motion.div
      key="analytics"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="p-6 space-y-4"
    >
      <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest">
        Per-Church Breakdown
      </p>

      {statsLoading ? (
        <div className="flex items-center justify-center gap-2 py-12">
          <Loader2 size={20} className="animate-spin text-gray-600" />
        </div>
      ) : (
        <div className="space-y-3">
          {stats.map((church) => (
            <div key={church.churchId} className="bg-gray-800/60 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl overflow-hidden bg-gray-700 flex-shrink-0">
                  {church.imageURL ? (
                    <img
                      src={church.imageURL}
                      alt=""
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <Church size={16} className="m-auto mt-2.5 text-gray-500" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-black text-white">{church.name}</p>
                  <p className="text-[10px] text-gray-500 font-bold">
                    {church.city}, {church.state} · Est. {church.foundedYear || '—'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <MetricCard
                  value={church.priestCount}
                  label="Clergy"
                  accentClassName="text-[#800000]"
                />
                <MetricCard
                  value={church.adminCount}
                  label="Admins"
                  accentClassName="text-amber-500"
                />
                <MetricCard
                  value={church.memberCount - church.priestCount - church.adminCount}
                  label="Members"
                  accentClassName="text-gray-400"
                />
              </div>

              <div className="flex items-center justify-between bg-gray-700/30 rounded-xl px-4 py-3">
                <div className="flex items-center gap-2">
                  <DollarSign size={14} className="text-emerald-400" />
                  <span className="text-xs font-black text-gray-300">Total Donations</span>
                </div>
                <span className="text-sm font-black text-emerald-400">
                  $
                  {church.donationTotal.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>

              <div className="flex gap-2">
                <ActivityPill
                  icon={Calendar}
                  value={`${church.eventCount} events`}
                  iconClassName="text-blue-400"
                />
                <ActivityPill
                  icon={Newspaper}
                  value={`${church.newsletterCount} bulletins`}
                  iconClassName="text-purple-400"
                />
                <div className="flex-1 flex items-center gap-2 bg-gray-700/30 rounded-xl px-3 py-2">
                  {church.isVerified ? (
                    <CheckCircle2 size={12} className="text-emerald-400" />
                  ) : (
                    <XCircle size={12} className="text-gray-600" />
                  )}
                  <span
                    className={`text-[10px] font-black ${
                      church.isVerified ? 'text-emerald-400' : 'text-gray-600'
                    }`}
                  >
                    {church.isVerified ? 'Verified' : 'Unverified'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function MetricCard({
  value,
  label,
  accentClassName,
}: {
  value: number;
  label: string;
  accentClassName: string;
}) {
  return (
    <div className="bg-gray-700/50 rounded-xl p-3 text-center">
      <p className="text-lg font-black text-white">{value}</p>
      <p className={`text-[9px] font-black uppercase tracking-widest ${accentClassName}`}>
        {label}
      </p>
    </div>
  );
}

function ActivityPill({
  icon: Icon,
  value,
  iconClassName,
}: {
  icon: React.ElementType;
  value: string;
  iconClassName: string;
}) {
  return (
    <div className="flex-1 flex items-center gap-2 bg-gray-700/30 rounded-xl px-3 py-2">
      <Icon size={12} className={iconClassName} />
      <span className="text-[10px] font-black text-gray-400">{value}</span>
    </div>
  );
}
