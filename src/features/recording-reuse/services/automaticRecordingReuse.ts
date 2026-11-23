import type { RecordingIdentity, TrackData } from "@/types/tagData";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { spotifyService } from "@/services/SpotifyService";
import { trackEditHistory } from "@/services/TrackEditHistory";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { flushLocalPersistence, getTagifyDatabaseName, isLocalPersistencePaused } from "@/services/sync/SyncLocalState";
import { baseRecordingName, nearRecording, notSameRecording, recordingAnnotations, recordingConflict, sameRecording, similarRecording } from "../utils/recordingReuse";

export type RecordingReuseStatus = "idle" | "checking" | "unavailable";
export const RECORDING_REUSE_EVENT = "tagify:recordingReuse";
export interface RecordingReuseTrack { uri: string; name: string; details?: Partial<TrackData> }
type Priority = "foreground" | "background";
interface Lookup {
  until: number;
  pending: boolean;
  priority: Priority;
  interests: Set<() => boolean>;
  identity: Promise<RecordingIdentity | undefined>;
}
interface Job { account: string; priority: () => Priority; active: () => boolean; run: () => void; defer: (until: number) => void }
interface Subscriber { active: () => boolean; changed: (changes: Record<string, TrackData>, syncChanges?: Record<string, TrackData>) => Promise<void> }
interface SharedChecks {
  identities: Map<string, Lookup>;
  statuses: Map<string, { pending: number; status: RecordingReuseStatus; retryAt?: number }>;
  guards: Set<(uris: string[]) => boolean>;
  running: number;
  backgroundRunning: number;
  queue: Job[];
  rates: Map<string, { foreground: number[]; background: number[]; blockedUntil: number; restored: boolean }>;
  checks: Map<string, { subscribers: Set<Subscriber>; promise: Promise<void> }>;
}
declare global { interface Window { __tagifyRecordingChecks?: SharedChecks } }
function shared(): SharedChecks {
  return window.__tagifyRecordingChecks ??= { identities: new Map(), statuses: new Map(), guards: new Set(), running: 0, backgroundRunning: 0, queue: [], rates: new Map(), checks: new Map() };
}
const editGuard = (uris: string[]) => trackEditHistory.hasEditsFor(uris);
shared().guards.add(editGuard);
function hasEdits(uris: string[]) { return [...shared().guards].some(guard => guard(uris)); }

