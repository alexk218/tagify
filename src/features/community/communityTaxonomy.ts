import {
  canonicalJson,
  projectPublishedTaxonomyArtifactV1,
  type InstalledTaxonomyRecordV1,
  type OwnerTaxonomyIdentityMappingV1,
  type PublicationPolicyV1,
  type PublishedTaxonomyArtifactV1,
  type PublishedTaxonomyNodeV1,
} from "@tagify/community-contracts";
import type {
  CustomTagAccent,
  TagTaxonomy,
  TaxonomyCategory,
  TaxonomyFolder,
  TaxonomySubcategory,
  TaxonomyTag,
} from "@/types/tagData";
import { normalizeTaxonomyTree } from "@/utils/tagTaxonomy";

export interface TaxonomyInstallOptionsV1 {
  selectedCategoryPublicIds?: string[];
  categoryMergeTargets?: Record<string, string | null>;
  now?: Date;
  createId?: (kind: "installation" | "category" | "folder" | "subcategory" | "tag" | "color" | "collection") => string;
}

export interface TaxonomyInstallConflictV1 {
  kind: "category-label" | "color-name" | "collection-name";
  publicId: string;
  original: string;
  installedAs: string;
}

export interface TaxonomyInstallPlanV1 {
  taxonomy: TagTaxonomy;
  installation: InstalledTaxonomyRecordV1;
  conflicts: TaxonomyInstallConflictV1[];
  counts: { categories: number; subcategories: number; tags: number; colors: number; collections: number };
}

export interface TaxonomyUpdateChangeV1 {
  publicId: string;
  kind: "added" | "changed" | "deleted";
  target: "node" | "color" | "collection";
  status: "safe" | "conflict" | "detached";
  summary: string;
}

export interface TaxonomyUpdatePreviewV1 {
  fromRevision: number;
  toRevision: number;
  changes: TaxonomyUpdateChangeV1[];
  safePublicIds: string[];
  conflictingPublicIds: string[];
}

export interface TaxonomyUpdateApplyOptionsV1 {
  selectedPublicIds?: string[];
  now?: Date;
  createId?: TaxonomyInstallOptionsV1["createId"];
}

export interface TaxonomyUpdateApplyPlanV1 {
  taxonomy: TagTaxonomy;
  installation: InstalledTaxonomyRecordV1;
  preview: TaxonomyUpdatePreviewV1;
  appliedPublicIds: string[];
  retainedConflictPublicIds: string[];
  detachedLocalIds: string[];
}

export interface PortableTaxonomyExportOptionsV1 {
  author?: { handle: string | null; displayName: string | null };
  description?: string | null;
  installedSources?: InstalledTaxonomyRecordV1[];
  now?: Date;
  createPublicId?: (kind: "taxonomy" | "revision" | "share" | "node" | "color" | "collection") => string;
}

export async function buildPortableTaxonomyArtifact(
  taxonomy: TagTaxonomy,
  options: PortableTaxonomyExportOptionsV1 = {},
): Promise<PublishedTaxonomyArtifactV1> {
  const createPublicId = options.createPublicId ?? defaultPublicId;
  const normalizedTaxonomy = normalizeTaxonomyTree(taxonomy);
  const nodeIds = [
    ...normalizedTaxonomy.categoryOrder,
    ...Object.keys(normalizedTaxonomy.foldersById || normalizedTaxonomy.subcategoriesById),
    ...Object.keys(normalizedTaxonomy.tagsById),
  ];
  const colorIds = Object.keys(taxonomy.customAccentsById);
  const collectionIds = taxonomy.colorThemeOrder ?? Object.keys(taxonomy.colorThemesById);
  const mapping: OwnerTaxonomyIdentityMappingV1 = {
    taxonomyId: createPublicId("taxonomy"),
    localNodeToPublicId: Object.fromEntries(nodeIds.map((id) => [id, createPublicId("node")])),
    localColorToPublicId: Object.fromEntries(colorIds.map((id) => [id, createPublicId("color")])),
    localCollectionToPublicId: Object.fromEntries(collectionIds.map((id) => [id, createPublicId("collection")])),
  };
  const policy: PublicationPolicyV1 = {
    policyVersion: 1,
    visibility: "unlisted",
    approvedLocalNodeIds: nodeIds,
    approvedLocalColorIds: colorIds,
    approvedLocalCollectionIds: collectionIds,
    entityRules: {
      track: { tags: false, ratings: false },
      album: { tags: false, ratings: false },
      artist: { tags: false, ratings: false },
    },
    excludedEntities: [],
    publishActivity: false,
  };
  const lineage = (options.installedSources ?? []).flatMap((source) => {
    const sourceNodePublicIds = Object.entries(source.nodePublicToLocalId)
      .filter(([, localId]) => Boolean(normalizedTaxonomy.categoriesById[localId] ?? normalizedTaxonomy.subcategoriesById[localId] ?? normalizedTaxonomy.tagsById[localId]))
      .map(([publicId]) => publicId);
    return sourceNodePublicIds.length ? [{
      sourceTaxonomyId: source.taxonomyId,
      sourceRevisionId: source.sourceRevisionId,
      sourceAuthorHandle: source.sourceAuthor.handle,
      sourceAuthorTombstoned: source.sourceAuthor.handle === null,
      sourceNodePublicIds,
    }] : [];
  });
  return projectPublishedTaxonomyArtifactV1(
    { schemaVersion: 9, taxonomy: normalizedTaxonomy },
    policy,
    mapping,
    {
      taxonomyId: mapping.taxonomyId,
      revisionId: createPublicId("revision"),
      revision: 1,
      shareSlug: createPublicId("share"),
      author: options.author ?? { handle: null, displayName: "Local Tagify user" },
      description: options.description ?? "A shared Tagify tag setup with its colors.",
      publishedAt: (options.now ?? new Date()).toISOString(),
      sourceTagifySchemaVersion: 9,
      lineage,
    },
  );
}

