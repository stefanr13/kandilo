import {
  Bell,
  BookOpen,
  Calendar,
  LayoutDashboard,
  PenLine,
  QrCode,
  Settings,
  Users,
} from 'lucide-react';
import type { Language } from '../../types';
import { getExtraCopy } from '../../localization/extra';
import { ManagementTab } from './types';

interface ManagementSidebarProps {
  activeTab: ManagementTab;
  onTabChange: (tab: ManagementTab) => void;
  language: Language;
}

const TABS: Array<{
  id: ManagementTab;
  icon: typeof LayoutDashboard;
}> = [
  { id: 'dashboard', icon: LayoutDashboard },
  { id: 'members', icon: Users },
  { id: 'events', icon: Calendar },
  { id: 'posts', icon: PenLine },
  { id: 'newsletters', icon: BookOpen },
  { id: 'notifications', icon: Bell },
  { id: 'scanner', icon: QrCode },
];

export default function ManagementSidebar({
  activeTab,
  onTabChange,
  language,
}: ManagementSidebarProps) {
  const copy = getExtraCopy(language).management;
  const labels = copy.tabs;

  return (
    <div className="w-20 xl:w-60 border-r border-gray-100 bg-white flex flex-col items-center xl:items-stretch px-3 xl:px-4 py-6 xl:py-8 gap-6 sticky top-0 h-full overflow-y-auto">
      <div className="flex items-center justify-center xl:justify-start gap-3 px-0 xl:px-2">
        <div className="w-12 h-12 bg-[#800000] rounded-2xl flex items-center justify-center text-white shadow-lg shadow-red-900/20 flex-shrink-0">
          <LayoutDashboard size={24} />
        </div>
        <div className="hidden xl:block min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#937022]">
            {copy.dashboard.eyebrow}
          </p>
          <p className="truncate text-sm font-black text-gray-900">{copy.dashboard.title}</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            title={labels[tab.id]}
            aria-label={labels[tab.id]}
            onClick={(event) => {
              event.stopPropagation();
              onTabChange(tab.id);
            }}
            className={`w-14 xl:w-full h-14 rounded-2xl flex items-center justify-center xl:justify-start gap-3 px-0 xl:px-4 transition-all ${
              activeTab === tab.id
                ? 'bg-gray-900 text-white shadow-xl'
                : 'text-gray-300 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <tab.icon size={20} className="flex-shrink-0" />
            <span className="hidden xl:block truncate text-[11px] font-black uppercase tracking-widest">
              {labels[tab.id]}
            </span>
          </button>
        ))}
      </div>

      <button
        title="Settings"
        aria-label="Settings"
        className="w-14 xl:w-full h-14 rounded-2xl flex items-center justify-center xl:justify-start gap-3 px-0 xl:px-4 text-gray-300 hover:text-gray-900 hover:bg-gray-50 transition-all"
      >
        <Settings size={20} className="flex-shrink-0" />
      </button>
    </div>
  );
}
