import { syncRuntime } from "@/services/sync/SyncRuntime";
import { COMMUNITY_PAGES_ORIGIN } from "../communityLinks";

/**
 * Community notifications in Tagify on the computer (Alex, 2026-11-22: a bell for members connected
 * to Community; "Yes, 1A": an unread count and a short list, each entry opening its page on Community).
 * Community words and links every entry the way the website's bell does: /api/v2/device/notifications
 * answers the phone apps' list (@tagify/community-contracts/mobile-v1) with the computer's own
 * Community sign-in. Until Community serves it (404), the bell stays hidden.
 */
export const NOTIFICATIONS_PATH = "/api/v2/device/notifications";

/** Where an entry leads, as Community answers it (MobileNotificationOpenV1). */
export type NotificationOpen =
  | { screen: "profile"; handle: string }
  | { screen: "song"; catalogEntityId: string }
  | { screen: "tag"; slug: string }
  | { screen: "website"; path: string };

export interface CommunityNotification {
  id: number;
  kind: string;
  text: string;
  createdAt: string;
  read: boolean;
  open: NotificationOpen;
}

export interface NotificationsPage {
  items: CommunityNotification[];
  nextCursor: number | null;
  unread: number;
}

type Request = (path: string, options?: { method?: "GET" | "PATCH"; body?: unknown }) => Promise<unknown>;

const runtime = () => window.TagifySync || syncRuntime;
const defaultRequest: Request = (path, options) => runtime().communityRequest(path, options);

const HANDLE = /^[a-z0-9][a-z0-9_]{2,29}$/;
const ENTITY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The tagify.fm page an entry opens. Anything unexpected opens the home page rather than a broken link. */
export function notificationUrl(open: NotificationOpen | null | undefined): string {
  switch (open?.screen) {
    case "profile":
      if (HANDLE.test(open.handle)) return `${COMMUNITY_PAGES_ORIGIN}/@${open.handle}`;
      break;
    case "song":
      if (ENTITY.test(open.catalogEntityId)) return `${COMMUNITY_PAGES_ORIGIN}/recording/${open.catalogEntityId.toLowerCase()}`;
      break;
    case "tag":
      if (SLUG.test(open.slug)) return `${COMMUNITY_PAGES_ORIGIN}/tags/${open.slug}`;
      break;
    case "website":
      if (typeof open.path === "string" && open.path.startsWith("/") && !open.path.startsWith("//")) return `${COMMUNITY_PAGES_ORIGIN}${open.path}`;
      break;
  }
  return `${COMMUNITY_PAGES_ORIGIN}/`;
}

function isNotification(value: unknown): value is CommunityNotification {
  const item = value as Partial<CommunityNotification> | null;
  return !!item && Number.isSafeInteger(item.id) && typeof item.text === "string" && typeof item.createdAt === "string" && typeof item.read === "boolean";
}

/** One page of notifications, newest first; `before` is the previous page's `nextCursor`. */
export async function fetchNotifications(before: number | null = null, request: Request = defaultRequest): Promise<NotificationsPage> {
  const answer = await request(before ? `${NOTIFICATIONS_PATH}?before=${before}` : NOTIFICATIONS_PATH) as Partial<NotificationsPage> | null;
  if (!answer || !Array.isArray(answer.items)) throw new Error("Unexpected notifications answer");
  return {
    items: answer.items.filter(isNotification),
    nextCursor: Number.isSafeInteger(answer.nextCursor) ? answer.nextCursor as number : null,
    unread: Number.isSafeInteger(answer.unread) && (answer.unread as number) >= 0 ? answer.unread as number : 0,
  };
}

/** Marks entries read (shown in the open list); answers the unread count that is left. */
export async function markNotificationsRead(ids: number[], request: Request = defaultRequest): Promise<number | null> {
  if (!ids.length) return null;
  const answer = await request(NOTIFICATIONS_PATH, { method: "PATCH", body: { ids: ids.slice(0, 50), via: "list" } }) as { unread?: unknown } | null;
  return Number.isSafeInteger(answer?.unread) ? answer!.unread as number : null;
}

/** "Just now", "5 min ago", "Yesterday", "Oct 3", as the website's bell says it, with the full date for a tooltip. */
export function notificationTime(createdAt: string, now: number): { short: string; full: string } | null {
  const at = Date.parse(createdAt);
  if (!Number.isFinite(at) || !now) return null;
  const date = new Date(at);
  const full = date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const minutes = Math.floor((now - at) / 60_000);
  const hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
  const short = minutes < 1
    ? "Just now"
    : minutes < 60
      ? `${minutes} min ago`
      : hours < 24
        ? `${hours} hr ago`
        : days === 1
          ? "Yesterday"
          : days < 7
            ? `${days} days ago`
            : date.toLocaleDateString("en-US", date.getFullYear() === new Date(now).getFullYear()
              ? { month: "short", day: "numeric" }
              : { month: "short", day: "numeric", year: "numeric" });
  return { short, full };
}

/** "3", or "9+" past nine, for the bell's count. */
export function unreadLabel(unread: number): string {
  return unread > 9 ? "9+" : String(unread);
}
