export function showTrackAddedNotification(
  trackUri: string,
  playlistName: string,
): void {
  if (trackUri.startsWith("spotify:local:")) {
    Spicetify.showNotification(
      `🎵 Local file matches "${playlistName}" criteria but must be added manually`,
      true,
      5000,
    );
  }
}

export function showTrackRemovedNotification(playlistName: string): void {
  Spicetify.showNotification(
    `❌ Track removed from smart playlist "${playlistName}"`,
    false,
    3000,
  );
}

export function showCleanupDeletedSmartPlaylistsNotification(
  removedCount: number,
): void {
  Spicetify.showNotification(
    `Cleaned up ${removedCount} deleted smart playlist(s)`,
    false,
    3000,
  );
}

export function showSmartPlaylistSyncSuccessNotification(
  playlistName: string,
  addedCount: number,
  removedCount: number,
  duplicatesRemovedCount: number,
): void {
  if (duplicatesRemovedCount > 0 || addedCount > 0 || removedCount > 0) {
    const messageParts: string[] = [];

    if (addedCount > 0) {
      messageParts.push(`+${addedCount} tracks`);
    }

    if (removedCount > 0) {
      messageParts.push(`-${removedCount} tracks`);
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
  Spicetify.showNotification(`❌ Failed to sync "${playlistName}"`, true, 5000);
}

export function showSmartPlaylistSyncValidationErrorNotification(
  playlistName: string,
): void {
  Spicetify.showNotification(`⚠️ Error syncing "${playlistName}"`, true, 5000);
}

export function showDeduplicationTrackLossNotification(trackUri: string): void {
  Spicetify.showNotification(
    `⚠️ Track lost during deduplication: ${trackUri}`,
    true,
    5000,
  );
}

export function showDeduplicationRestoreErrorNotification(): void {
  Spicetify.showNotification(
    "⚠️ Failed to restore track after deduplication",
    true,
    5000,
  );
}
