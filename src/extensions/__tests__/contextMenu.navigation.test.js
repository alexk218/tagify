import { describe, expect, it } from "vitest";
import { createBulkTagHistoryLocation } from "../contextMenu.navigation";
import { parseHistoryTrackSelection } from "../../features/track-session/utils/spicetifyHistory.location";

describe("Bulk Tag navigation", () => {
  it("keeps a 1,000-track selection out of the URL and available to the editor", () => {
    const trackUris = Array.from(
      { length: 1000 },
      (_, index) => `spotify:track:${index.toString().padStart(22, "0")}`,
    );
    const location = createBulkTagHistoryLocation("tagify", trackUris);

    expect(location.search).toBe("");
    expect(parseHistoryTrackSelection(location).trackUris).toEqual(trackUris);
  });
});
