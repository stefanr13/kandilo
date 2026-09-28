import { Suspense, lazy } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import AppLoadingScreen from '../../components/app/AppLoadingScreen';
import type { Role } from '../../domain/church';
import type { Language } from '../../types';
import type { StripeConnectReturnStatus } from '../../app/navigation';
import ManagementDashboardTab from './ManagementDashboardTab';
import ManagementEventSheet from './ManagementEventSheet';
import ManagementEventsTab from './ManagementEventsTab';
import ManagementEventPlatformTab from './ManagementEventPlatformTab';
import ManagementInviteSheet from './ManagementInviteSheet';
import ManagementMembersTab from './ManagementMembersTab';
import ManagementNewslettersTab from './ManagementNewslettersTab';
import ManagementNotificationsTab from './ManagementNotificationsTab';
import ManagementPostsTab from './ManagementPostsTab';
import ManagementReceiptsTab from './ManagementReceiptsTab';
import ManagementScannerTab from './ManagementScannerTab';
import ManagementSidebar from './ManagementSidebar';
import type { ManagementTab } from './types';
import { useManagementView } from './useManagementView';

const PostEditor = lazy(() => import('../../components/PostEditor'));

interface ManagementViewProps {
  churchId: string;
  userRole: Role;
  currentUser: FirebaseUser | null;
  language?: Language;
  initialTab?: ManagementTab | null;
  stripeConnectReturnStatus?: StripeConnectReturnStatus | null;
  stripeConnectReturnSequence?: number | null;
  onStripeConnectReturnConsumed?: () => void;
}

