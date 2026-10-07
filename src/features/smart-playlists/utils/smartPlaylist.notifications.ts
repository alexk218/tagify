import { TagTaxonomy } from "@/types/tagData";

export interface SmartPlaylistAppliedCriteriaNotification {
  trackName?: string;
  artists?: string;
  playlistNames: string[];
  addedTagIds: string[];
  removedTagIds: string[];
  rating?: number;
  energy?: number;
}

function formatList(values: string[]): string {
  if (values.length < 2) {
    return values[0] ?? "";
  }
  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function describeTagChanges(
  action: "added" | "removed",
  tagIds: string[],
  taxonomy: TagTaxonomy,
): string | null {
  if (tagIds.length === 0) {
    return null;
  }

  const tagNames = tagIds
    .map((tagId) => taxonomy?.tagsById?.[tagId]?.name)
    .filter((name): name is string => Boolean(name));
  if (tagNames.length === tagIds.length) {
    return `${action} ${formatList(tagNames)}`;
  }

  return `${action} ${tagIds.length} playlist tag${tagIds.length === 1 ? "" : "s"}`;
}

export function showSmartPlaylistCriteriaAppliedNotifications(
  updates: SmartPlaylistAppliedCriteriaNotification[],
  taxonomy: TagTaxonomy,
): void {
  updates.forEach((update) => {
    const details = [
      describeTagChanges("added", update.addedTagIds, taxonomy),
      describeTagChanges("removed", update.removedTagIds, taxonomy),
      update.rating !== undefined ? `rating ${update.rating}★` : null,
      update.energy !== undefined ? `energy ${update.energy}` : null,
    ].filter((detail): detail is string => Boolean(detail));

    if (details.length === 0) {
      return;
    }

    const playlistLabel =
      update.playlistNames.length === 1
        ? `“${update.playlistNames[0]}”`
        : `Smart Playlists ${formatList(
            update.playlistNames.map((name) => `“${name}”`),
          )}`;
    const trackLabel = update.trackName
      ? `“${update.trackName}${update.artists ? ` — ${update.artists}` : ""}”`
      : "a newly added track";

    Spicetify.showNotification(
      `${playlistLabel} updated ${trackLabel}: ${details.join("; ")}`,
      false,
      10000,
    );
  });
}

export function showSmartPlaylistSyncSuccessNotification(
  playlistName: string,
  addedCount: number,
  removedCount: number,
  metadataUpdatedCount: number,
  duplicatesRemovedCount: number,
): void {
  if (
    duplicatesRemovedCount > 0 ||
    addedCount > 0 ||
    removedCount > 0 ||
    metadataUpdatedCount > 0
  ) {
    const messageParts: string[] = [];

    if (addedCount > 0) {
      messageParts.push(`+${addedCount} tracks`);
    }

    if (removedCount > 0) {
      messageParts.push(`-${removedCount} tracks`);
    }

    if (metadataUpdatedCount > 0) {
      messageParts.push(
        `${metadataUpdatedCount} track${metadataUpdatedCount === 1 ? "" : "s"} updated`,
      );
    }

    if (duplicatesRemovedCount > 0) {
      messageParts.push(`-${duplicatesRemovedCount} duplicates`);
    }

    const message = `✅ Synced "${playlistName}": ${messageParts.join(", ")}`;
    Spicetify.showNotification(message, false, 10000);
    return;
  }

  Spicetify.showNotification(`✅ "${playlistName}" is already in sync`, false, 5000);
}

export function showSmartPlaylistSyncErrorNotification(
  playlistName: string,
): void {
  Spicetify.showNotification(
    `Couldn't update "${playlistName}" in Spotify. Your Smart Playlist is safe; try Sync again.`,
    true,
    8000,
  );
}
