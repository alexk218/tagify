import config from "./config.json";
import packageJson from "@/package";
import { getUsageAccountDigest } from "@/features/discovery-survey/services/tagifyUsage";

export const ANALYTICS_CHOICE_EVENT = "tagify:analytics-choice";
const PREFIX = "tagify:product-analytics:v1:";
const MAX_AGE = 7 * 86400000;
const MAX_EVENTS = 200;
const HOSTS = ["https://us.i.posthog.com", "https://eu.i.posthog.com"];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const EVENTS = ["tagify_opened", "tagify_present", "tagging_completed", "rating_completed", "tracks_viewed", "albums_viewed", "artists_viewed", "playlists_viewed", "tag_manager_opened", "export_requested", "import_requested", "import_submitted", "settings_opened", "stats_opened", "local_files_opened", "community_opened", "cloud_sync_opened", "update_banner_shown", "update_instructions_opened", "update_download_clicked", "update_banner_dismissed", "community_publish_prompt_shown", "community_publish_prompt_reminder_shown", "community_publish_prompt_snoozed", "community_publish_prompt_published", "community_profile_published", "community_publish_kept_private", "community_share_opened", "community_sharing_stopped", "community_sharing_resumed", "community_connect_prompt_shown", "community_connect_prompt_dismissed", "community_setup_opened", "community_connect_started", "community_connect_completed", "community_connect_failed", "invite_opened", "invite_link_copied", "start_reason_shown", "start_reason_answered", "start_reason_dismissed"] as const;
export type ProductEventName = typeof EVENTS[number];
// Details are fixed, coarse values so an event never carries content, versions or links.
const DETAILS = {
  update_kind: ["patch", "minor", "major"],
  method: ["direct", "release_page", "command"],
  sync_state: ["connected", "disconnected", "not_connected"],
  entry: ["prompt", "community", "sync", "invite"],
  relationship: ["first_link", "reconnect", "account_switch"],
  stage: ["start", "finish"],
  invite_entry: ["action_bar", "milestone"],
  invite_link: ["personal", "general"],
  surface: ["workspace", "sync", "invitation", "onboarding"],
  sharing_state: ["review", "private", "paused", "public"],
  saved_songs: ["0", "1-9", "10-99", "100-999", "1000+"],
  edit_surface: ["tagify_page", "spotify_views", "keyboard"],
  start_reason: ["not_sure_where_to_start", "library_too_big", "just_looking", "something_broke", "other"],
} as const;
type DetailKey = keyof typeof DETAILS;
export type ProductEventDetails = { [K in DetailKey]?: typeof DETAILS[K][number] };
const EVENT_DETAILS: Partial<Record<ProductEventName, readonly DetailKey[]>> = {
  update_banner_shown: ["update_kind"],
  update_download_clicked: ["method"],
  tagify_opened: ["sync_state", "saved_songs"],
  tagify_present: ["saved_songs"],
  tagging_completed: ["edit_surface"],
  rating_completed: ["edit_surface"],
  start_reason_answered: ["start_reason"],
  community_setup_opened: ["entry"],
  community_connect_started: ["entry"],
  community_connect_completed: ["entry", "relationship"],
  community_connect_failed: ["entry", "stage"],
  invite_opened: ["invite_entry", "invite_link"],
  invite_link_copied: ["invite_entry", "invite_link"],
  community_share_opened: ["surface", "sharing_state"],
  community_profile_published: ["surface"],
};
const BASE_PROPERTIES = ["app_version", "spotify_version", "installation_id", "$process_person_profile", "$geoip_disable", "$ip"];
const SPOTIFY_VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(\.\d{1,6})?$/;
const PRESENT_DAY_PREFIX = "tagify:product-analytics:present-day:";
/** Spotify's release number only (for example 1.2.74.477), so removals after a Spotify update can be seen. Build hashes are dropped. */
export function spotifyReleaseVersion(raw: unknown): string | undefined {
  const match = typeof raw === "string" ? raw.match(/^\d{1,4}\.\d{1,4}\.\d{1,4}(\.\d{1,6})?/) : null;
  return match?.[0];
}
/** Coarse library size: songs with tags, a rating or energy. */
export function savedSongsBucket(count: number): ProductEventDetails["saved_songs"] {
  if (!Number.isFinite(count) || count < 0) return undefined;
  return count === 0 ? "0" : count < 10 ? "1-9" : count < 100 ? "10-99" : count < 1000 ? "100-999" : "1000+";
}
function validDetails(event: ProductEventName, details: Record<string, unknown>): boolean {
  const allowed = EVENT_DETAILS[event] ?? [];
  return Object.entries(details).every(([key, value]) =>
    allowed.includes(key as DetailKey) && (DETAILS[key as DetailKey] as readonly unknown[]).includes(value));
}
const detailsOf = (properties: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(properties).filter(([key]) => !BASE_PROPERTIES.includes(key)));
interface Event {
  uuid: string;
  event: ProductEventName;
  timestamp: string;
  distinct_id: string;
  properties: { app_version: string; spotify_version?: string; installation_id?: string; $process_person_profile: false; $geoip_disable: true; $ip: null } & ProductEventDetails;
}
interface State { schemaVersion: 2; enabled: boolean; events: Event[]; projectToken?: string; installationId?: string; installationExpiresAt?: string }
interface Runtime {
  timers: Map<string, ReturnType<typeof setTimeout>>;
  openedDays: Map<string, string>;
  requests: Map<string, AbortController>;
  pausedUntil: number;
  aggregateRequests: Map<string, AbortController>;
  blockedAccounts?: Set<string>;
}
// App and inline editors are separate bundles. They must share in-flight requests and consent revocation.
const scope = window as unknown as { __tagifyProductAnalyticsV1?: Runtime; __tagifyInstallerAnalyticsV1?: unknown };
const runtime: Runtime = scope.__tagifyProductAnalyticsV1 ??= { timers: new Map(), openedDays: new Map(), requests: new Map(), aggregateRequests: new Map(), pausedUntil: 0 };
runtime.aggregateRequests ??= new Map();
runtime.blockedAccounts ??= new Set();