export async function buildTaxonomyInstallPlan(
  current: TagTaxonomy,
  artifact: PublishedTaxonomyArtifactV1,
  options: TaxonomyInstallOptionsV1 = {},
): Promise<TaxonomyInstallPlanV1> {
  const createId = options.createId ?? defaultCreateId;
  const now = (options.now ?? new Date()).toISOString();
  const selectedRoots = new Set(options.selectedCategoryPublicIds ?? artifact.nodes.filter((node) => node.kind === "category").map((node) => node.publicId));
  const includedNodes = collectSelectedNodes(artifact.nodes, selectedRoots);
  const next = structuredClone(current);
  const conflicts: TaxonomyInstallConflictV1[] = [];
  const nodeMap: Record<string, string> = {};
  const colorMap: Record<string, string> = {};
  const collectionMap: Record<string, string> = {};
  const fingerprints: Record<string, string> = {};
  const authorSuffix = artifact.author.handle ? `from @${artifact.author.handle}` : "from Community";

  for (const collection of artifact.collections) {
    const localId = createId("collection");
    const name = uniqueName(collection.name, Object.values(next.colorThemesById).map((item) => item.name), authorSuffix);
    if (name !== collection.name) conflicts.push({ kind: "collection-name", publicId: collection.publicId, original: collection.name, installedAs: name });
    next.colorThemesById[localId] = { id: localId, name, colorIds: [] };
    next.colorThemeOrder = [...(next.colorThemeOrder ?? []), localId];
    collectionMap[collection.publicId] = localId;
    fingerprints[collection.publicId] = fingerprint(comparableCollection(collection));
  }

  for (const color of artifact.colors) {
    const localId = createId("color") as `custom:${string}`;
    const name = uniqueName(color.name, Object.values(next.customAccentsById).map((item) => item.name), authorSuffix);
    if (name !== color.name) conflicts.push({ kind: "color-name", publicId: color.publicId, original: color.name, installedAs: name });
    const themeId = color.collectionPublicId ? collectionMap[color.collectionPublicId] ?? null : null;
    const accent: CustomTagAccent = { id: localId, name, color: color.hex, themeId, createdAt: Date.parse(now), updatedAt: Date.parse(now) };
    next.customAccentsById[localId] = accent;
    colorMap[color.publicId] = localId;
    if (themeId) next.colorThemesById[themeId].colorIds.push(localId);
    else next.ungroupedColorIds.push(localId);
    fingerprints[color.publicId] = fingerprint(comparableColor(color));
  }

  normalizeMutableTaxonomy(next);
  const orderedNodes = orderPublishedNodes(includedNodes);
  for (const node of orderedNodes) {
    if (node.kind === "category") {
      const mergeTarget = options.categoryMergeTargets?.[node.publicId] ?? null;
      const categoryId = mergeTarget && next.categoriesById[mergeTarget] ? mergeTarget : createId("category");
      if (!next.categoriesById[categoryId]) {
        const name = uniqueName(node.label, Object.values(next.categoriesById).map((item) => item.name), authorSuffix);
        if (name !== node.label) conflicts.push({ kind: "category-label", publicId: node.publicId, original: node.label, installedAs: name });
        next.categoriesById[categoryId] = { id: categoryId, name, subcategoryIds: [], childIds: [] };
        next.categoryOrder.push(categoryId);
        next.childrenByParentId![categoryId] = [];
      }
      nodeMap[node.publicId] = categoryId;
    } else if (node.kind === "folder" || node.kind === "subcategory") {
      const parentId = node.parentPublicId ? nodeMap[node.parentPublicId] : null;
      if (!parentId) continue;
      const folderId = createId(node.kind === "subcategory" ? "subcategory" : "folder");
      const siblingNames = (next.childrenByParentId![parentId] || []).map((id) => next.subcategoriesById[id]?.name || next.tagsById[id]?.name).filter(Boolean) as string[];
      const folder: TaxonomyFolder = { id: folderId, name: uniqueName(node.label, siblingNames, authorSuffix), parentId, categoryId: rootCategoryId(next, parentId) || parentId, tagIds: [], childIds: [] };
      next.foldersById![folderId] = folder;
      next.subcategoriesById[folderId] = folder;
      next.childrenByParentId![folderId] = [];
      next.childrenByParentId![parentId] = [...(next.childrenByParentId![parentId] || []), folderId];
      next.categoriesById[parentId]?.subcategoryIds.push(folderId);
      next.categoriesById[parentId]?.childIds?.push(folderId);
      nodeMap[node.publicId] = folderId;
    } else {
      const parentId = node.parentPublicId ? nodeMap[node.parentPublicId] : null;
      if (!parentId) continue;
      const tagId = createId("tag");
      const siblingTagNames = (next.childrenByParentId![parentId] || []).map((id) => next.tagsById[id]?.name).filter(Boolean) as string[];
      const tag: TaxonomyTag = { id: tagId, name: uniqueName(node.label, siblingTagNames, authorSuffix), parentId, subcategoryId: parentId, accentId: localAccentId(node, colorMap) };
      next.tagsById[tagId] = tag;
      next.childrenByParentId![parentId] = [...(next.childrenByParentId![parentId] || []), tagId];
      next.subcategoriesById[parentId]?.tagIds.push(tagId);
      next.subcategoriesById[parentId]?.childIds?.push(tagId);
      next.categoriesById[parentId]?.childIds?.push(tagId);
      nodeMap[node.publicId] = tagId;
    }
    fingerprints[node.publicId] = fingerprint(comparableNode(node));
  }

  const installedLocalFingerprints: Record<string, string> = {};
  for (const publicId of Object.keys(nodeMap)) installedLocalFingerprints[publicId] = fingerprintLocal(publicId, "node", next, { nodePublicToLocalId: nodeMap, colorPublicToLocalId: colorMap, collectionPublicToLocalId: collectionMap } as InstalledTaxonomyRecordV1) ?? "";
  for (const publicId of Object.keys(colorMap)) installedLocalFingerprints[publicId] = fingerprintLocal(publicId, "color", next, { nodePublicToLocalId: nodeMap, colorPublicToLocalId: colorMap, collectionPublicToLocalId: collectionMap } as InstalledTaxonomyRecordV1) ?? "";
  for (const publicId of Object.keys(collectionMap)) installedLocalFingerprints[publicId] = fingerprintLocal(publicId, "collection", next, { nodePublicToLocalId: nodeMap, colorPublicToLocalId: colorMap, collectionPublicToLocalId: collectionMap } as InstalledTaxonomyRecordV1) ?? "";
  const installation: InstalledTaxonomyRecordV1 = {
    recordVersion: 1,
    installationId: createId("installation"),
    taxonomyId: artifact.taxonomyId,
    sourceShareSlug: artifact.shareSlug,
    sourceRevisionId: artifact.revisionId,
    sourceRevision: artifact.revision,
    sourceAuthor: artifact.author,
    installedAt: now,
    updatedAt: now,
    lastUpdateCheckAt: null,
    nodePublicToLocalId: nodeMap,
    colorPublicToLocalId: colorMap,
    collectionPublicToLocalId: collectionMap,
    sourceFingerprints: fingerprints,
    installedLocalFingerprints,
    locallyEditedPublicIds: [],
    detachedLocalIds: [],
  };
  return {
    taxonomy: next,
    installation,
    conflicts,
    counts: { categories: includedNodes.filter((node) => node.kind === "category").length, subcategories: includedNodes.filter((node) => node.kind === "folder" || node.kind === "subcategory").length, tags: includedNodes.filter((node) => node.kind === "tag").length, colors: artifact.colors.length, collections: artifact.collections.length },
  };
}

