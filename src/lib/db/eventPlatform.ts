import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase/firestore';
import { callFunction } from '../api/client';
import {
  EMPTY_EVENT_SETUP_CHECKLIST,
  dateFromFirestore,
  isEventFocusActive,
  type EventCampaign,
  type EventAnnouncement,
  type EventAnnouncementChannel,
  type EventFoodOrder,
  type EventFoodOrderItem,
  type EventFoodOrderPaymentStatus,
  type EventMenuItem,
  type EventPerformer,
  type EventPortal,
  type EventScheduleItem,
  type EventSetupChecklist,
  type EventTicketTier,
} from '../eventPlatform/model';

const FEATURED_EVENT_CHURCH_QUERY_LIMIT = 10;

function stringField(data: Record<string, unknown>, field: string, fallback = ''): string {
  return typeof data[field] === 'string' ? data[field] : fallback;
}

function boolField(data: Record<string, unknown>, field: string, fallback = false): boolean {
  return typeof data[field] === 'boolean' ? data[field] : fallback;
}

function numberField(data: Record<string, unknown>, field: string, fallback = 0): number {
  return typeof data[field] === 'number' && Number.isFinite(data[field]) ? data[field] : fallback;
}

function stringArrayField(data: Record<string, unknown>, field: string): string[] {
  return Array.isArray(data[field])
    ? (data[field] as unknown[]).filter((value): value is string => typeof value === 'string')
    : [];
}

function setupChecklistField(data: Record<string, unknown>): EventSetupChecklist {
  const checklist = data.setupChecklist;
  if (!checklist || typeof checklist !== 'object' || Array.isArray(checklist)) {
    return EMPTY_EVENT_SETUP_CHECKLIST;
  }
  const record = checklist as Record<string, unknown>;
  return {
    basics: record.basics === true,
    tickets: record.tickets === true,
    schedule: record.schedule === true,
    foodDrink: record.foodDrink === true,
    campaigns: record.campaigns === true,
    staff: record.staff === true,
    payments: record.payments === true,
  };
}

export function mapEventPortal(snapshot: { id: string; data: () => Record<string, unknown> }): EventPortal {
  const data = snapshot.data();
  const startsAt = dateFromFirestore(data.startsAt) ?? new Date();
  const endsAt = dateFromFirestore(data.endsAt) ?? startsAt;
  const modules = stringArrayField(data, 'modules').filter((module): module is EventPortal['modules'][number] => (
    module === 'tickets'
    || module === 'schedule'
    || module === 'foodDrink'
    || module === 'campaigns'
    || module === 'info'
  ));
  const status = stringField(data, 'status', 'draft');
  return {
    id: snapshot.id,
    organizationId: stringField(data, 'organizationId', stringField(data, 'churchId')),
    organizationType: 'church',
    churchId: stringField(data, 'churchId'),
    title: stringField(data, 'title', 'Untitled Event'),
    slug: stringField(data, 'slug'),
    status: status === 'published' || status === 'archived' ? status : 'draft',
    startsAt,
    endsAt,
    venueName: stringField(data, 'venueName'),
    venueAddress: stringField(data, 'venueAddress'),
    heroImageURL: stringField(data, 'heroImageURL'),
    description: stringField(data, 'description'),
    modules,
    focusEnabled: boolField(data, 'focusEnabled'),
    focusStartsAt: dateFromFirestore(data.focusStartsAt),
    focusEndsAt: dateFromFirestore(data.focusEndsAt),
    ticketsEnabled: boolField(data, 'ticketsEnabled'),
    gateScanningEnabled: boolField(data, 'gateScanningEnabled'),
    reEntryEnabled: boolField(data, 'reEntryEnabled', true),
    foodDrinkEnabled: boolField(data, 'foodDrinkEnabled'),
    foodOrderingEnabled: boolField(data, 'foodOrderingEnabled'),
    campaignsEnabled: boolField(data, 'campaignsEnabled'),
    setupChecklist: setupChecklistField(data),
  };
}