export class RecordingLookupDeferred extends Error {
  readonly code = "tagify-recording-deferred";
  constructor(public retryAt: number) { super("Song checks will resume shortly."); }
}
export function recordingLookupRetryAt(error: unknown): number | undefined {
  const value = error as { code?: string; retryAt?: number } | undefined;
  return value?.code === "tagify-recording-deferred" && Number.isFinite(value.retryAt) ? value.retryAt : undefined;
}
const MINUTE = 60_000;
const FAILURE_DELAY = 5 * MINUTE;
function rate(account: string) {
  const state = shared();
  if (!state.rates.has(account)) state.rates.set(account, { foreground: [], background: [], blockedUntil: 0, restored: false });
  const value = state.rates.get(account)!;
  value.foreground = value.foreground.filter(time => time > Date.now() - MINUTE);
  value.background = value.background.filter(time => time > Date.now() - MINUTE);
  return value;
}
function drain() {
  const state = shared();
  state.queue.sort((a, b) => Number(a.priority() === "background") - Number(b.priority() === "background"));
  for (let index = 0; index < state.queue.length;) {
    const job = state.queue[index];
    if (!job.active()) { state.queue.splice(index, 1); job.defer(0); continue; }
    const budget = rate(job.account);
    const background = job.priority() === "background";
    const calls = [...budget.foreground, ...budget.background].sort((a, b) => a - b);
    const until = Math.max(budget.blockedUntil,
      calls.length >= 60 ? calls[0] + MINUTE : 0,
      background && budget.background.length >= 12 ? budget.background[0] + MINUTE : 0);
    if (until > Date.now()) { state.queue.splice(index, 1); job.defer(until); continue; }
    // One background request leaves two slots for music the user is checking now.
    if (state.running >= 3 || (background && state.backgroundRunning >= 1)) { index++; continue; }
    state.queue.splice(index, 1);
    (background ? budget.background : budget.foreground).push(Date.now());
    state.running++; if (background) state.backgroundRunning++;
    job.run();
  }
}
function requestRetryAt(account: string) {
  const value = rate(account);
  const calls = [...value.foreground, ...value.background].sort((a, b) => a - b);
  return Math.max(value.blockedUntil, calls.length >= 60 ? calls[0] + MINUTE : 0);
}
/** The saved request window and cooldown, so a reload can't reset the shared budget. */
async function restoreBudget(account: string) {
  if (!rate(account).restored) {
    const window = await indexedDBStorage.getRecordingLookup("request-window", account);
    if (!rate(account).restored) {
      Object.assign(rate(account), { foreground: window?.foreground || [], background: window?.background || [], restored: true });
    }
  }
  const outage = await indexedDBStorage.getRecordingLookup("cooldown", account);
  rate(account).blockedUntil = Math.max(rate(account).blockedUntil, outage?.retryAt || 0);
}
export function recordingIdentityFor(uri: string, saved?: RecordingIdentity, options: { priority?: Priority; isCurrent?: () => boolean; requireLead?: boolean } = {}) {
  // Near matches need the lead artist, which identities saved before 3.4.1 lack:
  // those songs are looked up once more and the cached identity gains it.
  const requireLead = options.requireLead === true;
  if (saved && (!requireLead || saved.leadArtistId)) return Promise.resolve(saved);
  const state = shared();
  const account = getTagifyDatabaseName();
  const key = `${account}:${uri}${requireLead ? ":lead" : ""}`;
  const interest = options.isCurrent || (() => true);
  const existing = state.identities.get(key);
  if (existing && existing.until > Date.now() && !(existing.priority === "background" && !existing.pending && options.priority !== "background")) {
    if (existing.pending) existing.interests.add(interest);
    if (options.priority !== "background") { existing.priority = "foreground"; drain(); }
    return existing.identity;
  }
  const entry: Lookup = { until: Infinity, pending: true, priority: options.priority || "foreground", interests: new Set([interest]), identity: undefined! };
  const active = () => account === getTagifyDatabaseName() && !isLocalPersistencePaused() && [...entry.interests].some(current => current());
  entry.identity = new Promise<RecordingIdentity | undefined>((resolve, reject) => {
    void (async () => {
      try {
        const cached = await indexedDBStorage.getRecordingLookup(uri, account);
        if (!active()) { entry.until = 0; resolve(undefined); return; }
        if (cached?.identity && (!requireLead || cached.identity.leadArtistId)) { resolve(cached.identity); return; }
        if ((cached?.retryAt || 0) > Date.now()) throw new RecordingLookupDeferred(cached!.retryAt!);
        await restoreBudget(account);
        await new Promise<void>((finish, fail) => {
          state.queue.push({ account, priority: () => entry.priority, active,
            defer: until => { entry.until = until; if (until) fail(new RecordingLookupDeferred(until)); else finish(); },
            run: () => {
              const background = entry.priority === "background";
              void (async () => {
                try {
                  const budget = rate(account);
                  await indexedDBStorage.cacheRecordingLookup("request-window", { foreground: [...budget.foreground], background: [...budget.background] }, account);
                  if (!active()) { entry.until = 0; resolve(undefined); finish(); return; }
                  const identity = await spotifyApiService.getRecordingIdentity(uri, undefined, { priority: entry.priority, feature: "recording-matching" });
                  const failures = (cached?.failures || 0) + 1;
                  const retryAt = Date.now() + Math.min(FAILURE_DELAY * 2 ** (failures - 1), 30 * MINUTE);
                  // A refresh that finds nothing keeps the identity already cached.
                  if (identity || !cached?.identity) await indexedDBStorage.cacheRecordingLookup(uri, identity ? { identity } : { retryAt, failures }, account);
                  entry.until = identity ? Infinity : retryAt;
                  resolve(identity); finish();
                } catch (error) {
                  const failures = (cached?.failures || 0) + 1;
                  const retryAt = Date.now() + Math.min(FAILURE_DELAY * 2 ** (failures - 1), 30 * MINUTE);
                  entry.until = retryAt;
                  rate(account).blockedUntil = Math.max(rate(account).blockedUntil, retryAt);
                  await Promise.allSettled([
                    indexedDBStorage.cacheRecordingLookup(uri, { retryAt, failures }, account),
                    indexedDBStorage.cacheRecordingLookup("cooldown", { retryAt }, account),
                  ]);
                  fail(error);
                } finally {
                  state.running--; if (background) state.backgroundRunning--;
                  drain();
                }
              })();
            },
          });
          drain();
        });
        resolve(undefined);
      } catch (error) {
        if (recordingLookupRetryAt(error)) entry.until = recordingLookupRetryAt(error)!;
        else if (entry.until === Infinity) entry.until = Date.now() + FAILURE_DELAY;
        reject(error);
      } finally {
        entry.pending = false;
        entry.interests.clear();
      }
    })();
  });
  state.identities.set(key, entry);
  // In-flight work is never evicted: scrolling cannot duplicate a queued request.
  while (state.identities.size > 500) {
    const removable = [...state.identities].find(([, value]) => !value.pending);
    if (!removable) break;
    state.identities.delete(removable[0]);
  }
  return entry.identity;
}