export function previewTaxonomyUpdate(
  local: TagTaxonomy,
  installation: InstalledTaxonomyRecordV1,
  previous: PublishedTaxonomyArtifactV1,
  current: PublishedTaxonomyArtifactV1,
): TaxonomyUpdatePreviewV1 {
  if (installation.taxonomyId !== current.taxonomyId || previous.taxonomyId !== current.taxonomyId) throw new Error("Taxonomy update source does not match the installation");
  return previewTaxonomyUpdateFromRecord(local, installation, current);
}

export function previewTaxonomyUpdateFromRecord(
  local: TagTaxonomy,
  installation: InstalledTaxonomyRecordV1,
  current: PublishedTaxonomyArtifactV1,
): TaxonomyUpdatePreviewV1 {
  if (installation.taxonomyId !== current.taxonomyId)
    throw new Error("Taxonomy update source does not match the installation");
  const currentItems = artifactItems(current);
  const changes: TaxonomyUpdateChangeV1[] = [];
  for (const [publicId, item] of currentItems) {
    const sourceFingerprint = installation.sourceFingerprints[publicId];
    if (!sourceFingerprint) {
      changes.push({ publicId, kind: "added", target: item.target, status: "safe", summary: `Add ${item.label}` });
      continue;
    }
    if (sourceFingerprint === fingerprint(item.value)) continue;
    const localFingerprint = fingerprintLocal(publicId, item.target, local, installation);
    const installedFingerprint = installation.installedLocalFingerprints[publicId];
    const locallyEdited = installation.locallyEditedPublicIds.includes(publicId) || !localFingerprint || localFingerprint !== installedFingerprint;
    changes.push({ publicId, kind: "changed", target: item.target, status: locallyEdited ? "conflict" : "safe", summary: `Update ${item.label}` });
  }
  for (const publicId of Object.keys(installation.sourceFingerprints)) {
    if (!currentItems.has(publicId)) {
      const target = installation.nodePublicToLocalId[publicId] ? "node" : installation.colorPublicToLocalId[publicId] ? "color" : "collection";
      changes.push({ publicId, kind: "deleted", target, status: "detached", summary: `Keep the local item and detach it from Community` });
    }
  }
  return {
    fromRevision: installation.sourceRevision,
    toRevision: current.revision,
    changes,
    safePublicIds: changes.filter((change) => change.status === "safe").map((change) => change.publicId),
    conflictingPublicIds: changes.filter((change) => change.status === "conflict").map((change) => change.publicId),
  };
}