export default function ManagementView({
  churchId,
  userRole,
  currentUser,
  language = 'English',
  initialTab = null,
  stripeConnectReturnStatus = null,
  stripeConnectReturnSequence = null,
  onStripeConnectReturnConsumed,
}: ManagementViewProps) {
  const management = useManagementView({
    churchId,
    userRole,
    currentUserId: currentUser?.uid ?? null,
    language,
    initialTab,
    stripeConnectReturnStatus,
    stripeConnectReturnSequence,
    onStripeConnectReturnConsumed,
  });

  if (management.isAdminOrPriest && management.editingPost !== undefined) {
    return (
      <Suspense fallback={<AppLoadingScreen variant="panel" />}>
        <PostEditor
          churchId={churchId}
          currentUser={currentUser}
          userRole={userRole}
          post={management.editingPost}
          onSaved={() => management.setEditingPost(undefined)}
          onBack={() => management.setEditingPost(undefined)}
          language={language}
        />
      </Suspense>
    );
  }

  return (
    <div className="flex h-full bg-white" onClick={() => management.setActiveMemberMenu(null)}>
      <ManagementSidebar
        activeTab={management.activeTab}
        onTabChange={management.setActiveTab}
        language={language}
        showOperations={management.isAdminOrPriest}
        showReceipts={management.canManageReceipts}
      />

      <div className="flex-1 flex flex-col min-w-0" onClick={(event) => event.stopPropagation()}>
        {management.churchDataError && (
          <p role="alert" className="m-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">Parish data could not be loaded. Please refresh and try again.</p>
        )}
        {management.isAdminOrPriest && management.activeTab === 'dashboard' && (
          <ManagementDashboardTab
            activeMemberCount={management.activeMemberCount}
            upcomingEventCount={management.upcomingEventCount}
            sentNewsletterCount={management.sentNewsletterCount}
            membersLoading={management.membersLoading}
            eventsLoading={management.eventsLoading}
            newslettersLoading={management.newslettersLoading}
            showSaintDays={management.showSaintDays}
            savingShowSaintDays={management.savingShowSaintDays}
            onOpenEvents={() => {
              management.setActiveTab('events');
              management.openEventEditor(null);
            }}
            onOpenMembers={() => management.setActiveTab('members')}
            onOpenPosts={() => management.setActiveTab('posts')}
            onOpenNewsletters={() => management.setActiveTab('newsletters')}
            onOpenNotifications={() => management.setActiveTab('notifications')}
            onToggleShowSaintDays={(v) => void management.handleToggleShowSaintDays(v)}
            language={language}
          />
        )}

        {management.isAdminOrPriest && management.activeTab === 'members' && (
          <ManagementMembersTab
            filteredMembers={management.filteredMembers}
            membersLoading={management.membersLoading}
            activeMemberCount={management.activeMemberCount}
            searchQuery={management.searchQuery}
            activeMemberMenu={management.activeMemberMenu}
            updatingMemberId={management.updatingMemberId}
            isPriest={management.isPriest}
            isAdminOrPriest={management.isAdminOrPriest}
            currentUserId={currentUser?.uid ?? null}
            onSearchQueryChange={management.setSearchQuery}
            onToggleMemberMenu={management.setActiveMemberMenu}
            onRoleChange={(memberId, role) => void management.handleRoleChange(memberId, role)}
            onSuspendMember={(memberId) => void management.handleSuspendMember(memberId)}
            onInviteMember={management.openInvitePanel}
            language={language}
          />
        )}

        {management.isAdminOrPriest && management.activeTab === 'events' && (
          <ManagementEventsTab
            events={management.events}
            eventsLoading={management.eventsLoading}
            isAdminOrPriest={management.isAdminOrPriest}
            onDeleteEvent={(eventId) => void management.handleDeleteEvent(eventId)}
            onCreateEvent={() => management.openEventEditor(null)}
            onEditEvent={management.openEventEditor}
            language={language}
          />
        )}

        {management.isAdminOrPriest && management.activeTab === 'eventPlatform' && (
          <ManagementEventPlatformTab
            churchId={churchId}
            isAdminOrPriest={management.isAdminOrPriest}
            language={language}
          />
        )}

        {management.isAdminOrPriest && management.activeTab === 'posts' && (
          <ManagementPostsTab
            posts={management.posts}
            postsLoading={management.postsLoading}
            deletingPostId={management.deletingPostId}
            isAdminOrPriest={management.isAdminOrPriest}
            onCreatePost={() => management.setEditingPost(null)}
            onEditPost={management.setEditingPost}
            onDeletePost={(postId) => void management.handleDeletePost(postId)}
            language={language}
          />
        )}

        {management.isAdminOrPriest && management.activeTab === 'newsletters' && (
          <ManagementNewslettersTab
            newsletters={management.newsletters}
            newslettersLoading={management.newslettersLoading}
            deletingNewsletterId={management.deletingNewsletterId}
            newsletterSaving={management.newsletterSaving}
            newsletterSaveError={management.newsletterSaveError}
            isAdminOrPriest={management.isAdminOrPriest}
            isPriest={management.isPriest}
            onSaveNewsletter={management.handleSaveNewsletter}
            onDeleteNewsletter={management.handleDeleteNewsletter}
            language={language}
          />
        )}

        {management.isAdminOrPriest && management.activeTab === 'notifications' && (
          <ManagementNotificationsTab
            isAdminOrPriest={management.isAdminOrPriest}
            sending={management.notificationSending}
            error={management.notificationError}
            notice={management.notificationNotice}
            onSend={management.handleSendPushNotification}
            language={language}
          />
        )}

        {management.canManageReceipts && management.activeTab === 'receipts' && (
          <ManagementReceiptsTab
            records={management.receiptRecords}
            annualSummaries={management.annualReceiptSummaries}
            loading={management.receiptRecordsLoading}
            error={management.receiptRecordsError}
            notice={management.receiptNotice}
            sendingReceiptId={management.sendingReceiptId}
            sendingAnnualReceiptKey={management.sendingAnnualReceiptKey}
            sendingBulkAnnualReceiptYear={management.sendingBulkAnnualReceiptYear}
            sendingBulkCorrectedAnnualReceiptYear={management.sendingBulkCorrectedAnnualReceiptYear}
            stripeOnboardingLoading={management.stripeOnboardingLoading}
            stripeConnectSetupStatus={management.stripeConnectSetupStatus}
            stripeConnectSetupStatusLoading={management.stripeConnectSetupStatusLoading}
            canManageReceipts={management.canManageReceipts}
            taxReceiptIssuanceState={management.taxReceiptIssuanceState}
            taxReceiptIssuanceReady={management.taxReceiptIssuanceReady}
            onOpenStripeConnectOnboarding={() => void management.handleOpenStripeConnectOnboarding()}
            onSendReceipt={(givingId) => void management.handleSendTaxReceipt(givingId)}
            onSendCorrectedReceipt={(givingId) => void management.handleSendCorrectedTaxReceipt(givingId)}
            onSendAnnualReceipt={(userId, year, acknowledgePreviouslyReceipted) =>
              void management.handleSendAnnualTaxReceipt(userId, year, acknowledgePreviouslyReceipted)}
            onSendCorrectedAnnualReceipt={(userId, year, acknowledgePreviouslyReceipted) =>
              void management.handleSendCorrectedAnnualTaxReceipt(userId, year, acknowledgePreviouslyReceipted)}
            onSendChurchAnnualReceipts={(year, acknowledgePreviouslyReceipted) =>
              void management.handleSendChurchAnnualTaxReceipts(year, acknowledgePreviouslyReceipted)}
            onSendChurchCorrectedAnnualReceipts={(year, acknowledgePreviouslyReceipted) =>
              void management.handleSendChurchCorrectedAnnualTaxReceipts(year, acknowledgePreviouslyReceipted)}
            language={language}
            churchTimezone={management.churchTimezone}
          />
        )}

        {management.isAdminOrPriest && management.activeTab === 'scanner' && (
          <ManagementScannerTab
            churchId={churchId}
            currentUserId={currentUser?.uid ?? null}
            events={management.events}
            members={management.members}
            eventsLoading={management.eventsLoading}
            membersLoading={management.membersLoading}
            isAdminOrPriest={management.isAdminOrPriest}
            language={language}
          />
        )}
      </div>

      <ManagementEventSheet
        event={management.editingEvent ?? null}
        isOpen={management.eventSheetOpen}
        saving={management.eventSaving}
        error={management.eventSaveError}
        onClose={management.closeEventEditor}
        onSubmit={management.handleSubmitEvent}
        language={language}
      />

      <ManagementInviteSheet
        isOpen={management.inviteSheetOpen}
        saving={management.inviteSaving}
        allowAdminInvites={management.isPriest}
        error={management.inviteError}
        notice={management.inviteNotice}
        onClose={management.closeInvitePanel}
        onSubmit={management.handleSendInvitation}
        language={language}
      />
    </div>
  );
}
