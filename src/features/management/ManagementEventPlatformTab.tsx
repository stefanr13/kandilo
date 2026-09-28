import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  DollarSign,
  Plus,
  Loader2,
  QrCode,
  ReceiptText,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Ticket,
  Trash2,
  Utensils,
  Users,
} from 'lucide-react';
import { motion } from 'motion/react';
import type { Language } from '../../types';
import {
  deleteEventMenuItem,
  getEventDashboardMetrics,
  saveEventPortalSetup,
  scanEventTicket,
  sendEventAnnouncement,
  updateEventFoodOrderStatus,
  upsertEventMenuItem,
} from '../../lib/api/eventPlatform';
import {
  subscribeToAdminEventFoodOrders,
  subscribeToAdminEventMenuItems,
  subscribeToChurchEventPortals,
} from '../../lib/db/eventPlatform';
import {
  EMPTY_EVENT_SETUP_CHECKLIST,
  eventSetupReadyForPublish,
  type EventDashboardMetrics,
  type EventFoodOrder,
  type EventMenuItem,
  type EventOrderStatus,
  type EventPortal,
  type EventSetupChecklist,
} from '../../lib/eventPlatform/model';
import { normalizePublicEventSlug } from '../../app/navigation';

interface ManagementEventPlatformTabProps {
  churchId: string;
  language: Language;
  isAdminOrPriest: boolean;
}

type WizardStep = 'dashboard' | 'basics' | 'tickets' | 'schedule' | 'announcements' | 'foodDrink' | 'campaigns' | 'staff' | 'publish';

const STEPS: Array<{ id: WizardStep; label: string; icon: typeof ClipboardList }> = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'basics', label: 'Basics', icon: ClipboardList },
  { id: 'tickets', label: 'Tickets', icon: Ticket },
  { id: 'schedule', label: 'Schedule', icon: CalendarClock },
  { id: 'announcements', label: 'Announcements', icon: ShieldCheck },
  { id: 'foodDrink', label: 'Food & Drink', icon: Utensils },
  { id: 'campaigns', label: 'Campaigns', icon: ShieldCheck },
  { id: 'staff', label: 'Staff', icon: Users },
  { id: 'publish', label: 'Publish/QR', icon: QrCode },
];
const NEW_EVENT_SELECTION = '__new_event__';
const EMPTY_MENU_FORM = {
  id: '',
  category: 'Food',
  name: '',
  description: '',
  price: '',
  currency: 'CAD',
  available: true,
  soldOut: false,
  maxPerOrder: '10',
  inventoryMode: 'unlimited' as 'unlimited' | 'tracked',
  quantityAvailable: '',
  sortOrder: '0',
};

function isoLocal(date: Date): string {
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60 * 1000);
  return localDate.toISOString().slice(0, 16);
}

function slugFromTitle(title: string): string | null {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return normalizePublicEventSlug(slug);
}

function checklistCompleteCount(checklist: EventSetupChecklist): number {
  return Object.values(checklist).filter(Boolean).length;
}

function formatCents(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: currency || 'CAD',
  }).format(cents / 100);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-CA').format(value);
}

function formatGeneratedAt(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return 'just now';
  }
  return new Intl.DateTimeFormat('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function orderStatusLabel(status: EventOrderStatus): string {
  return status.replace(/_/g, ' ');
}

function portalToForm(portal: EventPortal | null) {
  const startsAt = portal?.startsAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const endsAt = portal?.endsAt ?? new Date(startsAt.getTime() + 6 * 60 * 60 * 1000);
  return {
    id: portal?.id ?? '',
    title: portal?.title ?? '',
    slug: portal?.slug ?? '',
    description: portal?.description ?? '',
    venueName: portal?.venueName ?? '',
    venueAddress: portal?.venueAddress ?? '',
    heroImageURL: portal?.heroImageURL ?? '',
    startsAt: isoLocal(startsAt),
    endsAt: isoLocal(endsAt),
    status: portal?.status ?? 'draft',
    focusEnabled: portal?.focusEnabled ?? false,
    focusStartsAt: portal?.focusStartsAt ? isoLocal(portal.focusStartsAt) : '',
    focusEndsAt: portal?.focusEndsAt ? isoLocal(portal.focusEndsAt) : '',
    ticketsEnabled: portal?.ticketsEnabled ?? false,
    gateScanningEnabled: portal?.gateScanningEnabled ?? false,
    reEntryEnabled: portal?.reEntryEnabled ?? true,
    foodDrinkEnabled: portal?.foodDrinkEnabled ?? false,
    foodOrderingEnabled: portal?.foodOrderingEnabled ?? false,
    campaignsEnabled: portal?.campaignsEnabled ?? false,
    setupChecklist: portal?.setupChecklist ?? EMPTY_EVENT_SETUP_CHECKLIST,
  };
}

