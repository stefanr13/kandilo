import { AnimatePresence, motion } from 'motion/react';
import {
  Calendar,
  CheckCircle2,
  Church,
  DollarSign,
  Edit3,
  Loader2,
  MapPin,
  Newspaper,
  Plus,
  Power,
  PowerOff,
  Search,
  UserPlus,
  Users,
} from 'lucide-react';
import { Role, SuperAdminChurchStats } from '../../types';

interface MissionControlChurchesTabProps {
  statsLoading: boolean;
  filteredStats: SuperAdminChurchStats[];
  searchQuery: string;
  confirmDeactivateId: string | null;
  deactivateLoading: boolean;
  assignChurchId: string | null;
  assignEmail: string;
  assignRole: Role;
  assignLoading: boolean;
  assignResult: string;
  onSearchQueryChange: (value: string) => void;
  onShowAddChurch: () => void;
  onEditChurch: (church: SuperAdminChurchStats) => void;
  onStartAssign: (churchId: string) => void;
  onCancelAssign: () => void;
  onAssignEmailChange: (value: string) => void;
  onAssignRoleChange: (value: Role) => void;
  onAssignMembership: (churchId: string) => void;
  onRequestDeactivate: (churchId: string) => void;
  onCancelDeactivate: () => void;
  onSetActive: (churchId: string, isActive: boolean) => void;
}

