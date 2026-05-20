import { ReactNode } from 'react';
import BottomNav from '../BottomNav';
import DesktopSidebar from '../DesktopSidebar';
import Header from '../Header';
import { Church, Language, Role, Screen } from '../../types';

interface AppShellProps {
  currentScreen: Screen;
  onScreenChange: (screen: Screen) => void;
  language: Language;
  userRole: Role | null;
  churches: Church[];
  activeChurch: Church | null;
  onChurchChange: (church: Church) => void;
  children: ReactNode;
}

const CHROMELESS_SCREENS = new Set<Screen>(['calendar', 'profile']);

export default function AppShell({
  currentScreen,
  onScreenChange,
  language,
  userRole,
  churches,
  activeChurch,
  onChurchChange,
  children,
}: AppShellProps) {
  const showChrome = !CHROMELESS_SCREENS.has(currentScreen);

  return (
    <div
      className="h-screen overflow-hidden bg-gray-200 lg:bg-[#F7F4EF] flex justify-center lg:justify-start lg:flex-row"
      style={{ height: '100dvh' }}
    >
      {showChrome && (
        <DesktopSidebar
          currentScreen={currentScreen}
          onScreenChange={onScreenChange}
          language={language}
          userRole={userRole}
          onProfileClick={() => onScreenChange('profile')}
        />
      )}

      <div
        className={`relative w-full max-w-sm bg-white flex flex-col h-full min-h-0 shadow-2xl lg:max-w-none lg:shadow-none${
          showChrome ? ' lg:ml-60' : ''
        }`}
      >
        {showChrome && (
          <Header
            onProfileClick={() => onScreenChange('profile')}
            userChurches={churches}
            activeChurch={activeChurch ?? undefined}
            onChurchChange={onChurchChange}
            language={language}
          />
        )}

        <main className="flex-1 min-h-0 overflow-y-auto scrollbar-hide relative bg-[#F9F9F9]">
          {children}
        </main>

        {showChrome && (
          <div className="flex-shrink-0 z-40 lg:hidden">
            <BottomNav
              currentScreen={currentScreen}
              onScreenChange={onScreenChange}
              language={language}
              userRole={userRole}
            />
          </div>
        )}
      </div>
    </div>
  );
}
