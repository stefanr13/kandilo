import type { FirestoreGivingRecord } from '../db/giving';

const PARTIAL_REFUND_STATUS = 'partially_refunded';

function originalAmountCents(record: FirestoreGivingRecord): number {
  return Number.isInteger(record.amountCents) && record.amountCents > 0 ? record.amountCents : 0;
}

function refundedAmountCents(record: FirestoreGivingRecord): number {
  return Number.isFinite(record.stripeAmountRefundedCents) ? record.stripeAmountRefundedCents : 0;
}

export function givingHasPartialRefundSignal(record: FirestoreGivingRecord): boolean {
  return record.status === 'completed'
    && (
      record.stripeRefundStatus === PARTIAL_REFUND_STATUS
      || refundedAmountCents(record) > 0
    );
}

export function givingHasCorrectablePartialRefundMetadata(record: FirestoreGivingRecord): boolean {
  if (!givingHasPartialRefundSignal(record)) {
    return false;
  }

  const originalCents = originalAmountCents(record);
  const refundedCents = refundedAmountCents(record);
  return Number.isInteger(refundedCents)
    && originalCents > 0
    && refundedCents > 0
    && refundedCents < originalCents;
}