/**
 * A song's Spotify play count, read now through the same queue, per-minute budget and
 * cooldown as identity lookups. Never saved: a count is only compared within one check.
 * Undefined when Spotify gives no count, the budget is spent or the check is no longer current.
 */
async function playCountFor(uri: string, isCurrent: () => boolean): Promise<number | undefined> {
  const state = shared();
  const account = getTagifyDatabaseName();
  const active = () => account === getTagifyDatabaseName() && !isLocalPersistencePaused() && isCurrent();
  try {
    await restoreBudget(account);
    if (!active()) return;
    return await new Promise<number | undefined>(resolve => {
      state.queue.push({ account, priority: () => "foreground", active, defer: () => resolve(undefined),
        run: () => void (async () => {
          try {
            const budget = rate(account);
            await indexedDBStorage.cacheRecordingLookup("request-window", { foreground: [...budget.foreground], background: [...budget.background] }, account);
            resolve(active() ? await spotifyService.getTrackPlayCount(uri) : undefined);
          } catch (error) {
            console.debug("Tagify: Couldn't read a song's play count", error);
            resolve(undefined);
          } finally {
            state.running--;
            drain();
          }
        })(),
      });
      drain();
    });
  } catch (error) {
    console.debug("Tagify: Couldn't read a song's play count", error);
    return;
  }
}
/** Below this, two different releases can share a count by chance. */
export const SAME_PLAY_COUNT_FLOOR = 10_000;
/**
 * Spotify gives every release of one recording the same play count, so two near matches
 * with identical counts above the floor are the same song. Both counts are read now.
 */
async function samePlayCount(a: string, b: string, isCurrent: () => boolean) {
  const first = await playCountFor(a, isCurrent);
  if (first === undefined || first < SAME_PLAY_COUNT_FLOOR || !isCurrent()) return false;
  const second = await playCountFor(b, isCurrent);
  return second === first && isCurrent();
}

const candidateIndexes = new WeakMap<Record<string, TrackData>, { titles: Map<string, [string, TrackData][]>; isrcs: Map<string, [string, TrackData][]> }>();
function candidateIndex(tracks: Record<string, TrackData>) {
  let index = candidateIndexes.get(tracks);
  if (!index) {
    index = { titles: new Map(), isrcs: new Map() };
    for (const [otherUri, data] of Object.entries(tracks)) {
      if (!/^spotify:track:[A-Za-z0-9]{22}$/.test(otherUri) || data.recordingReuseDisabled) continue;
      const title = baseRecordingName(data.recordingIdentity?.name || data.name || "");
      for (const [map, key] of [[index.titles, title], [index.isrcs, data.recordingIdentity?.isrc]] as const) {
        if (!key) continue;
        const members = map.get(key) || []; members.push([otherUri, data]); map.set(key, members);
      }
    }
    candidateIndexes.set(tracks, index);
  }
  return index;
}
/**
 * Saved songs that might be the same recording: the same title once "(feat. …)" and
 * "[From …]" credits are removed, or the same ISRC when both songs' identities are already
 * known. A lookup shortcut only; sameRecording decides. `isrc` is the song's own ISRC when it
 * was looked up but isn't saved on it (a song not in the library yet).
 */
