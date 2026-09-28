import type { Timestamp } from 'firebase/firestore';
import type { ChurchMembership } from '../../types';

export type EventPortalStatus = 'draft' | 'published' | 'archived';
export type EventModule = 'tickets' | 'schedule' | 'foodDrink' | 'campaigns' | 'info';
export type EventAnnouncementPriority = 'info' | 'urgent' | 'offer';
export type EventAnnouncementChannel = 'inApp' | 'push' | 'email';
export type EventTicketStatus = 'paid' | 'checked_in' | 'cancelled' | 'refunded' | 'expired';
export type EventTicketScanResult =
  | 'accepted'
  | 'reentry_accepted'
  | 'requires_reentry_confirmation'
  | 'invalid'
  | 'wrong_event'
  | 'cancelled'
  | 'refunded'
  | 'expired';
export type EventOrderStatus =
  | 'submitted'
  | 'payment_pending'
  | 'paid'
  | 'accepted'
  | 'in_prep'
  | 'ready'
  | 'picked_up'
  | 'cancelled'
  | 'refunded';

export interface EventPortal {
  id: string;
  organizationId: string;
  organizationType: 'church';
  churchId: string;
  title: string;
  slug: string;
  status: EventPortalStatus;
  startsAt: Date;
  endsAt: Date;
  venueName: string;
  venueAddress: string;
  heroImageURL: string;
  description: string;
  modules: EventModule[];
  focusEnabled: boolean;
  focusStartsAt: Date | null;
  focusEndsAt: Date | null;
  ticketsEnabled: boolean;
  gateScanningEnabled: boolean;
  reEntryEnabled: boolean;
  foodDrinkEnabled: boolean;
  foodOrderingEnabled: boolean;
  campaignsEnabled: boolean;
  setupChecklist: EventSetupChecklist;
}

export interface EventSetupChecklist {
  basics: boolean;
  tickets: boolean;
  schedule: boolean;
  foodDrink: boolean;
  campaigns: boolean;
  staff: boolean;
  payments: boolean;
}

export interface EventTicketTier {
  id: string;
  eventId: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  capacity: number | null;
  perOrderLimit: number;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
  active: boolean;
}

export interface EventPerformer {
  id: string;
  eventId: string;
  name: string;
  subtitle: string;
  description: string;
  imageURL: string;
  links: string[];
  published: boolean;
}

export interface EventScheduleItem {
  id: string;
  eventId: string;
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  stage: string;
  location: string;
  performerIds: string[];
  imageURL: string;
  published: boolean;
}

export interface EventMenuItem {
  id: string;
  eventId: string;
  category: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  available: boolean;
  soldOut: boolean;
  maxPerOrder: number;
  inventoryMode: 'unlimited' | 'tracked';
  quantityAvailable: number | null;
  quantitySold: number;
  sortOrder: number;
}

export interface EventFoodOrderItem {
  menuItemId: string;
  category: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  inventoryMode?: 'unlimited' | 'tracked';
}

export type EventFoodOrderPaymentStatus = 'pay_at_pickup' | 'paid_at_pickup' | 'not_required';

export interface EventFoodOrder {
  id: string;
  eventId: string;
  churchId: string;
  orderCode: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  specialInstructions: string;
  items: EventFoodOrderItem[];
  itemCount: number;
  subtotalCents: number;
  totalCents: number;
  currency: string;
  status: EventOrderStatus;
  paymentStatus: EventFoodOrderPaymentStatus;
  paymentMethod: 'pay_at_pickup';
  createdAt: Date | null;
  updatedAt: Date | null;
  acceptedAt: Date | null;
  readyAt: Date | null;
  pickedUpAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string;
}

export interface EventCampaign {
  id: string;
  eventId: string;
  title: string;
  description: string;
  suggestedAmountCents: number;
  active: boolean;
}

export type EventDashboardSalesItemType = 'ticket' | 'food';

export interface EventDashboardSalesItem {
  id: string;
  type: EventDashboardSalesItemType;
  label: string;
  quantity: number;
  revenueCents: number;
  currency: string;
}

export interface EventDashboardOrderStatusCount {
  status: EventOrderStatus;
  count: number;
}

export interface EventDashboardMetrics {
  eventId: string;
  currency: string;
  entrySalesCents: number;
  foodSalesCents: number;
  pendingFoodSalesCents: number;
  totalSalesCents: number;
  donationCents: number;
  ticketsSold: number;
  qrCheckIns: number;
  scanAttempts: number;
  foodOrders: number;
  pendingFoodOrders: number;
  foodItemsSold: number;
  donationCount: number;
  salesBreakdown: EventDashboardSalesItem[];
  orderStatusCounts: EventDashboardOrderStatusCount[];
  generatedAt: string;
  truncated: boolean;
  multiCurrency: boolean;
}

