import { expect, it } from 'vitest';
import { completeFoodOrderRequest, foodOrderRequest } from './foodOrderSession';

it('keeps one order identity synchronously until confirmation, independent of cart changes', () => {
  const eventId = crypto.randomUUID();
  const original = foodOrderRequest(eventId);
  expect(foodOrderRequest(eventId)).toBe(original);
  completeFoodOrderRequest(eventId, original);
  expect(foodOrderRequest(eventId)).not.toBe(original);
});