export default function ManagementEventPlatformTab({
  churchId,
  isAdminOrPriest,
}: ManagementEventPlatformTabProps) {
  const [portals, setPortals] = useState<EventPortal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPortalId, setSelectedPortalId] = useState('');
  const [step, setStep] = useState<WizardStep>('basics');
  const selectedPortal = selectedPortalId && selectedPortalId !== NEW_EVENT_SELECTION
    ? portals.find((portal) => portal.id === selectedPortalId) ?? null
    : null;
  const [form, setForm] = useState(() => portalToForm(null));
  const [saving, setSaving] = useState(false);
  const [announcementSending, setAnnouncementSending] = useState(false);
  const [menuItems, setMenuItems] = useState<EventMenuItem[]>([]);
  const [foodOrders, setFoodOrders] = useState<EventFoodOrder[]>([]);
  const [menuForm, setMenuForm] = useState(EMPTY_MENU_FORM);
  const [menuSaving, setMenuSaving] = useState(false);
  const [orderUpdatingId, setOrderUpdatingId] = useState('');
  const [dashboardMetrics, setDashboardMetrics] = useState<EventDashboardMetrics | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [scannerCode, setScannerCode] = useState('');
  const [scannerDeviceId, setScannerDeviceId] = useState('');
  const [scannerSubmitting, setScannerSubmitting] = useState(false);
  const [scannerResult, setScannerResult] = useState<{
    result: string;
    admitted: boolean;
    requiresStaffConfirmation: boolean;
    reason: string;
    ticketId: string;
    scanCount: number;
  } | null>(null);
  const [announcement, setAnnouncement] = useState({
    title: '',
    body: '',
    priority: 'urgent' as const,
    channels: ['inApp', 'push', 'email'] as Array<'inApp' | 'push' | 'email'>,
  });
  const [message, setMessage] = useState('');

  useEffect(() => {
    setLoading(true);
    return subscribeToChurchEventPortals(
      churchId,
      (nextPortals) => {
        setPortals(nextPortals);
        setSelectedPortalId((current) => current || nextPortals[0]?.id || NEW_EVENT_SELECTION);
        setLoading(false);
      },
      (error) => {
        console.error('Failed to load event portals:', error);
        setPortals([]);
        setMessage('Events could not be loaded. Please refresh and try again.');
        setLoading(false);
      }
    );
  }, [churchId]);

  useEffect(() => {
    setForm(portalToForm(selectedPortal));
    setMenuForm(EMPTY_MENU_FORM);
    setScannerCode('');
    setScannerResult(null);
  }, [churchId, selectedPortal]);

  useEffect(() => {
    if (!selectedPortal) {
      setMenuItems([]);
      setFoodOrders([]);
      return undefined;
    }

    const unsubscribers = [
      subscribeToAdminEventMenuItems(selectedPortal.id, setMenuItems),
      subscribeToAdminEventFoodOrders(selectedPortal.id, setFoodOrders, () => setMessage('The order queue could not be loaded. Please refresh before updating orders.')),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [selectedPortal]);

  const fetchDashboardMetrics = useCallback(async (eventId: string): Promise<EventDashboardMetrics> => (
    getEventDashboardMetrics({ eventId })
  ), []);

  useEffect(() => {
    if (!selectedPortal || step !== 'dashboard') {
      if (!selectedPortal) {
        setDashboardMetrics(null);
      }
      return undefined;
    }

    let cancelled = false;
    setDashboardLoading(true);
    void fetchDashboardMetrics(selectedPortal.id)
      .then((metrics) => {
        if (!cancelled) {
          setDashboardMetrics(metrics);
        }
      })
      .catch((error) => {
        console.error('Failed to load event dashboard metrics:', error);
        if (!cancelled) {
          setDashboardMetrics(null);
          setMessage('Unable to load event dashboard metrics right now.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDashboardLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fetchDashboardMetrics, selectedPortal, step]);

  const previewPortal = useMemo<EventPortal>(() => ({
    id: form.id,
    organizationId: churchId,
    organizationType: 'church',
    churchId,
    title: form.title.trim() || 'Untitled Event',
    slug: normalizePublicEventSlug(form.slug) ?? slugFromTitle(form.title) ?? '',
    status: form.status === 'published' ? 'published' : 'draft',
    startsAt: new Date(form.startsAt),
    endsAt: new Date(form.endsAt),
    venueName: form.venueName,
    venueAddress: form.venueAddress,
    heroImageURL: form.heroImageURL,
    description: form.description,
    modules: [
      ...(form.ticketsEnabled ? ['tickets' as const] : []),
      'schedule' as const,
      ...(form.foodDrinkEnabled ? ['foodDrink' as const] : []),
      ...(form.campaignsEnabled ? ['campaigns' as const] : []),
      'info' as const,
    ],
    focusEnabled: form.focusEnabled,
    focusStartsAt: form.focusStartsAt ? new Date(form.focusStartsAt) : null,
    focusEndsAt: form.focusEndsAt ? new Date(form.focusEndsAt) : null,
    ticketsEnabled: form.ticketsEnabled,
    gateScanningEnabled: form.gateScanningEnabled,
    reEntryEnabled: form.reEntryEnabled,
    foodDrinkEnabled: form.foodDrinkEnabled,
    foodOrderingEnabled: form.foodDrinkEnabled && form.foodOrderingEnabled,
    campaignsEnabled: form.campaignsEnabled,
    setupChecklist: form.setupChecklist,
  }), [churchId, form]);

  const readyForPublish = eventSetupReadyForPublish(form.setupChecklist, previewPortal);
  const slugLocked = Boolean(selectedPortal);

  const updateChecklist = (key: keyof EventSetupChecklist, value: boolean) => {
    setForm((current) => ({
      ...current,
      setupChecklist: { ...current.setupChecklist, [key]: value },
    }));
  };

  const save = async (publish = false) => {
    if (!isAdminOrPriest || saving) {
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const normalizedSlug = normalizePublicEventSlug(form.slug) ?? slugFromTitle(form.title);
      if (!normalizedSlug) {
        setMessage('Enter a public URL slug using letters, numbers, and hyphens.');
        return;
      }
      if (form.id && form.id !== normalizedSlug) {
        setMessage('Public URL slugs cannot be changed after the event is saved.');
        return;
      }

      const startsAt = new Date(form.startsAt);
      const endsAt = new Date(form.endsAt);
      if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
        setMessage('Enter a valid start and end time before saving.');
        return;
      }

      const focusStartsAt = form.focusStartsAt ? new Date(form.focusStartsAt) : null;
      const focusEndsAt = form.focusEndsAt ? new Date(form.focusEndsAt) : null;
      if (
        (focusStartsAt && !Number.isFinite(focusStartsAt.getTime()))
        || (focusEndsAt && !Number.isFinite(focusEndsAt.getTime()))
        || (focusStartsAt && focusEndsAt && focusEndsAt <= focusStartsAt)
      ) {
        setMessage('Enter a valid Featured Event window before saving.');
        return;
      }

      const nextStatus = publish && readyForPublish ? 'published' : 'draft';
      const result = await saveEventPortalSetup({
        eventId: form.id || undefined,
        churchId,
        title: form.title.trim(),
        slug: normalizedSlug,
        status: nextStatus,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        venueName: form.venueName.trim(),
        venueAddress: form.venueAddress.trim(),
        heroImageURL: form.heroImageURL.trim(),
        description: form.description.trim(),
        focusEnabled: form.focusEnabled,
        focusStartsAt: focusStartsAt ? focusStartsAt.toISOString() : null,
        focusEndsAt: focusEndsAt ? focusEndsAt.toISOString() : null,
        ticketsEnabled: form.ticketsEnabled,
        gateScanningEnabled: form.gateScanningEnabled,
        reEntryEnabled: form.reEntryEnabled,
        foodDrinkEnabled: form.foodDrinkEnabled,
        foodOrderingEnabled: form.foodDrinkEnabled && form.foodOrderingEnabled,
        campaignsEnabled: form.campaignsEnabled,
        setupChecklist: form.setupChecklist,
      });
      setSelectedPortalId(result.eventId);
      setForm((current) => ({
        ...current,
        id: result.eventId,
        slug: result.slug,
        status: result.status,
      }));
      setMessage(nextStatus === 'published' ? 'Event published.' : 'Event draft saved.');
    } catch (error) {
      console.error('Failed to save event portal:', error);
      setMessage(error instanceof Error && error.message ? error.message : 'Unable to save this event setup right now.');
    } finally {
      setSaving(false);
    }
  };

  const sendAnnouncement = async () => {
    if (!isAdminOrPriest || announcementSending || !selectedPortal) {
      return;
    }
    setAnnouncementSending(true);
    setMessage('');
    try {
      const result = await sendEventAnnouncement({
        eventId: selectedPortal.id,
        title: announcement.title,
        body: announcement.body,
        priority: announcement.priority,
        channels: announcement.channels,
      });
      const pushLabel = announcement.channels.includes('push')
        ? (result.pushSent ? 'sent' : 'failed')
        : 'not selected';
      const emailLabel = announcement.channels.includes('email')
        ? (result.emailSent ? `${result.emailRecipientCount} recipients` : 'failed or no recipients')
        : 'not selected';
      setMessage(
        `Announcement posted. Email: ${emailLabel}. Push: ${pushLabel}.`
      );
      setAnnouncement((current) => ({ ...current, title: '', body: '' }));
    } catch (error) {
      console.error('Failed to send event announcement:', error);
      setMessage(error instanceof Error && error.message ? error.message : 'Unable to send this event announcement right now.');
    } finally {
      setAnnouncementSending(false);
    }
  };

  const editMenuItem = (item: EventMenuItem) => {
    setMenuForm({
      id: item.id,
      category: item.category,
      name: item.name,
      description: item.description,
      price: (item.priceCents / 100).toFixed(2),
      currency: item.currency,
      available: item.available,
      soldOut: item.soldOut,
      maxPerOrder: String(item.maxPerOrder),
      inventoryMode: item.inventoryMode,
      quantityAvailable: item.quantityAvailable === null ? '' : String(item.quantityAvailable),
      sortOrder: String(item.sortOrder),
    });
  };

  const resetMenuForm = () => {
    setMenuForm(EMPTY_MENU_FORM);
  };

  const saveMenuItem = async () => {
    if (!selectedPortal || !isAdminOrPriest || menuSaving) {
      return;
    }
    const priceNumber = Number(menuForm.price);
    const priceCents = Math.round(priceNumber * 100);
    const maxPerOrder = Number(menuForm.maxPerOrder);
    const trackedQuantityAvailable = Number(menuForm.quantityAvailable);
    const quantityAvailable = menuForm.inventoryMode === 'tracked' ? trackedQuantityAvailable : null;
    const sortOrder = Number(menuForm.sortOrder);
    if (!menuForm.category.trim() || !menuForm.name.trim() || !Number.isFinite(priceNumber) || priceCents < 0) {
      setMessage('Enter a valid menu category, name, and price.');
      return;
    }
    if (!Number.isInteger(maxPerOrder) || maxPerOrder < 1 || maxPerOrder > 99) {
      setMessage('Menu item per-order limit must be between 1 and 99.');
      return;
    }
    if (
      menuForm.inventoryMode === 'tracked'
      && (!Number.isInteger(trackedQuantityAvailable) || trackedQuantityAvailable < 0 || trackedQuantityAvailable > 1000000)
    ) {
      setMessage('Tracked inventory must be a whole number of available items.');
      return;
    }
    if (!Number.isInteger(sortOrder)) {
      setMessage('Menu item sort order must be a whole number.');
      return;
    }

    setMenuSaving(true);
    setMessage('');
    try {
      await upsertEventMenuItem({
        eventId: selectedPortal.id,
        menuItemId: menuForm.id || undefined,
        category: menuForm.category.trim(),
        name: menuForm.name.trim(),
        description: menuForm.description.trim(),
        priceCents,
        currency: menuForm.currency,
        available: menuForm.available,
        soldOut: menuForm.soldOut,
        maxPerOrder,
        inventoryMode: menuForm.inventoryMode,
        quantityAvailable,
        sortOrder,
      });
      resetMenuForm();
      setMessage('Menu item saved.');
    } catch (error) {
      console.error('Failed to save event menu item:', error);
      setMessage(error instanceof Error && error.message ? error.message : 'Unable to save this menu item right now.');
    } finally {
      setMenuSaving(false);
    }
  };

  const removeMenuItem = async (item: EventMenuItem) => {
    if (!selectedPortal || menuSaving) {
      return;
    }
    setMenuSaving(true);
    setMessage('');
    try {
      await deleteEventMenuItem({ eventId: selectedPortal.id, menuItemId: item.id });
      if (menuForm.id === item.id) {
        resetMenuForm();
      }
      setMessage('Menu item removed.');
    } catch (error) {
      console.error('Failed to delete event menu item:', error);
      setMessage(error instanceof Error && error.message ? error.message : 'Unable to remove this menu item right now.');
    } finally {
      setMenuSaving(false);
    }
  };

  const updateOrderStatus = async (
    order: EventFoodOrder,
    status: EventOrderStatus,
    paymentCollected = false
  ) => {
    if (!selectedPortal || orderUpdatingId) {
      return;
    }
    setOrderUpdatingId(order.id);
    setMessage('');
    try {
      await updateEventFoodOrderStatus({
        eventId: selectedPortal.id,
        orderId: order.id,
        status,
        paymentCollected,
        cancellationReason: status === 'cancelled' ? 'Cancelled by event staff.' : undefined,
      });
      if (step === 'dashboard') {
        void fetchDashboardMetrics(selectedPortal.id).then(setDashboardMetrics).catch((error) => {
          console.error('Failed to refresh event dashboard metrics:', error);
        });
      }
      setMessage(`Order ${order.orderCode} updated.`);
    } catch (error) {
      console.error('Failed to update event food order:', error);
      setMessage(error instanceof Error && error.message ? error.message : 'Unable to update this order right now.');
    } finally {
      setOrderUpdatingId('');
    }
  };

  const scanTicket = async (confirmReEntry = false) => {
    if (!selectedPortal || scannerSubmitting) {
      return;
    }
    const code = scannerCode.trim();
    if (code.length < 6) {
      setMessage('Enter a valid ticket QR or manual code.');
      return;
    }

    setScannerSubmitting(true);
    setMessage('');
    try {
      const result = await scanEventTicket({
        eventId: selectedPortal.id,
        code,
        deviceId: scannerDeviceId.trim() || undefined,
        confirmReEntry,
      });
      setScannerResult(result);
      if (result.admitted) {
        setScannerCode('');
        setMessage(result.requiresStaffConfirmation ? 'Re-entry admitted and recorded.' : 'Ticket admitted and recorded.');
      } else if (result.requiresStaffConfirmation) {
        setMessage('Ticket has prior scan history. Confirm re-entry only after staff review.');
      } else {
        setMessage(result.reason || 'Ticket was not admitted.');
      }
      if (step === 'dashboard') {
        void fetchDashboardMetrics(selectedPortal.id).then(setDashboardMetrics).catch((error) => {
          console.error('Failed to refresh event dashboard metrics:', error);
        });
      }
    } catch (error) {
      console.error('Failed to scan event ticket:', error);
      setScannerResult(null);
      setMessage(error instanceof Error && error.message ? error.message : 'Unable to scan this ticket right now.');
    } finally {
      setScannerSubmitting(false);
    }
  };

  const refreshDashboard = async () => {
    if (!selectedPortal || dashboardLoading) {
      return;
    }
    setDashboardLoading(true);
    setMessage('');
    try {
      setDashboardMetrics(await fetchDashboardMetrics(selectedPortal.id));
      setMessage('Dashboard refreshed.');
    } catch (error) {
      console.error('Failed to refresh event dashboard metrics:', error);
      setMessage(error instanceof Error && error.message ? error.message : 'Unable to refresh event dashboard metrics right now.');
    } finally {
      setDashboardLoading(false);
    }
  };

  const maxBreakdownRevenue = Math.max(
    1,
    ...(dashboardMetrics?.salesBreakdown.map((item) => item.revenueCents) ?? [0])
  );

  return (
    <div className="flex-1 overflow-y-auto bg-[#f6f3ee]">
      <div className="border-b border-gray-100 bg-white px-6 py-6 xl:px-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#937022]">Kandilo Events</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-gray-950">Event setup wizard.</h2>
            <p className="mt-2 max-w-2xl text-sm font-medium text-gray-400">
              Build and publish the public event portal. Ticket checkout and wallet passes stay off until Stripe ticketing is configured.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void save(false)}
            disabled={saving}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-gray-950 px-5 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
            Save draft
          </button>
        </div>
      </div>

      <div className="grid gap-6 p-6 xl:grid-cols-[260px_1fr_320px] xl:p-8">
        <aside className="space-y-4">
          <div className="rounded-2xl bg-white p-4">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Event</label>
            <select
              value={selectedPortalId || NEW_EVENT_SELECTION}
              onChange={(event) => setSelectedPortalId(event.target.value)}
              className="mt-2 w-full rounded-xl border-none bg-gray-50 px-3 py-3 text-xs font-bold text-gray-900"
            >
              {loading ? <option>Loading...</option> : null}
              <option value={NEW_EVENT_SELECTION}>New Event</option>
              {portals.map((portal) => (
                <option key={portal.id} value={portal.id}>{portal.title}</option>
              ))}
            </select>
          </div>

          <nav className="rounded-2xl bg-white p-2">
            {STEPS.map((entry) => {
              const Icon = entry.icon;
              const active = step === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setStep(entry.id)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-xs font-black uppercase tracking-widest ${
                    active ? 'bg-gray-950 text-white' : 'text-gray-400 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <Icon size={16} />
                  {entry.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="rounded-[28px] bg-white p-6 xl:p-8">
          {step === 'dashboard' && (
            <div className="space-y-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#937022]">Event performance</p>
                  <h3 className="mt-2 text-3xl font-black tracking-tight text-gray-950">Dashboard</h3>
                  <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-gray-500">
                    Revenue, check-in, and order performance for this event. Headline sales count paid entry tickets and collected pickup orders.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void refreshDashboard()}
                  disabled={!selectedPortal || dashboardLoading}
                  className="flex h-11 items-center justify-center gap-2 rounded-2xl bg-gray-950 px-4 text-[10px] font-black uppercase tracking-widest text-white disabled:bg-gray-200 disabled:text-gray-400"
                >
                  {dashboardLoading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                  Refresh
                </button>
              </div>

              {!selectedPortal ? (
                <div className="rounded-2xl bg-amber-50 px-5 py-4 text-sm font-black text-amber-800">
                  Save the event draft before viewing dashboard metrics.
                </div>
              ) : dashboardLoading && !dashboardMetrics ? (
                <div className="flex min-h-[360px] items-center justify-center rounded-2xl bg-gray-50 text-gray-400">
                  <Loader2 size={28} className="animate-spin" />
                </div>
              ) : dashboardMetrics ? (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24 }}
                  className="space-y-6"
                >
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {[
                      {
                        label: 'Total sales',
                        value: formatCents(dashboardMetrics.totalSalesCents, dashboardMetrics.currency),
                        sub: 'Entry + collected food',
                        icon: DollarSign,
                        tone: 'bg-gray-950 text-white',
                      },
                      {
                        label: 'Entry sales',
                        value: formatCents(dashboardMetrics.entrySalesCents, dashboardMetrics.currency),
                        sub: `${formatNumber(dashboardMetrics.ticketsSold)} tickets sold`,
                        icon: Ticket,
                        tone: 'bg-[#800000] text-white',
                      },
                      {
                        label: 'QR check-ins',
                        value: formatNumber(dashboardMetrics.qrCheckIns),
                        sub: `${formatNumber(dashboardMetrics.scanAttempts)} scan attempts`,
                        icon: ScanLine,
                        tone: 'bg-[#f2c66d] text-gray-950',
                      },
                      {
                        label: 'Donations',
                        value: formatCents(dashboardMetrics.donationCents, dashboardMetrics.currency),
                        sub: `${formatNumber(dashboardMetrics.donationCount)} completed gifts`,
                        icon: ReceiptText,
                        tone: 'bg-emerald-700 text-white',
                      },
                    ].map((metric) => {
                      const Icon = metric.icon;
                      return (
                        <div key={metric.label} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${metric.tone}`}>
                            <Icon size={18} />
                          </div>
                          <p className="mt-4 text-[10px] font-black uppercase tracking-widest text-gray-400">{metric.label}</p>
                          <p className="mt-1 break-words text-2xl font-black tracking-tight text-gray-950">{metric.value}</p>
                          <p className="mt-1 text-xs font-bold text-gray-400">{metric.sub}</p>
                        </div>
                      );
                    })}
                  </div>

                  {(dashboardMetrics.truncated || dashboardMetrics.multiCurrency) && (
                    <div className="rounded-2xl bg-amber-50 px-5 py-4 text-xs font-bold leading-relaxed text-amber-800">
                      {dashboardMetrics.truncated
                        ? 'This event has more activity rows than the live dashboard limit. Use exported reporting before final reconciliation.'
                        : 'This event has activity in more than one currency. Headline totals show the dashboard currency only.'}
                    </div>
                  )}

                  <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
                    <div className="rounded-2xl bg-gray-50 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-black uppercase tracking-widest text-gray-950">Sales by item</h4>
                          <p className="mt-1 text-xs font-bold text-gray-400">Tickets and collected food orders, grouped by item.</p>
                        </div>
                        <span className="rounded-xl bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-gray-500">
                          Top {dashboardMetrics.salesBreakdown.length}
                        </span>
                      </div>
                      <div className="mt-5 space-y-3">
                        {dashboardMetrics.salesBreakdown.length > 0 ? dashboardMetrics.salesBreakdown.map((item) => (
                          <div key={`${item.type}-${item.id}`} className="rounded-2xl bg-white p-4">
                            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`rounded-lg px-2 py-1 text-[9px] font-black uppercase tracking-widest ${
                                    item.type === 'ticket' ? 'bg-[#800000]/10 text-[#800000]' : 'bg-emerald-50 text-emerald-700'
                                  }`}>
                                    {item.type}
                                  </span>
                                  <p className="truncate text-sm font-black text-gray-950">{item.label}</p>
                                </div>
                                <p className="mt-1 text-xs font-bold text-gray-400">{formatNumber(item.quantity)} sold</p>
                              </div>
                              <p className="text-right text-sm font-black text-gray-950">{formatCents(item.revenueCents, item.currency)}</p>
                            </div>
                            <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
                              <div
                                className="h-full rounded-full bg-[#800000]"
                                style={{ width: `${Math.max(3, Math.round((item.revenueCents / maxBreakdownRevenue) * 100))}%` }}
                              />
                            </div>
                          </div>
                        )) : (
                          <div className="rounded-2xl bg-white px-5 py-10 text-center">
                            <p className="text-sm font-black text-gray-950">No item sales yet.</p>
                            <p className="mt-2 text-xs font-bold text-gray-400">Paid tickets and collected food orders will appear here.</p>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-5">
                      <div className="rounded-2xl bg-gray-950 p-5 text-white">
                        <p className="text-[10px] font-black uppercase tracking-widest text-white/45">Food orders</p>
                        <p className="mt-2 text-3xl font-black tracking-tight">{formatCents(dashboardMetrics.foodSalesCents, dashboardMetrics.currency)}</p>
                        <p className="mt-1 text-xs font-bold text-white/45">
                          {formatNumber(dashboardMetrics.foodOrders)} completed orders · {formatNumber(dashboardMetrics.foodItemsSold)} items
                        </p>
                        <div className="mt-4 rounded-2xl bg-white/10 p-4">
                          <p className="text-[10px] font-black uppercase tracking-widest text-white/45">Open order value</p>
                          <p className="mt-1 text-xl font-black">{formatCents(dashboardMetrics.pendingFoodSalesCents, dashboardMetrics.currency)}</p>
                          <p className="mt-1 text-xs font-bold text-white/45">{formatNumber(dashboardMetrics.pendingFoodOrders)} pending orders</p>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                        <h4 className="text-sm font-black uppercase tracking-widest text-gray-950">Order status</h4>
                        <div className="mt-4 space-y-3">
                          {dashboardMetrics.orderStatusCounts.length > 0 ? dashboardMetrics.orderStatusCounts.map((entry) => {
                            const maxCount = Math.max(...dashboardMetrics.orderStatusCounts.map((item) => item.count), 1);
                            return (
                              <div key={entry.status}>
                                <div className="flex items-center justify-between text-xs font-black uppercase tracking-widest">
                                  <span className="text-gray-500">{orderStatusLabel(entry.status)}</span>
                                  <span className="text-gray-950">{formatNumber(entry.count)}</span>
                                </div>
                                <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
                                  <div
                                    className="h-full rounded-full bg-[#f2c66d]"
                                    style={{ width: `${Math.max(6, Math.round((entry.count / maxCount) * 100))}%` }}
                                  />
                                </div>
                              </div>
                            );
                          }) : (
                            <p className="text-xs font-bold text-gray-400">No food order activity yet.</p>
                          )}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-gray-50 p-5">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Last updated</p>
                        <p className="mt-1 text-sm font-black text-gray-950">{formatGeneratedAt(dashboardMetrics.generatedAt)}</p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : (
                <div className="rounded-2xl bg-gray-50 px-5 py-10 text-center">
                  <p className="text-sm font-black text-gray-950">Dashboard metrics are not available.</p>
                  <p className="mt-2 text-xs font-bold text-gray-400">Refresh after ticket, scan, order, or donation activity is recorded.</p>
                </div>
              )}
            </div>
          )}

          {step === 'basics' && (
            <div className="space-y-5">
              <h3 className="text-2xl font-black tracking-tight text-gray-950">Event basics</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value, slug: form.slug || slugFromTitle(event.target.value) || '' })} placeholder="Serbian Fest" className="rounded-2xl border-none bg-gray-50 px-4 py-4 text-sm font-bold" />
                <input value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} disabled={slugLocked} placeholder="serbian-fest-2026" className="rounded-2xl border-none bg-gray-50 px-4 py-4 text-sm font-bold disabled:text-gray-400" />
                <input type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} className="rounded-2xl border-none bg-gray-50 px-4 py-4 text-sm font-bold" />
                <input type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} className="rounded-2xl border-none bg-gray-50 px-4 py-4 text-sm font-bold" />
                <input value={form.venueName} onChange={(event) => setForm({ ...form, venueName: event.target.value })} placeholder="Venue name" className="rounded-2xl border-none bg-gray-50 px-4 py-4 text-sm font-bold" />
                <input value={form.venueAddress} onChange={(event) => setForm({ ...form, venueAddress: event.target.value })} placeholder="Venue address" className="rounded-2xl border-none bg-gray-50 px-4 py-4 text-sm font-bold" />
              </div>
              <input value={form.heroImageURL} onChange={(event) => setForm({ ...form, heroImageURL: event.target.value })} placeholder="Hero image URL" className="w-full rounded-2xl border-none bg-gray-50 px-4 py-4 text-sm font-bold" />
              <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Public event description" rows={5} className="w-full rounded-2xl border-none bg-gray-50 px-4 py-4 text-sm font-bold" />
              <label className="flex items-center gap-3 text-sm font-black text-gray-900">
                <input type="checkbox" checked={form.setupChecklist.basics} onChange={(event) => updateChecklist('basics', event.target.checked)} />
                Basics are complete
              </label>
            </div>
          )}

          {step === 'tickets' && (
            <div className="space-y-5">
              <h3 className="text-2xl font-black tracking-tight text-gray-950">Tickets and secure entry</h3>
              {[
                ['ticketsEnabled', 'Show ticket information'],
                ['gateScanningEnabled', 'Enable staff gate scanning'],
                ['reEntryEnabled', 'Allow controlled re-entry after scanner launch'],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center justify-between rounded-2xl bg-gray-50 px-4 py-4 text-sm font-black text-gray-900">
                  {label}
                  <input type="checkbox" checked={Boolean(form[key as keyof typeof form])} onChange={(event) => setForm({ ...form, [key]: event.target.checked })} />
                </label>
              ))}
              <p className="text-sm font-medium text-gray-400">
                Gate scanning uses the secure backend scanner. Ticket checkout and wallet pass generation stay disabled until Stripe ticketing is configured.
              </p>
              <label className="flex items-center gap-3 text-sm font-black text-gray-900">
                <input type="checkbox" checked={form.setupChecklist.tickets} onChange={(event) => updateChecklist('tickets', event.target.checked)} />
                Ticket tiers and scanner settings are complete
              </label>
            </div>
          )}

          {step === 'schedule' && (
            <div className="space-y-5">
              <h3 className="text-2xl font-black tracking-tight text-gray-950">Dynamic schedule</h3>
              <p className="text-sm font-medium leading-relaxed text-gray-500">
                The public portal reads published event schedule and performer rows written by trusted backend tools. Keep this unchecked until those rows are present.
              </p>
              <label className="flex items-center gap-3 text-sm font-black text-gray-900">
                <input type="checkbox" checked={form.setupChecklist.schedule} onChange={(event) => updateChecklist('schedule', event.target.checked)} />
                Schedule and performer details are complete
              </label>
            </div>
          )}

          {step === 'announcements' && (
            <div className="space-y-5">
              <h3 className="text-2xl font-black tracking-tight text-gray-950">Event announcements</h3>
              <p className="text-sm font-medium leading-relaxed text-gray-500">
                Send event-scoped updates such as weather safety alerts, schedule changes, or food offers. The public event page updates immediately; push and email target active members and event ticket email records when available.
              </p>
              <div className="grid gap-4 md:grid-cols-[1fr_180px]">
                <input
                  value={announcement.title}
                  onChange={(event) => setAnnouncement({ ...announcement, title: event.target.value })}
                  placeholder="Rain storm. Please take shelter."
                  className="rounded-2xl border-none bg-gray-50 px-4 py-4 text-sm font-bold"
                />
                <select
                  value={announcement.priority}
                  onChange={(event) => setAnnouncement({ ...announcement, priority: event.target.value as typeof announcement.priority })}
                  className="rounded-2xl border-none bg-gray-50 px-4 py-4 text-sm font-bold"
                >
                  <option value="urgent">Urgent</option>
                  <option value="info">Info</option>
                  <option value="offer">Offer</option>
                </select>
              </div>
              <textarea
                value={announcement.body}
                onChange={(event) => setAnnouncement({ ...announcement, body: event.target.value })}
                placeholder="Please move calmly to the tents until the storm passes."
                rows={4}
                className="w-full rounded-2xl border-none bg-gray-50 px-4 py-4 text-sm font-bold"
              />
              <div className="grid gap-3 md:grid-cols-3">
                {(['inApp', 'push', 'email'] as const).map((channel) => (
                  <label key={channel} className="flex items-center justify-between rounded-2xl bg-gray-50 px-4 py-4 text-sm font-black text-gray-900">
                    {channel === 'inApp' ? 'Event page' : channel === 'push' ? 'Push' : 'Email'}
                    <input
                      type="checkbox"
                      checked={announcement.channels.includes(channel)}
                      onChange={(event) => {
                        setAnnouncement((current) => ({
                          ...current,
                          channels: event.target.checked
                            ? Array.from(new Set([...current.channels, channel]))
                            : current.channels.filter((value) => value !== channel),
                        }));
                      }}
                    />
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void sendAnnouncement()}
                disabled={!selectedPortal || selectedPortal.status !== 'published' || announcementSending || !announcement.title.trim() || !announcement.body.trim() || announcement.channels.length === 0}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#800000] px-5 text-[10px] font-black uppercase tracking-widest text-white disabled:bg-gray-200 disabled:text-gray-400"
              >
                {announcementSending ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}
                Send announcement
              </button>
              {!selectedPortal && <p className="text-xs font-black text-red-500">Save the event draft before sending announcements.</p>}
              {selectedPortal && selectedPortal.status !== 'published' && <p className="text-xs font-black text-red-500">Publish the event before sending announcements.</p>}
            </div>
          )}

          {step === 'foodDrink' && (
            <div className="space-y-5">
              <h3 className="text-2xl font-black tracking-tight text-gray-950">Food and drink</h3>
              <label className="flex items-center justify-between rounded-2xl bg-gray-50 px-4 py-4 text-sm font-black text-gray-900">
                Show food and drink menu
                <input
                  type="checkbox"
                  checked={form.foodDrinkEnabled}
                  onChange={(event) => setForm({
                    ...form,
                    foodDrinkEnabled: event.target.checked,
                    foodOrderingEnabled: event.target.checked ? form.foodOrderingEnabled : false,
                  })}
                />
              </label>
              <label className="flex items-center justify-between rounded-2xl bg-gray-50 px-4 py-4 text-sm font-black text-gray-900">
                Accept pay-at-pickup food orders
                <input
                  type="checkbox"
                  disabled={!form.foodDrinkEnabled}
                  checked={form.foodDrinkEnabled && form.foodOrderingEnabled}
                  onChange={(event) => setForm({ ...form, foodOrderingEnabled: event.target.checked })}
                />
              </label>
              <p className="text-sm font-medium leading-relaxed text-gray-500">
                Orders are stored with server-calculated prices and marked pay-at-pickup. Stripe checkout stays off until payment routing is configured.
              </p>
              {!selectedPortal && (
                <p className="rounded-2xl bg-amber-50 px-4 py-3 text-xs font-black text-amber-700">
                  Save the event draft before adding menu items or receiving orders.
                </p>
              )}
              {selectedPortal && (
                <div className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
                  <div className="rounded-2xl bg-gray-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-sm font-black uppercase tracking-widest text-gray-900">Menu items</h4>
                      <button
                        type="button"
                        onClick={resetMenuForm}
                        className="flex h-9 items-center gap-2 rounded-xl bg-white px-3 text-[10px] font-black uppercase tracking-widest text-gray-500"
                      >
                        <Plus size={14} />
                        New
                      </button>
                    </div>
                    <div className="mt-4 space-y-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <input value={menuForm.category} onChange={(event) => setMenuForm({ ...menuForm, category: event.target.value })} placeholder="Category" className="rounded-xl border-none bg-white px-3 py-3 text-xs font-bold" />
                        <input value={menuForm.name} onChange={(event) => setMenuForm({ ...menuForm, name: event.target.value })} placeholder="Item name" className="rounded-xl border-none bg-white px-3 py-3 text-xs font-bold" />
                        <input value={menuForm.price} onChange={(event) => setMenuForm({ ...menuForm, price: event.target.value })} placeholder="Price, e.g. 12.00" inputMode="decimal" className="rounded-xl border-none bg-white px-3 py-3 text-xs font-bold" />
                        <select value={menuForm.currency} onChange={(event) => setMenuForm({ ...menuForm, currency: event.target.value })} className="rounded-xl border-none bg-white px-3 py-3 text-xs font-bold">
                          <option value="CAD">CAD</option>
                          <option value="USD">USD</option>
                        </select>
                        <input value={menuForm.maxPerOrder} onChange={(event) => setMenuForm({ ...menuForm, maxPerOrder: event.target.value })} placeholder="Max per order" inputMode="numeric" className="rounded-xl border-none bg-white px-3 py-3 text-xs font-bold" />
                        <input value={menuForm.sortOrder} onChange={(event) => setMenuForm({ ...menuForm, sortOrder: event.target.value })} placeholder="Sort order" inputMode="numeric" className="rounded-xl border-none bg-white px-3 py-3 text-xs font-bold" />
                      </div>
                      <div className="grid gap-3 md:grid-cols-[0.9fr_1.1fr]">
                        <select
                          value={menuForm.inventoryMode}
                          onChange={(event) => setMenuForm({
                            ...menuForm,
                            inventoryMode: event.target.value === 'tracked' ? 'tracked' : 'unlimited',
                            quantityAvailable: event.target.value === 'tracked' ? menuForm.quantityAvailable : '',
                          })}
                          className="rounded-xl border-none bg-white px-3 py-3 text-xs font-bold"
                        >
                          <option value="unlimited">Unlimited or manual sold out</option>
                          <option value="tracked">Track quantity available</option>
                        </select>
                        <input
                          value={menuForm.quantityAvailable}
                          onChange={(event) => setMenuForm({ ...menuForm, quantityAvailable: event.target.value })}
                          placeholder="Quantity available"
                          inputMode="numeric"
                          disabled={menuForm.inventoryMode !== 'tracked'}
                          className="rounded-xl border-none bg-white px-3 py-3 text-xs font-bold disabled:text-gray-300"
                        />
                      </div>
                      <textarea value={menuForm.description} onChange={(event) => setMenuForm({ ...menuForm, description: event.target.value })} placeholder="Short public description" rows={3} className="w-full rounded-xl border-none bg-white px-3 py-3 text-xs font-bold" />
                      <label className="flex items-center justify-between rounded-xl bg-white px-3 py-3 text-xs font-black text-gray-900">
                        Available on public menu
                        <input type="checkbox" checked={menuForm.available} onChange={(event) => setMenuForm({ ...menuForm, available: event.target.checked })} />
                      </label>
                      <label className="flex items-center justify-between rounded-xl bg-white px-3 py-3 text-xs font-black text-gray-900">
                        Mark as sold out
                        <input type="checkbox" checked={menuForm.soldOut} onChange={(event) => setMenuForm({ ...menuForm, soldOut: event.target.checked })} />
                      </label>
                      <button
                        type="button"
                        onClick={() => void saveMenuItem()}
                        disabled={menuSaving}
                        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gray-950 px-4 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50"
                      >
                        {menuSaving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                        {menuForm.id ? 'Update item' : 'Add item'}
                      </button>
                    </div>
                    <div className="mt-5 divide-y divide-gray-200">
                      {menuItems.length > 0 ? menuItems.map((item) => (
                        <div key={item.id} className="grid grid-cols-[1fr_auto] gap-3 py-3">
                          <button type="button" onClick={() => editMenuItem(item)} className="min-w-0 text-left">
                            <p className="truncate text-sm font-black text-gray-950">{item.name}</p>
                            <p className="mt-1 truncate text-xs font-bold text-gray-400">
                              {item.category} · {formatCents(item.priceCents, item.currency)} · {item.available ? 'Available' : 'Hidden'}
                              {item.soldOut ? ' · Sold out' : ''}
                              {item.inventoryMode === 'tracked' ? ` · ${item.quantityAvailable ?? 0} left` : ''}
                            </p>
                          </button>
                          <button
                            type="button"
                            onClick={() => void removeMenuItem(item)}
                            disabled={menuSaving}
                            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-red-500 disabled:opacity-50"
                            aria-label={`Remove ${item.name}`}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      )) : (
                        <p className="py-5 text-xs font-bold text-gray-400">No menu items yet.</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-gray-950 p-4 text-white">
                    <h4 className="text-sm font-black uppercase tracking-widest">Food order queue</h4>
                    <div className="mt-4 max-h-[680px] space-y-3 overflow-y-auto pr-1">
                      {foodOrders.length > 0 ? foodOrders.map((order) => (
                        <div key={order.id} className="rounded-2xl bg-white/10 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-black">{order.orderCode}</p>
                              <p className="mt-1 truncate text-xs font-bold text-white/55">{order.customerName} · {order.customerEmail || order.customerPhone}</p>
                            </div>
                            <span className="rounded-xl bg-white px-3 py-2 text-[9px] font-black uppercase tracking-widest text-gray-950">
                              {orderStatusLabel(order.status)}
                            </span>
                          </div>
                          <div className="mt-3 space-y-1">
                            {order.items.map((item) => (
                              <p key={item.menuItemId} className="text-xs font-semibold text-white/75">
                                {item.quantity}x {item.name}
                              </p>
                            ))}
                          </div>
                          {order.specialInstructions && <p className="mt-3 text-xs font-semibold text-amber-200">{order.specialInstructions}</p>}
                          <p className="mt-3 text-xs font-black text-white">{formatCents(order.totalCents, order.currency)} · {order.paymentStatus.replace(/_/g, ' ')}</p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            {order.status === 'submitted' && (
                              <button type="button" onClick={() => void updateOrderStatus(order, 'accepted')} disabled={orderUpdatingId === order.id} className="rounded-xl bg-white px-3 py-2 text-[9px] font-black uppercase tracking-widest text-gray-950">Accept</button>
                            )}
                            {(order.status === 'submitted' || order.status === 'accepted') && (
                              <button type="button" onClick={() => void updateOrderStatus(order, 'in_prep')} disabled={orderUpdatingId === order.id} className="rounded-xl bg-white/15 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-white">Start prep</button>
                            )}
                            {order.status === 'in_prep' && (
                              <button type="button" onClick={() => void updateOrderStatus(order, 'ready')} disabled={orderUpdatingId === order.id} className="rounded-xl bg-green-300 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-gray-950">Ready</button>
                            )}
                            {order.status === 'ready' && (
                              <button type="button" onClick={() => void updateOrderStatus(order, 'picked_up', order.totalCents > 0)} disabled={orderUpdatingId === order.id} className="rounded-xl bg-[#f2c66d] px-3 py-2 text-[9px] font-black uppercase tracking-widest text-gray-950">
                                {order.totalCents > 0 ? 'Paid & picked up' : 'Picked up'}
                              </button>
                            )}
                            {!['picked_up', 'cancelled'].includes(order.status) && (
                              <button type="button" onClick={() => void updateOrderStatus(order, 'cancelled')} disabled={orderUpdatingId === order.id} className="rounded-xl bg-red-500/20 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-red-100">Cancel</button>
                            )}
                          </div>
                        </div>
                      )) : (
                        <p className="py-8 text-xs font-bold text-white/45">No food orders yet.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
              <label className="flex items-center gap-3 text-sm font-black text-gray-900">
                <input type="checkbox" checked={form.setupChecklist.foodDrink} onChange={(event) => updateChecklist('foodDrink', event.target.checked)} />
                Menu and pickup operations are complete
              </label>
            </div>
          )}

          {step === 'campaigns' && (
            <div className="space-y-5">
              <h3 className="text-2xl font-black tracking-tight text-gray-950">Campaigns</h3>
              <label className="flex items-center justify-between rounded-2xl bg-gray-50 px-4 py-4 text-sm font-black text-gray-900">
                Show event donation campaign cards
                <input type="checkbox" checked={form.campaignsEnabled} onChange={(event) => setForm({ ...form, campaignsEnabled: event.target.checked })} />
              </label>
              <label className="flex items-center gap-3 text-sm font-black text-gray-900">
                <input type="checkbox" checked={form.setupChecklist.campaigns} onChange={(event) => updateChecklist('campaigns', event.target.checked)} />
                Campaign cards are complete
              </label>
            </div>
          )}

          {step === 'staff' && (
            <div className="space-y-5">
              <h3 className="text-2xl font-black tracking-tight text-gray-950">Staff roles</h3>
              <p className="text-sm font-medium leading-relaxed text-gray-500">
                Admins and priests for this church can manage event orders, announcements, dashboards, and scanner operations.
              </p>
              {selectedPortal && (
                <div className="rounded-2xl bg-gray-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-black uppercase tracking-widest text-gray-900">Ticket scanner</h4>
                      <p className="mt-1 text-xs font-bold text-gray-400">Paste or scan the QR/manual ticket code at the gate.</p>
                    </div>
                    <ScanLine className="text-[#800000]" size={22} />
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-[1fr_180px]">
                    <input
                      value={scannerCode}
                      onChange={(event) => {
                        setScannerCode(event.target.value);
                        setScannerResult(null);
                      }}
                      placeholder="Ticket QR or manual code"
                      className="rounded-xl border-none bg-white px-3 py-3 text-xs font-bold"
                    />
                    <input
                      value={scannerDeviceId}
                      onChange={(event) => setScannerDeviceId(event.target.value)}
                      placeholder="Gate/device"
                      className="rounded-xl border-none bg-white px-3 py-3 text-xs font-bold"
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void scanTicket(false)}
                      disabled={scannerSubmitting || !selectedPortal.gateScanningEnabled || scannerCode.trim().length < 6}
                      className="flex h-10 items-center gap-2 rounded-xl bg-gray-950 px-4 text-[10px] font-black uppercase tracking-widest text-white disabled:bg-gray-200 disabled:text-gray-400"
                    >
                      {scannerSubmitting ? <Loader2 size={14} className="animate-spin" /> : <ScanLine size={14} />}
                      Scan
                    </button>
                    {scannerResult?.requiresStaffConfirmation && !scannerResult.admitted && (
                      <button
                        type="button"
                        onClick={() => void scanTicket(true)}
                        disabled={scannerSubmitting || scannerCode.trim().length < 6}
                        className="flex h-10 items-center gap-2 rounded-xl bg-[#800000] px-4 text-[10px] font-black uppercase tracking-widest text-white disabled:bg-gray-200 disabled:text-gray-400"
                      >
                        Confirm re-entry
                      </button>
                    )}
                  </div>
                  {!selectedPortal.gateScanningEnabled && (
                    <p className="mt-3 text-xs font-black text-amber-700">Publish this event with gate scanning enabled before scanning tickets.</p>
                  )}
                  {scannerResult && (
                    <div className={`mt-4 rounded-xl px-4 py-3 text-xs font-black ${
                      scannerResult.admitted ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                    }`}>
                      {scannerResult.admitted ? 'Admitted' : 'Not admitted'} · {scannerResult.reason} · Scans: {scannerResult.scanCount}
                    </div>
                  )}
                </div>
              )}
              <label className="flex items-center gap-3 text-sm font-black text-gray-900">
                <input type="checkbox" checked={form.setupChecklist.staff} onChange={(event) => updateChecklist('staff', event.target.checked)} />
                Staff assignments are complete
              </label>
              <label className="flex items-center gap-3 text-sm font-black text-gray-900">
                <input type="checkbox" checked={form.setupChecklist.payments} onChange={(event) => updateChecklist('payments', event.target.checked)} />
                Payment routing is ready for future paid modules
              </label>
            </div>
          )}

          {step === 'publish' && (
            <div className="space-y-5">
              <h3 className="text-2xl font-black tracking-tight text-gray-950">Publish and QR</h3>
              <div className="rounded-2xl bg-gray-50 p-5">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Public URL</p>
                <p className="mt-2 break-all text-sm font-black text-gray-950">https://app.kandilo.org/e/{normalizePublicEventSlug(form.slug) ?? slugFromTitle(form.title) ?? 'valid-slug-required'}</p>
              </div>
              <label className="flex items-center justify-between rounded-2xl bg-gray-50 px-4 py-4 text-sm font-black text-gray-900">
                Make this the Featured Event
                <input type="checkbox" checked={form.focusEnabled} onChange={(event) => setForm({ ...form, focusEnabled: event.target.checked })} />
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <input type="datetime-local" value={form.focusStartsAt} onChange={(event) => setForm({ ...form, focusStartsAt: event.target.value })} className="rounded-2xl border-none bg-gray-50 px-4 py-4 text-sm font-bold" />
                <input type="datetime-local" value={form.focusEndsAt} onChange={(event) => setForm({ ...form, focusEndsAt: event.target.value })} className="rounded-2xl border-none bg-gray-50 px-4 py-4 text-sm font-bold" />
              </div>
              <button
                type="button"
                onClick={() => void save(true)}
                disabled={!readyForPublish || saving}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#800000] px-5 text-[10px] font-black uppercase tracking-widest text-white disabled:bg-gray-200 disabled:text-gray-400"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />}
                Publish event
              </button>
              {!readyForPublish && <p className="text-xs font-black text-red-500">Complete required setup sections before publishing.</p>}
            </div>
          )}

          {message && <p className="mt-6 text-xs font-black text-[#800000]">{message}</p>}
        </section>

        <aside className="rounded-[28px] bg-gray-950 p-6 text-white">
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#f2c66d]">Readiness</p>
          <p className="mt-2 text-4xl font-black tracking-tight">{checklistCompleteCount(form.setupChecklist)}/7</p>
          <p className="mt-2 text-sm font-medium text-white/50">Required setup areas completed.</p>
          <div className="mt-6 space-y-3">
            {Object.entries(form.setupChecklist).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between text-xs font-black uppercase tracking-widest">
                <span className="text-white/60">{key}</span>
                <span className={value ? 'text-green-300' : 'text-white/25'}>{value ? 'Ready' : 'Open'}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
