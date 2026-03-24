import { getAdminFirestore } from '@/app/lib/firebase-admin';
import { coercePositionThesisPayload } from '@/app/lib/services/positionThesisService';
import type { PositionThesisPayload } from '@/app/lib/types/positionThesis';

/**
 * Read position thesis payload via Admin SDK. Verifies `userId` matches `ownerUserId`.
 */
export async function loadPositionThesisPayloadAdmin(
  thesisDocId: string,
  ownerUserId: string
): Promise<PositionThesisPayload | null> {
  const db = getAdminFirestore();
  const snap = await db.collection('position_theses').doc(thesisDocId.trim()).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (!data || data.userId !== ownerUserId) return null;
  const raw = data.payload;
  const ticker = typeof data.ticker === 'string' ? data.ticker : '';
  if (!raw || typeof raw !== 'object') return null;
  return coercePositionThesisPayload(raw, ticker || 'UNKNOWN');
}
