import { spotifyFailureHistory } from "@/utils/spotifyFailureHistory";
import { assertSpotifyEndpoint, classifySpotifyFailure, spotifyEndpointLabel, spotifyLocalPause, spotifyQuotaReason, type SpotifyFailure } from "@/utils/spotifyRequestFailure";
import { graphqlRateLimiter, type RequestOptions } from "@/utils/RateLimiter";
import { spotifyBackgroundPolicy } from "./SpotifyBackgroundPolicy";
import { spotifyRequestAccounting, requestFeature } from "@/utils/spotifyRequestAccounting";
import { getSpotifyRetryAfterMs } from "@/utils/spotifyRateLimit";

type ReadVersions = { epoch: number; sequence: number; resources: Map<string, number> };
const versions = globalThis as typeof globalThis & { __tagifyReadVersionsV2?: ReadVersions };
const readVersions = versions.__tagifyReadVersionsV2 ??= { epoch: 0, sequence: 0, resources: new Map() };
function normalizeResource(value: string): string {
  const playlist = value.match(/spotify:playlist:([\w-]+)/)?.[1] ?? value.match(/\/playlists\/([^/?"\s]+)/)?.[1];
  return playlist ? `spotify:playlist:${decodeURIComponent(playlist)}` : value;
}
function readResource(key: string, options?: RequestOptions): string | undefined {
  if (options?.resource) return normalizeResource(options.resource);
  const normalized = normalizeResource(key);
  return normalized.startsWith("spotify:playlist:") ? normalized : undefined;
}
export const spotifyReadGeneration = (resource?: string, account = spotifyAccountKey()) =>
  `${readVersions.epoch}:${resource ? readVersions.resources.get(`${account}:${normalizeResource(resource)}`) ?? 0 : 0}`;
const writes = (globalThis as typeof globalThis & { __tagifyPendingWritesV1?: Set<string> });
const pendingWrites = writes.__tagifyPendingWritesV1 ??= new Set<string>();
const notices = globalThis as typeof globalThis & { __tagifySpotifyRecoveryNoticeAt?: number };
export function assertSpotifyWriteSettled(resource: string): void {
  if (pendingWrites.has(`${spotifyAccountKey()}:${normalizeResource(resource)}`)) throw Object.assign(new Error("A Spotify update is still running. Your changes are saved and will be checked again."), { spotifyRequestStopped: true });
}
const invalidateReads = (resource: string | undefined, account: string) => {
  if (!resource) { readVersions.epoch++; return; }
  readVersions.resources.set(`${account}:${normalizeResource(resource)}`, ++readVersions.sequence);
  if (readVersions.resources.size > 1000) { readVersions.epoch++; readVersions.resources.clear(); }
};
// Read-only developer diagnostics, shared by app and extension. No network reporting.
(globalThis as typeof globalThis & { tagifyRequestStats?: () => unknown }).tagifyRequestStats = () => {
  const stats = graphqlRateLimiter.getStats(), account = spotifyAccountKey();
  let savedUntil = 0;
  try { savedUntil = Number(localStorage.getItem(`tagify:spotify-cooldown:v1:${account}`)) || 0; } catch { /* In-memory diagnostics still work. */ }
  return { ...stats, cooldowns: { requestsUntil: Math.max(stats.blockedUntil, savedUntil), backgroundUntil: spotifyBackgroundPolicy.retryAt() }, failureHistory: spotifyFailureHistory.read(account) };
};

export function promoteSpotifyRequest(options: RequestOptions | undefined): void {
  if (options?.priorityToken) graphqlRateLimiter.promote(options.priorityToken);
}
export function throwIfSpotifyRequestStopped(error: unknown): void {
  const value = error as { spotifyRequestStopped?: boolean; name?: string } | null;
  if (getSpotifyRetryAfterMs(error) !== null || value?.spotifyRequestStopped || value?.name === "AbortError") throw error;
}
export function spotifyAccountKey(): string {
  const platform = typeof Spicetify === "undefined" ? undefined : Spicetify.Platform as {
    username?: string; UserAPI?: { _user?: { username?: string } };
  };
  return platform?.username ?? platform?.UserAPI?._user?.username ?? "current";
}
function saveSpotifyCooldown(account: string, retry: number, failure?: SpotifyFailure): void {
  const key = `tagify:spotify-cooldown:v1:${account}`, until = Date.now() + retry;
  try {
    if (until >= (Number(localStorage.getItem(key)) || 0)) {
      localStorage.setItem(key, String(until));
      localStorage.setItem(`${key}:cause`, JSON.stringify({ until, failure: failure ?? null }));
    }
  } catch { /* In-memory protection remains available. */ }
}
export async function spotifyRead<T>(key: string, run: (signal: AbortSignal) => Promise<T>, options?: RequestOptions): Promise<T> {
  try { assertSpotifyEndpoint(key); }
  catch (error) { spotifyRequestAccounting.recordFailure("unsupported-endpoint"); spotifyFailureHistory.record(spotifyAccountKey(), key, error, options?.feature ?? requestFeature(key), options?.transport ?? "desktop", false); throw error; }
  options?.assertCurrent?.();
  const account = spotifyAccountKey();
  const feature = options?.feature ?? requestFeature(key);
  const resource = readResource(key, options);
  const checkBackground = () => { if ((options?.priorityToken?.current ?? options?.priority) === "background") spotifyBackgroundPolicy.assertAvailable(); };
  const storageKey = `tagify:spotify-cooldown:v1:${account}`;
  let until = 0;
  try { until = Number(localStorage.getItem(storageKey)) || 0; } catch { /* In-memory protection still applies. */ }
  spotifyRequestAccounting.record(feature, "requested", options?.transport ?? "desktop");
  try {
    if (until > Date.now()) {
      let cause: SpotifyFailure | undefined;
      try {
        const saved = JSON.parse(localStorage.getItem(`${storageKey}:cause`) ?? "null");
        // A partial storage write must not attribute a new pause to an old cause.
        if (saved?.until === until) cause = saved.failure ?? undefined;
      } catch { /* Older pauses have no cause. */ }
      throw spotifyLocalPause((until - Date.now()) / 1000, cause);
    }
    checkBackground();
    const result = await graphqlRateLimiter.execute<T>(`${account}:${spotifyReadGeneration(resource, account)}:${key}`, async signal => {
    if (spotifyAccountKey() !== account) throw new DOMException("Spotify account changed", "AbortError");
    options?.assertCurrent?.();
    checkBackground();
    spotifyRequestAccounting.record(feature, "dispatched", options?.transport ?? "desktop", `${account}:${key}`);
    try { return await run(signal); }
    catch (caught) {
      if (spotifyAccountKey() !== account) throw new DOMException("Spotify account changed", "AbortError");
      const failure = classifySpotifyFailure(caught, spotifyEndpointLabel(key));
      const error = failure ? Object.assign(new Error(failure.kind === "quota-exceeded" ? "Spotify's request quota was reached. Checks are paused; your edits remain saved." : "Spotify asked Tagify to pause requests. Your edits remain saved."), caught, { spotifyFailure: failure }) : caught;
      spotifyFailureHistory.record(account, key, error, feature, options?.transport ?? "desktop", true, caught);
      if (failure && failure.kind !== "local-pause") spotifyRequestAccounting.recordFailure(failure.kind);
      const retry = getSpotifyRetryAfterMs(error);
      if (retry !== null && failure?.kind !== "local-pause") {
        if (spotifyAccountKey() === account) spotifyBackgroundPolicy.throttled(retry);
        saveSpotifyCooldown(account, retry, failure);
      }
      throw error;
    }
  }, { ...options, feature, accountingAtTransport: true });
    options?.assertCurrent?.();
    if (spotifyAccountKey() !== account) throw new DOMException("Spotify account changed", "AbortError");
    return result;
  }
  catch (error) {
    if (classifySpotifyFailure(error)?.kind === "local-pause") {
      spotifyRequestAccounting.recordFailure("local-pause");
      spotifyFailureHistory.record(account, key, error, feature, options?.transport ?? "desktop", false);
    }
    if ((error as { spotifyRequestStopped?: boolean })?.spotifyRequestStopped) spotifyRequestAccounting.record(feature, "stopped", options?.transport ?? "desktop");
    if ((error as { recoveryRequired?: boolean })?.recoveryRequired && Date.now() - (notices.__tagifySpotifyRecoveryNoticeAt ?? -Infinity) > 60_000) {
      notices.__tagifySpotifyRecoveryNoticeAt = Date.now();
      Spicetify.showNotification?.((error as Error).message, true, 10000);
    }
    throw error;
  }
}

let mutationId = 0;
export async function spotifyWrite<T>(run: (signal: AbortSignal) => Promise<T>, options: RequestOptions & { resource?: string } = {}): Promise<T> {
  options = { ...options, feature: options.feature ?? requestFeature(options.resource ?? "") };
  const account = spotifyAccountKey();
  const resource = options.resource && `${account}:${normalizeResource(options.resource)}`;
  if (options.resource) assertSpotifyWriteSettled(options.resource);
  if (resource) pendingWrites.add(resource);
  let started = false;
  invalidateReads(options.resource, account);
  try {
    return await spotifyRead(`write:${Date.now()}:${++mutationId}:${Math.random()}`, async signal => {
      started = true;
      try { return await run(signal); }
      finally {
        invalidateReads(options.resource, account);
        if (resource) pendingWrites.delete(resource);
      }
    }, options);
  } finally {
    // A consumer timeout must not unlock an uncancellable desktop mutation.
    if (!started && resource) pendingWrites.delete(resource);
  }
}
export async function spotifyFetch(url: string, init: RequestInit = {}, readKey?: string, options: RequestOptions = {}): Promise<Response> {
  try { assertSpotifyEndpoint(url, init.method); }
  catch (error) { spotifyRequestAccounting.recordFailure("unsupported-endpoint"); spotifyFailureHistory.record(spotifyAccountKey(), url, error, options.feature ?? requestFeature(url), "fetch", false); throw error; }
  const read = !!readKey || !init.method || init.method === "GET";
  const response = await (read ? spotifyRead(readKey ?? `fetch:${url}`, signal => send(signal), { ...options, transport: "fetch", signal: init.signal ?? options.signal })
    : spotifyWrite(signal => send(signal), { ...options, transport: "fetch", resource: url, signal: init.signal ?? options.signal }));
  return typeof response.clone === "function" ? response.clone() : response;
  async function send(signal?: AbortSignal) {
    const account = spotifyAccountKey();
    const response = await fetch(url, { ...init, signal });
    if (response.status === 429) {
      // Pause dispatch at the headers, before spending up to 250ms on diagnosis.
      const provisional = { status: 429, headers: response.headers };
      const failure = classifySpotifyFailure(provisional, spotifyEndpointLabel(url, init.method));
      const retry = getSpotifyRetryAfterMs(provisional)!;
      saveSpotifyCooldown(account, retry, failure);
      if (spotifyAccountKey() === account) graphqlRateLimiter.pause(retry, failure);
      const reason = await spotifyQuotaReason(response);
      const evidence = { status: 429, headers: response.headers, reason };
      throw Object.assign(new Error(reason === "QUOTA_EXCEEDED" ? "Spotify's request quota was reached. Checks are paused; your edits remain saved." : "Spotify asked Tagify to pause requests. Your edits remain saved."), evidence, {
        spotifyFailure: classifySpotifyFailure(evidence, spotifyEndpointLabel(url, init.method)),
      });
    }
    if (response.status >= 400) spotifyFailureHistory.record(account, `${init.method ?? "GET"} ${url}`, { status: response.status, headers: response.headers }, options.feature ?? requestFeature(url), "fetch");
    // Fetch resolves at headers. Keep body transfer inside the request deadline,
    // retaining the original response metadata and independent consumer bodies.
    if (response.body) await response.clone().arrayBuffer();
    return response;
  }
}
