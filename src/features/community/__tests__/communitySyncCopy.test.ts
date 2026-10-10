import { describe, expect, it } from "vitest";
import { backupNotices, communityErrorMessage, communitySyncStatusLabel } from "../communitySyncCopy";

describe("Community sync copy", () => {
  it("explains an interrupted backup without exposing internal recovery terms", () => {
    expect(communitySyncStatusLabel("snapshot-required", false)).toBe("Backup paused. Your library is still on this device.");
    expect(communityErrorMessage(new Error("snapshot_required: local change set exceeds a normal sync batch"), "Try again."))
      .toContain("Your data is still on this device");
  });

  it("keeps unexpected server details out of user-facing errors", () => {
    expect(communityErrorMessage(new Error("device_confirmation_required"), "Try again."))
      .toBe("To keep your library safe, reconnect this device to Community before restoring or replacing your library. Nothing was changed.");
    expect(communityErrorMessage(new Error("permission denied for table sync_operations"), "Couldn't back up. Try again."))
      .toBe("Couldn't back up. Try again.");
  });

  it("explains a revoked device in ordinary terms", () => {
    expect(communityErrorMessage(new Error("device_revoked"), "Try again."))
      .toBe("This device is no longer connected to Community. Reconnect it to resume backups.");
  });

  it("describes what the cloud backup does not hold yet in plain language", () => {
    expect(backupNotices({ notBackedUp: ["smart-playlists", "filter-formulas"], retrying: ["local-files", "notes"], deviceOnlyChanges: 1 })).toEqual([
      "Smart Playlists and Saved filters are too large to back up to Community. They're still saved on this device; download a Tagify backup to keep a copy.",
      "Local files and notes haven't backed up yet. They're safe on this device, and Tagify will keep trying.",
      "1 item has a value Community can't save, such as a very long name. It stays on this device; download a Tagify backup to keep a copy.",
    ]);
    expect(backupNotices({ notBackedUp: [], retrying: [], deviceOnlyChanges: 0 })).toEqual([]);
    expect(communityErrorMessage(new Error("sync_waiting: retry"), "Try again.")).toBe("Some changes haven't backed up yet. They're safe on this device, and Tagify will try again.");
  });
});