function read(account: string): State {
  const automatic = (): State => {
    const offer = installationOffer(true);
    return { schemaVersion: 2, enabled: true, events: [], installationId: offer?.installationId, installationExpiresAt: offer?.expiresAt };
  };
  try {
    if (runtime.blockedAccounts!.has(account)) return { schemaVersion: 2, enabled: false, events: [] };
    const raw = localStorage.getItem(PREFIX + account);
    if (raw === null) return automatic();
    const value = JSON.parse(raw);
    // Client sharing controls were never published. Discard their disabled prototype records,
    // including unsent events, rather than carrying a local test choice into the first release.
    if ((value?.consentVersion === 1 || value?.schemaVersion === 2) && value.enabled === false) return automatic();
    if ((value?.consentVersion !== 1 && value?.schemaVersion !== 2) || value.enabled !== true || !Array.isArray(value.events)) return { schemaVersion: 2, enabled: false, events: [] };
    const linkValid = UUID.test(value.installationId || "") && Number.isFinite(Date.parse(value.installationExpiresAt)) && Date.parse(value.installationExpiresAt) <= Date.now() + MAX_AGE;
    const events = value.events.filter((e: Event) => UUID.test(e.uuid) && e.distinct_id === `tagify-account-${account}` &&
      EVENTS.includes(e.event) && Date.parse(e.timestamp) <= Date.now() &&
      Date.parse(e.timestamp) > Date.now() - MAX_AGE && /^[0-9A-Za-z.-]{1,40}$/.test(e.properties?.app_version || "") &&
      (e.properties.spotify_version === undefined || (e.event === "tagify_present" && SPOTIFY_VERSION.test(e.properties.spotify_version))) &&
      validDetails(e.event, detailsOf(e.properties)) &&
      e.properties.$process_person_profile === false && e.properties.$geoip_disable === true && e.properties.$ip === null && (!e.properties.installation_id || (linkValid && UUID.test(e.properties.installation_id) && e.properties.installation_id === value.installationId && Date.parse(e.timestamp) <= Date.parse(value.installationExpiresAt)))).slice(-MAX_EVENTS);
    return { schemaVersion: 2, enabled: true, events, projectToken: value.projectToken, installationId: linkValid ? value.installationId : undefined, installationExpiresAt: linkValid ? value.installationExpiresAt : undefined };
  } catch { return { schemaVersion: 2, enabled: false, events: [] }; }
}

