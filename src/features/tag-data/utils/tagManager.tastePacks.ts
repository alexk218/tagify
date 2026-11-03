import type { TastePackInstallResult } from "@tagify/community-contracts";
import type { TagTaxonomy } from "@/types/tagData";
import { recordTastePacksAdded } from "@/features/product-analytics/productAnalytics";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { flushLocalPersistence } from "@/services/sync/SyncLocalState";
import { normalizeTaxonomyTree } from "@/utils/tagTaxonomy";
import { planTastePacksForTaxonomy } from "@/utils/tastePackTaxonomy";

export interface TagManagerTastePackAddition {
  /** The draft afterwards; the same object when nothing was added. */
  taxonomy: TagTaxonomy;
  packs: TastePackInstallResult[];
  /** The first folder that gained pack tags and its category, to show the person what was added. */
  reveal: { categoryId: string; folderId: string } | null;
}

/**
 * "Add a pack" in Tag Manager: adds taste packs to Tag Manager's unsaved tags with the rules the
 * first run and Community use (planTastePackInstall). Save Changes saves them through
 * saveTaxonomy like any other Tag Manager edit, so they sync. Adding a pack that's already there
 * changes nothing.
 */
export function addTastePacksToDraft(draft: TagTaxonomy, keys: readonly string[]): TagManagerTastePackAddition {
  const { plan, taxonomy } = planTastePacksForTaxonomy(draft, keys);
  if (plan.upserts.length === 0) return { taxonomy: draft, packs: plan.packs, reveal: null };
  const folderId = plan.packs.find((pack) => pack.added.length > 0)?.folderId ?? null;
  const folder = folderId ? normalizeTaxonomyTree(taxonomy).subcategoriesById[folderId] : undefined;
  return {
    taxonomy,
    packs: plan.packs,
    reveal: folder?.categoryId ? { categoryId: folder.categoryId, folderId: folder.id } : null,
  };
}

/**
 * Counts the packs added in Tag Manager once Save Changes has saved them: waits for the save to
 * finish, then reads the saved tags and counts each pack whose new tags are there. A failed save,
 * or Cancel (never calls this), counts nothing.
 */
export async function recordSavedTastePacks(packs: readonly TastePackInstallResult[]): Promise<void> {
  if (packs.length === 0) return;
  try {
    // Save Changes hands the edit to React; the save starts once it has rendered.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushLocalPersistence();
    const saved = await indexedDBStorage.getTaxonomy();
    const keys = packs.filter((pack) => pack.added.some((tagId) => tagId in saved.tagsById)).map((pack) => pack.key);
    if (keys.length) recordTastePacksAdded(keys, "tag_manager");
  } catch {
    /* Optional measurements never interrupt saving. */
  }
}
