import {
  STARTER_TAG_SEEDS,
  STARTER_TAG_VERSIONS,
  type InitialMergeConflictV1,
  type InitialMergeSource,
} from "@tagify/sync-contracts";

// Starter tags keep their IDs from one version to the next, but a version can move them: version 2
// put R&B where Country was. A library started with one version, linked to a Community library
// started with the other, would otherwise be asked which place to keep for each moved starter tag.
// Tagify settles those itself and keeps Community's place. Anything else about the tag (its name,
// folder or color), or a place the member chose, is still theirs to review.

/** A starter tag, folder or category exactly where some version of the starter tags puts it. */
const starterPlacements = new Set(
  STARTER_TAG_VERSIONS.flatMap((version) =>
    STARTER_TAG_SEEDS[version].map((row) => placementKey(row.id, row.kind, row.parentId, row.name, row.position)),
  ),
);

function placementKey(id: string, kind: unknown, parentId: unknown, name: unknown, position: unknown): string {
  return JSON.stringify([id, kind, parentId ?? null, name, position]);
}

interface TaxonomyConflictValue {
  kind: unknown;
  parentId: unknown;
  name: unknown;
  accentId?: unknown;
  position: unknown;
  deleted?: unknown;
}

function isTaxonomyConflictValue(value: unknown): value is TaxonomyConflictValue {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "position" in value;
}

/**
 * Whether a difference found while combining two libraries is only where a starter tag sits, with
 * each copy holding it where one version of the starter tags placed it.
 */
export function isStarterTagPlacementConflict(conflict: InitialMergeConflictV1): boolean {
  if (conflict.kind !== "taxonomy") return false;
  const device = conflict.deviceValue;
  const community = conflict.communityValue;
  if (!isTaxonomyConflictValue(device) || !isTaxonomyConflictValue(community)) return false;
  if (
    device.kind !== community.kind ||
    device.parentId !== community.parentId ||
    device.name !== community.name ||
    (device.accentId ?? null) !== (community.accentId ?? null) ||
    Boolean(device.deleted) !== Boolean(community.deleted)
  ) return false;
  return [device, community].every((value) =>
    starterPlacements.has(placementKey(conflict.subjectId, value.kind, value.parentId, value.name, value.position)),
  );
}

/**
 * Splits a review's differences into the ones the member chooses and the starter tag moves
 * Tagify settles itself. Those still go to Community as ordinary choices, so it combines the
 * libraries the same way.
 */
export function settleStarterTagPlacements(conflicts: InitialMergeConflictV1[]): {
  conflicts: InitialMergeConflictV1[];
  automaticResolutions: Record<string, InitialMergeSource>;
} {
  const automaticResolutions: Record<string, InitialMergeSource> = {};
  const remaining = conflicts.filter((conflict) => {
    if (!isStarterTagPlacementConflict(conflict)) return true;
    automaticResolutions[conflict.id] = "community";
    return false;
  });
  return { conflicts: remaining, automaticResolutions };
}
