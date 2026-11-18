import {
  SMART_PLAYLIST_NAME_MAX,
  SMART_PLAYLISTS_PROTOCOL_VERSION,
  type SmartPlaylistInputV1,
  type SmartPlaylistListV1,
  type SmartPlaylistV1,
} from "@tagify/sync-contracts";
import type { SmartPlaylistCriteria, SmartPlaylistFilterCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import { normalizeSmartPlaylistCriteriaList } from "@/features/tag-data";

// Smart playlists are one list for Tagify desktop and Community (contract @tagify/sync-contracts
// smartPlaylists; tagify-community docs/SMART_PLAYLIST_SYNC_HANDOFF_2026-11-16.md). Alex, 2026-11-16:
// "Do smart playlists created on desktop propagate to the community library? they should. and vice
// versa." Then "all A": Community's list is the only list and Tagify reads and writes it through
// sync; existing desktop smart playlists move in once, each keeping the Spotify playlist it fills;
// every rule is kept on both sides, and an app that can't edit a rule says "Edit on Community".
//
// Tagify keeps its local list (IndexedDB, and the `smart-playlists` app-state document) as the copy
// it fills Spotify from and as the fallback for older servers, a paused feature or no connection.
// When Community advertises `smartPlaylists`, each run:
//   1. reads Community's list, and moves the local list in once (`moved` false);
//   2. sends local changes made since the last run (create, update, delete), and takes Community's
//      changes into the local list. Each playlist remembers the Community id and `updatedAt` it last
//      saw and a fingerprint of the fields both sides share, so a run knows which side changed;
//   3. keeps the playlists Tagify can't evaluate or edit (everyone's tags, one person's tag, or rules
//      only Community has) as a read-only list the Smart Playlists window shows with "Edit on Community".
//      Community fills their Spotify playlists itself through playlist writes.
// One writer per Spotify playlist: Tagify fills the playlists in its local list; when Community's
// "Keep in Spotify" asks to write one of them, PlaylistWriteRunner leaves it to Tagify's own fill.

export interface SmartPlaylistsCapability {
  path: string;
  movePath: string;
}

const SYNC_PATH = /^\/api\/v2\/sync\/[a-z/-]+$/;

/** Community's `smartPlaylists` capability when it speaks this protocol; null otherwise. */
export function smartPlaylistsCapability(capabilities: unknown): SmartPlaylistsCapability | null {
  const value = (capabilities as { smartPlaylists?: Record<string, unknown> } | null)?.smartPlaylists;
  if (!value || value.protocolVersion !== SMART_PLAYLISTS_PROTOCOL_VERSION) return null;
  if (typeof value.path !== "string" || !SYNC_PATH.test(value.path)) return null;
  if (typeof value.movePath !== "string" || !SYNC_PATH.test(value.movePath)) return null;
  return { path: value.path, movePath: value.movePath };
}

/** A Community playlist Tagify shows but can't change. */
export interface CommunityOnlySmartPlaylist {
  id: string;
  name: string;
  description: string;
  source: SmartPlaylistV1["source"];
  origin: SmartPlaylistV1["origin"];
  spotifyPlaylistId: string | null;
  trackCount: number;
  createdAt: string;
  /** Community's rules as it describes them (read-only). */
  rules: Record<string, unknown>;
}

export interface SmartPlaylistLink {
  communityId: string;
  updatedAt: string;
  /** Fingerprint of the shared fields as they were when both sides last agreed. */
  shared: string;
}

export const SMART_PLAYLIST_LINKS_STATE_KEY = "smart-playlist-links";

/** Kept in the account's sync state: which local playlist is which Community playlist. */
export interface SmartPlaylistLinksRecord {
  key: typeof SMART_PLAYLIST_LINKS_STATE_KEY;
  libraryId: string;
  /** By local playlist id. */
  links: Record<string, SmartPlaylistLink>;
}

export type SmartPlaylistListOutcome = "unsupported" | "paused" | "done" | "failed";

export interface CommunityAnswer {
  status: number;
  body: unknown;
}

export interface SmartPlaylistListContext {
  capability: SmartPlaylistsCapability | null;
  libraryId: string;
  deviceId: string;
  /** One Community request; resolves with any answer, rejects only when Community couldn't be reached. */
  call(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<CommunityAnswer>;
  loadLocal(): Promise<SmartPlaylistCriteria[]>;
  /** Changes the local list in one transaction and tells the app; returns the saved list. */
  updateLocal(updater: (current: SmartPlaylistCriteria[]) => SmartPlaylistCriteria[]): Promise<SmartPlaylistCriteria[]>;
  getRecord(): Promise<SmartPlaylistLinksRecord | undefined>;
  putRecord(record: SmartPlaylistLinksRecord): Promise<void>;
  /** The playlists Community fills, shown in the list; called after every successful read. */
  showCommunityOnly(playlists: CommunityOnlySmartPlaylist[]): void;
  /** Community-filled playlists whose tracking the member removed in Tagify, still to delete on Community. */
  pendingRemovals?(): string[];
  /** Those removals are done (deleted, or already gone). */
  removalsSent?(ids: string[]): void;
  now?: () => number;
}

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const DESKTOP_ID = /^[A-Za-z0-9:_.-]{1,128}$/;
/** SmartPlaylistCriteria fields that are Tagify's own bookkeeping on this computer, never sent. */
const LOCAL_ONLY_FIELDS = new Set(["id", "playlistId", "playlistName", "description", "criteria", "isActive", "createdAt", "updatedAt",
  "lastSyncAt", "smartPlaylistTrackUris", "pendingTagChoices"]);

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function tidyName(name: string): string {
  const tidy = name.trim().replace(/\s+/g, " ").slice(0, SMART_PLAYLIST_NAME_MAX).trim();
  return tidy || "Smart playlist";
}

/** The playlist as Tagify sends it to Community. */
export function sharedPlaylist(playlist: SmartPlaylistCriteria): SmartPlaylistInputV1 {
  const extras = Object.fromEntries(Object.entries(playlist).filter(([key, value]) => !LOCAL_ONLY_FIELDS.has(key) && value !== undefined));
  return {
    desktopId: playlist.id && DESKTOP_ID.test(playlist.id) ? playlist.id : null,
    name: tidyName(playlist.playlistName),
    description: playlist.description ?? "",
    criteria: playlist.criteria as SmartPlaylistInputV1["criteria"],
    extras,
    active: playlist.isActive,
    spotifyPlaylistId: SPOTIFY_ID.test(playlist.playlistId) ? playlist.playlistId : null,
  };
}

/** Fingerprint of what both sides share; a different value means the local playlist changed. */
export function sharedFingerprint(playlist: SmartPlaylistCriteria): string {
  // Compared as every saved playlist is stored, so a filled-in default isn't a change.
  return stableStringify(sharedPlaylist(normalizeSmartPlaylistCriteriaList([playlist])[0] ?? playlist));
}

/** Whether Tagify keeps this Community playlist in its own list (it can evaluate and edit every rule). */
export function isDesktopPlaylist(playlist: SmartPlaylistV1): boolean {
  return playlist.source === "library" && playlist.desktopEditable && !!playlist.criteria && typeof playlist.criteria === "object";
}

function communityOnly(playlist: SmartPlaylistV1): CommunityOnlySmartPlaylist {
  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description ?? "",
    source: playlist.source,
    origin: playlist.origin,
    spotifyPlaylistId: playlist.spotifyPlaylistId ?? null,
    trackCount: Number.isFinite(playlist.trackCount) ? playlist.trackCount : 0,
    createdAt: playlist.createdAt,
    rules: playlist.rules && typeof playlist.rules === "object" ? playlist.rules : {},
  };
}

const timeOf = (iso: string | undefined) => { const value = Date.parse(iso ?? ""); return Number.isFinite(value) ? value : 0; };

/** Community's playlist as a local one, keeping what only this computer knows. */
export function localFromCommunity(playlist: SmartPlaylistV1, existing: SmartPlaylistCriteria | undefined, now: number): SmartPlaylistCriteria {
  // Songs waiting for tag choices are this computer's own (the move may have carried an old list).
  const { pendingTagChoices: _pending, ...extras } = playlist.extras && typeof playlist.extras === "object" ? playlist.extras : {};
  const spotify = playlist.spotifyPlaylistId && SPOTIFY_ID.test(playlist.spotifyPlaylistId) ? playlist.spotifyPlaylistId : null;
  const playlistId = spotify ?? existing?.playlistId ?? "";
  const sameSpotify = existing && existing.playlistId === playlistId;
  const candidate = {
    ...extras,
    id: existing?.id ?? playlist.desktopId ?? `community-playlist:${playlist.id}`,
    playlistId,
    playlistName: playlist.name,
    ...(playlist.description ? { description: playlist.description } : {}),
    criteria: playlist.criteria as unknown as SmartPlaylistFilterCriteria,
    isActive: playlist.active !== false,
    createdAt: existing?.createdAt ?? (timeOf(playlist.createdAt) || now),
    updatedAt: timeOf(playlist.updatedAt) || now,
    // A different Spotify playlist starts its own tracking.
    lastSyncAt: sameSpotify ? existing.lastSyncAt : 0,
    smartPlaylistTrackUris: sameSpotify ? existing.smartPlaylistTrackUris : [],
    ...(sameSpotify && existing.pendingTagChoices ? { pendingTagChoices: existing.pendingTagChoices } : {}),
  };
  // The same checks every saved playlist gets (tag ids, filters, the id).
  return normalizeSmartPlaylistCriteriaList([candidate])[0] ?? existing ?? (candidate as SmartPlaylistCriteria);
}

function readList(body: unknown): SmartPlaylistV1[] | null {
  const playlists = (body as Partial<SmartPlaylistListV1> | null)?.playlists;
  if (!Array.isArray(playlists)) return null;
  return playlists.filter((item): item is SmartPlaylistV1 => !!item && typeof item === "object"
    && typeof (item as SmartPlaylistV1).id === "string" && typeof (item as SmartPlaylistV1).name === "string"
    && typeof (item as SmartPlaylistV1).updatedAt === "string");
}

function readPlaylist(body: unknown): SmartPlaylistV1 | null {
  const playlist = (body as { playlist?: unknown } | null)?.playlist;
  return readList({ playlists: [playlist] })?.[0] ?? null;
}

const errorCode = (body: unknown) => (body as { error?: { code?: unknown } } | null)?.error?.code;

class ListStop extends Error {
  constructor(readonly outcome: Exclude<SmartPlaylistListOutcome, "done">) { super(`Smart playlist list: ${outcome}`); }
}

function stopFor(answer: CommunityAnswer): ListStop {
  if (answer.status === 404 && errorCode(answer.body) !== "smart_playlist_gone") return new ListStop("unsupported");
  if (answer.status === 503 && errorCode(answer.body) === "smart_playlists_paused") return new ListStop("paused");
  return new ListStop("failed");
}

type Change =
  | { kind: "take"; localId: string | null; playlist: SmartPlaylistV1; before: string | null }
  | { kind: "drop"; localId: string; before: string };

/**
 * One run of the shared list. Never throws: an older Community (`unsupported`), a paused feature
 * (`paused`) or a lost connection (`failed`) leaves the local list as it is.
 */
export async function syncSmartPlaylistList(context: SmartPlaylistListContext): Promise<SmartPlaylistListOutcome> {
  const { capability } = context;
  if (!capability) return "unsupported";
  const now = context.now ?? Date.now;
  const query = `${capability.path}?deviceId=${encodeURIComponent(context.deviceId)}`;
  let links: Record<string, SmartPlaylistLink> | null = null;
  const call = async (method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown) => {
    try {
      return await context.call(method, path, body);
    } catch {
      throw new ListStop("failed");
    }
  };
  try {
    const listed = await call("GET", query);
    if (listed.status !== 200) throw stopFor(listed);
    let community = readList(listed.body);
    if (!community) throw new ListStop("failed");
    if ((listed.body as SmartPlaylistListV1).moved !== true) {
      // The local list moves in once (the pushed app-state document); later runs change nothing.
      const moved = await call("POST", capability.movePath, { deviceId: context.deviceId });
      if (moved.status !== 200) throw stopFor(moved);
      community = readList(moved.body) ?? community;
    }

    const stored = await context.getRecord();
    links = stored?.libraryId === context.libraryId ? { ...stored.links } : {};
    const local = await context.loadLocal();
    const byId = new Map(community.map((playlist) => [playlist.id, playlist]));
    const byDesktopId = new Map(community.filter((playlist) => playlist.desktopId).map((playlist) => [playlist.desktopId!, playlist]));
    const linkedIds = new Set(Object.values(links).map((link) => link.communityId));
    const matched = new Set<string>();
    const changes: Change[] = [];

    const save = (playlist: SmartPlaylistCriteria, target: SmartPlaylistV1 | null, expectedUpdatedAt?: string) => call(
      target ? "PUT" : "POST",
      capability.path,
      target
        ? { deviceId: context.deviceId, id: target.id, playlist: sharedPlaylist(playlist), ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) }
        : { deviceId: context.deviceId, playlist: sharedPlaylist(playlist) },
    );
    const findRemote = (playlist: SmartPlaylistCriteria, link: SmartPlaylistLink | undefined) => {
      if (link) return byId.get(link.communityId);
      const spotify = SPOTIFY_ID.test(playlist.playlistId) ? playlist.playlistId : null;
      return byDesktopId.get(playlist.id!)
        // The move keys a playlist without a usable id by its Spotify playlist.
        ?? (spotify ? byDesktopId.get(`spotify-playlist:${spotify}`)
          ?? community!.find((item) => item.origin === "desktop" && item.spotifyPlaylistId === spotify && !linkedIds.has(item.id) && !matched.has(item.id)) : undefined);
    };

    for (const playlist of local) {
      const localId = playlist.id;
      if (!localId) continue;
      const link = links[localId];
      const fingerprint = sharedFingerprint(playlist);
      const remote = findRemote(playlist, link);

      if (!remote) {
        if (link) {
          // Deleted on Community (or by another computer): the Spotify playlist stays.
          changes.push({ kind: "drop", localId, before: fingerprint });
          delete links[localId];
          continue;
        }
        const created = await save(playlist, null);
        const saved = created.status === 200 ? readPlaylist(created.body) : null;
        if (saved) {
          links[localId] = { communityId: saved.id, updatedAt: saved.updatedAt, shared: fingerprint };
          matched.add(saved.id);
        } else if (created.status !== 409 && created.status !== 422) throw stopFor(created);
        // 409/422: at Community's limit, or settings Community refuses. It stays on this computer.
        continue;
      }
      matched.add(remote.id);

      if (!isDesktopPlaylist(remote)) {
        // Community now has rules Tagify can't follow: it shows read-only, and Community fills it.
        changes.push({ kind: "drop", localId, before: fingerprint });
        delete links[localId];
        continue;
      }

      if (!link) {
        // First time both sides see this playlist (after the move, or from another computer).
        if (sharedFingerprint(localFromCommunity(remote, playlist, now())) === fingerprint) {
          links[localId] = { communityId: remote.id, updatedAt: remote.updatedAt, shared: fingerprint };
          continue;
        }
        if (timeOf(remote.updatedAt) > (playlist.updatedAt ?? 0)) {
          changes.push({ kind: "take", localId, playlist: remote, before: fingerprint });
          continue;
        }
      } else {
        const localChanged = link.shared !== fingerprint;
        const remoteChanged = link.updatedAt !== remote.updatedAt;
        if (!localChanged && !remoteChanged) continue;
        if (remoteChanged) {
          // Changed on Community (both: the later save, Community's, wins, as on the website).
          changes.push({ kind: "take", localId, playlist: remote, before: fingerprint });
          continue;
        }
      }

      const updated = await save(playlist, remote, link?.updatedAt);
      const saved = updated.status === 200 ? readPlaylist(updated.body) : null;
      if (saved) {
        links[localId] = { communityId: saved.id, updatedAt: saved.updatedAt, shared: fingerprint };
        continue;
      }
      if (updated.status === 404) {
        changes.push({ kind: "drop", localId, before: fingerprint });
        delete links[localId];
        continue;
      }
      if (updated.status !== 409) throw stopFor(updated);
      // Changed on Community since Tagify read it, or no longer Tagify's to change: Community's wins.
      const fresh = await call("GET", query);
      const current = fresh.status === 200 ? readList(fresh.body)?.find((item) => item.id === remote.id) : undefined;
      if (!current) throw stopFor(fresh);
      byId.set(current.id, current);
      if (isDesktopPlaylist(current)) changes.push({ kind: "take", localId, playlist: current, before: fingerprint });
      else {
        changes.push({ kind: "drop", localId, before: fingerprint });
        delete links[localId];
      }
    }

    // Playlists this computer deleted since the last run.
    const localIds = new Set(local.map((playlist) => playlist.id));
    for (const [localId, link] of Object.entries(links)) {
      if (localIds.has(localId)) continue;
      delete links[localId];
      const remote = byId.get(link.communityId);
      // Changed on Community meanwhile: it comes back below rather than losing that change.
      if (!remote || remote.updatedAt !== link.updatedAt) continue;
      const deleted = await call("DELETE", capability.path, { deviceId: context.deviceId, id: remote.id });
      if (deleted.status !== 200 && deleted.status !== 404) throw stopFor(deleted);
      byId.delete(remote.id);
    }

    // Community-filled playlists whose tracking was removed in Tagify (Remove Tracking): the Spotify playlist stays.
    const removed: string[] = [];
    for (const id of context.pendingRemovals?.() ?? []) {
      const remote = byId.get(id);
      if (remote && !isDesktopPlaylist(remote)) {
        const deleted = await call("DELETE", capability.path, { deviceId: context.deviceId, id });
        if (deleted.status !== 200 && deleted.status !== 404) throw stopFor(deleted);
        byId.delete(id);
      }
      removed.push(id);
    }
    if (removed.length) context.removalsSent?.(removed);

    // New on Community: your-tags playlists join the local list; the rest show in it as Community fills them.
    const shown: CommunityOnlySmartPlaylist[] = [];
    for (const playlist of byId.values()) {
      if (!isDesktopPlaylist(playlist)) shown.push(communityOnly(playlist));
      else if (!matched.has(playlist.id)) changes.push({ kind: "take", localId: null, playlist, before: null });
    }

    if (changes.length) {
      const taken: Array<{ value: SmartPlaylistCriteria; playlist: SmartPlaylistV1 }> = [];
      await context.updateLocal((current) => {
        let next = [...current];
        taken.length = 0;
        for (const change of changes) {
          const id = change.kind === "take" && change.localId === null
            ? change.playlist.desktopId ?? `community-playlist:${change.playlist.id}`
            : change.localId;
          const index = next.findIndex((item) => item.id === id);
          const existing = index >= 0 ? next[index] : undefined;
          // Edited on this computer while the run was out: that edit goes next run.
          if (existing && change.before !== null && sharedFingerprint(existing) !== change.before) continue;
          if (change.kind === "drop") {
            if (index >= 0) next = next.filter((_, position) => position !== index);
            continue;
          }
          const value = localFromCommunity(change.playlist, existing, now());
          taken.push({ value, playlist: change.playlist });
          if (index >= 0) next[index] = value; else next.push(value);
        }
        return next;
      });
      for (const { value, playlist } of taken) {
        if (value.id) links[value.id] = { communityId: playlist.id, updatedAt: playlist.updatedAt, shared: sharedFingerprint(value) };
      }
    }

    context.showCommunityOnly(shown.sort((left, right) => left.createdAt.localeCompare(right.createdAt)));
    return "done";
  } catch (error) {
    if (error instanceof ListStop) return error.outcome;
    console.warn("Tagify sync: smart playlists will be read again later", error);
    return "failed";
  } finally {
    // What was sent before a stop is remembered, so the next run doesn't send it again.
    if (links) await context.putRecord({ key: SMART_PLAYLIST_LINKS_STATE_KEY, libraryId: context.libraryId, links }).catch(() => undefined);
  }
}

