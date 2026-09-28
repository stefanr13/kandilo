const memory = new Map<string, OrderRequest>();
interface OrderRequest { requestId: string; complete: boolean }
const storageKey = (eventId: string) => `kandilo.foodOrder.${eventId}`;

export function lastFoodOrderRequest(eventId: string): OrderRequest | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey(eventId)) ?? 'null');
    if (value && typeof value.requestId === 'string' && typeof value.complete === 'boolean') return value;
  } catch { /* Storage can be unavailable in private browsing. */ }
  return memory.get(eventId) ?? null;
}

function save(eventId: string, value: OrderRequest): void {
  memory.set(eventId, value);
  try { sessionStorage.setItem(storageKey(eventId), JSON.stringify(value)); } catch { /* Keep this session usable. */ }
}

export function foodOrderRequest(eventId: string): string {
  const previous = lastFoodOrderRequest(eventId);
  // An ambiguous response must keep the same operation, even if a menu refresh
  // changes the cart. The server rejects changed input for an already saved order.
  if (previous && !previous.complete) return previous.requestId;
  const requestId = crypto.randomUUID();
  // Store only a receipt secret, never the customer's contact details.
  save(eventId, { requestId, complete: false });
  return requestId;
}

export function completeFoodOrderRequest(eventId: string, requestId: string): void {
  const previous = lastFoodOrderRequest(eventId);
  if (previous?.requestId === requestId) save(eventId, { ...previous, complete: true });
}
