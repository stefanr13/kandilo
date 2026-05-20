import { motion } from 'motion/react';
import {
  Calendar,
  CheckCircle2,
  Church,
  DollarSign,
  Loader2,
  Plus,
  ShieldCheck,
  Star,
  UserPlus,
  Users,
} from 'lucide-react';
import { SuperAdminChurchStats } from '../../types';

interface MissionControlOverviewTabProps {
  stats: SuperAdminChurchStats[];
  statsLoading: boolean;
  activeChurchCount: number;
  totalMembers: number;
  totalDonations: number;
  totalEvents: number;
  promoteUid: string;
  promoteLoading: boolean;
  promoteResult: string;
  onShowAddChurch: () => void;
  onOpenChurches: () => void;
  onPromoteUidChange: (value: string) => void;
  onPromote: () => void;
}

export default function MissionControlOverviewTab({
  stats,
  statsLoading,
  activeChurchCount,
  totalMembers,
  totalDonations,
  totalEvents,
  promoteUid,
  promoteLoading,
  promoteResult,
  onShowAddChurch,
  onOpenChurches,
  onPromoteUidChange,
  onPromote,
}: MissionControlOverviewTabProps) {
  return (
    <motion.div
      key="overview"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="p-6 space-y-6"
    >
      <div>
        <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest mb-3">
          Platform Overview
        </p>
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="Active Churches"
            value={statsLoading ? '—' : activeChurchCount}
            icon={Church}
            accent
          />
          <StatCard
            label="Total Members"
            value={statsLoading ? '—' : totalMembers.toLocaleString()}
            icon={Users}
          />
          <StatCard
            label="Total Donations"
            value={
              statsLoading
                ? '—'
                : `$${totalDonations.toLocaleString('en-US', {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  })}`
            }
            icon={DollarSign}
          />
          <StatCard
            label="Total Events"
            value={statsLoading ? '—' : totalEvents.toLocaleString()}
            icon={Calendar}
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest">
            All Churches
          </p>
          <button
            onClick={onShowAddChurch}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#800000] text-white rounded-lg text-[9px] font-black uppercase tracking-widest"
          >
            <Plus size={11} /> Add Church
          </button>
        </div>
        <div className="space-y-2">
          {statsLoading ? (
            <div className="flex items-center gap-2 py-4">
              <Loader2 size={16} className="animate-spin text-gray-600" />
              <span className="text-gray-500 text-sm">Loading…</span>
            </div>
          ) : (
            stats.map((church) => (
              <button
                key={church.churchId}
                onClick={onOpenChurches}
                className="w-full flex items-center gap-3 bg-gray-800/60 hover:bg-gray-800 rounded-xl px-4 py-3 transition-all text-left"
              >
                <div className="w-9 h-9 rounded-lg overflow-hidden bg-gray-700 flex-shrink-0">
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
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-white truncate">{church.name}</p>
                  <p className="text-[10px] text-gray-500 font-bold">
                    {church.city}, {church.state} · {church.memberCount} members
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {church.isVerified && <CheckCircle2 size={13} className="text-emerald-400" />}
                  {!church.isActive && (
                    <span className="text-[9px] font-black text-red-400 uppercase">Inactive</span>
                  )}
                  <Star size={14} className="text-gray-600" />
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="bg-gray-800/40 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <UserPlus size={16} className="text-[#800000]" />
          <p className="text-[10px] font-black text-white uppercase tracking-widest">
            Promote Super Admin
          </p>
        </div>
        <p className="text-[11px] text-gray-500 font-medium mb-3">
          Enter the Firebase UID of a user to grant them super admin access.
        </p>
        <input
          className="w-full bg-gray-700 border-none rounded-xl px-4 py-3 text-sm font-bold text-white focus:ring-2 focus:ring-[#800000]/40 transition-all mb-3 placeholder-gray-500"
          placeholder="Firebase UID"
          value={promoteUid}
          onChange={(event) => onPromoteUidChange(event.target.value)}
        />
        <button
          onClick={onPromote}
          disabled={promoteLoading || !promoteUid.trim()}
          className="w-full py-3 bg-[#800000] text-white rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 disabled:opacity-40 transition-all"
        >
          {promoteLoading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <ShieldCheck size={14} />
          )}
          Grant Super Admin
        </button>
        {promoteResult && (
          <p
            className={`text-[11px] font-bold mt-3 ${
              promoteResult.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {promoteResult}
          </p>
        )}
      </div>
    </motion.div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  accent = false,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  accent?: boolean;
}) {
  return (
    <div className={`rounded-2xl p-5 ${accent ? 'bg-[#800000] text-white' : 'bg-gray-50'}`}>
      <div className="flex items-center justify-between mb-3">
        <Icon size={18} className={accent ? 'text-red-200' : 'text-gray-400'} />
      </div>
      <p className={`text-3xl font-black tracking-tight ${accent ? 'text-white' : 'text-gray-900'}`}>
        {value}
      </p>
      <p
        className={`text-[10px] font-bold uppercase tracking-widest mt-1 ${
          accent ? 'text-red-200' : 'text-gray-400'
        }`}
      >
        {label}
      </p>
    </div>
  );
}
