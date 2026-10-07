import type { MusicEntityRefV1 } from "./index";
import { isRecord } from "./validation";

export const COMMUNITY_COMMENT_VERSION = 1 as const;
export const COMMUNITY_COMMENT_BODY_LIMIT = 2_000;

export type CommunityCommentTargetV1 =
  | { kind: "profile"; profileId: string }
  | { kind: "taxonomy"; taxonomyId: string; revisionId: string | null }
  | { kind: "entity"; entity: MusicEntityRefV1 };

export interface CommunityCommentV1 {
  commentVersion: typeof COMMUNITY_COMMENT_VERSION;
  id: string;
  author: { handle: string | null; displayName: string | null };
  target: CommunityCommentTargetV1;
  parentId: string | null;
  body: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  moderationState: "visible" | "hidden" | "removed";
  createdAt: string;
  updatedAt: string;
}

export function assertCommunityCommentBodyV1(
  value: unknown,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > COMMUNITY_COMMENT_BODY_LIMIT ||
    /\u0000/.test(value)
  ) {
    throw new Error(
      `Comments must contain 1–${COMMUNITY_COMMENT_BODY_LIMIT} characters`,
    );
  }
}

export function assertCommunityCommentV1(
  value: unknown,
): asserts value is CommunityCommentV1 {
  if (!isRecord(value) || value.commentVersion !== 1 || !isBoundedId(value.id))
    throw new Error("Unsupported Community comment");
  if (!isRecord(value.author)) throw new Error("Invalid comment author");
  if (
    value.author.handle !== null &&
    (typeof value.author.handle !== "string" ||
      !/^[a-z0-9_]{2,32}$/.test(value.author.handle))
  )
    throw new Error("Invalid comment author handle");
  if (
    value.author.displayName !== null &&
    (typeof value.author.displayName !== "string" ||
      value.author.displayName.length < 1 ||
      value.author.displayName.length > 80)
  )
    throw new Error("Invalid comment author name");
  if (value.body !== null) assertCommunityCommentBodyV1(value.body);
  if (value.deletedAt === null && value.body === null)
    throw new Error("Visible comments require a body");
  if (
    value.moderationState !== "visible" &&
    value.moderationState !== "hidden" &&
    value.moderationState !== "removed"
  )
    throw new Error("Invalid comment moderation state");
  if (value.parentId !== null && !isBoundedId(value.parentId))
    throw new Error("Invalid comment parent");
  if (
    !isRecord(value.target) ||
    (value.target.kind !== "profile" &&
      value.target.kind !== "taxonomy" &&
      value.target.kind !== "entity")
  )
    throw new Error("Invalid comment target");
  if (value.target.kind === "profile" && !isBoundedId(value.target.profileId))
    throw new Error("Invalid profile comment target");
  if (
    value.target.kind === "taxonomy" &&
    (!isBoundedId(value.target.taxonomyId) ||
      (value.target.revisionId !== null &&
        !isBoundedId(value.target.revisionId)))
  )
    throw new Error("Invalid taxonomy comment target");
  if (value.target.kind === "entity") assertEntityRef(value.target.entity);
  for (const field of ["createdAt", "updatedAt"] as const)
    if (
      typeof value[field] !== "string" ||
      !Number.isFinite(Date.parse(value[field]))
    )
      throw new Error(`Invalid comment ${field}`);
  for (const field of ["editedAt", "deletedAt"] as const)
    if (
      value[field] !== null &&
      (typeof value[field] !== "string" ||
        !Number.isFinite(Date.parse(value[field])))
    )
      throw new Error(`Invalid comment ${field}`);
}

function isBoundedId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function assertEntityRef(value: unknown): asserts value is MusicEntityRefV1 {
  if (
    !isRecord(value) ||
    value.provider !== "spotify" ||
    (value.kind !== "track" &&
      value.kind !== "album" &&
      value.kind !== "artist") ||
    typeof value.providerId !== "string" ||
    !/^[A-Za-z0-9]{10,64}$/.test(value.providerId)
  )
    throw new Error("Invalid entity comment target");
}
