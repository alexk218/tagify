import { getDesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { syncRuntime } from "@/services/sync/SyncRuntime";
import { COMMUNITY_PAGES_ORIGIN, openCommunityUrl } from "./communityLinks";
import { isInAppSignUpEnabled } from "./inAppSignUp";

/** How long Tagify waits for the sign-in link before opening the plain address. */
const LINK_TIMEOUT_MS = 4_000;

/**
 * Opens a tagify.fm page signed in as the account this computer is connected to (in-app sign-up,
 * slice 3; Alex, 2026-11-18: "Yes, one-time link (Recommended)"). Community answers a single-use,
 * short-lived sign-in link that lands on the page; the website asks before replacing a different
 * account already signed in there. Used for the buttons that open the member's own pages (profile,
 * Rewind, settings, Following), not for public pages such as a song or tag. Anything that goes wrong
 * opens the plain address, so the button always opens the page.
 */
export async function openCommunityUrlSignedIn(
  url: string,
  request: (path: string, options: { method: "POST"; body: unknown }) => Promise<unknown> = (path, options) => activeRuntime().communityRequest(path, options),
): Promise<void> {
  const next = sitePath(url);
  if (!next || !isInAppSignUpEnabled() || !getDesktopSyncConfiguration()) {
    openCommunityUrl(url);
    return;
  }
  let signedIn: string | null = null;
  try {
    const answer = await withTimeout(request("/api/v2/device/website-link", { method: "POST", body: { next } }), LINK_TIMEOUT_MS) as { url?: unknown } | null;
    if (typeof answer?.url === "string" && /^https:\/\//.test(answer.url)) signedIn = answer.url;
  } catch {
    // Switch off on Community, an expired connection or no network: open the page as it is.
  }
  openCommunityUrl(signedIn ?? url);
}

/** The path, query and fragment of a tagify.fm address; null for any other site. */
function sitePath(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== COMMUNITY_PAGES_ORIGIN) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

function activeRuntime() { return window.TagifySync || syncRuntime; }
