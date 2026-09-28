import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  CalendarDays,
  Clock,
  Heart,
  Info,
  MapPin,
  QrCode,
  Ticket,
  Utensils,
} from 'lucide-react';
import { useEventPortal } from '../../hooks/useEventPortal';
import { getEventFoodOrder, submitEventFoodOrder, type CustomerFoodOrder } from '../../lib/api/eventPlatform';
import { completeFoodOrderRequest, foodOrderRequest, lastFoodOrderRequest } from '../../lib/eventPlatform/foodOrderSession';
import type {
  EventMenuItem,
  EventPerformer,
  EventScheduleItem,
  EventTicketTier,
  EventAnnouncement,
} from '../../lib/eventPlatform/model';

interface EventPortalScreenProps {
  slug: string;
  onBackToChurch?: () => void;
  showBackToChurch?: boolean;
}

const currencyFormatter = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
});

function formatCents(cents: number, currency = 'CAD'): string {
  if (currency === 'CAD') {
    return currencyFormatter.format(cents / 100);
  }
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(cents / 100);
}

function scheduleState(item: EventScheduleItem, now: Date): 'past' | 'now' | 'next' {
  if (item.startTime <= now && item.endTime >= now) {
    return 'now';
  }
  return item.endTime < now ? 'past' : 'next';
}

function performerNames(item: EventScheduleItem, performers: EventPerformer[]): string {
  const names = item.performerIds
    .map((id) => performers.find((performer) => performer.id === id)?.name)
    .filter(Boolean);
  return names.length > 0 ? names.join(', ') : item.stage || item.location || 'Festival program';
}

function TicketTierRow({ tier }: { tier: EventTicketTier }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-4 border-b border-white/10 py-4 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-black text-white">{tier.name}</p>
        <p className="mt-1 line-clamp-2 text-xs font-medium text-white/60">{tier.description || 'General admission'}</p>
      </div>
      <span className="flex h-11 items-center rounded-xl bg-white px-4 text-[10px] font-black uppercase tracking-widest text-gray-950">
        {formatCents(tier.priceCents, tier.currency)}
      </span>
    </div>
  );
}

