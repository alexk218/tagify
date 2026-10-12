import { spotifyAccountKey } from "./SpotifyRequests";
import { getTagifyDatabaseName } from "./sync/SyncLocalState";

const shared = globalThis as typeof globalThis & { __tagifyPlaylistAdditionBatchesV1?: WeakSet<object> };
const ownBatches = shared.__tagifyPlaylistAdditionBatchesV1 ??= new WeakSet<object>();
export const isTagifyPlaylistAddition = (items: unknown): boolean => typeof items === "object" && items !== null && ownBatches.has(items);

/** Keep ambiguous additions until a settled Spotify read has been saved. */
function prefix(playlistId: string): string {
  return `tagify:playlist-additions:v1:${encodeURIComponent(JSON.stringify([spotifyAccountKey(), getTagifyDatabaseName(), playlistId]))}:`;
}

export function rememberPlaylistAdditions(playlistId: string, uris: string[]): void {
  // Each batch has its own entry: a large update never rewrites a growing list.
  try {
    localStorage.setItem(`${prefix(playlistId)}${crypto.randomUUID()}`, JSON.stringify(uris));
    ownBatches.add(uris);
  } catch {
    throw Object.assign(new Error("Your playlist update could not be saved for recovery. Free some storage and try again."), { spotifyRequestStopped: true });
  }
}

export function readPlaylistAdditionOrigins(playlistId: string) {
  const scope = prefix(playlistId);
  const entries: { key: string; uris: string[] }[] = [];
  const uris = new Set<string>();
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(scope)) continue;
    const values: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!Array.isArray(values) || values.some(uri => typeof uri !== "string")) {
      throw new Error("Your playlist update could not be recovered. Please restart Spotify and try again.");
    }
    entries.push({ key, uris: values as string[] });
    values.forEach(uri => uris.add(uri));
  }
  return {
    uris,
    acknowledge: (confirmed?: ReadonlySet<string>) => entries.forEach(entry => {
      if (!confirmed || entry.uris.every(uri => confirmed.has(uri))) localStorage.removeItem(entry.key);
    }),
  };
}
