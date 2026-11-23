import type { PublicationPolicyV2 } from "@tagify/sync-contracts";
import { getUsageAccountDigest } from "@/features/discovery-survey/services/tagifyUsage";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";
import { syncRuntime } from "@/services/sync/SyncRuntime";
import { COMMUNITY_PAGES_ORIGIN } from "./communityLinks";

/**
 * Whether the member's star ratings show on their Community profile, and the
 * one-time question "Share your ratings on your profile?". The answer lives on
 * Community, so it is asked once across the website and every computer.
 */
const PATH = "/api/v2/rating-sharing";

/** A note on this computer that the member answered, so a failed check never asks again. */
export const RATING_SHARING_ANSWERED_PREFIX = "tagify:community-rating-sharing:v1:";

/** Sent on `window` with the saved state whenever this computer saves an answer, so every open view agrees. */
export const COMMUNITY_RATING_SHARING_CHANGED_EVENT = "tagify:communityRatingSharingChanged";

/** Where the member answered: the question after rating, publishing their tags, or an update notice. */
export type RatingSharingSurface = "desktop_question" | "desktop_publish" | "notice";

export interface RatingSharing {
  /** False while Community has ratings paused. */
  available: boolean;
  shared: boolean;
  answered: boolean;
  profilePublic: boolean;
  rated: boolean;
  /** Community's own answer to "should Tagify ask this member now?". */
  askOnDesktop: boolean;
}

/** Approved wording (Alex, 2026-11-11 and 2026-11-14). The question bar's title and line are his option A of 2026-11-14. */
export const RATING_SHARING_COPY = {
  question: "Help people who tag like you find great music",
  explanation: "Your 5-star songs show up for people with taste like yours, and your stars appear on your profile. Only on music you've tagged.",
  share: "Share my ratings",
  keepPrivate: "Keep them private",
  shared: "Your ratings now show on music you've tagged.",
  keptPrivate: "Your ratings stay private.",
  changeLater: "Change this any time in Privacy settings.",
  changeLaterLead: "Change this any time in",
  privacySettings: "Privacy settings",
} as const;

export function parseRatingSharing(body: unknown): RatingSharing | null {
  const value = (body as { ratingSharing?: Record<string, unknown> } | null)?.ratingSharing;
  if (!value || typeof value !== "object") return null;
  const keys = ["available", "shared", "answered", "profilePublic", "rated", "askOnDesktop"] as const;
  if (!keys.every((key) => typeof value[key] === "boolean")) return null;
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as unknown as RatingSharing;
}

/** The member's rating sharing, or null when Community can't say (offline, or the route isn't live yet). */
export async function fetchRatingSharing(): Promise<RatingSharing | null> {
  try {
    return parseRatingSharing(await syncRuntime.communityRequest(PATH));
  } catch {
    return null;
  }
}

/** Whether Tagify may offer to share ratings at all: available, a public profile, and never answered. */
export function canOfferRatingSharing(sharing: RatingSharing | null): sharing is RatingSharing {
  return Boolean(sharing && sharing.available && sharing.profilePublic && !sharing.answered);
}

/** Whether the question after rating should appear: Community says to ask, and this computer has no answer on note. */
export function shouldAskRatingSharing(sharing: RatingSharing | null, answeredHere: boolean): boolean {
  return !answeredHere && canOfferRatingSharing(sharing) && sharing.askOnDesktop;
}

/**
 * Saves the member's answer on Community. Throws when it couldn't be saved;
 * the answered event is sent only after Community kept it.
 */
export async function saveRatingSharing(share: boolean, surface: RatingSharingSurface): Promise<RatingSharing> {
  const body = await syncRuntime.communityRequest(PATH, { method: "POST", body: { share, surface } });
  const saved = parseRatingSharing(body);
  if (!saved) throw new Error("Unexpected answer from Community");
  markRatingSharingAnswered();
  recordProductInteraction("community_rating_sharing_answered", { answer: share ? "yes" : "no", surface });
  try {
    window.dispatchEvent(new CustomEvent(COMMUNITY_RATING_SHARING_CHANGED_EVENT, { detail: { ratingSharing: saved } }));
  } catch { /* Other views catch up on their next check. */ }
  return saved;
}

/** Sent once each time the question, the publish choice or the notice button is shown. */
export function recordRatingSharingAsked(surface: RatingSharingSurface): void {
  recordProductInteraction("community_rating_sharing_asked", { surface });
}

/** A plain message for a save that failed, with the next step. */
export function ratingSharingErrorMessage(error: unknown): string {
  return (error as { status?: number } | null)?.status === 503
    ? "Ratings are paused right now. Try again later."
    : "Couldn't save your choice. Please try again.";
}

/** Sets song and album rating sharing together. */
export function withRatingSharing(policy: PublicationPolicyV2, share: boolean): PublicationPolicyV2 {
  return {
    ...policy,
    entities: {
      ...policy.entities,
      track: { ...policy.entities.track, rating: share },
      album: { ...policy.entities.album, rating: share },
    },
  };
}

export function readRatingSharingAnswered(accountDigest: string): boolean {
  try {
    return localStorage.getItem(`${RATING_SHARING_ANSWERED_PREFIX}${accountDigest}`) === "answered";
  } catch {
    return false;
  }
}

export function markRatingSharingAnsweredFor(accountDigest: string): void {
  try { localStorage.setItem(`${RATING_SHARING_ANSWERED_PREFIX}${accountDigest}`, "answered"); }
  catch { /* Community still keeps the answer. */ }
}

/** Community's privacy settings, where rating sharing can be changed later. */
export const COMMUNITY_PRIVACY_SETTINGS_URL = `${COMMUNITY_PAGES_ORIGIN}/settings/privacy`;

/** A note that the question was shown on this computer: it is asked at most once per computer, answered or not. */
export const RATING_SHARING_ASKED_PREFIX = "tagify:community-rating-sharing-asked:v1:";

export function readRatingSharingAsked(accountDigest: string): boolean {
  try {
    return localStorage.getItem(`${RATING_SHARING_ASKED_PREFIX}${accountDigest}`) === "asked";
  } catch {
    return false;
  }
}

export function markRatingSharingAskedFor(accountDigest: string): void {
  try { localStorage.setItem(`${RATING_SHARING_ASKED_PREFIX}${accountDigest}`, "asked"); }
  catch { /* It still asks only once in this run. */ }
}

function markRatingSharingAnswered(): void {
  void getUsageAccountDigest().then((digest) => {
    if (digest) markRatingSharingAnsweredFor(digest);
  }).catch(() => { /* Community still keeps the answer. */ });
}
