import { describe, expect, it } from "vitest";
import type { PublishedTaxonomyArtifactV1 } from "@tagify/community-contracts";
import { assertPublishedTaxonomyArtifactV1, assertTaxonomyArtifactChecksum } from "@tagify/community-contracts";
import { createEmptyTaxonomy } from "@/utils/tagTaxonomy";
import { applyTaxonomyUpdate, buildPortableTaxonomyArtifact, buildTaxonomyInstallPlan, previewTaxonomyUpdate } from "../communityTaxonomy";

const artifact: PublishedTaxonomyArtifactV1 = {
  format: "tagify-published-taxonomy",
  artifactVersion: 1,
  taxonomyId: "taxonomy_12345678",
  revisionId: "revision_12345678",
  revision: 1,
  shareSlug: "share_1234567890abcdef",
  author: { handle: "mira", displayName: "Mira" },
  description: null,
  visibility: "public",
  publishedAt: "2026-08-14T00:00:00.000Z",
  compatibility: { minimumTagifyMajor: 3, sourceTagifySchemaVersion: 8 },
  collections: [{ publicId: "collection_12345678", name: "Warm", position: 0 }],
  colors: [{ publicId: "color_12345678", name: "Sunset", hex: "#ff7755", collectionPublicId: "collection_12345678", position: 0 }],
  ungroupedColorPublicIds: [],
  nodes: [
    { publicId: "category_12345678", kind: "category", parentPublicId: null, position: 0, label: "Mood", accent: null },
    { publicId: "subcategory_12345678", kind: "subcategory", parentPublicId: "category_12345678", position: 0, label: "Energy", accent: null },
    { publicId: "tag_12345678", kind: "tag", parentPublicId: "subcategory_12345678", position: 0, label: "Glowing", accent: { kind: "custom", id: "color_12345678" } },
  ],
  lineage: [],
  checksum: "0".repeat(64),
};

function ids() {
  const counters: Record<string, number> = {};
  return (kind: "installation" | "category" | "folder" | "subcategory" | "tag" | "color" | "collection") => {
    counters[kind] = (counters[kind] ?? 0) + 1;
    return kind === "color" ? `custom:${kind}_${counters[kind]}` : `${kind}_${counters[kind]}`;
  };
}

