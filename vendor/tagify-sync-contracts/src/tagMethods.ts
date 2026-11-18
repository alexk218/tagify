/**
 * Tag origin (tagify-community `docs/TAG_ORIGIN_2026-11.md`): how a change to one tag on one item was
 * made. Private to the member: Community stores it on their tag assignment and never shows it to
 * anyone else, never sends it to analytics, and never records who a tag was copied from.
 *
 * - `typed`: the member picked this tag for this one item.
 * - `bulk`: one action applied to many items (bulk tagging, album tags onto its songs, tag delete).
 * - `copied`: copied from another member's tags.
 * - `suggested`: accepted a suggestion built from other members' tags.
 * - `imported`: brought in from an outside source (RYM).
 * - `smart_playlist`: added or removed because of a smart playlist.
 * - `rule`: an automatic tag rule (shelved; reserved).
 * - `agreed`: one-click agree with another member's tag (reserved for the agree test).
 * - `unknown`: not recorded (older versions, rows from before tag origin).
 *
 * Copies inside the member's own library keep the method of what they copy. Must match
 * `tagify_sync.tag_method` (Community migration 9001).
 */
export const TAG_MEMBERSHIP_METHODS = [
  "typed",
  "bulk",
  "copied",
  "suggested",
  "imported",
  "smart_playlist",
  "rule",
  "agreed",
  "unknown",
] as const;

export type TagMembershipMethod = (typeof TAG_MEMBERSHIP_METHODS)[number];

/**
 * What the sync check accepts as a method: any short, safe word. Deliberately looser than the list,
 * so a desktop newer than the server never has a whole batch refused; the server stores a method it
 * doesn't know as `unknown`.
 */
export const TAG_MEMBERSHIP_METHOD_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

export function isTagMembershipMethod(value: unknown): value is TagMembershipMethod {
  return typeof value === "string" && (TAG_MEMBERSHIP_METHODS as readonly string[]).includes(value);
}

/** The method Community stores for what a client sent: a known one as it is, anything else `unknown`. */
export function normalizeTagMembershipMethod(value: unknown): TagMembershipMethod {
  return isTagMembershipMethod(value) ? value : "unknown";
}

/** Throws when a present `method` isn't a short safe word. A missing one is fine. */
export function assertOptionalTagMembershipMethod(value: unknown): void {
  if (value !== undefined && (typeof value !== "string" || !TAG_MEMBERSHIP_METHOD_PATTERN.test(value))) {
    throw new Error("Invalid tag method");
  }
}
