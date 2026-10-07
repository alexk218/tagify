import { describe, expect, it } from "vitest";
import { communityErrorMessage, communitySyncStatusLabel } from "../communitySyncCopy";

describe("Community sync copy", () => {
  it("explains an interrupted backup without exposing internal recovery terms", () => {
    expect(communitySyncStatusLabel("snapshot-required", false)).toBe("Backup paused. Your library is still on this device.");
    expect(communityErrorMessage(new Error("snapshot_required: local change set exceeds a normal sync batch"), "Try again."))
      .toContain("Your data is still on this device");
  });

  it("keeps unexpected server details out of user-facing errors", () => {
    expect(communityErrorMessage(new Error("permission denied for table sync_operations"), "Couldn't back up. Try again."))
      .toBe("Couldn't back up. Try again.");
  });

  it("explains a revoked device in ordinary terms", () => {
    expect(communityErrorMessage(new Error("device_revoked"), "Try again."))
      .toBe("This device is no longer connected to Community. Reconnect it to resume backups.");
  });
});
