import type { DurableAppStateDomain } from "@tagify/sync-contracts";
import type { BackupHealth, SyncStatus } from "@/services/sync/SyncRuntime";

const SAVED_SETTINGS_LABELS: Record<DurableAppStateDomain, string> = {
  "smart-playlists": "Smart Playlists",
  "filter-formulas": "Saved filters",
  "playlist-rules": "Playlist rules",
  preferences: "Preferences",
  "community-provenance": "Installed Community tags",
};

export function savedSettingsLabel(domain: DurableAppStateDomain): string {
  return SAVED_SETTINGS_LABELS[domain] ?? "Saved settings";
}

function listLabels(labels: string[]): string {
  return labels.length < 2 ? labels.join("") : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/** Plain-language notes about anything the cloud backup does not hold yet. */
export function backupNotices(health: Partial<BackupHealth> | null): string[] {
  if (!health) return [];
  const notices: string[] = [];
  const tooLarge = (health.notBackedUp ?? []).map(savedSettingsLabel);
  if (tooLarge.length) {
    notices.push(`${listLabels(tooLarge)} ${tooLarge.length === 1 ? "is" : "are"} too large to back up to Community. ${tooLarge.length === 1 ? "It's" : "They're"} still saved on this device; download a Tagify backup to keep a copy.`);
  }
  const retrying = health.retrying ?? [];
  if (retrying.length) {
    const what = listLabels([...(retrying.includes("local-files") ? ["Local files"] : []), ...(retrying.includes("notes") ? ["notes"] : [])]);
    notices.push(`${what.charAt(0).toUpperCase()}${what.slice(1)} haven't backed up yet. They're safe on this device, and Tagify will keep trying.`);
  }
  const deviceOnly = health.deviceOnlyChanges ?? 0;
  if (deviceOnly > 0) {
    notices.push(`${deviceOnly.toLocaleString()} ${deviceOnly === 1 ? "item has a value" : "items have values"} Community can't save, such as a very long name. ${deviceOnly === 1 ? "It stays" : "They stay"} on this device; download a Tagify backup to keep a copy.`);
  }
  return notices;
}

/** How the backup stands. Sharing has its own line, so a pending sharing choice reads as backed up. */
export function communitySyncStatusLabel(status: SyncStatus, settingsNeedChoice = false): string {
  if (settingsNeedChoice && (status === "idle" || status === "publishing" || status === "publication-review-required")) return "Choose which saved settings to keep";
  const labels: Record<SyncStatus, string> = {
    idle: "Up to date",
    syncing: "Saving your changes…",
    publishing: "Backed up. Your Community profile is updating…",
    offline: "Offline. Your changes will back up when you reconnect.",
    reauthorize: "Reconnect Tagify to keep backing up",
    "snapshot-required": "Backup paused. Your library is still on this device.",
    "merge-required": "Choose how to combine your libraries",
    "publication-review-required": "Up to date",
    "recovery-available": "Your Community backup can restore this device",
    restoring: "Getting your library back…",
    "restore-failed": "Couldn't restore yet. Your Community backup is safe.",
    error: "Couldn't back up right now. Tagify will try again.",
    unlinked: "Not connected",
  };
  return labels[status];
}

/** The short backup half of the Community screen's status line. */
export function backupLabel(status: SyncStatus): string {
  if (status === "idle" || status === "publishing" || status === "publication-review-required") return "Backed up";
  return communitySyncStatusLabel(status);
}

export function communityErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message) return fallback;
  if (/snapshot_required/i.test(message)) {
    return "Tagify couldn't finish backing up your library. Your data is still on this device. Try Sync now again; if it keeps happening, save a backup and contact support.";
  }
  if (/device_confirmation_required/i.test(message)) {
    return "To keep your library safe, reconnect this device to Community before restoring or replacing your library. Nothing was changed.";
  }
  if (/device_revoked|session_inactive/i.test(message)) {
    return "This device is no longer connected to Community. Reconnect it to resume backups.";
  }
  if (/sync_waiting/i.test(message)) {
    return "Some changes haven't backed up yet. They're safe on this device, and Tagify will try again.";
  }
  if (/merge_review_required/i.test(message)) {
    return "Your device and Community both have changes. Choose how to combine them before backing up.";
  }
  // Server and storage errors are for diagnostics, not a message to show in Spotify.
  return fallback;
}
