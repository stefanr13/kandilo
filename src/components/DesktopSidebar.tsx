import {
  Home,
  Calendar,
  Church,
  Heart,
  Sparkles,
  ShieldCheck,
  Users,
  MessageCircle,
  Cross,
  ChevronDown,
} from 'lucide-react';
import { Screen, Language, Role, Church as ChurchType } from '../types';
import { TRANSLATIONS } from '../translations';
import { FAITH_AI_ENABLED } from '../config/features';
import { canAccessManagementTools } from '../domain/roles';

// Desktop-only sidebar; hidden below lg breakpoint via Tailwind

interface DesktopSidebarProps {
  currentScreen: Screen;
  onScreenChange: (screen: Screen) => void;
  language: Language;
  userRole?: Role | null;
  onProfileClick?: () => void;
  userChurches?: ChurchType[];
  activeChurch?: ChurchType | null;
  onChurchChange?: (church: ChurchType) => void;
}

export default function DesktopSidebar({
  currentScreen,
  onScreenChange,
  language,
  userRole,
  onProfileClick,
  userChurches = [],
  activeChurch = null,
  onChurchChange,
}: DesktopSidebarProps) {
  const t = TRANSLATIONS[language].nav;
  const moreT = TRANSLATIONS[language].more;
  const canManage = canAccessManagementTools(userRole);

  const navItems = [
    { id: 'home' as Screen, label: t.home, icon: Home },
    { id: 'events' as Screen, label: t.events, icon: Calendar },
    { id: 'saints' as Screen, label: t.saints, icon: Cross },
    { id: 'community' as Screen, label: t.forum, icon: MessageCircle },
    { id: 'giving' as Screen, label: t.giving, icon: Heart },
  ];

  const portalItems = [
    { screen: 'community' as Screen, label: moreT.communityDirectory, icon: Users },
    ...(FAITH_AI_ENABLED ? [{ screen: 'faith' as Screen, label: t.faith, icon: Sparkles }] : []),
  ];

  return (
    <aside className="hidden lg:flex flex-col fixed inset-y-0 left-0 w-60 bg-white border-r border-gray-100 z-50">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-6 border-b border-gray-50">
        <div className="w-10 h-10 flex items-center justify-center bg-[#800000] rounded-xl shadow-lg shadow-red-900/20 flex-shrink-0">
          <Church className="text-white" size={22} />
        </div>
        <span className="font-black text-xl tracking-tighter uppercase text-gray-900 leading-none">Kandilo</span>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentScreen === item.id;

          if (item.id === 'giving') {
            return (
              <button
                key={item.id}
                onClick={() => onScreenChange(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all text-left group border ${
                  isActive
                    ? 'bg-gradient-to-r from-[#800000] to-[#937022] text-white border-transparent shadow-lg shadow-red-900/15'
                    : 'bg-[#937022]/5 text-[#937022] border-[#937022]/15 hover:bg-[#937022]/10 hover:border-[#937022]/30 hover:shadow-sm'
                }`}
              >
                <Icon size={20} strokeWidth={2.5} className={isActive ? 'text-white' : 'text-[#937022] group-hover:text-[#800000] transition-colors'} />
                <span className={`text-sm font-black tracking-tight ${isActive ? 'text-white' : 'text-[#937022] group-hover:text-[#800000] transition-colors'}`}>
                  {item.label}
                </span>
                {!isActive && (
                  <span className="ml-auto flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#937022]/30 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#937022]"></span>
                  </span>
                )}
                {isActive && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-white" />
                )}
              </button>
            );
          }

          return (
            <button
              key={item.id}
              onClick={() => onScreenChange(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all text-left ${
                isActive
                  ? 'bg-[#800000]/10 text-[#800000]'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
              <span className={`text-sm font-bold ${isActive ? 'text-[#800000]' : ''}`}>
                {item.label}
              </span>
              {isActive && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#800000]" />
              )}
            </button>
          );
        })}

        <div className="pt-4 mt-4 border-t border-gray-50">
          <p className="px-4 mb-2 text-[9px] font-black text-gray-300 uppercase tracking-[0.2em]">
            {moreT.parishResources}
          </p>
          <div className="space-y-1">
            {portalItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  onClick={() => onScreenChange(item.screen)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 rounded-2xl transition-all text-left text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                >
                  <Icon size={17} strokeWidth={2} />
                  <span className="text-xs font-bold">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {canManage && (
          <div className="pt-4 mt-4 border-t border-gray-50">
            <button
              onClick={() => onScreenChange('management')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border border-dashed text-left transition-all ${
                currentScreen === 'management'
                  ? 'border-[#800000] bg-[#800000]/5 text-[#800000]'
                  : 'border-gray-200 text-gray-500 hover:border-gray-400 hover:text-gray-900'
              }`}
            >
              <ShieldCheck size={16} />
              <span className="text-xs font-bold">{t.manage}</span>
            </button>
          </div>
        )}
      </nav>

      {/* Profile & Church Switcher at bottom */}
      <div className="px-4 py-5 border-t border-gray-50 space-y-3">
        {userChurches.length > 1 && activeChurch && (
          <div className="relative">
            <select
              value={activeChurch.id}
              onChange={(e) => {
                const selected = userChurches.find(c => c.id === e.target.value);
                if (selected && onChurchChange) onChurchChange(selected);
              }}
              title="Select Parish"
              className="w-full appearance-none bg-gray-50 border border-gray-100 rounded-xl pl-9 pr-8 py-2 text-[11px] font-black text-gray-600 cursor-pointer hover:bg-gray-100 transition-colors focus:outline-none"
            >
              {userChurches.map((church) => (
                <option key={church.id} value={church.id}>
                  {church.name}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400">
              <Church size={13} />
            </div>
            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400">
              <ChevronDown size={13} />
            </div>
          </div>
        )}

        <button
          onClick={onProfileClick}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-50 transition-colors group"
        >
          <div className="w-9 h-9 bg-[#800000] rounded-full flex items-center justify-center text-white font-black text-xs flex-shrink-0">
            K
          </div>
          <div className="text-left min-w-0 flex-1">
            <p className="text-sm font-bold text-gray-900 group-hover:text-[#800000] transition-colors truncate">{t.profileLabel}</p>
            <p className="text-[10px] text-gray-400 font-medium truncate">{t.settingsAccount}</p>
          </div>
        </button>
      </div>
    </aside>
  );
}
