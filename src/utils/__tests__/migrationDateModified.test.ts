import { describe, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import {
  captureTrackDateModified,
  enforceMigrationDateModifiedPolicy,
} from "../migrationDateModified";

function dataWithTrack(dateModified?: number) {
  return {
    ...defaultTagData,
    tracks: {
      "spotify:track:one": {
        rating: 4,
        energy: 0,
        bpm: null,
        camelotKey: null,
        tagIds: [],
        ...(dateModified === undefined ? {} : { dateModified }),
      },
    },
  };
}

describe("migration Last Updated policy", () => {
  it("restores an existing timestamp changed by a migration", () => {
    const before = dataWithTrack(100);
    const migrated = dataWithTrack(999);

    const guarded = enforceMigrationDateModifiedPolicy(
      migrated,
      captureTrackDateModified(before),
      "test migration",
    );

    expect(guarded.tracks["spotify:track:one"].dateModified).toBe(100);
  });

  it("preserves the absence of a timestamp", () => {
    const before = dataWithTrack();
    const guarded = enforceMigrationDateModifiedPolicy(
      dataWithTrack(999),
      captureTrackDateModified(before),
      "test migration",
    );

    expect(guarded.tracks["spotify:track:one"]).not.toHaveProperty("dateModified");
  });

  it("requires an explicit reason and notifies for an intentional rewrite", () => {
    const notify = vi.fn();
    globalThis.Spicetify = { showNotification: notify } as unknown as typeof Spicetify;
    const before = dataWithTrack(100);
    const migrated = dataWithTrack(999);

    const allowed = enforceMigrationDateModifiedPolicy(
      migrated,
      captureTrackDateModified(before),
      "exceptional migration",
      { mode: "rewrite", reason: "the user requested a timestamp repair" },
    );

    expect(allowed.tracks["spotify:track:one"].dateModified).toBe(999);
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("intentionally changed Last Updated"),
      true,
    );
  });
});
