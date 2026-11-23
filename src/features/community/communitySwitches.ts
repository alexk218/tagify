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
 * - `communityTeasers`: shows people who aren't connected to Community a preview of how others tagged
 *   their songs, in the track list's "Tagged by others" view, on Tagged Tracks rows, in Track details
 *   and in the first-song card's count, with adding locked until they connect. A desktop that was
 *   never connected has no capability list to read, so Community controls this one with its own
 *   switch `desktop_tagged_by_others_preview`: while that is off, the preview route answers "paused"
 *   and every surface stays as it is without a preview.
 * - `communityTagSearch`: while a tag filter is on, the track list shows songs other members tagged
 *   that way on Community ("On Community"). People who aren't connected, or don't share their tags,
 *   see the first few and the count. Songs show as a cover shelf with tag pills (Alex's pick, 2026-11-22).
 *   Community's own tag-search switch also pauses it: the route then answers "paused" and nothing shows.
 *
 * One rule for every Community-locked feature (Alex, 2026-11-22): someone connected to Community who
 * doesn't share their tags gets the same limit as someone who isn't connected, and the lock asks them
 * to share ("Share my tags", the existing sharing window) instead of to connect ("Create account or
 * sign in"). New locked features take both states from the start.
 *
 * For checking one on a single computer before Community turns it on, `localStorage` key
 * `tagify:switch:<name>` set to "on" or "off" wins over Community's list.
 */
export type CommunitySwitch = "taggedByOthersTrackList" | "othersTagsSharingGate" | "communityTeasers" | "communityTagSearch";

export const COMMUNITY_SWITCHES: readonly CommunitySwitch[] = ["taggedByOthersTrackList", "othersTagsSharingGate", "communityTeasers", "communityTagSearch"];

const overrideKey = (name: CommunitySwitch) => `tagify:switch:${name}`;

export function communitySwitchOn(name: CommunitySwitch, apiBaseUrl: string | null = getDesktopSyncConfiguration()?.apiBaseUrl ?? null): boolean {
  try {
    const override = localStorage.getItem(overrideKey(name));
    if (override === "on") return true;
    if (override === "off") return false;
    if (!apiBaseUrl) return true;
    const saved = JSON.parse(localStorage.getItem(capabilitiesCacheKey(apiBaseUrl)) || "null") as { value?: Record<string, unknown> } | null;
    const value = saved?.value?.[name];
    return !(value === false || (!!value && typeof value === "object" && (value as { enabled?: unknown }).enabled === false));
  } catch {
    return true;
  }
}