export interface EventAnnouncement {
  id: string;
  eventId: string;
  churchId: string;
  title: string;
  body: string;
  priority: EventAnnouncementPriority;
  channels: EventAnnouncementChannel[];
  sentBy: string;
  sentByName: string;
  sentAt: Date | null;
  status: 'sent' | 'draft';
}

export interface EventTicketValidationInput {
  eventId: string;
  code: string;
}

export interface EventTicketPublicState {
  eventId: string;
  ticketId: string;
  status: EventTicketStatus;
  scanCount: number;
  reEntryEnabled: boolean;
  lastScanAt: Date | null;
}

export interface EventTicketValidationResult {
  result: EventTicketScanResult;
  requiresStaffConfirmation: boolean;
  reason: string;
}

export const EMPTY_EVENT_SETUP_CHECKLIST: EventSetupChecklist = {
  basics: false,
  tickets: false,
  schedule: false,
  foodDrink: false,
  campaigns: false,
  staff: false,
  payments: false,
};

export function isEventFocusActive(portal: EventPortal, now: Date = new Date()): boolean {
  if (portal.status !== 'published' || !portal.focusEnabled) {
    return false;
  }
  const focusStart = portal.focusStartsAt ?? portal.startsAt;
  const focusEnd = portal.focusEndsAt ?? portal.endsAt;
  return focusStart.getTime() <= now.getTime() && focusEnd.getTime() >= now.getTime();
}

export function featuredEventsForMemberships(
  portals: EventPortal[],
  memberships: ChurchMembership[],
  now: Date = new Date()
): EventPortal[] {
  const activeChurchIds = new Set(
    memberships
      .filter((membership) => membership.status === 'active')
      .map((membership) => membership.churchId)
  );
  return portals
    .filter((portal) => portal.churchId && activeChurchIds.has(portal.churchId))
    .filter((portal) => isEventFocusActive(portal, now))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export function eventSetupReadyForPublish(checklist: EventSetupChecklist, portal: EventPortal): boolean {
  if (!checklist.basics) {
    return false;
  }
  if (
    !portal.title.trim()
    || !portal.slug.trim()
    || !portal.description.trim()
    || !portal.venueName.trim()
    || !portal.venueAddress.trim()
    || !Number.isFinite(portal.startsAt.getTime())
    || !Number.isFinite(portal.endsAt.getTime())
    || portal.endsAt <= portal.startsAt
  ) {
    return false;
  }
  if (portal.ticketsEnabled && !checklist.tickets) {
    return false;
  }
  if (portal.gateScanningEnabled && !checklist.staff) {
    return false;
  }
  if (portal.foodDrinkEnabled && !checklist.foodDrink) {
    return false;
  }
  if (portal.foodOrderingEnabled && (!portal.foodDrinkEnabled || !checklist.staff)) {
    return false;
  }
  if (portal.campaignsEnabled && !checklist.campaigns) {
    return false;
  }
  return true;
}

export function validateEventTicketScan(
  input: EventTicketValidationInput,
  ticket: EventTicketPublicState | null
): EventTicketValidationResult {
  const normalizedCode = input.code.trim();
  if (!normalizedCode || normalizedCode.length < 6 || normalizedCode.length > 256) {
    return { result: 'invalid', requiresStaffConfirmation: false, reason: 'Code is not valid.' };
  }
  if (!ticket) {
    return { result: 'invalid', requiresStaffConfirmation: false, reason: 'Ticket was not found.' };
  }
  if (ticket.eventId !== input.eventId) {
    return { result: 'wrong_event', requiresStaffConfirmation: false, reason: 'Ticket belongs to another event.' };
  }
  if (ticket.status === 'cancelled') {
    return { result: 'cancelled', requiresStaffConfirmation: false, reason: 'Ticket is cancelled.' };
  }
  if (ticket.status === 'refunded') {
    return { result: 'refunded', requiresStaffConfirmation: false, reason: 'Ticket is refunded.' };
  }
  if (ticket.status === 'expired') {
    return { result: 'expired', requiresStaffConfirmation: false, reason: 'Ticket is expired.' };
  }
  if (ticket.status !== 'paid' && ticket.status !== 'checked_in') {
    return { result: 'invalid', requiresStaffConfirmation: false, reason: 'Ticket is not ready for admission.' };
  }
  if (ticket.scanCount > 0 && !ticket.reEntryEnabled) {
    return {
      result: 'requires_reentry_confirmation',
      requiresStaffConfirmation: true,
      reason: 'Ticket has already been scanned.',
    };
  }
  if (ticket.scanCount > 0) {
    return {
      result: 'reentry_accepted',
      requiresStaffConfirmation: true,
      reason: 'Re-entry is allowed; confirm the prior scan history before admitting.',
    };
  }
  return { result: 'accepted', requiresStaffConfirmation: false, reason: 'Ticket is valid.' };
}

export function dateFromFirestore(value: unknown): Date | null {
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as Timestamp).toDate();
  }
  return null;
}