describe("Community taxonomy installation", () => {
  it("exports a complete portable taxonomy and color library without music data", async () => {
    const source = createEmptyTaxonomy();
    source.categoryOrder.push("category-local");
    source.categoriesById["category-local"] = { id: "category-local", name: "Mood", subcategoryIds: ["subcategory-local"] };
    source.subcategoriesById["subcategory-local"] = { id: "subcategory-local", name: "Energy", categoryId: "category-local", tagIds: ["tag-local"] };
    source.tagsById["tag-local"] = { id: "tag-local", name: "Glowing", subcategoryId: "subcategory-local", accentId: "custom:color-local" };
    source.customAccentsById["custom:color-local"] = { id: "custom:color-local", name: "Sunset", color: "#ff7755", themeId: "collection-local" };
    source.colorThemesById["collection-local"] = { id: "collection-local", name: "Warm", colorIds: ["custom:color-local"] };
    source.colorThemeOrder = ["collection-local"];
    let counter = 0;
    const exported = await buildPortableTaxonomyArtifact(source, { now: new Date("2026-08-14T00:00:00.000Z"), createPublicId: (kind) => `${kind}_${String(++counter).padStart(12, "0")}` });
    assertPublishedTaxonomyArtifactV1(exported);
    await expect(assertTaxonomyArtifactChecksum(exported)).resolves.toBeUndefined();
    expect(exported.nodes.map((node) => node.label)).toEqual(["Mood", "Energy", "Glowing"]);
    expect(exported.colors).toMatchObject([{ name: "Sunset", hex: "#ff7755" }]);
    expect(exported.collections).toMatchObject([{ name: "Warm" }]);
    expect(JSON.stringify(exported)).not.toMatch(/spotify:|tracks|playlists|artists|category-local|tag-local/);
  });

  it("exports and installs direct category tags with nested folders", async () => {
    const source = createEmptyTaxonomy();
    source.categoryOrder.push("category-local");
    source.categoriesById["category-local"] = { id: "category-local", name: "Mood", subcategoryIds: [], childIds: ["direct-tag", "folder-local"] };
    source.childrenByParentId!["category-local"] = ["direct-tag", "folder-local"];
    source.foldersById!["folder-local"] = { id: "folder-local", name: "Energy", parentId: "category-local", tagIds: [], childIds: ["nested-folder"] };
    source.subcategoriesById["folder-local"] = source.foldersById!["folder-local"];
    source.foldersById!["nested-folder"] = { id: "nested-folder", name: "Peak", parentId: "folder-local", tagIds: ["nested-tag"], childIds: ["nested-tag"] };
    source.subcategoriesById["nested-folder"] = source.foldersById!["nested-folder"];
    source.childrenByParentId!["folder-local"] = ["nested-folder"];
    source.childrenByParentId!["nested-folder"] = ["nested-tag"];
    source.tagsById["direct-tag"] = { id: "direct-tag", name: "Nocturnal", parentId: "category-local", subcategoryId: "category-local" };
    source.tagsById["nested-tag"] = { id: "nested-tag", name: "Glowing", parentId: "nested-folder", subcategoryId: "nested-folder" };

    let counter = 0;
    const exported = await buildPortableTaxonomyArtifact(source, { now: new Date("2026-08-14T00:00:00.000Z"), createPublicId: (kind) => `${kind}_${String(++counter).padStart(12, "0")}` });
    expect(exported.nodes.map((node) => [node.kind, node.label, node.parentPublicId])).toEqual([
      ["category", "Mood", null],
      ["tag", "Nocturnal", "node_000000000002"],
      ["folder", "Energy", "node_000000000002"],
      ["folder", "Peak", "node_000000000003"],
      ["tag", "Glowing", "node_000000000004"],
    ]);

    const installed = await buildTaxonomyInstallPlan(createEmptyTaxonomy(), exported, { createId: ids() });
    const categoryId = installed.installation.nodePublicToLocalId[exported.nodes[0].publicId];
    const directTagId = installed.installation.nodePublicToLocalId[exported.nodes[1].publicId];
    const folderId = installed.installation.nodePublicToLocalId[exported.nodes[2].publicId];
    const nestedFolderId = installed.installation.nodePublicToLocalId[exported.nodes[3].publicId];
    const nestedTagId = installed.installation.nodePublicToLocalId[exported.nodes[4].publicId];
    expect(installed.taxonomy.childrenByParentId?.[categoryId]).toEqual([directTagId, folderId]);
    expect(installed.taxonomy.childrenByParentId?.[folderId]).toEqual([nestedFolderId]);
    expect(installed.taxonomy.childrenByParentId?.[nestedFolderId]).toEqual([nestedTagId]);
  });

  it("always remaps IDs, preserves existing tags, and visibly suffixes collisions", async () => {
    const current = createEmptyTaxonomy();
    current.categoryOrder.push("existing-category");
    current.categoriesById["existing-category"] = { id: "existing-category", name: "Mood", subcategoryIds: [] };
    current.customAccentsById["custom:existing"] = { id: "custom:existing", name: "Sunset", color: "#000000" };
    current.ungroupedColorIds.push("custom:existing");

    const plan = await buildTaxonomyInstallPlan(current, artifact, { createId: ids(), now: new Date("2026-08-14T00:00:00.000Z") });
    expect(plan.installation.nodePublicToLocalId.category_12345678).not.toBe("category_12345678");
    expect(Object.values(plan.taxonomy.categoriesById).map((item) => item.name)).toContain("Mood (from @mira)");
    expect(Object.values(plan.taxonomy.customAccentsById).map((item) => item.name)).toContain("Sunset (from @mira)");
    expect(plan.taxonomy.categoriesById["existing-category"]).toMatchObject(current.categoriesById["existing-category"]);
    const installedTag = plan.taxonomy.tagsById[plan.installation.nodePublicToLocalId.tag_12345678];
    expect(installedTag.accentId).toBe(plan.installation.colorPublicToLocalId.color_12345678);
    expect(plan.conflicts).toHaveLength(2);
  });

  it("classifies untouched source changes as safe and local edits as conflicts", async () => {
    const plan = await buildTaxonomyInstallPlan(createEmptyTaxonomy(), artifact, { createId: ids() });
    const changed = { ...artifact, revision: 2, revisionId: "revision_87654321", nodes: artifact.nodes.map((node) => node.kind === "tag" ? { ...node, label: "Radiant" } : node) } satisfies PublishedTaxonomyArtifactV1;
    expect(previewTaxonomyUpdate(plan.taxonomy, plan.installation, artifact, changed).safePublicIds).toContain("tag_12345678");
    plan.taxonomy.tagsById[plan.installation.nodePublicToLocalId.tag_12345678].name = "My local edit";
    expect(previewTaxonomyUpdate(plan.taxonomy, plan.installation, artifact, changed).conflictingPublicIds).toContain("tag_12345678");
  });

  it("retains source deletions as detached local nodes", async () => {
    const plan = await buildTaxonomyInstallPlan(createEmptyTaxonomy(), artifact, { createId: ids() });
    const changed = { ...artifact, revision: 2, revisionId: "revision_87654321", nodes: artifact.nodes.filter((node) => node.kind !== "tag") };
    const deletion = previewTaxonomyUpdate(plan.taxonomy, plan.installation, artifact, changed).changes.find((item) => item.publicId === "tag_12345678");
    expect(deletion).toMatchObject({ kind: "deleted", status: "detached" });
    expect(plan.taxonomy.tagsById[plan.installation.nodePublicToLocalId.tag_12345678]).toBeDefined();
  });

  it("applies safe changes transactionally while retaining local conflicts and source deletions", async () => {
    const installed = await buildTaxonomyInstallPlan(createEmptyTaxonomy(), artifact, { createId: ids(), now: new Date("2026-08-14T00:00:00.000Z") });
    const localTagId = installed.installation.nodePublicToLocalId.tag_12345678;
    installed.taxonomy.tagsById[localTagId].name = "My local name";
    const update: PublishedTaxonomyArtifactV1 = {
      ...artifact,
      revision: 2,
      revisionId: "revision_87654321",
      colors: [],
      collections: [],
      nodes: [
        artifact.nodes[0],
        artifact.nodes[1],
        { ...artifact.nodes[2], label: "Radiant", accent: null },
        { publicId: "tag_87654321", kind: "tag", parentPublicId: "subcategory_12345678", position: 1, label: "Hazy", accent: null },
      ],
    };
    const applied = applyTaxonomyUpdate(installed.taxonomy, installed.installation, update, { createId: ids(), now: new Date("2026-08-15T00:00:00.000Z") });
    expect(applied.taxonomy.tagsById[localTagId].name).toBe("My local name");
    expect(applied.retainedConflictPublicIds).toContain("tag_12345678");
    expect(applied.taxonomy.tagsById[applied.installation.nodePublicToLocalId.tag_87654321].name).toBe("Hazy");
    expect(applied.detachedLocalIds).toContain(installed.installation.colorPublicToLocalId.color_12345678);
    expect(applied.taxonomy.customAccentsById[installed.installation.colorPublicToLocalId.color_12345678]).toBeDefined();
    expect(applied.installation.sourceRevision).toBe(2);
  });

  it("overwrites a local conflict only when that conflict is explicitly selected", async () => {
    const installed = await buildTaxonomyInstallPlan(createEmptyTaxonomy(), artifact, { createId: ids() });
    const localTagId = installed.installation.nodePublicToLocalId.tag_12345678;
    installed.taxonomy.tagsById[localTagId].name = "My local name";
    const update = {
      ...artifact,
      revision: 2,
      revisionId: "revision_87654321",
      nodes: artifact.nodes.map((node) => node.kind === "tag" ? { ...node, label: "Radiant" } : node),
    } satisfies PublishedTaxonomyArtifactV1;

    const applied = applyTaxonomyUpdate(installed.taxonomy, installed.installation, update, {
      selectedPublicIds: ["tag_12345678"],
    });

    expect(applied.taxonomy.tagsById[localTagId].name).toBe("Radiant");
    expect(applied.retainedConflictPublicIds).not.toContain("tag_12345678");
    expect(applied.appliedPublicIds).toContain("tag_12345678");
  });
});