export function mapEventTicketTier(snapshot: { id: string; data: () => Record<string, unknown> }): EventTicketTier {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    eventId: stringField(data, 'eventId'),
    name: stringField(data, 'name', 'Admission'),
    description: stringField(data, 'description'),
    priceCents: numberField(data, 'priceCents'),
    currency: stringField(data, 'currency', 'CAD'),
    capacity: typeof data.capacity === 'number' ? data.capacity : null,
    perOrderLimit: numberField(data, 'perOrderLimit', 8),
    saleStartsAt: dateFromFirestore(data.saleStartsAt),
    saleEndsAt: dateFromFirestore(data.saleEndsAt),
    active: boolField(data, 'active', true),
  };
}

export function mapEventPerformer(snapshot: { id: string; data: () => Record<string, unknown> }): EventPerformer {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    eventId: stringField(data, 'eventId'),
    name: stringField(data, 'name'),
    subtitle: stringField(data, 'subtitle'),
    description: stringField(data, 'description'),
    imageURL: stringField(data, 'imageURL'),
    links: stringArrayField(data, 'links'),
    published: boolField(data, 'published', true),
  };
}

export function mapEventScheduleItem(snapshot: { id: string; data: () => Record<string, unknown> }): EventScheduleItem {
  const data = snapshot.data();
  const startTime = dateFromFirestore(data.startTime) ?? new Date();
  const endTime = dateFromFirestore(data.endTime) ?? startTime;
  return {
    id: snapshot.id,
    eventId: stringField(data, 'eventId'),
    title: stringField(data, 'title'),
    description: stringField(data, 'description'),
    startTime,
    endTime,
    stage: stringField(data, 'stage'),
    location: stringField(data, 'location'),
    performerIds: stringArrayField(data, 'performerIds'),
    imageURL: stringField(data, 'imageURL'),
    published: boolField(data, 'published', true),
  };
}

export function mapEventMenuItem(snapshot: { id: string; data: () => Record<string, unknown> }): EventMenuItem {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    eventId: stringField(data, 'eventId'),
    category: stringField(data, 'category', 'Menu'),
    name: stringField(data, 'name'),
    description: stringField(data, 'description'),
    priceCents: numberField(data, 'priceCents'),
    currency: stringField(data, 'currency', 'CAD'),
    available: boolField(data, 'available', true),
    soldOut: boolField(data, 'soldOut'),
    maxPerOrder: numberField(data, 'maxPerOrder', 10),
    inventoryMode: data.inventoryMode === 'tracked' ? 'tracked' : 'unlimited',
    quantityAvailable: typeof data.quantityAvailable === 'number' && Number.isInteger(data.quantityAvailable)
      ? data.quantityAvailable
      : null,
    quantitySold: numberField(data, 'quantitySold'),
    sortOrder: numberField(data, 'sortOrder'),
  };
}

function orderItemsField(data: Record<string, unknown>): EventFoodOrderItem[] {
  const items = Array.isArray(data.items) ? data.items : [];
  return items
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))
    .map((item) => ({
      menuItemId: stringField(item, 'menuItemId'),
      category: stringField(item, 'category', 'Menu'),
      name: stringField(item, 'name'),
      quantity: numberField(item, 'quantity'),
      unitPriceCents: numberField(item, 'unitPriceCents'),
      lineTotalCents: numberField(item, 'lineTotalCents'),
      inventoryMode: item.inventoryMode === 'tracked' ? 'tracked' : 'unlimited',
    }));
}

export function mapEventFoodOrder(snapshot: { id: string; data: () => Record<string, unknown> }): EventFoodOrder {
  const data = snapshot.data();
  const status = stringField(data, 'status', 'submitted');
  const paymentStatus = stringField(data, 'paymentStatus', 'pay_at_pickup');
  return {
    id: snapshot.id,
    eventId: stringField(data, 'eventId'),
    churchId: stringField(data, 'churchId'),
    orderCode: stringField(data, 'orderCode', snapshot.id.slice(-6).toUpperCase()),
    customerName: stringField(data, 'customerName'),
    customerEmail: stringField(data, 'customerEmail'),
    customerPhone: stringField(data, 'customerPhone'),
    specialInstructions: stringField(data, 'specialInstructions'),
    items: orderItemsField(data),
    itemCount: numberField(data, 'itemCount'),
    subtotalCents: numberField(data, 'subtotalCents'),
    totalCents: numberField(data, 'totalCents'),
    currency: stringField(data, 'currency', 'CAD'),
    status: (
      status === 'submitted'
      || status === 'payment_pending'
      || status === 'paid'
      || status === 'accepted'
      || status === 'in_prep'
      || status === 'ready'
      || status === 'picked_up'
      || status === 'cancelled'
      || status === 'refunded'
    ) ? status : 'submitted',
    paymentStatus: (
      paymentStatus === 'paid_at_pickup'
      || paymentStatus === 'not_required'
    ) ? paymentStatus as EventFoodOrderPaymentStatus : 'pay_at_pickup',
    paymentMethod: 'pay_at_pickup',
    createdAt: dateFromFirestore(data.createdAt),
    updatedAt: dateFromFirestore(data.updatedAt),
    acceptedAt: dateFromFirestore(data.acceptedAt),
    readyAt: dateFromFirestore(data.readyAt),
    pickedUpAt: dateFromFirestore(data.pickedUpAt),
    cancelledAt: dateFromFirestore(data.cancelledAt),
    cancellationReason: stringField(data, 'cancellationReason'),
  };
}

