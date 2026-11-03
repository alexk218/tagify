import type { TastePackInstallResult } from "@tagify/community-contracts";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { flushLocalPersistence, getTagifyDatabaseName } from "@/services/sync/SyncLocalState";
import { dispatchTagDataUpdatedEvent } from "@/features/tag-data/utils/tagData.events";
import { planTastePacksForTaxonomy } from "@/utils/tastePackTaxonomy";

/**
 * Adds taste packs to the saved tags with the rules Community uses (planTastePackInstall in
 * @tagify/community-contracts). The change is saved like any edit to the tags, through
 * saveTaxonomy, so it syncs to Community and other devices. Returns what each pack added.
 */
export async function addTastePacks(keys: readonly string[], expectedDatabaseName = getTagifyDatabaseName()): Promise<TastePackInstallResult[]> {
  if (keys.length === 0) return [];
  // Edits still waiting to be saved go first, so the packs are planned against the latest tags.
  await flushLocalPersistence();
  let packs: TastePackInstallResult[] | null = null;
  const saved = await indexedDBStorage.saveTaxonomy((current) => {
    if (expectedDatabaseName !== getTagifyDatabaseName()) throw new Error("Your account changed. Open Tagify again to add these tags.");
    const result = planTastePacksForTaxonomy(current, keys);
    packs = result.plan.packs;
    return result.taxonomy;
  });
  if (!saved || !packs) throw new Error("Your tags couldn't be added. Try again in a moment.");
  // The extension shows the new tags in Spotify's menus too.
  dispatchTagDataUpdatedEvent("save");
  return packs;
}
