import packageJson from "@/package";
import { PRIVATE_SYNC_PROTOCOL_VERSION } from "@tagify/sync-contracts";
const CLIENT_VERSION = packageJson.version;
const SYNC_CLIENT_GENERATION = "event-driven-v1";
export function syncClientHeaders(accessToken?: string): Record<string, string> {
  return {
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    "x-tagify-client-version": CLIENT_VERSION,
    "x-tagify-sync-protocol": String(PRIVATE_SYNC_PROTOCOL_VERSION),
    "x-tagify-sync-generation": SYNC_CLIENT_GENERATION,
  };
}