/** Lets callers skip preparing details for a presence event that would be dropped. */
export function presenceRecordedToday(account: string): boolean {
  try { return localStorage.getItem(PRESENT_DAY_PREFIX + account) === new Date().toISOString().slice(0, 10); }
  catch { return false; }
}

function spotifyVersionOf(): unknown {
  try { return (globalThis as { Spicetify?: { Platform?: { version?: unknown } } }).Spicetify?.Platform?.version; }
  catch { return undefined; }
}

function configuration() {
  if (!/^phc_[A-Za-z0-9_-]+$/.test(config.token || "") || !HOSTS.includes(config.host || "")) return null;
  return { token: config.token, host: config.host };
}

function installationOffer(automatic = false): { installationId: string; expiresAt: string } | null {
  const bridge = scope.__tagifyInstallerAnalyticsV1 as { schemaVersion?: number; enabled?: boolean; installationId?: string; expiresAt?: string } | undefined;
  if (!bridge) return null;
  const expiry = Date.parse(bridge?.expiresAt || "");
  if ((automatic ? bridge?.schemaVersion !== 2 : ![1, 2].includes(bridge?.schemaVersion || 0)) || bridge.enabled !== true || !UUID.test(bridge.installationId || "") || !(expiry > Date.now() && expiry <= Date.now() + MAX_AGE)) return null;
  return { installationId: bridge.installationId!, expiresAt: bridge.expiresAt! };
}
export function canLinkInstallation(): boolean { return !!installationOffer(); }

export function isAnalyticsConfigured(): boolean { return configuration() !== null; }
export function isAnalyticsSharing(account: string): boolean { return /^[a-f0-9]{64}$/.test(account) && read(account).enabled; }

/** Internal session control used by transport QA; disabled prototype records do not survive a restart. */
export function setAnalyticsSharing(account: string, enabled: boolean, linkPastSetup = false): boolean {
  if (!/^[a-f0-9]{64}$/.test(account)) return false;
  const previous = read(account);
  const offer = enabled && linkPastSetup ? installationOffer() : null;
  if (!enabled) stopSharing(account);
  try {
    localStorage.setItem(PREFIX + account, JSON.stringify({ schemaVersion: 2, enabled, events: enabled ? previous.events : [], projectToken: previous.projectToken, installationId: enabled ? previous.installationId ?? offer?.installationId : undefined, installationExpiresAt: enabled ? previous.installationExpiresAt ?? offer?.expiresAt : undefined }));
  } catch { return false; }
  if (enabled) runtime.blockedAccounts!.delete(account);
  if (!enabled || !previous.enabled) {
    // A disabled period never becomes a historical upload when reporting resumes.
    try { for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(`tagify:usage:activity:${account}`) || key?.startsWith(`tagify:usage:activity:ack:${account}:`)) localStorage.removeItem(key);
    } } catch { /* The persisted off choice also blocks any surviving queue from being sent. */ }
  }
  if (enabled && !previous.enabled) {
    try { localStorage.removeItem(`tagify:usage:last-report:${account}`); localStorage.removeItem(`tagify:usage:last-version:${account}`); } catch { /* A new action still reports its counters. */ }
  }
  window.dispatchEvent(new CustomEvent(ANALYTICS_CHOICE_EVENT, { detail: { account, enabled } }));
  return true;
}

function stopSharing(account: string): void {
  runtime.blockedAccounts!.add(account);
  runtime.requests.get(account)?.abort();
  runtime.aggregateRequests.get(account)?.abort();
  const timer = runtime.timers.get(account);
  if (timer) clearTimeout(timer);
  runtime.timers.delete(account);
  runtime.openedDays.delete(account);
}

/** Share revocation across the main app and separately bundled inline editors. */
export function trackAggregateRequest(account: string, controller: AbortController): void { runtime.aggregateRequests.set(account, controller); }
export function releaseAggregateRequest(account: string, controller: AbortController): void {
  if (runtime.aggregateRequests.get(account) === controller) runtime.aggregateRequests.delete(account);
}