export function applyTaxonomyUpdate(
  local: TagTaxonomy,
  installation: InstalledTaxonomyRecordV1,
  current: PublishedTaxonomyArtifactV1,
  options: TaxonomyUpdateApplyOptionsV1 = {},
): TaxonomyUpdateApplyPlanV1 {
  const preview = previewTaxonomyUpdateFromRecord(local, installation, current);
  const selected = new Set(options.selectedPublicIds ?? preview.safePublicIds);
  const next = structuredClone(local);
  const record = structuredClone(installation);
  const createId = options.createId ?? defaultCreateId;
  const currentItems = artifactItems(current);
  const appliedPublicIds: string[] = [];
  const retainedConflictPublicIds = preview.conflictingPublicIds.filter((id) => !selected.has(id));
  const detachedLocalIds = [...record.detachedLocalIds];
  const suffix = current.author.handle ? `from @${current.author.handle}` : "from Community";

  for (const change of preview.changes.filter((item) => item.kind === "deleted")) {
    const localId = record.nodePublicToLocalId[change.publicId] ?? record.colorPublicToLocalId[change.publicId] ?? record.collectionPublicToLocalId[change.publicId];
    if (localId && !detachedLocalIds.includes(localId)) detachedLocalIds.push(localId);
    delete record.nodePublicToLocalId[change.publicId];
    delete record.colorPublicToLocalId[change.publicId];
    delete record.collectionPublicToLocalId[change.publicId];
    delete record.sourceFingerprints[change.publicId];
    delete record.installedLocalFingerprints[change.publicId];
  }

  const selectedChanges = preview.changes.filter((item) => item.status !== "detached" && selected.has(item.publicId));
  for (const collection of current.collections) {
    if (!selectedChanges.some((change) => change.publicId === collection.publicId)) continue;
    let localId = record.collectionPublicToLocalId[collection.publicId];
    if (!localId) {
      localId = createUnusedLocalId("collection", next, createId);
      record.collectionPublicToLocalId[collection.publicId] = localId;
      next.colorThemesById[localId] = { id: localId, name: collection.name, colorIds: [] };
      next.colorThemeOrder = [...(next.colorThemeOrder ?? []), localId];
    } else next.colorThemesById[localId].name = collection.name;
    appliedPublicIds.push(collection.publicId);
  }
  for (const color of current.colors) {
    if (!selectedChanges.some((change) => change.publicId === color.publicId)) continue;
    let localId = record.colorPublicToLocalId[color.publicId] as `custom:${string}` | undefined;
    const themeId = color.collectionPublicId ? record.collectionPublicToLocalId[color.collectionPublicId] ?? null : null;
    if (!localId) {
      localId = createUnusedLocalId("color", next, createId) as `custom:${string}`;
      record.colorPublicToLocalId[color.publicId] = localId;
      const name = uniqueName(color.name, Object.values(next.customAccentsById).map((item) => item.name), suffix);
      next.customAccentsById[localId] = { id: localId, name, color: color.hex, themeId };
    } else {
      const value = next.customAccentsById[localId];
      if (value) Object.assign(value, { name: color.name, color: color.hex, themeId, updatedAt: (options.now ?? new Date()).getTime() });
    }
    removeColorFromOrdering(next, localId);
    if (themeId && next.colorThemesById[themeId]) next.colorThemesById[themeId].colorIds.push(localId);
    else next.ungroupedColorIds.push(localId);
    appliedPublicIds.push(color.publicId);
  }
  normalizeMutableTaxonomy(next);
  for (const kind of ["category", "folder", "subcategory", "tag"] as const) {
    for (const node of current.nodes.filter((item) => item.kind === kind)) {
      if (!selectedChanges.some((change) => change.publicId === node.publicId)) continue;
      let localId = record.nodePublicToLocalId[node.publicId];
      if (!localId) {
        localId = createUnusedLocalId(kind, next, createId);
        record.nodePublicToLocalId[node.publicId] = localId;
        if (kind === "category") {
          const name = uniqueName(node.label, Object.values(next.categoriesById).map((item) => item.name), suffix);
          next.categoriesById[localId] = { id: localId, name, subcategoryIds: [], childIds: [] };
          next.categoryOrder.push(localId);
          next.childrenByParentId![localId] = [];
        } else if (kind === "folder" || kind === "subcategory") {
          const parentId = record.nodePublicToLocalId[node.parentPublicId!];
          if (!parentId || (!next.categoriesById[parentId] && !next.subcategoriesById[parentId])) continue;
          const siblings = (next.childrenByParentId![parentId] || []).map((id) => next.subcategoriesById[id]?.name || next.tagsById[id]?.name).filter(Boolean) as string[];
          const folder = { id: localId, name: uniqueName(node.label, siblings, suffix), parentId, categoryId: rootCategoryId(next, parentId) || parentId, tagIds: [], childIds: [] };
          next.foldersById![localId] = folder;
          next.subcategoriesById[localId] = folder;
          next.childrenByParentId![localId] = [];
          next.childrenByParentId![parentId] = [...(next.childrenByParentId![parentId] || []), localId];
          next.categoriesById[parentId]?.subcategoryIds.push(localId);
          next.categoriesById[parentId]?.childIds?.push(localId);
        } else {
          const parentId = record.nodePublicToLocalId[node.parentPublicId!];
          if (!parentId || (!next.categoriesById[parentId] && !next.subcategoriesById[parentId])) continue;
          const siblings = (next.childrenByParentId![parentId] || []).map((id) => next.tagsById[id]?.name).filter(Boolean) as string[];
          next.tagsById[localId] = { id: localId, name: uniqueName(node.label, siblings, suffix), parentId, subcategoryId: parentId, accentId: localAccentId(node, record.colorPublicToLocalId) };
          next.childrenByParentId![parentId] = [...(next.childrenByParentId![parentId] || []), localId];
          next.subcategoriesById[parentId]?.tagIds.push(localId);
          next.subcategoriesById[parentId]?.childIds?.push(localId);
          next.categoriesById[parentId]?.childIds?.push(localId);
        }
      } else if (kind === "category") {
        next.categoriesById[localId].name = node.label;
      } else if (kind === "folder" || kind === "subcategory") {
        const value = next.subcategoriesById[localId];
        const parentId = record.nodePublicToLocalId[node.parentPublicId!];
        if (value && parentId) {
          removeChild(next, value.parentId || value.categoryId || "", localId);
          value.name = node.label; value.parentId = parentId; value.categoryId = rootCategoryId(next, parentId) || parentId;
          addChild(next, parentId, localId, false);
        }
      } else {
        const value = next.tagsById[localId];
        const parentId = record.nodePublicToLocalId[node.parentPublicId!];
        if (value && parentId) {
          removeChild(next, value.parentId || value.subcategoryId, localId);
          value.name = node.label; value.parentId = parentId; value.subcategoryId = parentId; value.accentId = localAccentId(node, record.colorPublicToLocalId);
          addChild(next, parentId, localId, true);
        }
      }
      appliedPublicIds.push(node.publicId);
    }
  }

  reorderInstalledItems(next, current, record);
  const now = (options.now ?? new Date()).toISOString();
  record.sourceRevision = current.revision;
  record.sourceRevisionId = current.revisionId;
  record.sourceShareSlug = current.shareSlug;
  record.sourceAuthor = current.author;
  record.updatedAt = now;
  record.lastUpdateCheckAt = now;
  record.detachedLocalIds = detachedLocalIds;
  record.locallyEditedPublicIds = [...new Set([...record.locallyEditedPublicIds, ...retainedConflictPublicIds])];
  for (const [publicId, item] of currentItems) {
    record.sourceFingerprints[publicId] = fingerprint(item.value);
    const localFingerprint = fingerprintLocal(publicId, item.target, next, record);
    if (localFingerprint && appliedPublicIds.includes(publicId)) record.installedLocalFingerprints[publicId] = localFingerprint;
  }
  return { taxonomy: next, installation: record, preview, appliedPublicIds, retainedConflictPublicIds, detachedLocalIds };
}

