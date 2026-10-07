import { isRecord } from "./validation";
import {
  computeTaxonomyArtifactChecksum,
  type OwnerTaxonomyIdentityMappingV1,
  type PublicationPolicyV1,
  type PublishedAccentRefV1,
  type PublishedColorCollectionV1,
  type PublishedColorV1,
  type PublishedTaxonomyArtifactV1,
  type PublishedTaxonomyNodeV1,
  type VerifiedRemixSourceV1,
} from "./taxonomy-artifact";
import { isTagifyPresetAccentId } from "../../../src/shared/tagAccentPresets";

interface LocalTaxonomy {
  categoryOrder: string[];
  categoriesById: Record<string, { id: string; name: string; subcategoryIds: string[]; childIds?: string[] }>;
  foldersById: Record<string, { id: string; name: string; parentId?: string; categoryId?: string; tagIds: string[]; childIds?: string[] }>;
  childrenByParentId: Record<string, string[]>;
  subcategoriesById: Record<string, { id: string; name: string; parentId?: string; categoryId?: string; tagIds: string[]; childIds?: string[] }>;
  tagsById: Record<string, { id: string; name: string; parentId?: string; subcategoryId: string; accentId?: string | null }>;
  customAccentsById: Record<string, { id: string; name: string; color: string }>;
  colorThemesById: Record<string, { id: string; name: string; colorIds: string[] }>;
  colorThemeOrder: string[];
  ungroupedColorIds: string[];
}

export interface PublishedTaxonomyMetadataV1 {
  taxonomyId: string;
  revisionId: string;
  revision: number;
  shareSlug: string;
  author: PublishedTaxonomyArtifactV1["author"];
  description: string | null;
  publishedAt: string;
  sourceTagifySchemaVersion: number;
  lineage?: VerifiedRemixSourceV1[];
}

export async function projectPublishedTaxonomyArtifactV1(
  rawTagData: unknown,
  policy: PublicationPolicyV1,
  identity: OwnerTaxonomyIdentityMappingV1,
  metadata: PublishedTaxonomyMetadataV1,
): Promise<PublishedTaxonomyArtifactV1> {
  const taxonomy = readTaxonomy(rawTagData);
  const approvedNodes = new Set(policy.approvedLocalNodeIds);
  const approvedColors = new Set(policy.approvedLocalColorIds);
  const approvedCollections = new Set(policy.approvedLocalCollectionIds);
  const collections: PublishedColorCollectionV1[] = [];
  const colors: PublishedColorV1[] = [];
  const visibleColorIds = new Set<string>();

  taxonomy.colorThemeOrder.forEach((localCollectionId, position) => {
    const collection = taxonomy.colorThemesById[localCollectionId];
    if (!collection || !approvedCollections.has(localCollectionId)) return;
    const publicId = requireMapping(identity.localCollectionToPublicId, localCollectionId, "collection");
    collections.push({ publicId, name: cleanLabel(collection.name), position });
    collection.colorIds.forEach((localColorId, colorPosition) => {
      if (!approvedColors.has(localColorId)) return;
      const color = taxonomy.customAccentsById[localColorId];
      if (!color) return;
      const colorPublicId = requireMapping(identity.localColorToPublicId, localColorId, "color");
      visibleColorIds.add(localColorId);
      colors.push({
        publicId: colorPublicId,
        name: cleanLabel(color.name),
        hex: cleanHex(color.color),
        collectionPublicId: publicId,
        position: colorPosition,
      });
    });
  });

  const ungroupedColorPublicIds: string[] = [];
  taxonomy.ungroupedColorIds.forEach((localColorId, position) => {
    if (!approvedColors.has(localColorId)) return;
    const color = taxonomy.customAccentsById[localColorId];
    if (!color) return;
    const publicId = requireMapping(identity.localColorToPublicId, localColorId, "color");
    visibleColorIds.add(localColorId);
    colors.push({ publicId, name: cleanLabel(color.name), hex: cleanHex(color.color), collectionPublicId: null, position });
    ungroupedColorPublicIds.push(publicId);
  });

  const nodes: PublishedTaxonomyNodeV1[] = [];
  const normalized = normalizeTaxonomy(taxonomy);
  normalized.categoryOrder.forEach((categoryId, categoryPosition) => {
    const category = normalized.categoriesById[categoryId];
    if (!category || !approvedNodes.has(categoryId)) return;
    const categoryPublicId = requireMapping(identity.localNodeToPublicId, categoryId, "node");
    const before = nodes.length;
    nodes.push({ publicId: categoryPublicId, kind: "category", parentPublicId: null, position: categoryPosition, label: cleanLabel(category.name), accent: null });
    projectChildren(normalized, categoryId, categoryPublicId, approvedNodes, visibleColorIds, identity, nodes);
    if (nodes.length === before + 1) nodes.pop();
  });

  const content: Omit<PublishedTaxonomyArtifactV1, "checksum"> = {
    format: "tagify-published-taxonomy",
    artifactVersion: 1,
    taxonomyId: metadata.taxonomyId,
    revisionId: metadata.revisionId,
    revision: metadata.revision,
    shareSlug: metadata.shareSlug,
    author: metadata.author,
    description: metadata.description,
    visibility: policy.visibility,
    publishedAt: metadata.publishedAt,
    compatibility: { minimumTagifyMajor: 3, sourceTagifySchemaVersion: metadata.sourceTagifySchemaVersion },
    nodes,
    colors,
    collections,
    ungroupedColorPublicIds,
    lineage: metadata.lineage ?? [],
  };
  return { ...content, checksum: await computeTaxonomyArtifactChecksum(content) };
}

