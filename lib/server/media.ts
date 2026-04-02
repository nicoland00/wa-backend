import { getSignedDownloadUrl, uploadBufferToStorage } from "@/lib/storage";
import type { StoredMediaRef } from "@/lib/db/types";

export async function uploadFormFile(file: File | null | undefined) {
  if (!file) {
    return null;
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  return uploadBufferToStorage({
    filename: file.name,
    buffer,
    contentType: file.type || undefined,
  });
}

export async function resolveStoredMediaUrl(storage: StoredMediaRef | null | undefined) {
  if (!storage) {
    return null;
  }

  return getSignedDownloadUrl(storage);
}
