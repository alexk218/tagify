import type { RecordingIdentity, TrackData } from "@/types/tagData";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { trackEditHistory } from "@/services/TrackEditHistory";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { flushLocalPersistence, getTagifyDatabaseName, isLocalPersistencePaused } from "@/services/sync/SyncLocalState";
import { recordingAnnotations, recordingConflict, recordingName, sameRecording } from "../utils/recordingReuse";

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
export function recordingIdentityFor(uri: string, saved?: RecordingIdentity, options: { priority?: Priority; isCurrent?: () => boolean } = {}) {
  if (saved) return Promise.resolve(saved);
  const state = shared();
  const account = getTagifyDatabaseName();
  const key = `${account}:${uri}`;
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
        if (cached?.identity) { resolve(cached.identity); return; }
        if ((cached?.retryAt || 0) > Date.now()) throw new RecordingLookupDeferred(cached!.retryAt!);
        if (!rate(account).restored) {
          const window = await indexedDBStorage.getRecordingLookup("request-window", account);
          if (!rate(account).restored) {
            Object.assign(rate(account), { foreground: window?.foreground || [], background: window?.background || [], restored: true });
          }
        }
        const outage = await indexedDBStorage.getRecordingLookup("cooldown", account);
        rate(account).blockedUntil = Math.max(rate(account).blockedUntil, outage?.retryAt || 0);
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
                  await indexedDBStorage.cacheRecordingLookup(uri, identity ? { identity } : { retryAt, failures }, account);
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

const titleIndexes = new WeakMap<Record<string, TrackData>, Map<string, [string, TrackData][]>>();
export function automaticRecordingCandidates(track: RecordingReuseTrack, tracks: Record<string, TrackData>) {
  const { uri, name } = track;
  if (!/^spotify:track:[A-Za-z0-9]{22}$/.test(uri) || !name || tracks[uri]?.recordingReuseDisabled) return [];
  let titles = titleIndexes.get(tracks);
  if (!titles) {
    titles = new Map();
    for (const [otherUri, data] of Object.entries(tracks)) {
      if (!/^spotify:track:[A-Za-z0-9]{22}$/.test(otherUri) || data.recordingReuseDisabled) continue;
      const title = recordingName(data.recordingIdentity?.name || data.name || "");
      const members = titles.get(title) || []; members.push([otherUri, data]); titles.set(title, members);
    }
    titleIndexes.set(tracks, titles);
  }
  return (titles.get(recordingName(name)) || []).filter(([otherUri]) => otherUri !== uri);
}
function needsCheck(track: RecordingReuseTrack, tracks: Record<string, TrackData>) {
  return automaticRecordingCandidates(track, tracks).some(([, data]) => !tracks[track.uri]?.recordingGroupId || data.recordingGroupId !== tracks[track.uri].recordingGroupId);
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
  if (!needsCheck(track, tracks) || !subscriber.active()) return Promise.resolve();
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
      const candidates = automaticRecordingCandidates(track, tracks).map(([id]) => id);
      const saved = await indexedDBStorage.getRecordingTracks([uri, ...candidates], account);
      if (!active() || !needsCheck(track, saved)) return;
      const identity = await recordingIdentityFor(uri, saved[uri]?.recordingIdentity, { isCurrent: active });
      if (!identity) { unavailable(); return; }
      if (!active()) return;
      const proposals: Record<string, { identity: RecordingIdentity; annotations: string; details?: Partial<TrackData> }> = {
        [uri]: { identity, annotations: recordingAnnotations(saved[uri]), details: { name: track.name, ...track.details } },
      };
      const matched: TrackData[] = saved[uri] ? [saved[uri]] : [];
      const identities: Record<string, RecordingIdentity> = saved[uri] ? { [uri]: identity } : {};
      try {
        for (const [otherUri, data] of automaticRecordingCandidates(track, saved).sort((a, b) => Number(!a[1].recordingIdentity) - Number(!b[1].recordingIdentity))) {
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
