import { getAdminFirestore, getAdminStorageBucket } from '@/app/lib/firebase-admin';
import {
  POSITION_THESIS_FIRESTORE_COLLECTION,
  POSITION_THESIS_CHAT_SCOPE,
  type ChatTranscriptFileV1,
  type PersistedChatMessage,
  buildTranscriptFile,
  coercePersistedChatMessages,
} from '@/app/lib/types/chatTranscript';

function storageObjectPath(uid: string, thesisDocId: string): string {
  const safeId = thesisDocId.replace(/\//g, '_');
  return `user_chats/${uid}/${POSITION_THESIS_CHAT_SCOPE}/${safeId}.json`;
}

export async function assertPositionThesisOwnedByUid(
  thesisDocId: string,
  uid: string
): Promise<boolean> {
  const db = getAdminFirestore();
  const snap = await db.collection(POSITION_THESIS_FIRESTORE_COLLECTION).doc(thesisDocId).get();
  if (!snap.exists) return false;
  const data = snap.data();
  return data?.userId === uid;
}

export async function readPositionThesisChatTranscript(
  uid: string,
  thesisDocId: string
): Promise<PersistedChatMessage[]> {
  const bucket = getAdminStorageBucket();
  const file = bucket.file(storageObjectPath(uid, thesisDocId));
  const [exists] = await file.exists();
  if (!exists) return [];
  const [buf] = await file.download();
  let parsed: unknown;
  try {
    parsed = JSON.parse(buf.toString('utf8'));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const messages = (parsed as { messages?: unknown }).messages;
  const coerced = coercePersistedChatMessages(messages);
  return coerced ?? [];
}

export async function writePositionThesisChatTranscript(
  uid: string,
  thesisDocId: string,
  messages: PersistedChatMessage[]
): Promise<void> {
  const bucket = getAdminStorageBucket();
  const file = bucket.file(storageObjectPath(uid, thesisDocId));
  const body: ChatTranscriptFileV1 = buildTranscriptFile(messages);
  await file.save(JSON.stringify(body), {
    contentType: 'application/json; charset=utf-8',
    resumable: false,
  });
}
