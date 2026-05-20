import {
  Loader2,
  MoreVertical,
  Search,
  Shield,
  UserCheck,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react';
import { Role } from '../../domain/church';
import type { Language } from '../../types';
import { getExtraCopy } from '../../localization/extra';
import type { FirestoreMember } from '../../lib/db/memberships';

interface ManagementMembersTabProps {
  filteredMembers: FirestoreMember[];
  membersLoading: boolean;
  activeMemberCount: number;
  searchQuery: string;
  activeMemberMenu: string | null;
  updatingMemberId: string | null;
  isPriest: boolean;
  isAdminOrPriest: boolean;
  currentUserId: string | null;
  onSearchQueryChange: (value: string) => void;
  onToggleMemberMenu: (memberId: string | null) => void;
  onRoleChange: (memberId: string, role: Role) => void;
  onSuspendMember: (memberId: string) => void;
  onInviteMember: () => void;
  language: Language;
}

const ROLE_COLORS: Record<Role, string> = {
  priest: 'bg-[#800000]/10 text-[#800000]',
  admin: 'bg-amber-50 text-amber-700',
  member: 'bg-gray-100 text-gray-500',
};

export default function ManagementMembersTab({
  filteredMembers,
  membersLoading,
  activeMemberCount,
  searchQuery,
  activeMemberMenu,
  updatingMemberId,
  isPriest,
  isAdminOrPriest,
  currentUserId,
  onSearchQueryChange,
  onToggleMemberMenu,
  onRoleChange,
  onSuspendMember,
  onInviteMember,
  language,
}: ManagementMembersTabProps) {
  const copy = getExtraCopy(language).management;
  const t = copy.members;
  const ROLE_LABELS = copy.roles;
  const STATUS_LABELS = copy.statuses;

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
              {!membersLoading && (
                <span className="ml-3 text-base text-gray-400 font-bold">
                  {t.memberCount(activeMemberCount)}
                </span>
              )}
            </h2>
          </div>
          {isAdminOrPriest && (
            <button
              onClick={onInviteMember}
              className="w-full sm:w-auto bg-gray-900 text-white px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-[#800000] transition-all"
            >
              <UserPlus size={16} />
              {t.invite}
            </button>
          )}
        </div>

        <div className="relative">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder={t.search}
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            className="w-full bg-gray-50 border-none rounded-2xl pl-12 pr-6 py-4 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-[#800000]/20 transition-all"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 xl:p-8 scrollbar-hide">
        {membersLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 size={32} className="text-[#800000] animate-spin" />
          </div>
        ) : filteredMembers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <Users size={40} className="mb-3 opacity-30" />
            <p className="font-bold text-sm">{t.noMembers}</p>
            <p className="text-xs mt-1">{t.noMembersSub}</p>
          </div>
        ) : (
          <div className="bg-white rounded-[32px] border border-gray-100 overflow-x-auto shadow-sm">
            <table className="w-full min-w-[860px] text-left border-collapse">
              <thead>
                <tr className="bg-gray-50/50">
                  <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                    {t.parishioner}
                  </th>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                    {t.role}
                  </th>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                    {t.joined}
                  </th>
                  <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                    {t.status}
                  </th>
                  {isAdminOrPriest && (
                    <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">
                      {copy.common.actions}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredMembers.map((member) => (
                  <tr
                    key={member.id}
                    className="hover:bg-gray-50/50 transition-colors group relative"
                  >
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl overflow-hidden bg-gray-100 flex items-center justify-center text-gray-400 font-black text-xs flex-shrink-0">
                          {member.photoURL ? (
                            <img
                              src={member.photoURL}
                              alt=""
                              className="w-full h-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <span>{member.displayName.charAt(0).toUpperCase()}</span>
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-black text-gray-900">{member.displayName}</p>
                          <p className="text-[10px] text-gray-400 font-bold">{member.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span
                        className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${ROLE_COLORS[member.role]}`}
                      >
                        {ROLE_LABELS[member.role]}
                      </span>
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-xs font-bold text-gray-500">{member.joinedAt}</span>
                    </td>
                    <td className="px-6 py-5">
                      <span
                        className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                          member.status === 'active'
                            ? 'bg-green-50 text-green-600'
                            : member.status === 'suspended'
                              ? 'bg-red-50 text-red-600'
                              : 'bg-gray-50 text-gray-400'
                        }`}
                      >
                        {STATUS_LABELS[member.status] ?? member.status}
                      </span>
                    </td>
                    {isAdminOrPriest && (
                      <td className="px-6 py-5 text-right relative">
                        {member.id !== currentUserId && (
                          <div className="relative inline-block">
                            {(isPriest || member.role === 'member') && (
                              <button
                                onClick={() =>
                                  onToggleMemberMenu(activeMemberMenu === member.id ? null : member.id)
                                }
                                className="p-2 text-gray-300 hover:text-gray-900 transition-colors"
                              >
                                {updatingMemberId === member.id ? (
                                  <Loader2 size={18} className="animate-spin" />
                                ) : (
                                  <MoreVertical size={18} />
                                )}
                              </button>
                            )}

                            {activeMemberMenu === member.id && (isPriest || member.role === 'member') && (
                              <div className="absolute right-0 top-10 z-50 bg-white rounded-2xl shadow-xl border border-gray-100 p-2 w-48">
                                {isPriest && (
                                  <>
                                    <p className="text-[9px] font-black text-gray-300 uppercase tracking-widest px-3 py-2">
                                      {t.changeRole}
                                    </p>
                                    {(['admin', 'member'] as Role[])
                                      .filter((role) => role !== member.role)
                                      .map((role) => (
                                        <button
                                          key={role}
                                          onClick={() => onRoleChange(member.id, role)}
                                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 transition-all text-left"
                                        >
                                          <Shield size={14} className="text-gray-400" />
                                          <span className="text-xs font-black text-gray-700">
                                            {t.setAs(ROLE_LABELS[role])}
                                          </span>
                                        </button>
                                      ))}
                                    <div className="h-px bg-gray-50 my-1" />
                                  </>
                                )}
                                <button
                                  onClick={() => onSuspendMember(member.id)}
                                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-red-50 transition-all text-left"
                                >
                                  {member.status === 'suspended' ? (
                                    <>
                                      <UserCheck size={14} className="text-green-500" />
                                      <span className="text-xs font-black text-green-600">
                                        {t.reinstate}
                                      </span>
                                    </>
                                  ) : (
                                    <>
                                      <UserX size={14} className="text-red-500" />
                                      <span className="text-xs font-black text-red-600">
                                        {t.suspend}
                                      </span>
                                    </>
                                  )}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