export function mapEventCampaign(snapshot: { id: string; data: () => Record<string, unknown> }): EventCampaign {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    eventId: stringField(data, 'eventId'),
    title: stringField(data, 'title'),
    description: stringField(data, 'description'),
    suggestedAmountCents: numberField(data, 'suggestedAmountCents', 2500),
    active: boolField(data, 'active', true),
  };
}

export function mapEventAnnouncement(snapshot: { id: string; data: () => Record<string, unknown> }): EventAnnouncement {
  const data = snapshot.data();
  const priority = stringField(data, 'priority', 'info');
  const channels = stringArrayField(data, 'channels').filter((channel): channel is EventAnnouncementChannel => (
    channel === 'inApp' || channel === 'push' || channel === 'email'
  ));
  return {
    id: snapshot.id,
    eventId: stringField(data, 'eventId'),
    churchId: stringField(data, 'churchId'),
    title: stringField(data, 'title'),
    body: stringField(data, 'body'),
    priority: priority === 'urgent' || priority === 'offer' ? priority : 'info',
    channels: channels.length > 0 ? channels : ['inApp'],
    sentBy: stringField(data, 'sentBy'),
    sentByName: stringField(data, 'sentByName'),
    sentAt: dateFromFirestore(data.sentAt),
    status: data.status === 'draft' ? 'draft' : 'sent',
  };
}

export function subscribeToPublicEventPortalBySlug(
  slug: string,
  callback: (portal: EventPortal | null) => void,
  onError?: (error: Error) => void
): () => void {
  return onSnapshot(doc(db, 'eventPortals', slug), (snap) => {
    if (!snap.exists()) {
      callback(null);
      return;
    }

    const portal = mapEventPortal({
      id: snap.id,
      data: () => snap.data() as Record<string, unknown>,
    });
    callback(portal.status === 'published' && portal.slug === slug ? portal : null);
  }, onError);
}

export function subscribeToChurchEventPortals(
  churchId: string,
  callback: (portals: EventPortal[]) => void,
  onError?: (error: Error) => void
): () => void {
  const q = query(collection(db, 'eventPortals'), where('churchId', '==', churchId), orderBy('startsAt', 'desc'), limit(25));
  return onSnapshot(q, (snap) => callback(snap.docs.map(mapEventPortal)), onError);
}

export function subscribeToFeaturedEventPortalsForChurches(
  churchIds: string[],
  callback: (portals: EventPortal[]) => void,
  onError?: (error: Error) => void
): () => void {
  const uniqueChurchIds = Array.from(new Set(churchIds.filter(Boolean)));
  if (uniqueChurchIds.length === 0) {
    callback([]);
    return () => undefined;
  }
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const refresh = async () => {
    try {
      const results: EventPortal[] = [];
      for (let i = 0; i < uniqueChurchIds.length; i += FEATURED_EVENT_CHURCH_QUERY_LIMIT) {
        const response = await callFunction<{ churchIds: string[] }, { portals: Array<Record<string, unknown> & { id: string }> }>(
          'getFeaturedEventPortals', { churchIds: uniqueChurchIds.slice(i, i + FEATURED_EVENT_CHURCH_QUERY_LIMIT) }
        );
        results.push(...response.portals.map((data) => mapEventPortal({ id: data.id, data: () => data })));
      }
      if (!stopped) callback(results.filter((portal) => isEventFocusActive(portal))
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()));
    } catch (error) {
      if (!stopped) onError?.(error instanceof Error ? error : new Error('Unable to load featured events.'));
    } finally {
      if (!stopped) timer = setTimeout(refresh, 60_000);
    }
  };
  void refresh();
  return () => { stopped = true; clearTimeout(timer); };
}