/**
 * The Spotify playlist Tagify fills itself for a Community playlist, so Community's "Keep in Spotify"
 * doesn't write it a second time: the playlist must be in the local list, linked, kept updating
 * ("Enable Sync") and connected to a Spotify playlist.
 */
export function desktopFilledSpotifyPlaylist(
  communityId: string,
  record: SmartPlaylistLinksRecord | undefined,
  local: SmartPlaylistCriteria[],
): string | null {
  if (!record) return null;
  const localId = Object.entries(record.links).find(([, link]) => link.communityId === communityId)?.[0];
  const playlist = localId ? local.find((item) => item.id === localId) : undefined;
  return playlist && playlist.isActive && SPOTIFY_ID.test(playlist.playlistId) ? playlist.playlistId : null;
}

// --- Between the sync runtime (extension) and the Smart Playlists window (app) --------------------

/** The window asks for a fresh read (on open and before Sync Now). */
export const SMART_PLAYLISTS_REFRESH_REQUEST_EVENT = "tagify:smartPlaylistsRefreshRequested";
/** A run finished (`detail.outcome`). */
export const SMART_PLAYLISTS_REFRESHED_EVENT = "tagify:smartPlaylistsRefreshed";
/** The read-only Community playlists changed (`detail.playlists`). */
export const COMMUNITY_ONLY_SMART_PLAYLISTS_EVENT = "tagify:communityOnlySmartPlaylists";
const COMMUNITY_ONLY_KEY = "tagify:smart-playlists:community-only:v1:";