function createUnusedLocalId(
  kind: "category" | "folder" | "subcategory" | "tag" | "color" | "collection",
  taxonomy: TagTaxonomy,
  createId: NonNullable<TaxonomyInstallOptionsV1["createId"]>,
): string {
  const collection = kind === "category"
    ? taxonomy.categoriesById
    : kind === "folder" || kind === "subcategory"
      ? taxonomy.subcategoriesById
      : kind === "tag"
        ? taxonomy.tagsById
        : kind === "color"
          ? taxonomy.customAccentsById
          : taxonomy.colorThemesById;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = createId(kind);
    if (!Object.hasOwn(collection, candidate)) return candidate;
  }
  throw new Error(`Could not allocate an unused ${kind} ID`);
}

function normalizeMutableTaxonomy(taxonomy: TagTaxonomy): void {
  const normalized = normalizeTaxonomyTree(taxonomy);
  taxonomy.foldersById = normalized.foldersById;
  taxonomy.childrenByParentId = normalized.childrenByParentId;
  taxonomy.categoriesById = normalized.categoriesById;
  taxonomy.subcategoriesById = normalized.subcategoriesById;
  taxonomy.tagsById = normalized.tagsById;
}

function orderPublishedNodes(nodes: PublishedTaxonomyNodeV1[]): PublishedTaxonomyNodeV1[] {
  const byParent = new Map<string | null, PublishedTaxonomyNodeV1[]>();
  nodes.forEach((node) => {
    const siblings = byParent.get(node.parentPublicId) || [];
    siblings.push(node);
    byParent.set(node.parentPublicId, siblings);
  });
  const ordered: PublishedTaxonomyNodeV1[] = [];
  const visit = (parentId: string | null) => {
    [...(byParent.get(parentId) || [])].sort(byPosition).forEach((node) => {
      ordered.push(node);
      if (node.kind !== "tag") visit(node.publicId);
    });
  };
  visit(null);
  return ordered;
}

