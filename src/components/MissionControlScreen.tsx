import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import type { User as FirebaseUser } from 'firebase/auth';
import MissionControlAnalyticsTab from './mission-control/MissionControlAnalyticsTab';
import MissionControlChurchesTab from './mission-control/MissionControlChurchesTab';
import ChurchFormSheet from './mission-control/ChurchFormSheet';
import MissionControlHeader from './mission-control/MissionControlHeader';
import MissionControlOverviewTab from './mission-control/MissionControlOverviewTab';
import MissionControlTabBar, { MCTab } from './mission-control/MissionControlTabBar';
import {
  buildEditChurchForm,
  EMPTY_CHURCH_FORM,
} from './mission-control/missionControlForm';
import { useMissionControl } from './mission-control/useMissionControl';

interface MissionControlScreenProps {
  onBack: () => void;
  currentUser: FirebaseUser | null;
}

export default function MissionControlScreen({
  onBack,
  currentUser,
}: MissionControlScreenProps) {
  const [activeTab, setActiveTab] = useState<MCTab>('overview');
  const {
    stats,
    filteredStats,
    statsLoading,
    statsError,
    showAddChurch,
    editingChurch,
    formLoading,
    formError,
    confirmDeactivateId,
    deactivateLoading,
    searchQuery,
    promoteUid,
    promoteLoading,
    promoteResult,
    assignChurchId,
    assignEmail,
    assignRole,
    assignLoading,
    assignResult,
    activeChurchCount,
    totalMembers,
    totalDonations,
    totalEvents,
    loadStats,
    setSearchQuery,
    setPromoteUid,
    setAssignEmail,
    setAssignRole,
    openAddChurch,
    closeAddChurch,
    openEditChurch,
    closeEditChurch,
    startAssignMembership,
    cancelAssignMembership,
    requestDeactivate,
    cancelDeactivate,
    handleAddChurch,
    handleEditChurch,
    handleSetActive,
    handlePromote,
    handleAssignMembership,
  } = useMissionControl();

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <MissionControlHeader
        currentUser={currentUser}
        loading={statsLoading}
        onBack={onBack}
        onRefresh={() => void loadStats()}
      />
      <MissionControlTabBar activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="flex-1 overflow-y-auto">
        {statsError && (
          <div className="mx-6 mt-4 p-4 bg-red-900/30 rounded-xl">
            <p className="text-red-400 text-xs font-bold">{statsError}</p>
          </div>
        )}

        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <MissionControlOverviewTab
              stats={stats}
              statsLoading={statsLoading}
              activeChurchCount={activeChurchCount}
              totalMembers={totalMembers}
              totalDonations={totalDonations}
              totalEvents={totalEvents}
              promoteUid={promoteUid}
              promoteLoading={promoteLoading}
              promoteResult={promoteResult}
              onShowAddChurch={openAddChurch}
              onOpenChurches={() => setActiveTab('churches')}
              onPromoteUidChange={setPromoteUid}
              onPromote={() => void handlePromote()}
            />
          )}

          {activeTab === 'churches' && (
            <MissionControlChurchesTab
              statsLoading={statsLoading}
              filteredStats={filteredStats}
              searchQuery={searchQuery}
              confirmDeactivateId={confirmDeactivateId}
              deactivateLoading={deactivateLoading}
              assignChurchId={assignChurchId}
              assignEmail={assignEmail}
              assignRole={assignRole}
              assignLoading={assignLoading}
              assignResult={assignResult}
              onSearchQueryChange={setSearchQuery}
              onShowAddChurch={openAddChurch}
              onEditChurch={(church) => void openEditChurch(church.churchId)}
              onStartAssign={startAssignMembership}
              onCancelAssign={cancelAssignMembership}
              onAssignEmailChange={setAssignEmail}
              onAssignRoleChange={setAssignRole}
              onAssignMembership={(churchId) => void handleAssignMembership(churchId)}
              onRequestDeactivate={requestDeactivate}
              onCancelDeactivate={cancelDeactivate}
              onSetActive={(churchId, isActive) => void handleSetActive(churchId, isActive)}
            />
          )}

          {activeTab === 'analytics' && (
            <MissionControlAnalyticsTab stats={stats} statsLoading={statsLoading} />
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showAddChurch && (
          <ChurchFormSheet
            title="Add New Church"
            initial={EMPTY_CHURCH_FORM}
            onSubmit={(form) => void handleAddChurch(form)}
            onCancel={closeAddChurch}
            loading={formLoading}
          />
        )}
        {editingChurch && (
          <ChurchFormSheet
            title="Edit Church"
            initial={buildEditChurchForm(editingChurch)}
            onSubmit={(form) => void handleEditChurch(form)}
            onCancel={closeEditChurch}
            loading={formLoading}
          />
        )}
      </AnimatePresence>

      {formError && (
        <div className="fixed bottom-6 left-6 right-6 bg-red-900 rounded-xl px-4 py-3 z-[200]">
          <p className="text-red-200 text-xs font-bold">{formError}</p>
        </div>
      )}
    </div>
  );
}