const REMOVALS_KEY = "tagify:smart-playlists:community-removals:v1:";

/** The connected Community account on this computer, if any. */
export function syncAccountId(): string | null {
  try { return localStorage.getItem("tagify:sync:account-id") || null; } catch { return null; }
}

function communityOnlyKey(): string | null {
  const account = syncAccountId();
  return account ? `${COMMUNITY_ONLY_KEY}${account}` : null;
}

function removalsKey(): string | null {
  const account = syncAccountId();
  return account ? `${REMOVALS_KEY}${account}` : null;
}

function readIds(key: string | null): string[] {
  if (!key) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}

/** Community-filled playlists whose tracking was removed here and that Community hasn't deleted yet. */
export function readQueuedSmartPlaylistRemovals(): string[] {
  return readIds(removalsKey());
}

export function clearQueuedSmartPlaylistRemovals(ids: string[]): void {
  const key = removalsKey();
  if (!key) return;
  const done = new Set(ids);
  try { localStorage.setItem(key, JSON.stringify(readIds(key).filter((id) => !done.has(id)))); } catch { /* best effort */ }
}

function publishCommunityOnly(playlists: CommunityOnlySmartPlaylist[]): void {
  try { window.dispatchEvent(new CustomEvent(COMMUNITY_ONLY_SMART_PLAYLISTS_EVENT, { detail: { playlists } })); } catch { /* best effort */ }
}