export function automaticRecordingCandidates(track: RecordingReuseTrack, tracks: Record<string, TrackData>, lookedUpIsrc?: string) {
  const { uri, name } = track;
  if (!/^spotify:track:[A-Za-z0-9]{22}$/.test(uri) || !name || tracks[uri]?.recordingReuseDisabled) return [];
  const index = candidateIndex(tracks);
  const isrc = tracks[uri]?.recordingIdentity?.isrc || lookedUpIsrc;
  const found = new Map([...(index.titles.get(baseRecordingName(name)) || []), ...(isrc && index.isrcs.get(isrc) || [])]);
  found.delete(uri);
  return [...found];
}
const baseTitleIndexes = new WeakMap<Record<string, TrackData>, Map<string, [string, TrackData][]>>();
const MAX_NEAR_CANDIDATES = 4;
/**
 * Saved songs whose title matches once credits and "[From …]" are removed. Like the
 * title index, this is a lookup shortcut, never evidence that two songs are the same.
 */
export function nearRecordingCandidates(track: RecordingReuseTrack, tracks: Record<string, TrackData>) {
  const { uri, name } = track;
  if (!/^spotify:track:[A-Za-z0-9]{22}$/.test(uri) || !name || tracks[uri]?.recordingReuseDisabled) return [];
  let titles = baseTitleIndexes.get(tracks);
  if (!titles) {
    titles = new Map();
    for (const [otherUri, data] of Object.entries(tracks)) {
      if (!/^spotify:track:[A-Za-z0-9]{22}$/.test(otherUri) || data.recordingReuseDisabled) continue;
      const title = baseRecordingName(data.recordingIdentity?.name || data.name || "");
      if (!title) continue;
      const members = titles.get(title) || []; members.push([otherUri, data]); titles.set(title, members);
    }
    baseTitleIndexes.set(tracks, titles);
  }
  const group = tracks[uri]?.recordingGroupId;
  return (titles.get(baseRecordingName(name)) || []).filter(([otherUri, data]) => otherUri !== uri &&
    (!group || data.recordingGroupId !== group) && !notSameRecording(uri, tracks[uri], otherUri, data)).slice(0, MAX_NEAR_CANDIDATES);
}
export interface NearRecordingMatch {
  uri: string;
  /** The saved song that is the same song, with every copy already linked to it. */
  data: TrackData;
  proposals: Record<string, { identity: RecordingIdentity; annotations: string; details?: Partial<TrackData> }>;
}
/**
 * A saved song that is another release of the song being viewed (a single and its album
 * cut, for example) that exact-copy linking won't combine, confirmed by an identical
 * Spotify play count so it can link without asking. Pairs whose ratings or energy differ,
 * or whose counts don't match, are left apart and never surfaced. Looks up only the viewed
 * song and at most a few same-title candidates.
 */
