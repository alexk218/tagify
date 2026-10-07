import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { readLocalDurableAppState } from "@/services/sync/DurableAppState";
import type { CompleteBackupContents } from "./tagData.backup";

/** Everything a backup file carries besides tag data: Community provenance and saved settings. */
export async function readCompleteBackupContents(): Promise<Required<CompleteBackupContents>> {
  const [publicationPolicy, ownerIdentityMapping, installations] = await Promise.all([
    indexedDBStorage.getCommunityPublicationPolicy(),
    indexedDBStorage.getCommunityOwnerIdentityMapping(),
    indexedDBStorage.getCommunityInstallations(),
  ]);
  return {
    community: { publicationPolicy, ownerIdentityMapping, installations },
    appState: readLocalDurableAppState(),
  };
}
