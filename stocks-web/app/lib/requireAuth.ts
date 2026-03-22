import { NextResponse } from 'next/server';
import { getAdminAuth } from './firebase-admin';

export type AuthResult =
  | { ok: true; uid: string }
  | { ok: false; response: NextResponse };

/**
 * Require Firebase ID token in Authorization: Bearer <token>.
 */
export async function requireUidFromRequest(request: Request): Promise<AuthResult> {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }),
    };
  }
  const token = header.slice(7).trim();
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }),
    };
  }
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    return { ok: true, uid: decoded.uid };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }),
    };
  }
}
