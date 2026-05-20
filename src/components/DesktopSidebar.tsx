import { Home, Calendar, Heart, MoreHorizontal, Sparkles, ShieldCheck, Church, Users } from 'lucide-react';
import { Screen, Language, Role } from '../types';
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
}

export default function DesktopSidebar({
  currentScreen,
  onScreenChange,
  language,
  userRole,
  onProfileClick,
}: DesktopSidebarProps) {
  const t = TRANSLATIONS[language].nav;
  const canManage = canAccessManagementTools(userRole);

  const navItems = [
    { id: 'home' as Screen, label: t.home, icon: Home },
    { id: 'events' as Screen, label: t.events, icon: Calendar },
    { id: 'community' as Screen, label: t.community, icon: Users },
    ...(FAITH_AI_ENABLED ? [{ id: 'faith' as Screen, label: t.faith, icon: Sparkles }] : []),
    ...(canManage ? [{ id: 'management' as Screen, label: t.manage, icon: ShieldCheck }] : []),
    { id: 'more' as Screen, label: t.more, icon: MoreHorizontal },
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

        {/* Giving — prominent CTA */}
        <div className="pt-3">
          <button
            onClick={() => onScreenChange('giving')}
            className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all font-black text-sm ${
              currentScreen === 'giving'
                ? 'bg-[#800000] text-white shadow-lg shadow-red-900/30'
                : 'bg-[#800000]/10 text-[#800000] hover:bg-[#800000] hover:text-white hover:shadow-lg hover:shadow-red-900/30'
            }`}
          >
            <Heart size={20} strokeWidth={2.5} />
            {t.giving}
          </button>
        </div>
      </nav>

      {/* Profile at bottom */}
      <div className="px-4 py-5 border-t border-gray-50">
        <button
          onClick={onProfileClick}
          className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-gray-50 transition-colors group"
        >
          <div className="w-9 h-9 bg-[#800000] rounded-full flex items-center justify-center text-white font-black text-xs flex-shrink-0">
            K
          </div>
          <div className="text-left">
            <p className="text-sm font-bold text-gray-900 group-hover:text-[#800000] transition-colors">{t.profileLabel}</p>
            <p className="text-[10px] text-gray-400 font-medium">{t.settingsAccount}</p>
          </div>
        </button>
      </div>
    </aside>
  );
}
