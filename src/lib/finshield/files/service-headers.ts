import "server-only";

/** 새 Supabase secret은 JWT가 아니므로 API gateway의 apikey로만 보낸다. */
export function storageServiceHeaders(key: string): Record<string, string> {
  if (key.startsWith("sb_publishable_")) throw new Error("STORAGE_SERVICE_KEY_REQUIRED");
  return key.startsWith("sb_secret_")
    ? { apikey: key }
    : { apikey: key, Authorization: `Bearer ${key}` };
}