function rootCategoryId(taxonomy: TagTaxonomy, localId: string): string | null {
  if (taxonomy.categoriesById[localId]) return localId;
  let folder = taxonomy.subcategoriesById[localId] || taxonomy.foldersById?.[localId];
  const seen = new Set<string>();
  while (folder && !seen.has(folder.id)) {
    seen.add(folder.id);
    const parentId = folder.parentId || folder.categoryId;
    if (!parentId) return null;
    if (taxonomy.categoriesById[parentId]) return parentId;
    folder = taxonomy.subcategoriesById[parentId] || taxonomy.foldersById?.[parentId];
  }
  return null;
}

function addChild(taxonomy: TagTaxonomy, parentId: string, childId: string, tag: boolean): void {
  taxonomy.childrenByParentId![parentId] = [...(taxonomy.childrenByParentId![parentId] || []).filter((id) => id !== childId), childId];
  const folder = taxonomy.subcategoriesById[parentId];
  if (folder) {
    folder.childIds = [...(folder.childIds || []).filter((id) => id !== childId), childId];
    if (tag) folder.tagIds = [...folder.tagIds.filter((id) => id !== childId), childId];
  }
  const category = taxonomy.categoriesById[parentId];
  if (category) {
    category.childIds = [...(category.childIds || []).filter((id) => id !== childId), childId];
    if (!tag) category.subcategoryIds = [...category.subcategoryIds.filter((id) => id !== childId), childId];
  }
}