export function storeCommunityOnlySmartPlaylists(playlists: CommunityOnlySmartPlaylist[]): void {
  const key = communityOnlyKey();
  try { if (key) localStorage.setItem(key, JSON.stringify(playlists)); } catch { /* best effort */ }
  publishCommunityOnly(key ? readCommunityOnlySmartPlaylists() : playlists);
}

export function readCommunityOnlySmartPlaylists(): CommunityOnlySmartPlaylist[] {
  const key = communityOnlyKey();
  if (!key) return [];
  const removed = new Set(readQueuedSmartPlaylistRemovals());
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item.id === "string" && typeof item.name === "string" && !removed.has(item.id))
      : [];
  } catch { return []; }
}

/**
 * Remove Tracking on a Community-filled playlist: it leaves the list now and is deleted on Community
 * with the next read (the Spotify playlist stays, as for every other playlist).
 */
export function removeCommunitySmartPlaylist(id: string): Promise<void> {
  const key = removalsKey();
  if (!key) return Promise.resolve();
  const queued = readIds(key);
  try { if (!queued.includes(id)) localStorage.setItem(key, JSON.stringify([...queued, id])); } catch { /* best effort */ }
  publishCommunityOnly(readCommunityOnlySmartPlaylists());
  return requestSmartPlaylistRefresh();
}

/** Asks the sync runtime for a fresh read; resolves once it answered, or after `timeoutMs`. */
export function requestSmartPlaylistRefresh(timeoutMs = 4_000): Promise<void> {
  if (typeof window === "undefined" || !communityOnlyKey()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { window.removeEventListener(SMART_PLAYLISTS_REFRESHED_EVENT, done); clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, timeoutMs);
    window.addEventListener(SMART_PLAYLISTS_REFRESHED_EVENT, done);
    window.dispatchEvent(new CustomEvent(SMART_PLAYLISTS_REFRESH_REQUEST_EVENT));
  });
}
