import { getAdminStorageBucket } from '@/app/lib/firebase-admin';

export interface AnnualPriceFile {
  data?: Record<string, { c: number; o?: number; h?: number; l?: number; v?: number }>;
}

/** Read annual price JSON via Admin SDK (latest object generation, not stale public URL). */
export async function downloadAnnualPriceJson(storageRef: string): Promise<AnnualPriceFile> {
  const bucket = getAdminStorageBucket();
  const [contents] = await bucket.file(storageRef).download();
  return JSON.parse(contents.toString('utf-8')) as AnnualPriceFile;
}
