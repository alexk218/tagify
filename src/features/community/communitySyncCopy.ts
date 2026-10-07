import type { SyncStatus } from "@/services/sync/SyncRuntime";

export function communitySyncStatusLabel(status: SyncStatus, visibilityReviewed: boolean | null): string {
  if (status === "snapshot-required") return "Backup paused. Your library is still on this device.";
  if (visibilityReviewed === false || status === "publication-review-required") {
    return "Choose what appears on your public profile";
  }
  const labels: Record<SyncStatus, string> = {
    idle: "Up to date",
    syncing: "Saving your changes…",
    publishing: "Backed up. Your Community profile is updating…",
    offline: "Offline. Your changes will back up when you reconnect.",
    reauthorize: "Reconnect Tagify to keep backing up",
    "snapshot-required": "Backup paused. Your library is still on this device.",
    "merge-required": "Choose how to combine your libraries",
    "publication-review-required": "Choose what appears on your public profile",
    "recovery-available": "Your Community backup can restore this device",
    restoring: "Getting your library back…",
    "restore-failed": "Couldn't restore yet. Your Community backup is safe.",
    error: "Couldn't back up right now. Tagify will try again.",
    unlinked: "Not connected",
  };
  return labels[status];
}

export function communityErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message) return fallback;
  if (/snapshot_required/i.test(message)) {
    return "Tagify couldn't finish backing up your library. Your data is still on this device. Try Sync now again; if it keeps happening, save a backup and contact support.";
  }
  if (/device_revoked|session_inactive/i.test(message)) {
    return "This device is no longer connected to Community. Reconnect it to resume backups.";
  }
  if (/merge_review_required/i.test(message)) {
    return "Your device and Community both have changes. Choose how to combine them before backing up.";
  }
  // Server and storage errors are for diagnostics, not a message to show in Spotify.
  return fallback;
}
