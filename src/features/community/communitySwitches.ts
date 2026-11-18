import { getDesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { capabilitiesCacheKey } from "@/services/sync/SyncRuntime";

/**
 * Desktop features Community can switch off without a client release. Each is on (Alex picked them,
 * 2026-11-16) unless Community's capability list (the one sync keeps) says `<name>: false` or
 * `<name>: { enabled: false }`.
 *
 * - `taggedByOthersTrackList`: the track list's "Tagged by others" view, with all but the top songs
 *   locked until the member shares their tags on Community. The Community tab's
 *   "Your songs, tagged by others" card goes away while it is on.
 * - `othersTagsSharingGate`: opening a track-list row's "N others" chip (every tag, one-tap add)
 *   asks members who don't share their tags on Community to share them first.
 * - `communityTeasers`: starts OFF (on only when Community lists it as on, or the override says "on").
 *   Shows people who aren't connected to Community a preview of how others tagged their songs, in the
 *   track list's "Tagged by others" view, on Tagged Tracks rows and in Track details, with adding
 *   locked until they connect.
 *
 * For checking one on a single computer before Community turns it on, `localStorage` key
 * `tagify:switch:<name>` set to "on" or "off" wins over Community's list.
 */
export type CommunitySwitch = "taggedByOthersTrackList" | "othersTagsSharingGate" | "communityTeasers";

export const COMMUNITY_SWITCHES: readonly CommunitySwitch[] = ["taggedByOthersTrackList", "othersTagsSharingGate", "communityTeasers"];

/** Switches that stay off until Community (or the override) turns them on. */
const OFF_UNTIL_ON: ReadonlySet<CommunitySwitch> = new Set(["communityTeasers"]);

const overrideKey = (name: CommunitySwitch) => `tagify:switch:${name}`;

export function communitySwitchOn(name: CommunitySwitch, apiBaseUrl: string | null = getDesktopSyncConfiguration()?.apiBaseUrl ?? null): boolean {
  try {
    const override = localStorage.getItem(overrideKey(name));
    if (override === "on") return true;
    if (override === "off") return false;
    const offUntilOn = OFF_UNTIL_ON.has(name);
    if (!apiBaseUrl) return !offUntilOn;
    const saved = JSON.parse(localStorage.getItem(capabilitiesCacheKey(apiBaseUrl)) || "null") as { value?: Record<string, unknown> } | null;
    const value = saved?.value?.[name];
    if (offUntilOn) return value === true || (!!value && typeof value === "object" && (value as { enabled?: unknown }).enabled === true);
    return !(value === false || (!!value && typeof value === "object" && (value as { enabled?: unknown }).enabled === false));
  } catch {
    return !OFF_UNTIL_ON.has(name);
  }
}
