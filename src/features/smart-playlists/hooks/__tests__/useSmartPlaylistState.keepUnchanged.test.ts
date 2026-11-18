import { describe, expect, it } from "vitest";
import type { SmartPlaylistCriteria } from "../../model/smartPlaylist.types";
import { keepUnchangedSmartPlaylists } from "../useSmartPlaylistState";

const playlist = (index: number, extra: Partial<SmartPlaylistCriteria> = {}): SmartPlaylistCriteria => ({
  id: `setup-${index}`,
  playlistId: `playlist${index}`,
  playlistName: `Playlist ${index}`,
  criteria: {
    includeTagClauses: [{ tagIds: [`tag-${index}`], excludedTagIds: [], operator: "OR" }],
    clauseConnectors: [],
    ratingFilters: [],
    energyMinFilter: null,
    energyMaxFilter: null,
    bpmMinFilter: null,
    bpmMaxFilter: null,
  },
  isActive: true,
  createdAt: index,
  lastSyncAt: 100,
  smartPlaylistTrackUris: [`spotify:track:${index}a`, `spotify:track:${index}b`],
  ...extra,
});

describe("keepUnchangedSmartPlaylists", () => {
  it("keeps the same list when a reload brings back identical playlists", () => {
    const current = [playlist(1), playlist(2)];
    const reloaded = JSON.parse(JSON.stringify(current)) as SmartPlaylistCriteria[];
    expect(keepUnchangedSmartPlaylists(current, reloaded)).toBe(current);
  });

  it("replaces only the playlists that changed", () => {
    const current = [playlist(1), playlist(2), playlist(3)];
    const reloaded = JSON.parse(JSON.stringify(current)) as SmartPlaylistCriteria[];
    reloaded[1] = { ...reloaded[1], smartPlaylistTrackUris: ["spotify:track:new"], lastSyncAt: 200 };
    const kept = keepUnchangedSmartPlaylists(current, reloaded);
    expect(kept).not.toBe(current);
    expect(kept[0]).toBe(current[0]);
    expect(kept[1]).toEqual(reloaded[1]);
    expect(kept[2]).toBe(current[2]);
  });

  it("notices added, removed and reordered playlists, and nested rule edits", () => {
    const current = [playlist(1), playlist(2)];
    expect(keepUnchangedSmartPlaylists(current, [current[0]])).toEqual([current[0]]);
    expect(keepUnchangedSmartPlaylists(current, [...current, playlist(3)])).toHaveLength(3);
    const swapped = keepUnchangedSmartPlaylists(current, [playlist(2), playlist(1)]);
    expect(swapped.map((item) => item.id)).toEqual(["setup-2", "setup-1"]);
    const edited = playlist(1, { criteria: { ...playlist(1).criteria, ratingFilters: [5] } });
    expect(keepUnchangedSmartPlaylists(current, [edited, playlist(2)])[0].criteria.ratingFilters).toEqual([5]);
    const optionalAdded = playlist(2, { pendingTagChoices: [] });
    expect(keepUnchangedSmartPlaylists(current, [playlist(1), optionalAdded])[1]).toBe(optionalAdded);
  });
});
