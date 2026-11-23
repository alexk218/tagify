import config from "./config.json";
import packageJson from "@/package";
import { getUsageAccountDigest } from "@/features/discovery-survey/services/tagifyUsage";

export const ANALYTICS_CHOICE_EVENT = "tagify:analytics-choice";
const PREFIX = "tagify:product-analytics:v1:";
const MAX_AGE = 7 * 86400000;
const MAX_EVENTS = 200;
const HOSTS = ["https://us.i.posthog.com", "https://eu.i.posthog.com"];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const EVENTS = ["tagify_opened", "tagify_present", "tagging_completed", "rating_completed", "tracks_viewed", "albums_viewed", "artists_viewed", "playlists_viewed", "tag_manager_opened", "export_requested", "import_requested", "import_submitted", "settings_opened", "stats_opened", "local_files_opened", "community_opened", "cloud_sync_opened", "update_banner_shown", "update_instructions_opened", "update_download_clicked", "update_banner_dismissed", "community_publish_prompt_shown", "community_publish_prompt_reminder_shown", "community_publish_prompt_snoozed", "community_publish_prompt_published", "community_profile_published", "community_publish_kept_private", "community_share_opened", "community_sharing_stopped", "community_sharing_resumed", "community_connect_prompt_shown", "community_connect_prompt_dismissed", "community_setup_opened", "community_connect_started", "community_connect_completed", "community_connect_failed", "invite_opened", "invite_link_copied", "first_run_shown", "first_run_song_picked", "first_run_members_checked", "first_run_members_tag_added", "community_library_check_completed", "community_library_tag_added", "first_run_payoff_shown", "first_run_payoff_reached", "first_run_tip_shown", "first_run_tip_done", "welcome_popup_shown", "taste_packs_shown", "taste_pack_added", "taste_packs_skipped", "rewind_prompt_shown", "rewind_prompt_opened", "phone_app_panel_opened", "phone_app_store_clicked", "phone_app_button_hidden", "android_notify_requested", "android_release_notice_shown", "community_rating_sharing_asked", "community_rating_sharing_answered", "track_list_others_opened", "track_list_members_tag_added", "track_list_community_link_opened", "track_list_sort_changed", "smart_playlist_created", "smart_playlist_refreshed", "note_saved", "bulk_tag_applied", "suggested_tag_used", "auto_tags_applied", "energy_set", "tag_filter_used", "album_apply_to_tracks", "tagged_by_others_song_played", "tagged_by_others_tag_toggled", "tagged_by_others_song_hidden", "tagged_by_others_filter_used", "tagged_by_others_playlists_chosen", "community_teaser_viewed", "community_teaser_connect_clicked"] as const;
export type ProductEventName = typeof EVENTS[number];
// Details are fixed, coarse values so an event never carries content, versions or links.
const DETAILS = {
  update_kind: ["patch", "minor", "major"],
  method: ["direct", "release_page", "command"],
  sync_state: ["connected", "disconnected", "not_connected"],
  entry: ["prompt", "community", "sync", "invite", "rewind", "library_check", "teaser_tab", "teaser_rows", "teaser_track_details", "teaser_tag_search", "phone_app"],
  relationship: ["first_link", "reconnect", "account_switch"],
  stage: ["start", "finish"],
  invite_entry: ["action_bar", "milestone"],
  invite_link: ["personal", "general"],
  surface: ["workspace", "sync", "invitation", "onboarding", "first_run", "tag_manager", "desktop_question", "desktop_publish", "notice", "tab", "rows", "track_details", "tag_search"],
  sharing_state: ["review", "private", "paused", "public"],
  saved_songs: ["0", "1-9", "10-99", "100-999", "1000+"],
  tagged_songs: ["0", "1-9", "10-99", "100-999", "1000-2499", "2500-4999", "5000-9999", "10000+"],
  edit_surface: ["tagify_page", "spotify_views", "keyboard"],
  songs: ["1", "2", "3", "4", "5", "6-9", "10-24", "25-49", "50-99", "100+"],
  liked_songs: ["0", "1+"],
  first_run_source: ["liked", "playing"],
  payoff_action: ["filter", "playlist"],
  // Taste pack keys from @tagify/community-contracts. A test fails when a pack is added there but not here.
  taste_pack: ["metal", "indie", "rock", "pop", "hip-hop", "electronic", "chill", "jazz-soul", "country-folk", "reggae-latin", "k-pop-j-pop"],
  members_matches: ["0", "1-4", "5-14", "15+"],
  members_add: ["tag", "all"],
  songs_checked: ["0", "1-99", "100-999", "1000-9999", "10000+"],
  songs_matched: ["0", "1-9", "10-99", "100-999", "1000+"],
  outcome: ["complete", "spotify_stopped", "community_stopped", "limited"],
  optional_buttons: ["on", "off"],
  store: ["app_store", "google_play"],
  phone_surface: ["panel", "notice"],
  // Tagged tracks: other members' tags opened on a row.
  new_to_library: ["yes", "no"],
  target: ["song", "member", "tag"],
  // The track list's Sort by options (SORT_OPTIONS in constants/trackList, as snake_case). A test fails when an option is added there but not here.
  sort: ["date_modified", "date_created", "alphabetical", "rating", "energy", "bpm", "community_people"],
  after_highlight: ["yes", "no"],
  // The track list's "Tagged by others" view.
  toggle_action: ["added", "removed"],
  hide_action: ["hidden", "unhidden"],
  filter_kind: ["tag", "artist", "not_tagged"],
  playlists_chosen: ["1", "2-4", "5-9", "10-24", "25-99", "100+"],
  folders_used: ["yes", "no"],
  // Community teasers for people who aren't connected: songs other members tagged among their newest Liked Songs.
  found_bucket: ["1-9", "10-49", "50-99", "100-249", "250+"],
  answer: ["yes", "no"],
  // First-run tips (docs/ONBOARDING_FIRST_RUN_PLAN_2026-11.md section 10).
  tip: ["play", "tag", "manage", "tagged", "others", "playlist", "smart", "rate"],
  how: ["action", "got_it", "skipped"],
} as const;
type DetailKey = keyof typeof DETAILS;
export type ProductEventDetails = { [K in DetailKey]?: typeof DETAILS[K][number] };
const EVENT_DETAILS: Partial<Record<ProductEventName, readonly DetailKey[]>> = {
  update_banner_shown: ["update_kind"],
  update_download_clicked: ["method"],
  tagify_opened: ["sync_state", "saved_songs", "tagged_songs"],
  tagify_present: ["saved_songs", "tagged_songs"],
  tagging_completed: ["edit_surface", "songs"],
  rating_completed: ["edit_surface"],
  first_run_shown: ["liked_songs"],
  first_run_song_picked: ["first_run_source"],
  first_run_members_checked: ["members_matches"],
  first_run_members_tag_added: ["members_add"],
  community_library_check_completed: ["songs_checked", "songs_matched", "outcome"],
  community_teaser_viewed: ["surface", "found_bucket"],
  community_teaser_connect_clicked: ["surface"],
  community_library_tag_added: ["members_add"],
  first_run_payoff_reached: ["payoff_action"],
  first_run_tip_shown: ["tip"],
  first_run_tip_done: ["tip", "how"],
  community_setup_opened: ["entry"],
  community_connect_started: ["entry"],
  community_connect_completed: ["entry", "relationship"],
  community_connect_failed: ["entry", "stage"],
  invite_opened: ["invite_entry", "invite_link"],
  invite_link_copied: ["invite_entry", "invite_link"],
  community_share_opened: ["surface", "sharing_state"],
  community_profile_published: ["surface"],
  taste_pack_added: ["taste_pack", "surface"],
  phone_app_panel_opened: ["optional_buttons"],
  phone_app_store_clicked: ["store", "phone_surface"],
  track_list_members_tag_added: ["members_add", "new_to_library"],
  track_list_community_link_opened: ["target"],
  track_list_sort_changed: ["sort", "after_highlight"],
  bulk_tag_applied: ["songs"],
  energy_set: ["edit_surface"],
  tag_filter_used: ["sort"],
  tagged_by_others_tag_toggled: ["toggle_action"],
  tagged_by_others_song_hidden: ["hide_action"],
  tagged_by_others_filter_used: ["filter_kind"],
  tagged_by_others_playlists_chosen: ["playlists_chosen", "folders_used"],
  community_rating_sharing_asked: ["surface"],
  community_rating_sharing_answered: ["answer", "surface"],
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
/** Songs with at least one tag, in ranges fine enough to tell large libraries apart. */
export function taggedSongsBucket(count: number): ProductEventDetails["tagged_songs"] {
  if (!Number.isFinite(count) || count < 0) return undefined;
  if (count < 1000) return savedSongsBucket(count) as ProductEventDetails["tagged_songs"];
  return count < 2500 ? "1000-2499" : count < 5000 ? "2500-4999" : count < 10000 ? "5000-9999" : "10000+";
}
/** Playlists ticked in the "Tagged by others" playlist picker. */
export function playlistsChosenBucket(count: number): ProductEventDetails["playlists_chosen"] {
  if (!Number.isInteger(count) || count < 1) return undefined;
  return count === 1 ? "1" : count < 5 ? "2-4" : count < 10 ? "5-9" : count < 25 ? "10-24" : count < 100 ? "25-99" : "100+";
}
/** Songs changed by one tagging gesture: exact up to 5, then ranges. */
export function songsBucket(count: number): ProductEventDetails["songs"] {
  if (!Number.isInteger(count) || count < 1) return undefined;
  if (count <= 5) return DETAILS.songs[count - 1];
  return count < 10 ? "6-9" : count < 25 ? "10-24" : count < 50 ? "25-49" : count < 100 ? "50-99" : "100+";
}
// Sharing and taste packs both report a `surface`, from different places.
const SHARING_SURFACES = ["workspace", "sync", "invitation", "onboarding"] as const;
// Where Tagify asked "Share your ratings on your profile?": the question, the publish choice or an update notice.
const RATING_SHARING_SURFACES = ["desktop_question", "desktop_publish", "notice"] as const;
const TEASER_SURFACES = ["tab", "rows", "track_details", "tag_search"] as const;
const EVENT_VALUES: Partial<Record<ProductEventName, Partial<Record<DetailKey, readonly string[]>>>> = {
  community_share_opened: { surface: SHARING_SURFACES },
  community_profile_published: { surface: SHARING_SURFACES },
  taste_pack_added: { surface: ["first_run", "tag_manager"] },
  track_list_sort_changed: { sort: ["community_people"] },
  community_teaser_viewed: { surface: TEASER_SURFACES },
  community_teaser_connect_clicked: { surface: TEASER_SURFACES },
  community_rating_sharing_asked: { surface: RATING_SHARING_SURFACES },
  community_rating_sharing_answered: { surface: RATING_SHARING_SURFACES },
};
/** The track list's Sort by option as a fixed detail value, for example `dateModified` → `date_modified`. */
export function sortDetail(sortBy: string): ProductEventDetails["sort"] {
  const value = sortBy.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  return (DETAILS.sort as readonly string[]).includes(value) ? value as ProductEventDetails["sort"] : undefined;
}
function validDetails(event: ProductEventName, details: Record<string, unknown>): boolean {
  const allowed = EVENT_DETAILS[event] ?? [];
  return Object.entries(details).every(([key, value]) => {
    const values = EVENT_VALUES[event]?.[key as DetailKey] ?? DETAILS[key as DetailKey];
    return allowed.includes(key as DetailKey) && (values as readonly unknown[]).includes(value);
  });
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

export type TastePackSurface = "first_run" | "tag_manager";
/** One `taste_pack_added` per pack. Call only once the packs are saved; unknown keys are dropped. */
export function recordTastePacksAdded(keys: readonly string[], surface: TastePackSurface): void {
  for (const key of new Set(keys)) recordProductInteraction("taste_pack_added", { taste_pack: key as ProductEventDetails["taste_pack"], surface });
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
