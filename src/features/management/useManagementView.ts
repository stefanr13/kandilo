import { useEffect, useState } from 'react';
import { Role } from '../../domain/church';
import {
  canAccessManagementTools,
  canDeleteNewsletters,
  canManageMemberRoles,
  canManageMemberStatus,
} from '../../domain/roles';
import type { Language } from '../../types';
import { getExtraCopy } from '../../localization/extra';
import { useChurchData } from '../../hooks/useChurchData';
import {
  createEvent,
  createNewsletter,
  deleteEvent,
  deleteNewsletter,
  deletePost,
  subscribeToPosts,
  subscribeToChurch,
  getChurchManagementStats,
  updateChurchShowSaintDays,
  updateEvent,
  updateNewsletter,
  updateMemberRole,
  updateMemberStatus,
} from '../../lib/db';
import { sendInvitation } from '../../lib/api/invitations';
import { sendPushNotification } from '../../lib/api/notifications';
import type { ChurchPost } from '../../lib/db/posts';
import type { FirestoreEvent } from '../../lib/db/events';
import type { NewsletterStatus } from '../../lib/db/newsletters';
import {
  countActiveMembers,
  countSentNewsletters,
  countUpcomingEvents,
  filterMembers,
  getNextMemberStatus,
} from './management-model';
import { ManagementTab } from './types';

const EVENT_SAVE_CONFIRMATION_TIMEOUT_MS = 10_000;

async function waitForEventWriteConfirmation(write: Promise<unknown>): Promise<'confirmed' | 'queued'> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const confirmation = write.then(() => 'confirmed' as const);
  const timeout = new Promise<'queued'>((resolve) => {
    timeoutId = setTimeout(() => resolve('queued'), EVENT_SAVE_CONFIRMATION_TIMEOUT_MS);
  });

  const result = await Promise.race([confirmation, timeout]);
  if (result === 'confirmed' && timeoutId) {
    clearTimeout(timeoutId);
  }
  if (result === 'queued') {
    confirmation.catch((error) => {
      console.error('Event save failed after the UI closed:', error);
    });
  }
  return result;
}

interface UseManagementViewOptions {
  churchId: string;
  userRole: Role;
  currentUserId: string | null;
  language: Language;
}