export async function findNearRecording(track: RecordingReuseTrack, tracks: Record<string, TrackData>, isCurrent = () => true): Promise<NearRecordingMatch | undefined> {
  const account = getTagifyDatabaseName();
  const active = () => isCurrent() && account === getTagifyDatabaseName() && !isLocalPersistencePaused();
  if (!nearRecordingCandidates(track, tracks).length) return;
  const { uri } = track;
  const candidates = nearRecordingCandidates(track, tracks).map(([id]) => id);
  const saved = await indexedDBStorage.getRecordingTracks([uri, ...candidates], account);
  if (!active()) return;
  const remaining = nearRecordingCandidates(track, saved).filter(([id]) => candidates.includes(id));
  if (!remaining.length) return;
  const identity = await recordingIdentityFor(uri, saved[uri]?.recordingIdentity, { isCurrent: active, requireLead: true });
  if (!identity || !active()) return;
  for (const [otherUri, data] of remaining) {
    const other = await recordingIdentityFor(otherUri, data.recordingIdentity, { isCurrent: active, requireLead: true });
    if (!active()) return;
    // Exact copies are linked by the automatic check; only what that leaves apart is checked here.
    if (!other || sameRecording(identity, other) || !nearRecording(identity, other)) continue;
    // Copies already linked to either song join the link, so every copy keeps sharing tags.
    const groups = [data.recordingGroupId, saved[uri]?.recordingGroupId].filter((id): id is string => !!id);
    const linked = groups.length ? await indexedDBStorage.getRecordingGroupTracksStrict(groups, account) : {};
    if (!active()) return;
    const members: [string, TrackData][] = [[otherUri, data], ...Object.entries(linked).filter(([id]) => id !== uri && id !== otherUri)];
    // Saving checks every pair; keep only a link that will save.
    if (members.some(([id, member]) => id !== otherUri && !(nearRecording(identity, member.recordingIdentity) || similarRecording(identity, member.recordingIdentity)))) continue;
    const proposals: NearRecordingMatch["proposals"] = {
      [uri]: { identity, annotations: recordingAnnotations(saved[uri]), details: { name: track.name, ...track.details } },
    };
    for (const [id, member] of members) proposals[id] = { identity: id === otherUri ? other : member.recordingIdentity!, annotations: recordingAnnotations(member) };
    const all = [saved[uri], ...members.map(([, member]) => member)].filter(Boolean) as TrackData[];
    // Different ratings or energy would need a choice, so those stay apart without reading play counts.
    if (all.some(a => all.some(b => recordingConflict(a, b)))) continue;
    const samePlays = await samePlayCount(uri, otherUri, active);
    if (!active()) return;
    if (samePlays) return { uri: otherUri, data, proposals };
  }
}
export interface AlbumNearRecordingMatch extends NearRecordingMatch {
  /** The album's song this match was found for. */
  track: RecordingReuseTrack;
}
const MAX_ALBUM_TRACKS = 60;
/**
 * Same-song matches (see findNearRecording) for the songs on one album, so a whole album of
 * singles links at once. Only the album's own songs are checked, each against the saved
 * songs that share its title; nothing is searched for. A song already in one match is never
 * in another, so every match saves on its own.
 */
export async function findAlbumNearRecordings(albumTracks: RecordingReuseTrack[], tracks: Record<string, TrackData>, isCurrent = () => true): Promise<AlbumNearRecordingMatch[]> {
  const found: AlbumNearRecordingMatch[] = [];
  const offered = new Set<string>();
  for (const track of albumTracks.slice(0, MAX_ALBUM_TRACKS)) {
    if (!isCurrent()) return [];
    if (offered.has(track.uri) || !nearRecordingCandidates(track, tracks).length) continue;
    const match = await findNearRecording(track, tracks, isCurrent);
    if (!isCurrent()) return [];
    if (!match || Object.keys(match.proposals).some(uri => offered.has(uri))) continue;
    Object.keys(match.proposals).forEach(uri => offered.add(uri));
    found.push({ ...match, track });
  }
  return found;
}
/**
 * Whether the viewed song is worth one identity lookup although no saved song shares its title:
 * its own identity isn't known yet, and some other saved song has an ISRC it could share (a
 * translated or romanized title, for example). The answer is cached, so each song is read once.
 */
