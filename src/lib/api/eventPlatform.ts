import type {
  EventAnnouncementChannel,
  EventAnnouncementPriority,
  EventDashboardMetrics,
  EventOrderStatus,
  EventPortalStatus,
  EventSetupChecklist,
} from '../eventPlatform/model';
import { callFunction } from './client';

export interface SaveEventPortalSetupInput {
  eventId?: string;
  churchId: string;
  title: string;
  slug: string;
  description: string;
  venueName: string;
  venueAddress: string;
  heroImageURL: string;
  startsAt: string;
  endsAt: string;
  status: EventPortalStatus;
  focusEnabled: boolean;
  focusStartsAt: string | null;
  focusEndsAt: string | null;
  ticketsEnabled: boolean;
  gateScanningEnabled: boolean;
  reEntryEnabled: boolean;
  foodDrinkEnabled: boolean;
  foodOrderingEnabled: boolean;
  campaignsEnabled: boolean;
  setupChecklist: EventSetupChecklist;
}

export interface UpsertEventMenuItemInput {
  eventId: string;
  menuItemId?: string;
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
  sortOrder: number;
}

export interface SubmitEventFoodOrderInput {
  requestId: string;
  eventId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  specialInstructions: string;
  items: Array<{
    menuItemId: string;
    quantity: number;
  }>;
}

export async function saveEventPortalSetup(input: SaveEventPortalSetupInput): Promise<{
  success: boolean;
  eventId: string;
  slug: string;
  status: EventPortalStatus;
}> {
  return callFunction<SaveEventPortalSetupInput, {
    success: boolean;
    eventId: string;
    slug: string;
    status: EventPortalStatus;
  }>('saveEventPortalSetup', input);
}

export async function sendEventAnnouncement(input: {
  eventId: string;
  title: string;
  body: string;
  priority: EventAnnouncementPriority;
  channels: EventAnnouncementChannel[];
}): Promise<{
  success: boolean;
  announcementId: string;
  pushSent: boolean;
  emailSent: boolean;
  emailRecipientCount: number;
}> {
  return callFunction<typeof input, {
    success: boolean;
    announcementId: string;
    pushSent: boolean;
    emailSent: boolean;
    emailRecipientCount: number;
  }>('sendEventAnnouncement', input);
}

export async function upsertEventMenuItem(input: UpsertEventMenuItemInput): Promise<{
  success: boolean;
  menuItemId: string;
}> {
  return callFunction<UpsertEventMenuItemInput, { success: boolean; menuItemId: string }>('upsertEventMenuItem', input);
}

export async function deleteEventMenuItem(input: { eventId: string; menuItemId: string }): Promise<{ success: boolean }> {
  return callFunction<typeof input, { success: boolean }>('deleteEventMenuItem', input);
}

export async function submitEventFoodOrder(input: SubmitEventFoodOrderInput): Promise<{
  success: boolean;
  orderId: string;
  orderCode: string;
  totalCents: number;
  currency: string;
  status: EventOrderStatus;
  paymentStatus: string;
}> {
  return callFunction<SubmitEventFoodOrderInput, {
    success: boolean;
    orderId: string;
    orderCode: string;
    totalCents: number;
    currency: string;
    status: EventOrderStatus;
    paymentStatus: string;
  }>('submitEventFoodOrder', input);
}

export async function updateEventFoodOrderStatus(input: {
  eventId: string;
  orderId: string;
  status: EventOrderStatus;
  paymentCollected?: boolean;
  cancellationReason?: string;
}): Promise<{ success: boolean }> {
  return callFunction<typeof input, { success: boolean }>('updateEventFoodOrderStatus', input);
}

export async function getEventDashboardMetrics(input: {
  eventId: string;
}): Promise<EventDashboardMetrics> {
  return callFunction<typeof input, EventDashboardMetrics>('getEventDashboardMetrics', input);
}

export async function scanEventTicket(input: {
  eventId: string;
  code: string;
  deviceId?: string;
  confirmReEntry?: boolean;
}): Promise<{
  success: boolean;
  scanId: string;
  result: string;
  admitted: boolean;
  requiresStaffConfirmation: boolean;
  reason: string;
  ticketId: string;
  scanCount: number;
}> {
  return callFunction<typeof input, {
    success: boolean;
    scanId: string;
    result: string;
    admitted: boolean;
    requiresStaffConfirmation: boolean;
    reason: string;
    ticketId: string;
    scanCount: number;
  }>('scanEventTicket', input);
}

export interface CustomerFoodOrder {
  orderCode: string;
  totalCents: number;
  currency: string;
  status: EventOrderStatus;
  paymentStatus: string;
}

export function getEventFoodOrder(eventId: string, requestId: string): Promise<{ order: CustomerFoodOrder | null }> {
  return callFunction('getEventFoodOrder', { eventId, requestId });
}
