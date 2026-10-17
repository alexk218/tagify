import type { PublicationPolicyV2 } from "@tagify/sync-contracts";
import type { TagTaxonomy, TaxonomyTag, TrackData } from "@/types/tagData";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";
import { syncRuntime } from "@/services/sync/SyncRuntime";
import { normalizeTaxonomyTree } from "@/utils/tagTaxonomy";
import { markCommunityPublishPromptDecided } from "./communityPublishPromptHistory";

const POLICY_PATH = "/api/v2/publication-policy";

/**
 * Where a member's public profile stands. "review" means they never chose, so
 * nothing from their library is public yet; "private" is an explicit choice.
 */
export type PublicationState = "review" | "public" | "private" | "paused";

export function publicationState(policy: PublicationPolicyV2): PublicationState {
  if (!policy.reviewedAt) return "review";
  if (!policy.enabled) return "private";
  if (policy.paused) return "paused";
  return "public";
}

/** Desktop always shares the tag structure and tags; the member's only tag choice is what to hide. */
export function normalizePublicationPolicy(policy: PublicationPolicyV2): PublicationPolicyV2 {
  return {
    ...policy,
    shareTaxonomy: true,
    hiddenTagIds: Array.isArray(policy.hiddenTagIds) ? policy.hiddenTagIds : [],
    hiddenNodeIds: Array.isArray(policy.hiddenNodeIds) ? policy.hiddenNodeIds : [],
    entities: {
      track: { ...policy.entities.track, tags: true },
      album: { ...policy.entities.album, tags: true },
      artist: { ...policy.entities.artist, tags: true },
    },
  };
}

export async function fetchPublicationPolicy(): Promise<PublicationPolicyV2> {
  const body = await syncRuntime.communityRequest(POLICY_PATH);
  return normalizePublicationPolicy(body.policy as PublicationPolicyV2);
}

/**
 * Saves the member's choice. Publishing state changes only when `enabled` is
 * passed, so editing hidden tags never republishes someone who stopped sharing.
 */
export async function savePublicationPolicy(policy: PublicationPolicyV2, choice: { enabled?: boolean } = {}): Promise<PublicationPolicyV2> {
  const next = normalizePublicationPolicy({ ...policy, ...choice, reviewedAt: new Date().toISOString() });
  const body = await syncRuntime.communityRequest(POLICY_PATH, {
    method: "PUT",
    body: { policy: next, expectedRevision: policy.revision },
  });
  const saved = normalizePublicationPolicy(body.policy as PublicationPolicyV2);
  if (publicationState(policy) !== "public" && publicationState(saved) === "public") recordPublished();
  if (publicationState(saved) !== "review") markCommunityPublishPromptDecided();
  return saved;
}

/** "Keep my tags private": a reviewed choice, so Tagify stops asking and backup keeps running. */
export async function keepTagsPrivate(policy: PublicationPolicyV2): Promise<PublicationPolicyV2> {
  const saved = await savePublicationPolicy(policy, { enabled: false });
  recordProductInteraction("community_publish_kept_private");
  return saved;
}

/** Takes the public profile down or resumes paused updates, matching Community's own controls. */
export async function changePublication(policy: PublicationPolicyV2, action: "unpublish" | "resume"): Promise<PublicationPolicyV2> {
  const body = await syncRuntime.communityRequest(`${POLICY_PATH}/${action}`, {
    method: "POST",
    body: { expectedRevision: policy.revision },
  });
  return normalizePublicationPolicy(body.policy as PublicationPolicyV2);
}

// Set when the publish invitation opens Sync, so a publish it led to is counted once, as its own.
let publishInvitationFollowed = false;

export function notePublishInvitationFollowed(): void {
  publishInvitationFollowed = true;
}

function recordPublished(): void {
  recordProductInteraction(publishInvitationFollowed ? "community_publish_prompt_published" : "community_profile_published");
  publishInvitationFollowed = false;
}

export interface VisibilityBranch {
  id: string;
  kind: "category" | "folder" | "tag";
  name: string;
  children: VisibilityBranch[];
}

export function buildVisibilityTree(taxonomy: TagTaxonomy): VisibilityBranch[] {
  const normalized = normalizeTaxonomyTree(taxonomy);
  const visit = (id: string): VisibilityBranch | null => {
    const category = normalized.categoriesById[id];
    const folder = normalized.subcategoriesById[id];
    const tag = normalized.tagsById[id];
    if (category) return { id: category.id, kind: "category", name: category.name, children: (normalized.childrenByParentId?.[id] || category.subcategoryIds || []).map(visit).filter(Boolean) as VisibilityBranch[] };
    if (folder) return { id: folder.id, kind: "folder", name: folder.name, children: (normalized.childrenByParentId?.[id] || folder.childIds || folder.tagIds || []).map(visit).filter(Boolean) as VisibilityBranch[] };
    if (tag) return { id: tag.id, kind: "tag", name: tag.name, children: [] };
    return null;
  };
  const rootIds = normalized.categoryOrder.length ? normalized.categoryOrder : Object.values(normalized.tagsById).filter(isRootTag).map((tag) => tag.id);
  return rootIds.map(visit).filter(Boolean) as VisibilityBranch[];
}

function isRootTag(tag: TaxonomyTag): boolean {
  return !tag.parentId;
}

/** What publishing would show today: tags the member hasn't hidden, and the songs carrying them. */
export function publicTagSummary(tracks: Record<string, TrackData>, taxonomy: TagTaxonomy, policy: PublicationPolicyV2): { tags: number; songs: number } {
  const visibleTagIds = new Set<string>();
  const hiddenTags = new Set(policy.hiddenTagIds);
  const hiddenNodes = new Set(policy.hiddenNodeIds);
  const collect = (node: VisibilityBranch, hidden: boolean) => {
    const branchHidden = hidden || hiddenNodes.has(node.id);
    if (node.kind === "tag") {
      if (!branchHidden && !hiddenTags.has(node.id)) visibleTagIds.add(node.id);
      return;
    }
    node.children.forEach((child) => collect(child, branchHidden));
  };
  buildVisibilityTree(taxonomy).forEach((node) => collect(node, false));

  const usedTags = new Set<string>();
  let songs = 0;
  for (const track of Object.values(tracks)) {
    const visible = (track.tagIds || []).filter((id) => visibleTagIds.has(id));
    if (!visible.length) continue;
    songs += 1;
    visible.forEach((id) => usedTags.add(id));
  }
  return { tags: usedTags.size, songs };
}

export function sharesRatings(policy: PublicationPolicyV2): boolean {
  return Boolean(policy.entities.track.rating || policy.entities.album.rating || policy.entities.artist.rating);
}