function worthIsrcLookup(track: RecordingReuseTrack, tracks: Record<string, TrackData>) {
  const { uri } = track;
  if (!/^spotify:track:[A-Za-z0-9]{22}$/.test(uri) || !track.name || tracks[uri]?.recordingReuseDisabled || tracks[uri]?.recordingIdentity) return false;
  if (automaticRecordingCandidates(track, tracks).length) return false;
  for (const members of candidateIndex(tracks).isrcs.values()) if (members.some(([id]) => id !== uri)) return true;
  return false;
}
function needsCheck(track: RecordingReuseTrack, tracks: Record<string, TrackData>, lookedUpIsrc?: string) {
  return automaticRecordingCandidates(track, tracks, lookedUpIsrc).some(([, data]) => !tracks[track.uri]?.recordingGroupId || data.recordingGroupId !== tracks[track.uri].recordingGroupId);
}
export function recordingReuseSignature(track: RecordingReuseTrack, tracks: Record<string, TrackData>) {
  const entry = (uri: string) => [uri, tracks[uri]?.name, tracks[uri]?.artists, tracks[uri]?.recordingReuseDisabled, tracks[uri]?.recordingGroupId, tracks[uri]?.recordingIdentity, recordingAnnotations(tracks[uri])];
  return JSON.stringify([getTagifyDatabaseName(), track.name, entry(track.uri), automaticRecordingCandidates(track, tracks).map(([uri]) => entry(uri))]);
}
export function getRecordingReuseStatus(uri: string): RecordingReuseStatus {
  return shared().statuses.get(`${getTagifyDatabaseName()}:${uri}`)?.status || "idle";
}
export function getRecordingReuseRetryAt(uri: string): number {
  return shared().statuses.get(`${getTagifyDatabaseName()}:${uri}`)?.retryAt || Date.now() + FAILURE_DELAY;
}
function statusChanged(account: string, uri: string, status: RecordingReuseStatus, delta: number, retryAt?: number) {
  const state = shared();
  const key = `${account}:${uri}`;
  const pending = Math.max(0, (state.statuses.get(key)?.pending || 0) + delta);
  const next = pending ? "checking" : status;
  if (state.statuses.size >= 500 && !state.statuses.has(key)) state.statuses.delete(state.statuses.keys().next().value!);
  state.statuses.set(key, { pending, status: next, retryAt });
  window.dispatchEvent(new CustomEvent(RECORDING_REUSE_EVENT, { detail: { account, uri, status: next } }));
}
export async function checkAutomaticRecordingReuse(track: RecordingReuseTrack, tracks: Record<string, TrackData>, onChanged: (changes: Record<string, TrackData>, syncChanges?: Record<string, TrackData>) => Promise<void>, isCurrent = () => true): Promise<void> {
  const state = shared();
  state.guards.add(editGuard);
  const { uri } = track;
  const account = getTagifyDatabaseName();
  const subscriber = { active: () => isCurrent() && account === getTagifyDatabaseName() && !isLocalPersistencePaused(), changed: onChanged };
  // Older inline ratings may contain no title. Learn it from the current row or
  // song card before candidate selection, without looking up the entire library.
  const source = tracks[uri];
  if (source && subscriber.active() && ((!source.name?.trim() && track.name?.trim()) || (!source.artists?.trim() && track.details?.artists?.trim()))) {
    try {
      await flushLocalPersistence();
      if (!subscriber.active()) return;
      const changes = await indexedDBStorage.rememberRecordingDetails(uri, { name: track.name, artists: track.details?.artists }, account, subscriber.active);
      if (!subscriber.active()) return;
      if (Object.keys(changes).length) {
        tracks = { ...tracks, ...changes };
        await onChanged(changes, {});
      }
    } catch (error) { console.debug("Tagify: Song details could not be remembered", error); return; }
  }
  // A song whose title matches nothing saved can still share an ISRC with a saved song. One
  // background lookup (queued behind what the user is checking, and cached) finds it; no
  // "checking" status is shown, since most songs match nothing.
  let lookedUpIsrc: string | undefined;
  if (subscriber.active() && worthIsrcLookup(track, tracks)) {
    let identity: RecordingIdentity | undefined;
    try { identity = await recordingIdentityFor(uri, undefined, { priority: "background", isCurrent: subscriber.active }); }
    catch (error) { console.debug("Tagify: Song check will try again later", error); return; }
    if (!identity || !subscriber.active()) return;
    if (tracks[uri]) {
      // A saved song keeps the identity, so the library check also finds it by ISRC.
      try {
        await flushLocalPersistence();
        if (!subscriber.active()) return;
        const changes = await indexedDBStorage.rememberRecordingIdentities({ [uri]: identity }, account);
        if (!subscriber.active()) return;
        if (Object.keys(changes).length) { tracks = { ...tracks, ...changes }; await onChanged(changes, {}); }
      } catch (error) { console.debug("Tagify: Song identity could not be remembered", error); return; }
    } else lookedUpIsrc = identity.isrc;
  }
  if (!needsCheck(track, tracks, lookedUpIsrc) || !subscriber.active()) return Promise.resolve();
  const key = `${account}:${uri}`;
  const existing = state.checks.get(key);
  if (existing) { existing.subscribers.add(subscriber); return existing.promise; }
  const subscribers = new Set<Subscriber>([subscriber]);
  const active = () => [...subscribers].some(listener => listener.active());
  const promise = (async () => {
    statusChanged(account, uri, "checking", 1);
    let outcome: RecordingReuseStatus = "idle";
    let retryAt = 0;
    const unavailable = (error?: unknown, otherUri = uri) => {
      outcome = "unavailable";
      const until = recordingLookupRetryAt(error) || state.identities.get(`${account}:${otherUri}`)?.until;
      retryAt = Math.max(retryAt, until && Number.isFinite(until) ? until : Date.now() + FAILURE_DELAY);
    };
    try {
      await flushLocalPersistence();
      if (!active()) return;
      const candidates = automaticRecordingCandidates(track, tracks, lookedUpIsrc).map(([id]) => id);
      const saved = await indexedDBStorage.getRecordingTracks([uri, ...candidates], account);
      if (!active() || !needsCheck(track, saved, lookedUpIsrc)) return;
      const identity = await recordingIdentityFor(uri, saved[uri]?.recordingIdentity, { isCurrent: active });
      if (!identity) { unavailable(); return; }
      if (!active()) return;
      const proposals: Record<string, { identity: RecordingIdentity; annotations: string; details?: Partial<TrackData> }> = {
        [uri]: { identity, annotations: recordingAnnotations(saved[uri]), details: { name: track.name, ...track.details } },
      };
      const matched: TrackData[] = saved[uri] ? [saved[uri]] : [];
      const identities: Record<string, RecordingIdentity> = saved[uri] ? { [uri]: identity } : {};
      try {
        for (const [otherUri, data] of automaticRecordingCandidates(track, saved, lookedUpIsrc).sort((a, b) => Number(!a[1].recordingIdentity) - Number(!b[1].recordingIdentity))) {
          if (!active()) return;
          let other: RecordingIdentity | undefined;
          try { other = await recordingIdentityFor(otherUri, data.recordingIdentity, { isCurrent: active }); }
          catch (error) { unavailable(error, otherUri); if (requestRetryAt(account) > Date.now()) break; continue; }
          if (!active()) return;
          if (!other) { unavailable(undefined, otherUri); continue; }
          identities[otherUri] = other;
          if (!Object.values(proposals).every(proposal => sameRecording(proposal.identity, other))) continue;
          if (matched.some(member => recordingConflict(member, data))) return;
          matched.push(data);
          proposals[otherUri] = { identity: other, annotations: recordingAnnotations(data) };
        }
      } finally {
        if (active() && Object.keys(identities).length) {
          const remembered = await indexedDBStorage.rememberRecordingIdentities(identities, account);
          if (active() && Object.keys(remembered).length) await Promise.all([...subscribers].filter(listener => listener.active()).map(listener => listener.changed(remembered, {})));
        }
      }
      const proposalUris = Object.keys(proposals);
      if (!active() || proposalUris.length < 2 || hasEdits(proposalUris)) return;
      if (saved[uri]?.recordingGroupId && proposalUris.every(id => saved[id]?.recordingGroupId === saved[uri].recordingGroupId)) return;
      await flushLocalPersistence();
      if (!active()) return;
      const changes = await indexedDBStorage.linkRecordings(proposals, Object.keys(proposals).find(id => !!saved[id])!, false, { automatic: true, expectedDatabaseName: account, isCurrent: () => active() && !hasEdits(Object.keys(proposals)) });
      if (active()) {
        const syncChanges = Object.fromEntries(Object.entries(changes).filter(([id, value]) => !saved[id] || recordingAnnotations(value) !== recordingAnnotations(saved[id])));
        await Promise.all([...subscribers].filter(listener => listener.active()).map((listener, index) => listener.changed(changes, index ? {} : syncChanges)));
      }
    } catch (error) {
      if (active()) {
        // Another visible copy can finish linking while this one is checking.
        // Re-read the new group promptly using cached identities, not an outage cooldown.
        if ((error as { code?: string })?.code === "tagify-recording-changed") { outcome = "unavailable"; retryAt = Date.now() + 1000; }
        else unavailable(error);
        console.debug("Tagify: Recording reuse left releases separate", error);
      }
    } finally { statusChanged(account, uri, outcome, -1, retryAt); state.checks.delete(key); }
  })();
  state.checks.set(key, { subscribers, promise });
  return promise;
}