export function useManagementView({ churchId, userRole, currentUserId, language }: UseManagementViewOptions) {
  const copy = getExtraCopy(language).management;
  const eventCopy = copy.eventSheet;
  const [activeTab, setActiveTab] = useState<ManagementTab>('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMemberMenu, setActiveMemberMenu] = useState<string | null>(null);
  const [updatingMemberId, setUpdatingMemberId] = useState<string | null>(null);
  const [posts, setPosts] = useState<ChurchPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [editingPost, setEditingPost] = useState<ChurchPost | null | undefined>(undefined);
  const [editingEvent, setEditingEvent] = useState<FirestoreEvent | null>(null);
  const [eventSheetOpen, setEventSheetOpen] = useState(false);
  const [eventSaveError, setEventSaveError] = useState('');
  const [eventSaving, setEventSaving] = useState(false);
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteNotice, setInviteNotice] = useState('');
  const [inviteSaving, setInviteSaving] = useState(false);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
  const [deletingNewsletterId, setDeletingNewsletterId] = useState<string | null>(null);
  const [newsletterSaving, setNewsletterSaving] = useState(false);
  const [newsletterSaveError, setNewsletterSaveError] = useState('');
  const [notificationSending, setNotificationSending] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const [notificationNotice, setNotificationNotice] = useState('');
  const [showSaintDays, setShowSaintDays] = useState(false);
  const [savingShowSaintDays, setSavingShowSaintDays] = useState(false);
  const [dashboardStats, setDashboardStats] = useState({
    activeMemberCount: 0,
    upcomingEventCount: 0,
    sentNewsletterCount: 0,
  });
  const [dashboardStatsLoading, setDashboardStatsLoading] = useState(true);
  const needsMembers = activeTab === 'members' || activeTab === 'scanner';
  const needsEvents = activeTab === 'events' || activeTab === 'scanner';
  const needsNewsletters = activeTab === 'newsletters';

  useEffect(() => {
    if (activeTab !== 'posts') {
      setPosts([]);
      setPostsLoading(false);
      return;
    }

    setPostsLoading(true);
    const unsubscribe = subscribeToPosts(churchId, (nextPosts) => {
      setPosts(nextPosts);
      setPostsLoading(false);
    });
    return unsubscribe;
  }, [churchId, activeTab]);

  useEffect(() => {
    if (activeTab !== 'dashboard') {
      setDashboardStatsLoading(false);
      return undefined;
    }

    let cancelled = false;
    setDashboardStatsLoading(true);
    void getChurchManagementStats(churchId)
      .then((stats) => {
        if (!cancelled) {
          setDashboardStats(stats);
        }
      })
      .catch((error) => {
        console.error('Failed to load management dashboard stats:', error);
        if (!cancelled) {
          setDashboardStats({
            activeMemberCount: 0,
            upcomingEventCount: 0,
            sentNewsletterCount: 0,
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDashboardStatsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [churchId, activeTab]);

  // Subscribe to the church document for live settings (showSaintDays etc.)
  useEffect(() => {
    if (activeTab !== 'dashboard') {
      return undefined;
    }

    const unsubscribe = subscribeToChurch(churchId, (church) => {
      if (church) setShowSaintDays(church.showSaintDays);
    });
    return unsubscribe;
  }, [churchId, activeTab]);

  const { members, events, newsletters, membersLoading, eventsLoading, newslettersLoading } = useChurchData(churchId, {
    members: needsMembers,
    events: needsEvents,
    newsletters: needsNewsletters,
  });

  const isPriest = canManageMemberRoles(userRole);
  const isAdminOrPriest = canAccessManagementTools(userRole);
  const filteredMembers = filterMembers(members, searchQuery);
  const activeMemberCount =
    activeTab === 'dashboard' ? dashboardStats.activeMemberCount : countActiveMembers(members);
  const upcomingEventCount =
    activeTab === 'dashboard' ? dashboardStats.upcomingEventCount : countUpcomingEvents(events);
  const sentNewsletterCount =
    activeTab === 'dashboard' ? dashboardStats.sentNewsletterCount : countSentNewsletters(newsletters);
  const effectiveMembersLoading = activeTab === 'dashboard' ? dashboardStatsLoading : membersLoading;
  const effectiveEventsLoading = activeTab === 'dashboard' ? dashboardStatsLoading : eventsLoading;
  const effectiveNewslettersLoading = activeTab === 'dashboard' ? dashboardStatsLoading : newslettersLoading;

  const handleRoleChange = async (memberId: string, newRole: Role) => {
    if (!isPriest) {
      return;
    }

    setUpdatingMemberId(memberId);
    try {
      await updateMemberRole(churchId, memberId, newRole);
    } finally {
      setUpdatingMemberId(null);
      setActiveMemberMenu(null);
    }
  };

  const handleSuspendMember = async (memberId: string) => {
    if (!canManageMemberStatus(userRole)) {
      return;
    }

    setUpdatingMemberId(memberId);
    try {
      const member = members.find((entry) => entry.id === memberId);
      const newStatus = getNextMemberStatus(member?.status ?? 'active');
      await updateMemberStatus(churchId, memberId, newStatus);
    } finally {
      setUpdatingMemberId(null);
      setActiveMemberMenu(null);
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!isAdminOrPriest) {
      return;
    }

    await deleteEvent(eventId);
  };

  const handleSubmitEvent = (values: {
    title: string;
    description: string;
    location: string;
    category: string;
    startAt: string;
    endAt: string;
  }): boolean => {
    if (!isAdminOrPriest) {
      return false;
    }
    if (!currentUserId) {
      setEventSaveError(eventCopy.signedOut);
      return false;
    }

    const startTime = new Date(values.startAt);
    const endTime = new Date(values.endAt);
    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
      setEventSaveError(eventCopy.invalidDates);
      return false;
    }
    if (endTime <= startTime) {
      setEventSaveError(eventCopy.endAfterStart);
      return false;
    }

    setEventSaving(true);
    setEventSaveError('');
    try {
      const title = values.title.trim();
      const description = values.description.trim();
      const location = values.location.trim();
      const category = values.category.trim();
      if (!title || !description || !location || !category) {
        setEventSaveError(eventCopy.allFields);
        setEventSaving(false);
        return false;
      }

      const payload = {
        title,
        description,
        location,
        category,
        startTime,
        endTime,
      };

      const eventToUpdate = editingEvent;
      setEventSheetOpen(false);
      setEditingEvent(null);
      setTimeout(() => {
        try {
          const write = eventToUpdate
            ? updateEvent(eventToUpdate.id, payload)
            : createEvent(churchId, currentUserId, payload);
          void waitForEventWriteConfirmation(write)
            .then((writeState) => {
              if (writeState === 'queued') {
                console.warn(eventCopy.queuedWarning);
              }
            })
            .catch((error) => {
              console.error(eventCopy.failedAfterClose, error);
            })
            .finally(() => {
              setEventSaving(false);
            });
        } catch (error) {
          console.error(eventCopy.failedToStart, error);
          setEventSaving(false);
        }
      }, 0);
      return true;
    } catch (error) {
      console.error('Failed to save event:', error);
      setEventSaveError(eventCopy.unableSave);
      setEventSaving(false);
      return false;
    }
  };

  const handleSendInvitation = async (values: {
    inviteeEmail: string;
    role: 'member' | 'admin';
  }) => {
    if (!isAdminOrPriest) {
      return;
    }

    setInviteSaving(true);
    setInviteError('');
    setInviteNotice('');
    try {
      const result = await sendInvitation({
        churchId,
        inviteeEmail: values.inviteeEmail.trim(),
        role: values.role,
      });
      if (result.emailSent === false && result.inviteUrl) {
        setInviteNotice(copy.invite.manual(result.inviteUrl));
        return;
      }
      setInviteSheetOpen(false);
    } catch (error) {
      console.error('Failed to send invitation:', error);
      setInviteError(copy.invite.unable);
    } finally {
      setInviteSaving(false);
    }
  };

  const handleToggleShowSaintDays = async (value: boolean) => {
    setSavingShowSaintDays(true);
    try {
      await updateChurchShowSaintDays(churchId, value);
    } catch (err) {
      console.error('Failed to update showSaintDays:', err);
    } finally {
      setSavingShowSaintDays(false);
    }
  };

  const handleDeletePost = async (postId: string) => {
    setDeletingPostId(postId);
    try {
      await deletePost(churchId, postId);
    } finally {
      setDeletingPostId(null);
    }
  };

  const handleSaveNewsletter = async (
    newsletterId: string | null,
    values: {
      title: string;
      excerpt: string;
      content: string;
      status: NewsletterStatus;
    }
  ): Promise<boolean> => {
    if (!isAdminOrPriest) {
      return false;
    }
    if (!currentUserId) {
      setNewsletterSaveError(copy.newsletters.signedOutError);
      return false;
    }

    setNewsletterSaving(true);
    setNewsletterSaveError('');
    try {
      if (newsletterId) {
        await updateNewsletter(newsletterId, values);
      } else {
        await createNewsletter(churchId, currentUserId, values);
      }
      return true;
    } catch (error) {
      console.error('Failed to save bulletin:', error);
      setNewsletterSaveError(copy.newsletters.saveError);
      return false;
    } finally {
      setNewsletterSaving(false);
    }
  };

  const handleDeleteNewsletter = async (newsletterId: string): Promise<void> => {
    if (!canDeleteNewsletters(userRole)) {
      return;
    }

    setDeletingNewsletterId(newsletterId);
    try {
      await deleteNewsletter(newsletterId);
    } catch (error) {
      console.error('Failed to delete bulletin:', error);
      setNewsletterSaveError(copy.newsletters.deleteError);
    } finally {
      setDeletingNewsletterId(null);
    }
  };

  const handleSendPushNotification = async (values: {
    title: string;
    body: string;
    targetRoles: Array<'member' | 'admin' | 'priest'>;
  }): Promise<void> => {
    if (!isAdminOrPriest) {
      return;
    }

    setNotificationSending(true);
    setNotificationError('');
    setNotificationNotice('');
    try {
      await sendPushNotification({
        churchId,
        title: values.title,
        body: values.body,
        targetRoles: values.targetRoles,
      });
      setNotificationNotice(copy.notifications.sent);
    } catch (error) {
      console.error('Failed to send notification:', error);
      setNotificationError(copy.notifications.sendError);
    } finally {
      setNotificationSending(false);
    }
  };

  const openEventEditor = (event: FirestoreEvent | null) => {
    setEventSaveError('');
    setActiveMemberMenu(null);
    setEditingEvent(event);
    setEventSheetOpen(true);
  };

  const closeEventEditor = () => {
    setEventSaveError('');
    setEventSheetOpen(false);
    setEditingEvent(null);
  };

  const openInvitePanel = () => {
    setInviteError('');
    setInviteNotice('');
    setActiveMemberMenu(null);
    setInviteSheetOpen(true);
  };

  const closeInvitePanel = () => {
    setInviteError('');
    setInviteNotice('');
    setInviteSheetOpen(false);
  };

  return {
    activeTab,
    searchQuery,
    activeMemberMenu,
    updatingMemberId,
    posts,
    postsLoading,
    editingPost,
    editingEvent,
    eventSheetOpen,
    eventSaveError,
    eventSaving,
    inviteSheetOpen,
    inviteError,
    inviteNotice,
    inviteSaving,
    deletingPostId,
    deletingNewsletterId,
    newsletterSaving,
    newsletterSaveError,
    notificationSending,
    notificationError,
    notificationNotice,
    showSaintDays,
    savingShowSaintDays,
    members,
    events,
    newsletters,
    membersLoading: effectiveMembersLoading,
    eventsLoading: effectiveEventsLoading,
    newslettersLoading: effectiveNewslettersLoading,
    filteredMembers,
    isPriest,
    isAdminOrPriest,
    activeMemberCount,
    upcomingEventCount,
    sentNewsletterCount,
    setActiveTab,
    setSearchQuery,
    setActiveMemberMenu,
    setEditingPost,
    openEventEditor,
    closeEventEditor,
    openInvitePanel,
    closeInvitePanel,
    handleRoleChange,
    handleSuspendMember,
    handleDeleteEvent,
    handleSubmitEvent,
    handleSendInvitation,
    handleDeletePost,
    handleSaveNewsletter,
    handleDeleteNewsletter,
    handleSendPushNotification,
    handleToggleShowSaintDays,
  };
}
