import { Suspense, lazy } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import AppLoadingScreen from '../../components/app/AppLoadingScreen';
import { Role } from '../../domain/church';
import type { Language } from '../../types';
import ManagementDashboardTab from './ManagementDashboardTab';
import ManagementEventSheet from './ManagementEventSheet';
import ManagementEventsTab from './ManagementEventsTab';
import ManagementInviteSheet from './ManagementInviteSheet';
import ManagementMembersTab from './ManagementMembersTab';
import ManagementNewslettersTab from './ManagementNewslettersTab';
import ManagementNotificationsTab from './ManagementNotificationsTab';
import ManagementPostsTab from './ManagementPostsTab';
import ManagementScannerTab from './ManagementScannerTab';
import ManagementSidebar from './ManagementSidebar';
import { useManagementView } from './useManagementView';

const PostEditor = lazy(() => import('../../components/PostEditor'));

interface ManagementViewProps {
  churchId: string;
  userRole: Role;
  currentUser: FirebaseUser | null;
  language?: Language;
}

export default function ManagementView({
  churchId,
  userRole,
  currentUser,
  language = 'English',
}: ManagementViewProps) {
  const management = useManagementView({
    churchId,
    userRole,
    currentUserId: currentUser?.uid ?? null,
    language,
  });

  if (management.editingPost !== undefined) {
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
      />

      <div className="flex-1 flex flex-col min-w-0" onClick={(event) => event.stopPropagation()}>
        {management.activeTab === 'dashboard' && (
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

        {management.activeTab === 'members' && (
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

        {management.activeTab === 'events' && (
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

        {management.activeTab === 'posts' && (
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

        {management.activeTab === 'newsletters' && (
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

        {management.activeTab === 'notifications' && (
          <ManagementNotificationsTab
            isAdminOrPriest={management.isAdminOrPriest}
            sending={management.notificationSending}
            error={management.notificationError}
            notice={management.notificationNotice}
            onSend={management.handleSendPushNotification}
            language={language}
          />
        )}

        {management.activeTab === 'scanner' && (
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
