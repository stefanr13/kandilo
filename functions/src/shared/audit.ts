import { FieldValue } from 'firebase-admin/firestore';
import { db } from './firebase';
import { sanitizedErrorContext } from './logging';

export async function logAuditEvent(
  actorUid: string,
  action: string,
  details: Record<string, unknown>
): Promise<void> {
  try {
    await db.collection('platformAuditLog').add({
      actorUid,
      action,
      details,
      timestamp: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('Audit log write failed:', sanitizedErrorContext(err));
  }
}