function ScheduleRow({
  item,
  performers,
  selected,
  onSelect,
}: {
  item: EventScheduleItem;
  performers: EventPerformer[];
  selected: boolean;
  onSelect: () => void;
}) {
  const state = scheduleState(item, new Date());
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full grid grid-cols-[72px_1fr] gap-4 border-b border-gray-100 py-4 text-left last:border-b-0 ${
        state === 'past' ? 'opacity-45' : ''
      }`}
    >
      <div>
        <p className="text-xs font-black text-gray-900">
          {item.startTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </p>
        <p className="mt-1 text-[9px] font-black uppercase tracking-widest text-[#937022]">
          {state === 'now' ? 'Now' : state === 'past' ? 'Done' : 'Next'}
        </p>
      </div>
      <div className={`min-w-0 border-l-2 pl-4 ${selected ? 'border-[#800000]' : 'border-gray-100'}`}>
        <p className="truncate text-sm font-black text-gray-950">{item.title}</p>
        <p className="mt-1 truncate text-xs font-bold text-gray-400">{performerNames(item, performers)}</p>
      </div>
    </button>
  );
}

function MenuSection({
  items,
  orderingEnabled,
  quantities,
  onChangeQuantity,
}: {
  items: EventMenuItem[];
  orderingEnabled: boolean;
  quantities: Record<string, number>;
  onChangeQuantity: (item: EventMenuItem, quantity: number) => void;
}) {
  const grouped = useMemo(() => {
    const groups = new Map<string, EventMenuItem[]>();
    items.forEach((item) => {
      groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
    });
    return Array.from(groups.entries());
  }, [items]);

  return (
    <div className="space-y-6">
      {grouped.map(([category, categoryItems]) => (
        <section key={category}>
          <h3 className="text-[10px] font-black uppercase tracking-[0.24em] text-[#937022]">{category}</h3>
          <div className="mt-3 divide-y divide-gray-100">
            {categoryItems.map((item) => {
              const quantityRemaining = item.inventoryMode === 'tracked' ? item.quantityAvailable ?? 0 : null;
              const soldOut = item.soldOut || quantityRemaining === 0;
              const maxSelectable = Math.min(item.maxPerOrder, quantityRemaining ?? item.maxPerOrder);
              return (
                <div key={item.id} className="grid grid-cols-[1fr_auto] gap-4 py-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-black text-gray-950">{item.name}</p>
                      {soldOut && (
                        <span className="rounded-full bg-red-50 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-red-700">
                          Sold out
                        </span>
                      )}
                      {quantityRemaining !== null && quantityRemaining > 0 && quantityRemaining <= 10 && (
                        <span className="rounded-full bg-amber-50 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-amber-700">
                          {quantityRemaining} left
                        </span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs font-medium text-gray-400">{item.description}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className="flex h-10 items-center rounded-xl bg-gray-950 px-4 text-[10px] font-black uppercase tracking-widest text-white">
                      {formatCents(item.priceCents, item.currency)}
                    </span>
                    {orderingEnabled && !soldOut && (
                      <div className="flex h-9 items-center overflow-hidden rounded-xl bg-gray-100">
                        <button
                          type="button"
                          onClick={() => onChangeQuantity(item, Math.max(0, (quantities[item.id] ?? 0) - 1))}
                          className="h-9 w-9 text-sm font-black text-gray-500 disabled:text-gray-300"
                          disabled={(quantities[item.id] ?? 0) === 0}
                          aria-label={`Remove one ${item.name}`}
                        >
                          -
                        </button>
                        <span className="w-8 text-center text-xs font-black text-gray-950">{quantities[item.id] ?? 0}</span>
                        <button
                          type="button"
                          onClick={() => onChangeQuantity(item, Math.min(maxSelectable, (quantities[item.id] ?? 0) + 1))}
                          className="h-9 w-9 text-sm font-black text-gray-950 disabled:text-gray-300"
                          disabled={(quantities[item.id] ?? 0) >= maxSelectable}
                          aria-label={`Add one ${item.name}`}
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function AnnouncementStrip({ announcements }: { announcements: EventAnnouncement[] }) {
  if (announcements.length === 0) {
    return null;
  }
  const latest = announcements[0];
  const style = latest.priority === 'urgent'
    ? 'bg-[#800000] text-white'
    : latest.priority === 'offer'
      ? 'bg-[#937022] text-white'
      : 'bg-gray-950 text-white';
  return (
    <section className={`${style} px-5 py-4 lg:px-8`}>
      <div className="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] opacity-70">
            {latest.priority === 'urgent' ? 'Urgent announcement' : latest.priority === 'offer' ? 'Event offer' : 'Event update'}
          </p>
          <h2 className="mt-1 break-words text-lg font-black tracking-tight">{latest.title}</h2>
          <p className="mt-1 break-words text-sm font-semibold opacity-75">{latest.body}</p>
        </div>
        {announcements.length > 1 && (
          <span className="text-[10px] font-black uppercase tracking-widest opacity-60">
            {announcements.length} updates
          </span>
        )}
      </div>
    </section>
  );
}

export default function EventPortalScreen({
  slug,
  onBackToChurch,
  showBackToChurch = false,
}: EventPortalScreenProps) {
  const { portal, ticketTiers, scheduleItems, performers, menuItems, campaigns, announcements, loading, error } = useEventPortal(slug);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const [menuQuantities, setMenuQuantities] = useState<Record<string, number>>({});
  const [orderForm, setOrderForm] = useState({
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    specialInstructions: '',
  });
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [orderMessage, setOrderMessage] = useState('');
  const [lastOrderCode, setLastOrderCode] = useState('');
  const [receiptRequestId, setReceiptRequestId] = useState(() => lastFoodOrderRequest(slug)?.requestId ?? '');
  const [customerOrder, setCustomerOrder] = useState<CustomerFoodOrder | null>(null);
  const confirmOrder = useCallback((eventId: string, requestId: string, order: CustomerFoodOrder) => {
    setCustomerOrder(order);
    if (lastFoodOrderRequest(eventId)?.requestId === requestId && !lastFoodOrderRequest(eventId)?.complete) {
      completeFoodOrderRequest(eventId, requestId);
      setMenuQuantities({});
      setOrderForm({ customerName: '', customerEmail: '', customerPhone: '', specialInstructions: '' });
      setLastOrderCode(order.orderCode);
      setOrderMessage(`Order ${order.orderCode} was received. Check its status below.`);
    }
  }, []);
  useEffect(() => {
    setReceiptRequestId(lastFoodOrderRequest(slug)?.requestId ?? '');
    setCustomerOrder(null);
    setMenuQuantities({});
    setOrderMessage('');
    setLastOrderCode('');
  }, [slug]);
  useEffect(() => {
    if (!receiptRequestId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const { order } = await getEventFoodOrder(slug, receiptRequestId);
        if (!stopped && order) confirmOrder(slug, receiptRequestId, order);
      } catch (error) { console.warn('Order status is temporarily unavailable:', error); }
      finally { if (!stopped) timer = setTimeout(refresh, 15_000); }
    };
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [slug, receiptRequestId, confirmOrder]);
  const selectedScheduleItem =
    scheduleItems.find((item) => item.id === selectedScheduleId)
    ?? scheduleItems.find((item) => scheduleState(item, new Date()) === 'now')
    ?? scheduleItems[0]
    ?? null;
  const cartItems = useMemo(() => menuItems
    .map((item) => {
      const quantityRemaining = item.inventoryMode === 'tracked' ? item.quantityAvailable ?? 0 : null;
      const maxSelectable = Math.min(item.maxPerOrder, quantityRemaining ?? item.maxPerOrder);
      return {
        item,
        quantity: Math.min(menuQuantities[item.id] ?? 0, maxSelectable),
        soldOut: item.soldOut || quantityRemaining === 0,
      };
    })
    .filter((entry) => entry.quantity > 0 && !entry.soldOut), [menuItems, menuQuantities]);
  const cartTotalCents = cartItems.reduce((sum, entry) => sum + entry.item.priceCents * entry.quantity, 0);
  const cartCurrency = cartItems[0]?.item.currency ?? 'CAD';

  const changeMenuQuantity = (item: EventMenuItem, quantity: number) => {
    setOrderMessage('');
    setLastOrderCode('');
    setMenuQuantities((current) => {
      const next = { ...current };
      const quantityRemaining = item.inventoryMode === 'tracked' ? item.quantityAvailable ?? 0 : null;
      const maxSelectable = Math.min(item.maxPerOrder, quantityRemaining ?? item.maxPerOrder);
      const safeQuantity = item.soldOut || quantityRemaining === 0 ? 0 : Math.max(0, Math.min(maxSelectable, quantity));
      if (safeQuantity === 0) {
        delete next[item.id];
      } else {
        next[item.id] = safeQuantity;
      }
      return next;
    });
  };

  const submitFoodOrder = async () => {
    if (!portal || !portal.foodOrderingEnabled || orderSubmitting || cartItems.length === 0) {
      return;
    }
    if (!orderForm.customerName.trim() || (!orderForm.customerEmail.trim() && !orderForm.customerPhone.trim())) {
      setOrderMessage('Enter your name and an email or phone number so staff can contact you about pickup.');
      return;
    }

    setOrderSubmitting(true);
    setOrderMessage('');
    setLastOrderCode('');
    let requestId = '';
    try {
      const input = {
        eventId: portal.id,
        customerName: orderForm.customerName.trim(),
        customerEmail: orderForm.customerEmail.trim(),
        customerPhone: orderForm.customerPhone.trim(),
        specialInstructions: orderForm.specialInstructions.trim(),
        items: cartItems.map((entry) => ({
          menuItemId: entry.item.id,
          quantity: entry.quantity,
        })).sort((a, b) => a.menuItemId.localeCompare(b.menuItemId)),
      };
      requestId = foodOrderRequest(portal.id);
      setReceiptRequestId(requestId);
      const result = await submitEventFoodOrder({ ...input, requestId });
      confirmOrder(portal.id, requestId, result);
      setLastOrderCode(result.orderCode);
      setOrderMessage(
        result.paymentStatus === 'pay_at_pickup' && result.status !== 'cancelled'
          ? `Order ${result.orderCode} was sent. Pay ${formatCents(result.totalCents, result.currency)} at pickup.`
          : `Order ${result.orderCode} was sent.`
      );
    } catch (submitError) {
      console.error('Failed to submit event food order:', submitError);
      if (requestId) {
        const recovered = await getEventFoodOrder(portal.id, requestId).catch(() => null);
        if (recovered?.order) {
          confirmOrder(portal.id, requestId, recovered.order);
          return;
        }
      }
      setOrderMessage(submitError instanceof Error && submitError.message
        ? submitError.message
        : 'Unable to submit this order right now. Please try again at the event counter.');
    } finally {
      setOrderSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
        <p className="text-xs font-black uppercase tracking-[0.3em] text-white/50">Loading event</p>
      </div>
    );
  }

  if (error || !portal) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-8 text-center">
        <div>
          <Info className="mx-auto text-gray-300" size={40} />
          <h1 className="mt-4 text-2xl font-black tracking-tight text-gray-950">Event unavailable</h1>
          <p className="mt-2 max-w-sm text-sm font-medium text-gray-400">{error || 'This event is not published.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f3ee] text-gray-950">
      <section className="relative min-h-[78vh] overflow-hidden bg-gray-950 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(147,112,34,0.55),transparent_35%),linear-gradient(135deg,#320909,#111827_60%,#171717)]" />
        {portal.heroImageURL && (
          <img
            src={portal.heroImageURL}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-70"
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/45 to-gray-950/15" />

        <div className="relative z-10 flex min-h-[78vh] flex-col justify-between px-6 py-6 lg:px-12">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {showBackToChurch && (
                <button
                  type="button"
                  onClick={onBackToChurch}
                  className="flex h-11 items-center gap-2 rounded-xl bg-white/10 px-4 text-[10px] font-black uppercase tracking-widest text-white backdrop-blur transition-colors hover:bg-white/20"
                >
                  <ArrowLeft size={16} />
                  Church
                </button>
              )}
              <span className="rounded-xl bg-white/10 px-4 py-3 text-[10px] font-black uppercase tracking-[0.24em] text-white/75 backdrop-blur">
                Kandilo Events
              </span>
            </div>
            <div className="hidden items-center gap-2 rounded-xl bg-white/10 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white/75 backdrop-blur sm:flex">
              <QrCode size={15} />
              {portal.slug}
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="max-w-3xl pb-8"
          >
            <p className="mb-4 flex items-center gap-2 text-xs font-black uppercase tracking-[0.26em] text-[#f2c66d]">
              <CalendarDays size={16} />
              {portal.startsAt.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
            <h1 className="max-w-4xl text-5xl font-black leading-none tracking-tight sm:text-7xl lg:text-8xl">
              {portal.title}
            </h1>
            <p className="mt-6 max-w-2xl text-base font-semibold leading-relaxed text-white/75">
              {portal.description}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {portal.ticketsEnabled && (
                <a href="#tickets" className="rounded-2xl bg-white px-5 py-4 text-[10px] font-black uppercase tracking-widest text-gray-950">
                  Entry Tickets
                </a>
              )}
              {portal.foodDrinkEnabled && (
                <a href="#food" className="rounded-2xl bg-[#800000] px-5 py-4 text-[10px] font-black uppercase tracking-widest text-white">
                  Food & Drink
                </a>
              )}
            </div>
          </motion.div>
        </div>
      </section>

      <AnnouncementStrip announcements={announcements} />

      <main className="mx-auto grid max-w-7xl gap-8 px-5 py-8 lg:grid-cols-[1.15fr_0.85fr] lg:px-8">
        <div className="space-y-8">
          {portal.ticketsEnabled && (
            <section id="tickets" className="overflow-hidden rounded-[28px] bg-gray-950 p-6 text-white lg:p-8">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#f2c66d]">Entry</p>
                  <h2 className="mt-2 text-2xl font-black tracking-tight">Ticket information</h2>
                </div>
                <Ticket size={28} className="text-white/50" />
              </div>
              {ticketTiers.length > 0 ? ticketTiers.map((tier) => <TicketTierRow key={tier.id} tier={tier} />) : (
                <p className="py-8 text-sm font-bold text-white/50">Ticket tiers will appear here when sales open.</p>
              )}
              <p className="mt-5 text-xs font-semibold text-white/45">
                Ticket purchase, QR delivery, wallet passes, and scanner validation are not available from this page yet.
              </p>
            </section>
          )}

          <section id="schedule" className="rounded-[28px] bg-white p-6 lg:p-8">
            <div className="mb-5 flex items-center gap-3">
              <Clock className="text-[#800000]" size={24} />
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#937022]">Program</p>
                <h2 className="text-2xl font-black tracking-tight">Schedule</h2>
              </div>
            </div>
            {scheduleItems.length > 0 ? (
              <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
                <div>
                  {scheduleItems.map((item) => (
                    <ScheduleRow
                      key={item.id}
                      item={item}
                      performers={performers}
                      selected={selectedScheduleItem?.id === item.id}
                      onSelect={() => setSelectedScheduleId(item.id)}
                    />
                  ))}
                </div>
                {selectedScheduleItem && (
                  <div className="rounded-2xl bg-gray-50 p-5">
                    {selectedScheduleItem.imageURL && (
                      <img
                        src={selectedScheduleItem.imageURL}
                        alt=""
                        className="mb-5 aspect-[16/9] w-full rounded-2xl object-cover"
                        onError={(event) => {
                          event.currentTarget.style.display = 'none';
                        }}
                      />
                    )}
                    <h3 className="text-xl font-black tracking-tight">{selectedScheduleItem.title}</h3>
                    <p className="mt-2 text-sm font-bold text-[#937022]">{performerNames(selectedScheduleItem, performers)}</p>
                    <p className="mt-4 text-sm font-medium leading-relaxed text-gray-500">{selectedScheduleItem.description}</p>
                    <p className="mt-4 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-400">
                      <MapPin size={14} />
                      {selectedScheduleItem.stage || selectedScheduleItem.location || portal.venueName}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="py-8 text-sm font-bold text-gray-400">The public schedule has not been published yet.</p>
            )}
          </section>
        </div>

        <aside className="space-y-8">
          {portal.foodDrinkEnabled && (
            <section id="food" className="rounded-[28px] bg-white p-6 lg:p-8">
              <div className="mb-5 flex items-center gap-3">
                <Utensils className="text-[#800000]" size={24} />
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#937022]">
                    {portal.foodOrderingEnabled ? 'Order ahead' : 'Menu'}
                  </p>
                  <h2 className="text-2xl font-black tracking-tight">Food & drink</h2>
                </div>
              </div>
              {menuItems.length > 0 ? (
                <MenuSection
                  items={menuItems}
                  orderingEnabled={portal.foodOrderingEnabled}
                  quantities={menuQuantities}
                  onChangeQuantity={changeMenuQuantity}
                />
              ) : (
                <p className="py-8 text-sm font-bold text-gray-400">Food and drink information will appear when the menu is published.</p>
              )}
              {portal.foodOrderingEnabled ? (
                <div className="mt-6 rounded-2xl bg-gray-50 p-5">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm font-black text-gray-950">Pickup order</p>
                    <p className="text-sm font-black text-gray-950">{formatCents(cartTotalCents, cartCurrency)}</p>
                  </div>
                  {customerOrder && (
                    <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-900" role="status">
                      <p className="font-bold">Order {customerOrder.orderCode}: {customerOrder.status.replaceAll('_', ' ')}</p>
                      <p>{formatCents(customerOrder.totalCents, customerOrder.currency)} · {customerOrder.paymentStatus.replaceAll('_', ' ')}</p>
                      <p className="mt-1 text-xs">Keep this page or save your order code for pickup.</p>
                    </div>
                  )}
                  {cartItems.length > 0 ? (
                    <div className="mt-4 space-y-2">
                      {cartItems.map(({ item, quantity }) => (
                        <div key={item.id} className="flex items-center justify-between gap-3 text-xs font-bold text-gray-500">
                          <span>{quantity}x {item.name}</span>
                          <span>{formatCents(item.priceCents * quantity, item.currency)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-4 text-xs font-bold text-gray-400">Add menu items to start an order.</p>
                  )}
                  <div className="mt-5 grid gap-3">
                    <input aria-label="Name for pickup" maxLength={120} value={orderForm.customerName} onChange={(event) => setOrderForm({ ...orderForm, customerName: event.target.value })} placeholder="Name for pickup" className="rounded-xl border-none bg-white px-4 py-3 text-xs font-bold" />
                    <input aria-label="Email" maxLength={254} value={orderForm.customerEmail} onChange={(event) => setOrderForm({ ...orderForm, customerEmail: event.target.value })} placeholder="Email" inputMode="email" className="rounded-xl border-none bg-white px-4 py-3 text-xs font-bold" />
                    <input aria-label="Phone" maxLength={40} value={orderForm.customerPhone} onChange={(event) => setOrderForm({ ...orderForm, customerPhone: event.target.value })} placeholder="Phone" inputMode="tel" className="rounded-xl border-none bg-white px-4 py-3 text-xs font-bold" />
                    <textarea aria-label="Pickup notes" maxLength={500} value={orderForm.specialInstructions} onChange={(event) => setOrderForm({ ...orderForm, specialInstructions: event.target.value })} placeholder="Pickup notes" rows={3} className="rounded-xl border-none bg-white px-4 py-3 text-xs font-bold" />
                  </div>
                  <button
                    type="button"
                    onClick={() => void submitFoodOrder()}
                    disabled={orderSubmitting || cartItems.length === 0}
                    className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-[#800000] px-4 text-[10px] font-black uppercase tracking-widest text-white disabled:bg-gray-200 disabled:text-gray-400"
                  >
                    {orderSubmitting ? 'Sending order' : 'Submit pickup order'}
                  </button>
                  {orderMessage && (
                    <p className={`mt-3 text-xs font-black ${lastOrderCode ? 'text-green-700' : 'text-[#800000]'}`}>
                      {orderMessage}
                    </p>
                  )}
                  <p className="mt-3 text-[11px] font-bold leading-relaxed text-gray-400">
                    Payment is collected at pickup. Online card checkout is not connected for this event yet.
                  </p>
                </div>
              ) : (
                <p className="mt-6 rounded-2xl bg-gray-50 px-5 py-4 text-xs font-bold text-gray-400">
                  Online ordering is not available yet.
                </p>
              )}
            </section>
          )}

          {portal.campaignsEnabled && (
            <section className="rounded-[28px] bg-white p-6 lg:p-8">
              <div className="mb-5 flex items-center gap-3">
                <Heart className="text-[#800000]" size={24} />
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#937022]">Support</p>
                  <h2 className="text-2xl font-black tracking-tight">Event campaigns</h2>
                </div>
              </div>
              {campaigns.length > 0 ? campaigns.map((campaign) => (
                <div key={campaign.id} className="border-b border-gray-100 py-4 last:border-b-0">
                  <p className="text-sm font-black text-gray-950">{campaign.title}</p>
                  <p className="mt-1 text-xs font-medium text-gray-400">{campaign.description}</p>
                  <span className="mt-3 inline-flex rounded-xl bg-gray-950 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-white">
                    {formatCents(campaign.suggestedAmountCents)}
                  </span>
                </div>
              )) : (
                <p className="py-8 text-sm font-bold text-gray-400">Donation campaigns will appear here when published.</p>
              )}
              <p className="mt-5 text-xs font-semibold leading-relaxed text-gray-400">
                Online campaign checkout is not connected from this page yet.
              </p>
            </section>
          )}

          <section className="rounded-[28px] bg-white p-6 lg:p-8">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-[#937022]">Venue</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight">{portal.venueName || 'Event venue'}</h2>
            <p className="mt-3 text-sm font-medium leading-relaxed text-gray-500">{portal.venueAddress}</p>
          </section>
        </aside>
      </main>
    </div>
  );
}
