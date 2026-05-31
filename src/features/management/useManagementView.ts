import { useCallback, useEffect, useState } from 'react';
import { getTaxReceiptIssuanceState } from '../../domain/church';
import type { Role, TaxReceiptIssuanceState } from '../../domain/church';
import type { StripeConnectReturnStatus } from '../../app/navigation';
import {
  canDeleteNewsletters,
  canManageTaxReceipts,
  canManageMemberRoles,
  canManageMemberStatus,
  isAdminOrPriestRole,
} from '../../domain/roles';
import type { ChurchStripeConnectSetupStatus, Language } from '../../types';
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
  subscribeToChurchAnnualTaxReceiptSummaries,
  subscribeToChurchGivingForReceipts,
  type FirestoreGivingRecord,
  type FirestoreTaxReceiptSummaryRecord,
} from '../../lib/db';
import {
  sendAnnualTaxReceipt,
  sendChurchAnnualTaxReceipts,
  sendChurchCorrectedAnnualTaxReceipts,
  sendCorrectedAnnualTaxReceipt,
  sendCorrectedTaxReceipt,
  sendTaxReceipt,
} from '../../lib/api/giving';
import {
  callableReceiptDeliveryErrorMessage,
  receiptBatchFailureReason,
  type ReceiptDeliveryErrorMessages,
} from '../../lib/giving/receipt-errors';
import { sendInvitation } from '../../lib/api/invitations';
import {
  createChurchStripeConnectOnboardingLink,
  fetchChurchStripeConnectSetupStatus,
} from '../../lib/api/mission-control';
import {
  createPendingStripeConnectOnboardingState,
  createStripeConnectReturnState,
  PENDING_STRIPE_CONNECT_STORAGE_KEY,
} from '../../lib/stripe/connect';
import { sendPushNotification } from '../../lib/api/notifications';
import { openExternalUrl } from '../../app/native';
import type { ChurchPost } from '../../lib/db/posts';
import type { FirestoreEvent } from '../../lib/db/events';
import type { NewsletterStatus } from '../../lib/db/newsletters';
import {
  countActiveMembers,
  countSentNewsletters,
  countUpcomingEvents,
  coerceManagementTabForRole,
  filterMembers,
  getDefaultManagementTab,
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
  initialTab?: ManagementTab | null;
  stripeConnectReturnStatus?: StripeConnectReturnStatus | null;
  stripeConnectReturnSequence?: number | null;
  onStripeConnectReturnConsumed?: () => void;
}