function projectAccent(
  accentId: string | null | undefined,
  visibleColorIds: Set<string>,
  identity: OwnerTaxonomyIdentityMappingV1,
): PublishedAccentRefV1 | null {
  if (!accentId) return null;
  if (isTagifyPresetAccentId(accentId)) return { kind: "preset", id: accentId };
  if (!visibleColorIds.has(accentId)) return null;
  return { kind: "custom", id: requireMapping(identity.localColorToPublicId, accentId, "color") };
}

function readTaxonomy(raw: unknown): LocalTaxonomy {
  if (!isRecord(raw)) throw new Error("Choose a supported Tagify backup");
  const tagData = raw.format === "tagify-backup" && raw.envelopeVersion === 2 ? raw.tagData : raw;
  if (!isRecord(tagData) || !isRecord(tagData.taxonomy)) throw new Error("The Tagify taxonomy is missing");
  const value = tagData.taxonomy;
  for (const field of ["categoriesById", "subcategoriesById", "tagsById", "customAccentsById", "colorThemesById"] as const) if (!isRecord(value[field])) throw new Error(`The Tagify taxonomy is missing ${field}`);
  if (!Array.isArray(value.categoryOrder)) throw new Error("The Tagify category order is missing");
  return {
    categoryOrder: strings(value.categoryOrder),
    categoriesById: value.categoriesById as LocalTaxonomy["categoriesById"],
    foldersById: (value.foldersById || value.subcategoriesById) as LocalTaxonomy["foldersById"],
    childrenByParentId: (value.childrenByParentId || {}) as LocalTaxonomy["childrenByParentId"],
    subcategoriesById: value.subcategoriesById as LocalTaxonomy["subcategoriesById"],
    tagsById: value.tagsById as LocalTaxonomy["tagsById"],
    customAccentsById: value.customAccentsById as LocalTaxonomy["customAccentsById"],
    colorThemesById: value.colorThemesById as LocalTaxonomy["colorThemesById"],
    colorThemeOrder: strings(
      value.colorThemeOrder ?? Object.keys(value.colorThemesById as Record<string, unknown>),
    ),
    ungroupedColorIds: strings(value.ungroupedColorIds ?? []),
  };
}

function normalizeTaxonomy(taxonomy: LocalTaxonomy): LocalTaxonomy {
  const next: LocalTaxonomy = JSON.parse(JSON.stringify(taxonomy));
  next.foldersById = { ...(next.foldersById || {}), ...next.subcategoriesById };
  next.childrenByParentId = { ...(next.childrenByParentId || {}) };
  const appendChild = (parentId: string, childId: string) => {
    const children = next.childrenByParentId[parentId] || [];
    next.childrenByParentId[parentId] = children.includes(childId) ? children : [...children, childId];
  };
  next.categoryOrder.forEach((categoryId) => {
    const category = next.categoriesById[categoryId];
    if (!category) return;
    const childIds = category.childIds || category.subcategoryIds || [];
    next.childrenByParentId[categoryId] = [...(next.childrenByParentId[categoryId] || childIds)];
  });
  Object.values(next.foldersById).forEach((folder) => {
    const parentId = folder.parentId || folder.categoryId;
    if (!parentId) return;
    folder.parentId = parentId;
    folder.childIds = [...(folder.childIds || folder.tagIds || [])];
    next.subcategoriesById[folder.id] = folder;
    next.childrenByParentId[folder.id] = [...(next.childrenByParentId[folder.id] || folder.childIds)];
    appendChild(parentId, folder.id);
  });
  Object.values(next.tagsById).forEach((tag) => {
    const parentId = tag.parentId || tag.subcategoryId;
    tag.parentId = parentId;
    appendChild(parentId, tag.id);
  });
  return next;
}

function projectChildren(
  taxonomy: LocalTaxonomy,
  parentId: string,
  parentPublicId: string,
  approvedNodes: Set<string>,
  visibleColorIds: Set<string>,
  identity: OwnerTaxonomyIdentityMappingV1,
  nodes: PublishedTaxonomyNodeV1[],
) {
  (taxonomy.childrenByParentId[parentId] || []).forEach((childId, position) => {
    if (!approvedNodes.has(childId)) return;
    const folder = taxonomy.foldersById[childId] || taxonomy.subcategoriesById[childId];
    if (folder) {
      const publicId = requireMapping(identity.localNodeToPublicId, childId, "node");
      const before = nodes.length;
      nodes.push({ publicId, kind: "folder", parentPublicId, position, label: cleanLabel(folder.name), accent: null });
      projectChildren(taxonomy, childId, publicId, approvedNodes, visibleColorIds, identity, nodes);
      if (nodes.length === before + 1) nodes.pop();
      return;
    }
    const tag = taxonomy.tagsById[childId];
    if (!tag) return;
    nodes.push({
      publicId: requireMapping(identity.localNodeToPublicId, childId, "node"),
      kind: "tag",
      parentPublicId,
      position,
      label: cleanLabel(tag.name),
      accent: projectAccent(tag.accentId, visibleColorIds, identity),
    });
  });
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function requireMapping(mapping: Record<string, string>, localId: string, kind: string): string {
  const value = mapping[localId];
  if (!value) throw new Error(`Approved ${kind} ${localId} has no stable public identity`);
  return value;
}

function cleanLabel(value: unknown): string {
  if (typeof value !== "string") throw new Error("Published names must be text");
  const clean = value.trim().replace(/\s+/g, " ");
  if (!clean || clean.length > 80 || /[<>\u0000-\u001f]/.test(clean)) throw new Error("A published name is invalid");
  return clean;
}

function cleanHex(value: unknown): string {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error("A published color has an invalid hex value");
  return value.toLowerCase();
}