function removeChild(taxonomy: TagTaxonomy, parentId: string, childId: string): void {
  if (!parentId) return;
  taxonomy.childrenByParentId![parentId] = (taxonomy.childrenByParentId![parentId] || []).filter((id) => id !== childId);
  const folder = taxonomy.subcategoriesById[parentId];
  if (folder) {
    folder.childIds = (folder.childIds || []).filter((id) => id !== childId);
    folder.tagIds = folder.tagIds.filter((id) => id !== childId);
  }
  const category = taxonomy.categoriesById[parentId];
  if (category) {
    category.childIds = (category.childIds || []).filter((id) => id !== childId);
    category.subcategoryIds = category.subcategoryIds.filter((id) => id !== childId);
  }
}

function collectSelectedNodes(nodes: PublishedTaxonomyNodeV1[], roots: Set<string>): PublishedTaxonomyNodeV1[] {
  const included = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) if (node.parentPublicId && included.has(node.parentPublicId) && !included.has(node.publicId)) { included.add(node.publicId); changed = true; }
  }
  return nodes.filter((node) => included.has(node.publicId));
}

function uniqueName(name: string, existing: string[], suffix: string): string {
  const lower = new Set(existing.map((value) => value.toLocaleLowerCase()));
  if (!lower.has(name.toLocaleLowerCase())) return name;
  const base = `${name} (${suffix})`;
  if (!lower.has(base.toLocaleLowerCase())) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base} ${index}`;
    if (!lower.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

function localAccentId(node: PublishedTaxonomyNodeV1, colors: Record<string, string>): TaxonomyTag["accentId"] {
  if (!node.accent) return null;
  if (node.accent.kind === "preset") return node.accent.id as TaxonomyTag["accentId"];
  return (colors[node.accent.id] as `custom:${string}` | undefined) ?? null;
}

function artifactItems(artifact: PublishedTaxonomyArtifactV1) {
  const result = new Map<string, { target: "node" | "color" | "collection"; label: string; value: unknown }>();
  artifact.nodes.forEach((item) => result.set(item.publicId, { target: "node", label: item.label, value: comparableNode(item) }));
  artifact.colors.forEach((item) => result.set(item.publicId, { target: "color", label: item.name, value: comparableColor(item) }));
  artifact.collections.forEach((item) => result.set(item.publicId, { target: "collection", label: item.name, value: comparableCollection(item) }));
  return result;
}

function removeColorFromOrdering(taxonomy: TagTaxonomy, localId: string): void {
  taxonomy.ungroupedColorIds = taxonomy.ungroupedColorIds.filter((id) => id !== localId);
  Object.values(taxonomy.colorThemesById).forEach((collection) => {
    collection.colorIds = collection.colorIds.filter((id) => id !== localId);
  });
}

function reorderInstalledItems(
  taxonomy: TagTaxonomy,
  artifact: PublishedTaxonomyArtifactV1,
  installation: InstalledTaxonomyRecordV1,
): void {
  normalizeMutableTaxonomy(taxonomy);
  taxonomy.categoryOrder = reorderMapped(
    taxonomy.categoryOrder,
    artifact.nodes.filter((node) => node.kind === "category").sort(byPosition).map((node) => installation.nodePublicToLocalId[node.publicId]).filter(Boolean),
  );
  for (const node of artifact.nodes.filter((item) => item.kind !== "tag")) {
    const localParentId = installation.nodePublicToLocalId[node.publicId];
    if (!localParentId) continue;
    const orderedChildren = artifact.nodes
      .filter((child) => child.parentPublicId === node.publicId)
      .sort(byPosition)
      .map((child) => installation.nodePublicToLocalId[child.publicId])
      .filter(Boolean);
    taxonomy.childrenByParentId![localParentId] = reorderMapped(taxonomy.childrenByParentId![localParentId] || [], orderedChildren);
    const category = taxonomy.categoriesById[localParentId];
    if (category) {
      category.childIds = taxonomy.childrenByParentId![localParentId];
      category.subcategoryIds = category.childIds.filter((id) => taxonomy.subcategoriesById[id]);
    }
    const folder = taxonomy.subcategoriesById[localParentId];
    if (folder) {
      folder.childIds = taxonomy.childrenByParentId![localParentId];
      folder.tagIds = folder.childIds.filter((id) => taxonomy.tagsById[id]);
    }
  }
  taxonomy.colorThemeOrder = reorderMapped(
    taxonomy.colorThemeOrder ?? [],
    [...artifact.collections].sort(byPosition).map((item) => installation.collectionPublicToLocalId[item.publicId]).filter(Boolean),
  );
  for (const collection of artifact.collections) {
    const localCollectionId = installation.collectionPublicToLocalId[collection.publicId];
    const localCollection = taxonomy.colorThemesById[localCollectionId];
    if (!localCollection) continue;
    localCollection.colorIds = reorderMapped(
      localCollection.colorIds,
      artifact.colors.filter((color) => color.collectionPublicId === collection.publicId).sort(byPosition).map((color) => installation.colorPublicToLocalId[color.publicId]).filter(Boolean) as `custom:${string}`[],
    );
  }
  taxonomy.ungroupedColorIds = reorderMapped(
    taxonomy.ungroupedColorIds,
    artifact.ungroupedColorPublicIds.map((id) => installation.colorPublicToLocalId[id]).filter(Boolean) as `custom:${string}`[],
  );
}

function reorderMapped<T extends string>(existing: T[], orderedMapped: T[]): T[] {
  const mapped = new Set(orderedMapped);
  const queue = [...orderedMapped];
  const result = existing.map((id) => mapped.has(id) ? queue.shift()! : id);
  result.push(...queue);
  return result;
}

function byPosition<T extends { position: number }>(left: T, right: T): number {
  return left.position - right.position;
}

function fingerprintLocal(publicId: string, target: "node" | "color" | "collection", local: TagTaxonomy, installation: InstalledTaxonomyRecordV1): string | null {
  if (target === "node") {
    const id = installation.nodePublicToLocalId[publicId];
    const value: TaxonomyCategory | TaxonomySubcategory | TaxonomyTag | undefined = local.categoriesById[id] ?? local.subcategoriesById[id] ?? local.tagsById[id];
    return value ? fingerprint(normalizeLocalNode(value, installation)) : null;
  }
  if (target === "color") {
    const value = local.customAccentsById[installation.colorPublicToLocalId[publicId]];
    return value ? fingerprint({ publicId, name: value.name, hex: value.color, collectionPublicId: value.themeId ? reverseLookup(installation.collectionPublicToLocalId, value.themeId) : null }) : null;
  }
  const value = local.colorThemesById[installation.collectionPublicToLocalId[publicId]];
  return value ? fingerprint({ publicId, name: value.name }) : null;
}

function normalizeLocalNode(value: TaxonomyCategory | TaxonomySubcategory | TaxonomyTag, installation: InstalledTaxonomyRecordV1): unknown {
  if ("subcategoryIds" in value) return { publicId: reverseLookup(installation.nodePublicToLocalId, value.id), kind: "category", parentPublicId: null, label: value.name };
  if ("tagIds" in value) return { publicId: reverseLookup(installation.nodePublicToLocalId, value.id), kind: "folder", parentPublicId: reverseLookup(installation.nodePublicToLocalId, value.parentId || value.categoryId || ""), label: value.name };
  const accent = value.accentId?.startsWith("custom:") ? { kind: "custom", id: reverseLookup(installation.colorPublicToLocalId, value.accentId) } : value.accentId ? { kind: "preset", id: value.accentId } : null;
  return { publicId: reverseLookup(installation.nodePublicToLocalId, value.id), kind: "tag", parentPublicId: reverseLookup(installation.nodePublicToLocalId, value.parentId || value.subcategoryId), label: value.name, accent };
}

function reverseLookup(mapping: Record<string, string>, localId: string): string | null {
  return Object.entries(mapping).find(([, value]) => value === localId)?.[0] ?? null;
}

function comparableNode(node: PublishedTaxonomyNodeV1): unknown {
  return { publicId: node.publicId, kind: node.kind, parentPublicId: node.parentPublicId, label: node.label, ...(node.kind === "tag" ? { accent: node.accent } : {}) };
}

function comparableColor(color: PublishedTaxonomyArtifactV1["colors"][number]): unknown {
  return { publicId: color.publicId, name: color.name, hex: color.hex, collectionPublicId: color.collectionPublicId };
}

function comparableCollection(collection: PublishedTaxonomyArtifactV1["collections"][number]): unknown {
  return { publicId: collection.publicId, name: collection.name };
}

function fingerprint(value: unknown): string {
  return canonicalJson(value);
}

function defaultCreateId(kind: string): string {
  const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return kind === "color" ? `custom:${id}` : `${kind}_${id}`;
}

function defaultPublicId(kind: string): string {
  const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${kind}_${id}`;
}