export function useManagementView({
  churchId,
  userRole,
  currentUserId,
  language,
  initialTab = null,
  stripeConnectReturnStatus = null,
  stripeConnectReturnSequence = null,
  onStripeConnectReturnConsumed,
}: UseManagementViewOptions) {
  const copy = getExtraCopy(language).management;
  const eventCopy = copy.eventSheet;
  const receiptDeliveryErrorMessages: ReceiptDeliveryErrorMessages = {
    fallback: copy.receipts.sendError,
    emailNotConfigured: copy.receipts.emailNotConfigured,
    emailInvalidConfiguration: copy.receipts.emailInvalidConfiguration,
    missingEmailOrAmount: copy.receipts.missingEmailOrAmount,
    missingDonorProfile: copy.receipts.missingDonorProfile,
    pdfFailed: copy.receipts.pdfFailed,
    providerRejected: copy.receipts.providerRejected,
    genericIssue: copy.receipts.genericIssue,
    setupRequired: copy.receipts.setupRequired,
    unsupportedJurisdiction: copy.receipts.unsupportedJurisdictionSetupRequired,
    previouslyReceiptedAckRequired: copy.receipts.previouslyReceiptedAckRequired,
    partialRefundReview: copy.receipts.partialRefundReview,
    singleIncludedInAnnual: copy.receipts.singleIncludedInAnnual,
    singleGivingChanged: copy.receipts.singleGivingChanged,
    annualGivingChanged: copy.receipts.annualGivingChanged,
    annualMixedCurrency: copy.receipts.annualMixedCurrency,
  };
  const isPriest = canManageMemberRoles(userRole);
  const isAdminOrPriest = isAdminOrPriestRole(userRole);
  const canManageReceipts = canManageTaxReceipts(userRole);
  const [activeTab, setActiveTabState] = useState<ManagementTab>(() => (
    initialTab ? coerceManagementTabForRole(initialTab, userRole) : getDefaultManagementTab(userRole)
  ));
  const [handledStripeConnectReturnSequence, setHandledStripeConnectReturnSequence] =
    useState<number | null>(null);
  const setActiveTab = useCallback(
    (tab: ManagementTab) => {
      setActiveTabState(coerceManagementTabForRole(tab, userRole));
    },
    [userRole]
  );
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
  const [receiptRecords, setReceiptRecords] = useState<FirestoreGivingRecord[]>([]);
  const [annualReceiptSummaries, setAnnualReceiptSummaries] = useState<FirestoreTaxReceiptSummaryRecord[]>([]);
  const [receiptRecordsLoading, setReceiptRecordsLoading] = useState(false);
  const [receiptRecordsError, setReceiptRecordsError] = useState('');
  const [receiptNotice, setReceiptNotice] = useState('');
  const [sendingReceiptId, setSendingReceiptId] = useState<string | null>(null);
  const [sendingAnnualReceiptKey, setSendingAnnualReceiptKey] = useState<string | null>(null);
  const [sendingBulkAnnualReceiptYear, setSendingBulkAnnualReceiptYear] = useState<number | null>(null);
  const [sendingBulkCorrectedAnnualReceiptYear, setSendingBulkCorrectedAnnualReceiptYear] = useState<number | null>(null);
  const [stripeOnboardingLoading, setStripeOnboardingLoading] = useState(false);
  const [stripeConnectSetupStatus, setStripeConnectSetupStatus] =
    useState<ChurchStripeConnectSetupStatus | null>(null);
  const [stripeConnectSetupStatusLoading, setStripeConnectSetupStatusLoading] = useState(false);
  const [showSaintDays, setShowSaintDays] = useState(false);
  const [churchTimezone, setChurchTimezone] = useState('UTC');
  const [taxReceiptIssuanceState, setTaxReceiptIssuanceState] =
    useState<TaxReceiptIssuanceState>('disabled');
  const [taxReceiptIssuanceReady, setTaxReceiptIssuanceReady] = useState(false);
  const receiptSetupRequiredMessage = taxReceiptIssuanceState === 'unsupported_jurisdiction'
    ? copy.receipts.unsupportedJurisdictionSetupRequired
    : copy.receipts.setupRequired;
  const [savingShowSaintDays, setSavingShowSaintDays] = useState(false);
  const [dashboardStats, setDashboardStats] = useState({
    activeMemberCount: 0,
    upcomingEventCount: 0,
    sentNewsletterCount: 0,
  });
  const [dashboardStatsLoading, setDashboardStatsLoading] = useState(true);
  const needsMembers = isAdminOrPriest && (activeTab === 'members' || activeTab === 'scanner');
  const needsEvents = isAdminOrPriest && (activeTab === 'events' || activeTab === 'scanner');
  const needsNewsletters = isAdminOrPriest && activeTab === 'newsletters';
  const needsReceipts = activeTab === 'receipts' && canManageReceipts;

  useEffect(() => {
    const allowedTab = coerceManagementTabForRole(activeTab, userRole);
    if (activeTab !== allowedTab) {
      setActiveTabState(allowedTab);
    }
  }, [activeTab, userRole]);

  useEffect(() => {
    if (!initialTab) {
      return;
    }

    const nextTab = coerceManagementTabForRole(initialTab, userRole);
    setActiveTabState((currentTab) => (currentTab === nextTab ? currentTab : nextTab));
  }, [initialTab, userRole]);

  useEffect(() => {
    if (!stripeConnectReturnStatus || stripeConnectReturnSequence === null) {
      return;
    }

    if (handledStripeConnectReturnSequence === stripeConnectReturnSequence) {
      return;
    }

    setHandledStripeConnectReturnSequence(stripeConnectReturnSequence);
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(PENDING_STRIPE_CONNECT_STORAGE_KEY);
    }
    onStripeConnectReturnConsumed?.();

    if (!canManageReceipts) {
      return;
    }

    setActiveTabState(coerceManagementTabForRole('receipts', userRole));
    setReceiptRecordsError('');
    setReceiptNotice(
      stripeConnectReturnStatus === 'refresh'
        ? copy.receipts.stripeOnboardingRefreshNotice
        : copy.receipts.stripeOnboardingReturnNotice
    );
  }, [
    canManageReceipts,
    copy.receipts.stripeOnboardingRefreshNotice,
    copy.receipts.stripeOnboardingReturnNotice,
    handledStripeConnectReturnSequence,
    onStripeConnectReturnConsumed,
    stripeConnectReturnSequence,
    stripeConnectReturnStatus,
    userRole,
  ]);

  useEffect(() => {
    if (isAdminOrPriest) {
      return;
    }

    setEditingPost(undefined);
    setEditingEvent(null);
    setEventSheetOpen(false);
    setInviteSheetOpen(false);
  }, [isAdminOrPriest]);

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

  // Subscribe to the church document for live settings used by dashboard and receipt year grouping.
  useEffect(() => {
    if (activeTab !== 'dashboard' && activeTab !== 'receipts') {
      return undefined;
    }

    const unsubscribe = subscribeToChurch(churchId, (church) => {
      if (church) {
        const receiptState = getTaxReceiptIssuanceState(church.taxReceiptSettings);
        setShowSaintDays(church.showSaintDays);
        setChurchTimezone(church.timezone || 'UTC');
        setTaxReceiptIssuanceState(church.isActive === true ? receiptState : 'disabled');
        setTaxReceiptIssuanceReady(church.isActive === true && receiptState === 'ready');
      } else {
        setChurchTimezone('UTC');
        setTaxReceiptIssuanceState('disabled');
        setTaxReceiptIssuanceReady(false);
      }
    });
    return unsubscribe;
  }, [churchId, activeTab]);

  useEffect(() => {
    if (!needsReceipts) {
      setReceiptRecords([]);
      setAnnualReceiptSummaries([]);
      setStripeConnectSetupStatus(null);
      setStripeConnectSetupStatusLoading(false);
      setReceiptRecordsLoading(false);
      setReceiptRecordsError('');
      return undefined;
    }

    setReceiptRecordsLoading(true);
    setReceiptRecordsError('');
    return subscribeToChurchGivingForReceipts(
      churchId,
      (records) => {
        setReceiptRecords(records);
        setReceiptRecordsLoading(false);
      },
      (error) => {
        console.error('Failed to load receipt records:', error);
        setReceiptRecords([]);
        setReceiptRecordsLoading(false);
        setReceiptRecordsError(copy.receipts.loadError);
      }
    );
  }, [churchId, copy.receipts.loadError, needsReceipts]);

  useEffect(() => {
    if (!needsReceipts) {
      return undefined;
    }

    let cancelled = false;
    setStripeConnectSetupStatusLoading(true);
    void fetchChurchStripeConnectSetupStatus(churchId)
      .then((status) => {
        if (!cancelled) {
          setStripeConnectSetupStatus(status);
        }
      })
      .catch((error) => {
        console.error('Failed to load Stripe Connect setup status:', error);
        if (!cancelled) {
          setStripeConnectSetupStatus(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setStripeConnectSetupStatusLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [churchId, needsReceipts]);

  useEffect(() => {
    if (!needsReceipts) {
      setAnnualReceiptSummaries([]);
      return undefined;
    }

    return subscribeToChurchAnnualTaxReceiptSummaries(
      churchId,
      setAnnualReceiptSummaries,
      (error) => {
        console.error('Failed to load annual receipt summaries:', error);
        setAnnualReceiptSummaries([]);
        setReceiptRecordsError(copy.receipts.loadError);
      }
    );
  }, [churchId, copy.receipts.loadError, needsReceipts]);

  const { members, events, newsletters, membersLoading, eventsLoading, newslettersLoading } = useChurchData(churchId, {
    members: needsMembers,
    events: needsEvents,
    newsletters: needsNewsletters,
  });

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
    role: 'member' | 'admin' | 'treasurer';
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
    if (!isAdminOrPriest) {
      return;
    }

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
    if (!isAdminOrPriest) {
      return;
    }

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
    targetRoles: Array<'member' | 'admin' | 'treasurer' | 'priest'>;
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

  const handleSendTaxReceipt = async (givingId: string): Promise<void> => {
    if (!canManageReceipts) {
      return;
    }

    setSendingReceiptId(givingId);
    setReceiptRecordsError('');
    setReceiptNotice('');
    try {
      await sendTaxReceipt({ givingId });
      setReceiptNotice(copy.receipts.sentNotice);
    } catch (error) {
      console.error('Failed to send tax receipt:', error);
      setReceiptRecordsError(callableReceiptDeliveryErrorMessage(error, receiptDeliveryErrorMessages));
    } finally {
      setSendingReceiptId(null);
    }
  };

  const handleSendCorrectedTaxReceipt = async (givingId: string): Promise<void> => {
    if (!canManageReceipts) {
      return;
    }

    setSendingReceiptId(givingId);
    setReceiptRecordsError('');
    setReceiptNotice('');
    try {
      await sendCorrectedTaxReceipt({ givingId });
      setReceiptNotice(copy.receipts.correctedSentNotice);
    } catch (error) {
      console.error('Failed to send corrected tax receipt:', error);
      setReceiptRecordsError(callableReceiptDeliveryErrorMessage(error, receiptDeliveryErrorMessages));
    } finally {
      setSendingReceiptId(null);
    }
  };

  const handleSendAnnualTaxReceipt = async (
    userId: string,
    year: number,
    acknowledgePreviouslyReceipted = false
  ): Promise<void> => {
    if (!canManageReceipts) {
      return;
    }

    const annualKey = `${userId}:${year}`;
    setSendingAnnualReceiptKey(annualKey);
    setReceiptRecordsError('');
    setReceiptNotice('');
    try {
      await sendAnnualTaxReceipt({ churchId, userId, year, acknowledgePreviouslyReceipted });
      setReceiptNotice(copy.receipts.annualSentNotice);
    } catch (error) {
      console.error('Failed to send annual tax receipt:', error);
      setReceiptRecordsError(callableReceiptDeliveryErrorMessage(error, receiptDeliveryErrorMessages));
    } finally {
      setSendingAnnualReceiptKey(null);
    }
  };

  const handleSendCorrectedAnnualTaxReceipt = async (
    userId: string,
    year: number,
    acknowledgePreviouslyReceipted = false
  ): Promise<void> => {
    if (!canManageReceipts) {
      return;
    }

    const annualKey = `${userId}:${year}`;
    setSendingAnnualReceiptKey(annualKey);
    setReceiptRecordsError('');
    setReceiptNotice('');
    try {
      await sendCorrectedAnnualTaxReceipt({ churchId, userId, year, acknowledgePreviouslyReceipted });
      setReceiptNotice(copy.receipts.correctedAnnualSentNotice);
    } catch (error) {
      console.error('Failed to send corrected annual tax receipt:', error);
      setReceiptRecordsError(callableReceiptDeliveryErrorMessage(error, receiptDeliveryErrorMessages));
    } finally {
      setSendingAnnualReceiptKey(null);
    }
  };

  const handleSendChurchAnnualTaxReceipts = async (
    year: number,
    acknowledgePreviouslyReceipted = false
  ): Promise<void> => {
    if (!canManageReceipts) {
      return;
    }
    if (!taxReceiptIssuanceReady) {
      setReceiptRecordsError(receiptSetupRequiredMessage);
      return;
    }

    setSendingBulkAnnualReceiptYear(year);
    setReceiptRecordsError('');
    setReceiptNotice('');
    try {
      const result = await sendChurchAnnualTaxReceipts({
        churchId,
        year,
        acknowledgePreviouslyReceipted,
      });
      const failureReason = receiptBatchFailureReason(result.failures, receiptDeliveryErrorMessages);
      if (result.emailSentCount === 0 && result.skippedCount > 0 && result.failedCount === 0 && !result.truncated) {
        setReceiptNotice(copy.receipts.bulkAlreadySent);
      } else if (result.emailSentCount === 0 && result.failedCount > 0) {
        setReceiptRecordsError(failureReason || copy.receipts.bulkNoReceipts);
      } else if (result.emailSentCount === 0) {
        setReceiptRecordsError(copy.receipts.bulkNoReceipts);
      } else if (result.failedCount > 0 || result.truncated) {
        const notice = copy.receipts.bulkPartialNotice(
          result.emailSentCount,
          result.failedCount,
          result.truncated
        );
        setReceiptNotice(failureReason ? `${notice} ${failureReason}` : notice);
      } else {
        setReceiptNotice(copy.receipts.bulkSentNotice(result.emailSentCount));
      }
    } catch (error) {
      console.error('Failed to send annual tax receipt batch:', error);
      setReceiptRecordsError(callableReceiptDeliveryErrorMessage(error, receiptDeliveryErrorMessages));
    } finally {
      setSendingBulkAnnualReceiptYear(null);
    }
  };

  const handleSendChurchCorrectedAnnualTaxReceipts = async (
    year: number,
    acknowledgePreviouslyReceipted = false
  ): Promise<void> => {
    if (!canManageReceipts) {
      return;
    }
    if (!taxReceiptIssuanceReady) {
      setReceiptRecordsError(receiptSetupRequiredMessage);
      return;
    }

    setSendingBulkCorrectedAnnualReceiptYear(year);
    setReceiptRecordsError('');
    setReceiptNotice('');
    try {
      const result = await sendChurchCorrectedAnnualTaxReceipts({
        churchId,
        year,
        acknowledgePreviouslyReceipted,
      });
      const failureReason = receiptBatchFailureReason(result.failures, receiptDeliveryErrorMessages);
      if (result.emailSentCount === 0 && result.skippedCount > 0 && result.failedCount === 0 && !result.truncated) {
        setReceiptNotice(copy.receipts.bulkCorrectedAlreadySent);
      } else if (result.emailSentCount === 0 && result.failedCount > 0) {
        setReceiptRecordsError(failureReason || copy.receipts.bulkNoCorrectedReceipts);
      } else if (result.emailSentCount === 0) {
        setReceiptRecordsError(copy.receipts.bulkNoCorrectedReceipts);
      } else if (result.failedCount > 0 || result.truncated) {
        const notice = copy.receipts.bulkCorrectedPartialNotice(
          result.emailSentCount,
          result.failedCount,
          result.truncated
        );
        setReceiptNotice(failureReason ? `${notice} ${failureReason}` : notice);
      } else {
        setReceiptNotice(copy.receipts.bulkCorrectedSentNotice(result.emailSentCount));
      }
    } catch (error) {
      console.error('Failed to send corrected annual tax receipt batch:', error);
      setReceiptRecordsError(callableReceiptDeliveryErrorMessage(error, receiptDeliveryErrorMessages));
    } finally {
      setSendingBulkCorrectedAnnualReceiptYear(null);
    }
  };

  const handleOpenStripeConnectOnboarding = async (): Promise<void> => {
    if (!canManageReceipts) {
      return;
    }
    if (stripeConnectSetupStatus?.stripeConnectAccountConfigured !== true) {
      setReceiptNotice('');
      setReceiptRecordsError(
        stripeConnectSetupStatus?.stripeConnectAccountConfigured === false
          ? copy.receipts.stripeSetupMissing
          : copy.receipts.stripeSetupUnknown
      );
      return;
    }

    setStripeOnboardingLoading(true);
    setReceiptRecordsError('');
    setReceiptNotice('');
    try {
      const returnState = createStripeConnectReturnState();
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(
          PENDING_STRIPE_CONNECT_STORAGE_KEY,
          JSON.stringify(createPendingStripeConnectOnboardingState(churchId, returnState))
        );
      }
      const result = await createChurchStripeConnectOnboardingLink(churchId, returnState);
      await openExternalUrl(result.url);
      setStripeConnectSetupStatus((current) => (
        current
          ? { ...current, stripeConnectAccountConfigured: true }
          : current
      ));
      setReceiptNotice(copy.receipts.stripeOnboardingOpened);
    } catch (error) {
      console.error('Failed to open Stripe Connect onboarding:', error);
      setReceiptRecordsError(copy.receipts.stripeOnboardingError);
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(PENDING_STRIPE_CONNECT_STORAGE_KEY);
      }
    } finally {
      setStripeOnboardingLoading(false);
    }
  };

  const openEventEditor = (event: FirestoreEvent | null) => {
    if (!isAdminOrPriest) {
      return;
    }

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
    if (!isAdminOrPriest) {
      return;
    }

    setInviteError('');
    setInviteNotice('');
    setActiveMemberMenu(null);
    setInviteSheetOpen(true);
  };

  const handleSetEditingPost = (post: ChurchPost | null | undefined) => {
    if (!isAdminOrPriest && post !== undefined) {
      return;
    }

    setEditingPost(post);
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
    receiptRecords,
    annualReceiptSummaries,
    receiptRecordsLoading,
    receiptRecordsError,
    receiptNotice,
    sendingReceiptId,
    sendingAnnualReceiptKey,
    sendingBulkAnnualReceiptYear,
    sendingBulkCorrectedAnnualReceiptYear,
    stripeOnboardingLoading,
    stripeConnectSetupStatus,
    stripeConnectSetupStatusLoading,
    showSaintDays,
    churchTimezone,
    taxReceiptIssuanceState,
    taxReceiptIssuanceReady,
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
    canManageReceipts,
    activeMemberCount,
    upcomingEventCount,
    sentNewsletterCount,
    setActiveTab,
    setSearchQuery,
    setActiveMemberMenu,
    setEditingPost: handleSetEditingPost,
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
    handleSendTaxReceipt,
    handleSendCorrectedTaxReceipt,
    handleSendAnnualTaxReceipt,
    handleSendCorrectedAnnualTaxReceipt,
    handleSendChurchAnnualTaxReceipts,
    handleSendChurchCorrectedAnnualTaxReceipts,
    handleOpenStripeConnectOnboarding,
    handleToggleShowSaintDays,
  };
}
