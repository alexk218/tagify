import packageJson from "@/package";
import { describe, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import {
  backupIncludesSmartPlaylists,
  buildTagifyBackupEnvelopeV2,
  downloadOlderCopyBackup,
  downloadSafetyTagDataBackup,
  extractPrivateNotesFromBackup,
  isAutomaticFileBackupDue,
  maybeDownloadTrailingTagDataFileBackup,
  extractAppStateFromBackup,
  hasCommunityBackupState,
  DEFAULT_AUTO_FILE_BACKUP_INTERVAL_MS,
  extractTagDataFromBackup,
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

  it("accepts V2 envelopes while keeping credentials out of backups", () => {
    const envelope = buildTagifyBackupEnvelopeV2(defaultTagData, {
      publicationPolicy: null,
      ownerIdentityMapping: null,
      installations: [],
    }, new Date("2026-08-14T00:00:00.000Z"));
    expect(() => validateTagDataBackup(envelope)).not.toThrow();
    expect(extractTagDataFromBackup(envelope)).toBe(defaultTagData);
    expect(envelope.tagifyVersion).toBe(packageJson.version);
    expect(JSON.stringify(envelope)).not.toMatch(/accessToken|refreshToken|deviceToken|credential/i);
  });

  it("includes smart playlists in the same global backup payload", () => {
    const data: TagDataStructure = {
      ...defaultTagData,
      smartPlaylists: [{
        id: "smart-1",
        playlistId: "spotify-playlist-1",
        playlistName: "Four stars",
        criteria: {
          includeTagClauses: [],
          clauseConnectors: [],
          ratingFilters: [4],
          energyMinFilter: null,
          energyMaxFilter: null,
          bpmMinFilter: null,
          bpmMaxFilter: null,
        },
        isActive: true,
        createdAt: 1,
        lastSyncAt: 2,
        smartPlaylistTrackUris: ["spotify:track:1"],
      }],
    };
    const envelope = buildTagifyBackupEnvelopeV2(data);

    expect(envelope.tagData.smartPlaylists).toEqual(data.smartPlaylists);
    expect(() => validateTagDataBackup(envelope)).not.toThrow();
  });

  it("rejects malformed smart-playlist entries instead of silently dropping them", () => {
    expect(() => validateTagDataBackup({
      ...defaultTagData,
      smartPlaylists: [{ not: "a playlist" }],
    })).toThrow("Invalid smart playlist data");
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

describe("keeping the newest changes in a backup file", () => {
  const now = Date.UTC(2026, 9, 9, 9, 0, 0);
  const hour = 60 * 60 * 1000;
  const withRating = (rating: number): TagDataStructure => ({
    ...taggedBackupData,
    tracks: { "spotify:track:1": { ...taggedBackupData.tracks["spotify:track:1"], rating } },
  });

  it("saves edits made after the first file of the day once Tagify goes quiet", () => {
    const files: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { files.push(this.download); });

    expect(maybeDownloadAutomaticTagDataFileBackup(withRating(5), { now }).status).toBe("created");
    // A later edit the same day is too soon for the daily file...
    expect(maybeDownloadAutomaticTagDataFileBackup(withRating(3), { now: now + hour })).toEqual({ status: "skipped", reason: "too-soon" });
    // ...and a trailing file waits for a quarter of the period, so edits don't download on every pause.
    expect(maybeDownloadTrailingTagDataFileBackup(withRating(3), { now: now + hour })).toEqual({ status: "skipped", reason: "too-soon" });

    const trailing = maybeDownloadTrailingTagDataFileBackup(withRating(3), { now: now + 6 * hour });

    expect(trailing.status).toBe("created");
    expect(files).toHaveLength(2);
    expect(JSON.parse(window.localStorage.getItem(TAG_DATA_AUTO_FILE_BACKUP_METADATA_KEY) || "{}").lastBackedUpAt).toBe(now + 6 * hour);
    expect(maybeDownloadTrailingTagDataFileBackup(withRating(3), { now: now + 13 * hour })).toEqual({ status: "skipped", reason: "unchanged" });
  });

  it("does not download an unchanged library again just because time passed", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    maybeDownloadAutomaticTagDataFileBackup(taggedBackupData, { now });
    const later = maybeDownloadAutomaticTagDataFileBackup(taggedBackupData, { now: now + 2 * DEFAULT_AUTO_FILE_BACKUP_INTERVAL_MS });

    expect(later).toEqual({ status: "skipped", reason: "unchanged" });
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("decides a file isn't due without reading the library", () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    expect(isAutomaticFileBackupDue(now)).toBe(true);
    maybeDownloadAutomaticTagDataFileBackup(taggedBackupData, { now });

    expect(isAutomaticFileBackupDue(now + hour)).toBe(false);
    expect(isAutomaticFileBackupDue(now + DEFAULT_AUTO_FILE_BACKUP_INTERVAL_MS)).toBe(true);
    expect(isAutomaticFileBackupDue(now + DEFAULT_AUTO_FILE_BACKUP_INTERVAL_MS, "never")).toBe(false);

    let reads = 0;
    const watched = { ...withRating(2) } as TagDataStructure;
    Object.defineProperty(watched, "tracks", { get: () => { reads += 1; return withRating(2).tracks; } });

    expect(maybeDownloadAutomaticTagDataFileBackup(watched, { now: now + hour })).toEqual({ status: "skipped", reason: "too-soon" });
    expect(reads).toBe(0);
  });

  it("names the older copy so it is never mistaken for the newest backup", () => {
    const files: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { files.push(this.download); });

    downloadOlderCopyBackup(taggedBackupData, new Date(Date.UTC(2026, 9, 9, 12, 0, 0)));

    expect(files).toEqual(["tagify-older-copy-2026-10-09T12-00-00-000Z.json"]);
  });
});

describe("complete backup files", () => {
  const community = {
    publicationPolicy: null,
    ownerIdentityMapping: null,
    installations: [{ installationId: "install-1" } as never],
  };
  const appState = {
    "filter-formulas": { tracks: { includeTagClauses: [{ tagIds: ["rock"], excludedTagIds: [], operator: "AND" }] } },
    "playlist-rules": { excludedPlaylistIds: ["37i9dQZF1DXcBWIGoYBM5M"] },
    preferences: { "tagify:trackListSortBy": "dateModified" },
  };

  it("includes Community provenance and saved settings in automatic backups", () => {
    let saved: Blob | null = null;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => { saved = blob as Blob; return "blob:backup"; });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    const result = maybeDownloadAutomaticTagDataFileBackup(taggedBackupData, { now: Date.UTC(2026, 9, 5), community, appState });

    expect(result.status).toBe("created");
    expect(saved).not.toBeNull();
    return new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(saved!);
    }).then((text) => {
      const envelope = JSON.parse(text);
      expect(envelope.community.installations).toEqual([{ installationId: "install-1" }]);
      expect(extractAppStateFromBackup(envelope)).toEqual(appState);
    });
  });

  it("treats a file without Smart Playlists as silent about them", () => {
    const withoutSmartPlaylists: Partial<TagDataStructure> = { ...taggedBackupData };
    delete withoutSmartPlaylists.smartPlaylists;
    expect(backupIncludesSmartPlaylists(withoutSmartPlaylists)).toBe(false);
    expect(backupIncludesSmartPlaylists({ ...taggedBackupData, smartPlaylists: [] })).toBe(true);
    expect(backupIncludesSmartPlaylists(buildTagifyBackupEnvelopeV2({ ...taggedBackupData, smartPlaylists: [] }))).toBe(true);
  });

  it("recognizes the empty Community block written by older automatic backups", () => {
    expect(hasCommunityBackupState({ publicationPolicy: null, ownerIdentityMapping: null, installations: [] })).toBe(false);
    expect(hasCommunityBackupState(community)).toBe(true);
    expect(extractAppStateFromBackup(buildTagifyBackupEnvelopeV2(taggedBackupData))).toBeNull();
  });

  it("saves a dated copy of the current library before it is replaced", () => {
    const anchors: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { anchors.push(this.download); });
    const now = new Date(Date.UTC(2026, 9, 5, 12, 0, 0));

    expect(downloadSafetyTagDataBackup(taggedBackupData, { community, appState }, "before-import", now)).toBe(true);
    expect(downloadSafetyTagDataBackup(defaultTagData, { community, appState }, "before-reset", now)).toBe(false);
    expect(anchors).toEqual(["tagify-before-import-2026-10-05T12-00-00-000Z.json"]);
  });
  it("backs up a notes-only library and treats older files as silent about notes", () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const privateNotes = { "spotify:artist:aaaaaaaaaaaaaaaaaaaaaa": { text: "Private artist memory" } };
    const now = Date.UTC(2026, 9, 8);
    expect(maybeDownloadAutomaticTagDataFileBackup(defaultTagData, { now, privateNotes }).status).toBe("created");
    expect(downloadSafetyTagDataBackup(defaultTagData, { privateNotes }, "before-import", new Date(now))).toBe(true);
    expect(extractPrivateNotesFromBackup(buildTagifyBackupEnvelopeV2(defaultTagData))).toBeNull();
    expect(() => extractPrivateNotesFromBackup({ format: "tagify-backup", privateNotes: { "https://public.example": { text: "Invalid" } } })).toThrow();
  });

});
