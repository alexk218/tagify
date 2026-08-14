import { describe, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import {
  DEFAULT_AUTO_FILE_BACKUP_INTERVAL_MS,
  maybeDownloadAutomaticTagDataFileBackup,
  TAG_DATA_AUTO_FILE_BACKUP_FREQUENCY_KEY,
  TAG_DATA_AUTO_FILE_BACKUP_METADATA_KEY,
  validateTagDataBackup,
} from "../tagData.backup";
import { TagDataStructure } from "@/types/tagData";

const taggedBackupData: TagDataStructure = {
  ...defaultTagData,
  tracks: {
    "spotify:track:1": {
      rating: 5,
      energy: 4,
      bpm: null,
      tagIds: ["rock"],
    },
  },
};

const taggedEntityBackupData: TagDataStructure = {
  ...taggedBackupData,
  playlists: {
    "spotify:album:1": {
      rating: 4,
      energy: 8,
      tagIds: [],
    },
  },
  artists: {
    "spotify:artist:1": {
      rating: 5,
      energy: 9,
      tagIds: [],
    },
  },
};

describe("validateTagDataBackup", () => {
  it("accepts normalized taxonomy backups", () => {
    expect(() => validateTagDataBackup(defaultTagData)).not.toThrow();
  });

  it("accepts legacy category backups", () => {
    expect(() =>
      validateTagDataBackup({
        categories: [
          {
            id: "genre",
            name: "Genre",
            subcategories: [
              {
                id: "electronic",
                name: "Electronic",
                tags: [{ id: "house", name: "House" }],
              },
            ],
          },
        ],
        tracks: {},
      }),
    ).not.toThrow();
  });

  it("rejects unsupported objects instead of normalizing them", () => {
    expect(() => validateTagDataBackup({ foo: "bar" })).toThrow(
      "Invalid backup file format",
    );
  });
});

describe("automatic tag data backup", () => {
  it("creates a throttled Downloads file backup for non-empty tag data", () => {
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const now = Date.UTC(2026, 4, 27, 14, 0, 0);

    const result = maybeDownloadAutomaticTagDataFileBackup(taggedEntityBackupData, {
      now,
    });

    expect(result.status).toBe("created");
    expect(clickSpy).toHaveBeenCalledTimes(1);

    const metadata = JSON.parse(
      window.localStorage.getItem(TAG_DATA_AUTO_FILE_BACKUP_METADATA_KEY) || "{}",
    );
    expect(metadata.trackCount).toBe(1);
    expect(metadata.playlistCount).toBe(1);
    expect(metadata.artistCount).toBe(1);
    expect(metadata.filename).toBe("tagify-auto-backup-2026-05-27T14-00-00-000Z.json");
  });

  it("skips automatic file backups when the interval has not elapsed", () => {
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const now = Date.UTC(2026, 4, 27, 14, 0, 0);

    maybeDownloadAutomaticTagDataFileBackup(taggedBackupData, { now });

    const changedData: TagDataStructure = {
      ...taggedBackupData,
      tracks: {
        ...taggedBackupData.tracks,
        "spotify:track:1": {
          ...taggedBackupData.tracks["spotify:track:1"],
          rating: 4,
        },
      },
    };

    const result = maybeDownloadAutomaticTagDataFileBackup(changedData, {
      now: now + DEFAULT_AUTO_FILE_BACKUP_INTERVAL_MS - 1,
    });

    expect(result).toEqual({ status: "skipped", reason: "too-soon" });
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("skips automatic file backups when frequency is never", () => {
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    window.localStorage.setItem(TAG_DATA_AUTO_FILE_BACKUP_FREQUENCY_KEY, "never");

    const result = maybeDownloadAutomaticTagDataFileBackup(taggedEntityBackupData, {
      now: Date.UTC(2026, 4, 27, 14, 0, 0),
    });

    expect(result).toEqual({ status: "skipped", reason: "disabled" });
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it("uses the configured automatic file backup frequency", () => {
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const now = Date.UTC(2026, 4, 27, 14, 0, 0);
    window.localStorage.setItem(TAG_DATA_AUTO_FILE_BACKUP_FREQUENCY_KEY, "weekly");

    maybeDownloadAutomaticTagDataFileBackup(taggedBackupData, { now });

    const changedData: TagDataStructure = {
      ...taggedBackupData,
      tracks: {
        ...taggedBackupData.tracks,
        "spotify:track:1": {
          ...taggedBackupData.tracks["spotify:track:1"],
          rating: 4,
        },
      },
    };

    const result = maybeDownloadAutomaticTagDataFileBackup(changedData, {
      now: now + 6 * DEFAULT_AUTO_FILE_BACKUP_INTERVAL_MS,
    });

    expect(result).toEqual({ status: "skipped", reason: "too-soon" });
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