export function subscribeToEventTicketTiers(eventId: string, callback: (tiers: EventTicketTier[]) => void): () => void {
  const q = query(collection(db, 'eventTicketTiers'), where('eventId', '==', eventId), where('active', '==', true));
  return onSnapshot(q, (snap) => callback(snap.docs.map(mapEventTicketTier).sort((a, b) => a.priceCents - b.priceCents)));
}

export function subscribeToEventScheduleItems(eventId: string, callback: (items: EventScheduleItem[]) => void): () => void {
  const q = query(collection(db, 'eventScheduleItems'), where('eventId', '==', eventId), where('published', '==', true), orderBy('startTime', 'asc'));
  return onSnapshot(q, (snap) => callback(snap.docs.map(mapEventScheduleItem)));
}

export function subscribeToEventPerformers(eventId: string, callback: (items: EventPerformer[]) => void): () => void {
  const q = query(collection(db, 'eventPerformers'), where('eventId', '==', eventId), where('published', '==', true));
  return onSnapshot(q, (snap) => callback(snap.docs.map(mapEventPerformer).sort((a, b) => a.name.localeCompare(b.name))));
}

export function subscribeToEventMenuItems(eventId: string, callback: (items: EventMenuItem[]) => void): () => void {
  const q = query(collection(db, 'eventMenuItems'), where('eventId', '==', eventId), where('available', '==', true));
  return onSnapshot(q, (snap) => callback(snap.docs.map(mapEventMenuItem).sort((a, b) => a.sortOrder - b.sortOrder || a.category.localeCompare(b.category) || a.name.localeCompare(b.name))));
}

export function subscribeToAdminEventMenuItems(eventId: string, callback: (items: EventMenuItem[]) => void): () => void {
  const q = query(collection(db, 'eventMenuItems'), where('eventId', '==', eventId));
  return onSnapshot(q, (snap) => callback(snap.docs.map(mapEventMenuItem).sort((a, b) => a.sortOrder - b.sortOrder || a.category.localeCompare(b.category) || a.name.localeCompare(b.name))));
}

export function subscribeToAdminEventFoodOrders(eventId: string, callback: (orders: EventFoodOrder[]) => void, onError?: (error: Error) => void): () => void {
  const active = query(collection(db, 'eventOrders'), where('eventId', '==', eventId),
    where('status', 'in', ['submitted', 'payment_pending', 'paid', 'accepted', 'in_prep', 'ready']));
  const recent = query(collection(db, 'eventOrders'), where('eventId', '==', eventId), orderBy('createdAt', 'desc'), limit(75));
  let activeOrders: EventFoodOrder[] = [];
  let recentOrders: EventFoodOrder[] = [];
  const emit = () => callback(Array.from(new Map([...recentOrders, ...activeOrders].map((order) => [order.id, order])).values())
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)));
  const stopActive = onSnapshot(active, (snap) => { activeOrders = snap.docs.map(mapEventFoodOrder); emit(); }, onError);
  const stopRecent = onSnapshot(recent, (snap) => { recentOrders = snap.docs.map(mapEventFoodOrder); emit(); }, onError);
  return () => { stopActive(); stopRecent(); };
}

export function subscribeToEventCampaigns(eventId: string, callback: (items: EventCampaign[]) => void): () => void {
  const q = query(collection(db, 'eventCampaigns'), where('eventId', '==', eventId), where('active', '==', true));
  return onSnapshot(q, (snap) => callback(snap.docs.map(mapEventCampaign)));
}

export function subscribeToEventAnnouncements(eventId: string, callback: (items: EventAnnouncement[]) => void): () => void {
  const q = query(
    collection(db, 'eventAnnouncements'),
    where('eventId', '==', eventId),
    where('status', '==', 'sent'),
    orderBy('sentAt', 'desc'),
    limit(10)
  );
  return onSnapshot(q, (snap) => callback(snap.docs.map(mapEventAnnouncement)));
}