export default function MissionControlChurchesTab({
  statsLoading,
  filteredStats,
  searchQuery,
  confirmDeactivateId,
  deactivateLoading,
  assignChurchId,
  assignEmail,
  assignRole,
  assignLoading,
  assignResult,
  onSearchQueryChange,
  onShowAddChurch,
  onEditChurch,
  onStartAssign,
  onCancelAssign,
  onAssignEmailChange,
  onAssignRoleChange,
  onAssignMembership,
  onRequestDeactivate,
  onCancelDeactivate,
  onSetActive,
}: MissionControlChurchesTabProps) {
  return (
    <motion.div
      key="churches"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="p-6 space-y-4"
    >
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            className="w-full bg-gray-800 border-none rounded-xl pl-9 pr-4 py-3 text-sm font-bold text-white focus:ring-2 focus:ring-[#800000]/40 transition-all placeholder-gray-500"
            placeholder="Search churches…"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
          />
        </div>
        <button
          onClick={onShowAddChurch}
          className="flex items-center gap-1.5 px-4 py-3 bg-[#800000] text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex-shrink-0"
        >
          <Plus size={14} /> Add
        </button>
      </div>

      {statsLoading ? (
        <div className="flex items-center gap-2 py-8 justify-center">
          <Loader2 size={20} className="animate-spin text-gray-600" />
        </div>
      ) : filteredStats.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-8">No churches found.</p>
      ) : (
        <div className="space-y-3">
          {filteredStats.map((church) => (
            <div key={church.churchId} className="bg-gray-800/60 rounded-2xl overflow-hidden">
              <div className="flex items-center gap-3 p-4">
                <div className="w-12 h-12 rounded-xl overflow-hidden bg-gray-700 flex-shrink-0">
                  {church.imageURL ? (
                    <img
                      src={church.imageURL}
                      alt=""
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <Church size={20} className="m-auto mt-3 text-gray-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-black text-white truncate">{church.name}</p>
                    {church.isVerified && (
                      <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />
                    )}
                    {!church.isActive && (
                      <span className="text-[8px] font-black text-red-400 uppercase bg-red-900/30 px-1.5 py-0.5 rounded flex-shrink-0">
                        Inactive
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-500 font-bold flex items-center gap-1 mt-0.5">
                    <MapPin size={9} /> {church.city}, {church.state}
                  </p>
                  <p className="text-[10px] text-gray-600 font-bold">{church.denomination}</p>
                </div>
              </div>

              <div className="grid grid-cols-4 border-t border-gray-700">
                {[
                  { icon: Users, value: church.memberCount, label: 'Members' },
                  {
                    icon: DollarSign,
                    value: `$${church.donationTotal.toLocaleString()}`,
                    label: 'Raised',
                  },
                  { icon: Calendar, value: church.eventCount, label: 'Events' },
                  { icon: Newspaper, value: church.newsletterCount, label: 'Bulletins' },
                ].map(({ icon: Icon, value, label }) => (
                  <div key={label} className="flex flex-col items-center py-3">
                    <Icon size={12} className="text-gray-500 mb-1" />
                    <span className="text-sm font-black text-white">{value}</span>
                    <span className="text-[8px] font-bold text-gray-600 uppercase tracking-wider">
                      {label}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex border-t border-gray-700">
                <button
                  onClick={() => onEditChurch(church)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest hover:text-white hover:bg-gray-700/50 transition-all"
                >
                  <Edit3 size={12} /> Edit
                </button>
                <div className="w-px bg-gray-700" />
                <button
                  onClick={() => onStartAssign(church.churchId)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest hover:text-white hover:bg-gray-700/50 transition-all"
                >
                  <UserPlus size={12} /> Assign
                </button>
                <div className="w-px bg-gray-700" />
                <button
                  onClick={() => {
                    if (church.isActive) {
                      onRequestDeactivate(church.churchId);
                    } else {
                      onSetActive(church.churchId, true);
                    }
                  }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-[10px] font-black uppercase tracking-widest hover:bg-gray-700/50 transition-all ${
                    church.isActive
                      ? 'text-red-400 hover:text-red-300'
                      : 'text-emerald-400 hover:text-emerald-300'
                  }`}
                >
                  {church.isActive ? (
                    <>
                      <PowerOff size={12} /> Deactivate
                    </>
                  ) : (
                    <>
                      <Power size={12} /> Reactivate
                    </>
                  )}
                </button>
              </div>

              <AnimatePresence>
                {assignChurchId === church.churchId && (
                  <motion.form
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden border-t border-gray-700 bg-gray-900/80"
                    onSubmit={(event) => {
                      event.preventDefault();
                      onAssignMembership(church.churchId);
                    }}
                  >
                    <div className="p-4 space-y-3">
                      <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">
                        Assign Existing User
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2">
                        <input
                          type="email"
                          value={assignEmail}
                          onChange={(event) => onAssignEmailChange(event.target.value)}
                          placeholder="user@example.com"
                          className="w-full bg-gray-800 border-none rounded-xl px-4 py-3 text-xs font-bold text-white focus:ring-2 focus:ring-[#800000]/40 placeholder-gray-600"
                          required
                        />
                        <select
                          value={assignRole}
                          onChange={(event) => onAssignRoleChange(event.target.value as Role)}
                          className="w-full bg-gray-800 border-none rounded-xl px-4 py-3 text-xs font-bold text-white focus:ring-2 focus:ring-[#800000]/40"
                        >
                          <option value="priest">Priest</option>
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                        </select>
                      </div>
                      {assignResult && (
                        <p
                          className={`text-xs font-bold ${
                            assignResult.startsWith('Error:') ? 'text-red-300' : 'text-emerald-300'
                          }`}
                        >
                          {assignResult}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={assignLoading}
                          className="flex-1 py-2.5 bg-[#800000] text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1 disabled:opacity-60"
                        >
                          {assignLoading ? <Loader2 size={12} className="animate-spin" /> : null}
                          Assign User
                        </button>
                        <button
                          type="button"
                          onClick={onCancelAssign}
                          className="flex-1 py-2.5 bg-gray-700 text-gray-300 rounded-xl text-[10px] font-black uppercase tracking-widest"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </motion.form>
                )}

                {confirmDeactivateId === church.churchId && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden border-t border-gray-700 bg-red-900/20"
                  >
                    <div className="p-4">
                      <p className="text-xs font-bold text-red-300 mb-3">
                        Deactivating hides this church from all members. Data is preserved. Confirm?
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => onSetActive(church.churchId, false)}
                          disabled={deactivateLoading}
                          className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-1"
                        >
                          {deactivateLoading ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            'Confirm Deactivate'
                          )}
                        </button>
                        <button
                          onClick={onCancelDeactivate}
                          className="flex-1 py-2.5 bg-gray-700 text-gray-300 rounded-xl text-[10px] font-black uppercase tracking-widest"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
