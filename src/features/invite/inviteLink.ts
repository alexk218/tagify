import { COMMUNITY_ORIGIN } from "@/features/community/communityLinks";
import { getDesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { syncRuntime } from "@/services/sync/SyncRuntime";

/** The link anyone can share: Community's general invite, where friends join or download Tagify. */
export const GENERAL_INVITE_URL = `${COMMUNITY_ORIGIN}/join`;
export const GENERAL_INVITE_PREVIEW = `${GENERAL_INVITE_URL}/opengraph-image`;

/** What would put the member's name on the invite, when it doesn't have it yet. */
export type InviteNameStep = "connect" | "publish";

export type InviteLink =
  | { kind: "personal"; url: string; preview: string }
  | { kind: "general"; url: string; preview: string; nameStep: InviteNameStep | null };

const general = (nameStep: InviteNameStep | null): InviteLink => ({ kind: "general", url: GENERAL_INVITE_URL, preview: GENERAL_INVITE_PREVIEW, nameStep });

interface ProfileAnswer { profile?: { handle?: unknown; invitable?: unknown } }

/**
 * The member's personal invite (community.tagify.fm/join/<handle>) when Community says it opens for
 * other people, and Community's general invite (community.tagify.fm/join) otherwise. Without an answer from Community (offline, or a Community
 * that doesn't report it yet) the general link goes out with no suggestion, so a member whose
 * profile is already public is never told to publish it.
 *
 * The profile route is outside sync and accepts only the session, so the request carries no sync
 * headers; sync still refreshes a session that is about to expire first.
 */
export async function resolveInviteLink(
  request: (path: string) => Promise<ProfileAnswer> = (path) => syncRuntime.communityRequest(path, { syncHeaders: false }),
): Promise<InviteLink> {
  if (!getDesktopSyncConfiguration()) return general("connect");
  let body: ProfileAnswer;
  try {
    body = await request("/api/v2/device/profile");
  } catch {
    return general(null);
  }
  const handle = body.profile?.handle;
  if (typeof handle !== "string" || !handle) return general(null);
  if (body.profile?.invitable === true) {
    const url = `${COMMUNITY_ORIGIN}/join/${encodeURIComponent(handle)}`;
    return { kind: "personal", url, preview: `${url}/opengraph-image` };
  }
  return general(body.profile?.invitable === false ? "publish" : null);
}