export function recordProductEvent(account: string, event: ProductEventName, details: ProductEventDetails = {}): void {
  try {
    const state = read(account);
    const settings = configuration();
    if (!state.enabled || !settings || !/^[a-f0-9]{64}$/.test(account) || !EVENTS.includes(event) || !validDetails(event, details)) return;
    const day = new Date().toISOString().slice(0, 10);
    if (event === "tagify_opened" && runtime.openedDays.get(account) === day) { schedule(account); return; }
    // Spotify restarts and both bundles share this marker, so presence counts once per account and UTC day.
    if (event === "tagify_present" && localStorage.getItem(PRESENT_DAY_PREFIX + account) === day) { schedule(account); return; }
    const properties: Event["properties"] = { ...details, app_version: packageJson.version, $process_person_profile: false, $geoip_disable: true, $ip: null };
    const spotifyVersion = event === "tagify_present" ? spotifyReleaseVersion(spotifyVersionOf()) : undefined;
    if (spotifyVersion) properties.spotify_version = spotifyVersion;
    if (state.installationId && Date.parse(state.installationExpiresAt || "") > Date.now()) properties.installation_id = state.installationId;
    if (state.projectToken !== settings.token) state.events = [];
    state.projectToken = settings.token;
    state.events.push({ uuid: crypto.randomUUID(), event, timestamp: new Date().toISOString(), distinct_id: `tagify-account-${account}`, properties });
    state.events = state.events.slice(-MAX_EVENTS);
    localStorage.setItem(PREFIX + account, JSON.stringify(state));
    if (event === "tagify_opened") runtime.openedDays.set(account, day);
    if (event === "tagify_present") localStorage.setItem(PRESENT_DAY_PREFIX + account, day);
    schedule(account);
  } catch { /* Optional measurements never interrupt editing. */ }
}

/** Fixed interactions only; callers never supply file names, routes or content. */
export function recordProductInteraction(event: ProductEventName, details?: ProductEventDetails): void {
  void getUsageAccountDigest().then(account => {
    if (account) recordProductEvent(account, event, details);
  }).catch(() => { /* Optional reporting never interrupts the user's action. */ });
}

function schedule(account: string, failures = 0, delay = 1000): void {
  if (runtime.timers.has(account) || !isAnalyticsSharing(account)) return;
  runtime.timers.set(account, setTimeout(async () => {
    runtime.timers.delete(account);
    const sent = await flushProductEvents(account);
    if (read(account).enabled && read(account).events.length) {
      schedule(account, sent ? 0 : failures + 1, Math.max(sent ? 1000 : [5000, 30000, 120000][failures] ?? 3600000, runtime.pausedUntil - Date.now()));
    }
  }, delay));
}

export async function flushProductEvents(account: string): Promise<boolean> {
  const state = read(account);
  const settings = configuration();
  if (!state.enabled || !settings || !state.events.length || runtime.requests.has(account) || document.visibilityState === "hidden" || !navigator.onLine || Date.now() < runtime.pausedUntil) return false;
  if (state.projectToken !== settings.token || await getUsageAccountDigest() !== account || !isAnalyticsSharing(account) || runtime.requests.has(account)) return false;
  const batch = state.events.slice(0, 20);
  const controller = new AbortController();
  runtime.requests.set(account, controller);
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${settings.host}/batch/`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: settings.token, batch }), redirect: "error", credentials: "omit", signal: controller.signal });
    if (response.status === 429) {
      const value = response.headers.get("retry-after");
      const delay = Number(value) > 0 ? Number(value) * 1000 : Date.parse(value || "") - Date.now();
      runtime.pausedUntil = Date.now() + Math.min(86400000, Number.isFinite(delay) && delay > 0 ? delay : 3600000);
    }
    if (!response.ok) return false;
    const result = await response.json();
    if (![1, "Ok"].includes(result.status) || result.quota_limited?.length) return false;
    const latest = read(account);
    if (!latest.enabled || controller.signal.aborted) return false;
    const acknowledged = new Set(batch.map(event => event.uuid));
    latest.events = latest.events.filter(event => !acknowledged.has(event.uuid));
    localStorage.setItem(PREFIX + account, JSON.stringify(latest));
    return true;
  } catch { return false; }
  finally { clearTimeout(timeout); if (runtime.requests.get(account) === controller) runtime.requests.delete(account); }
}
