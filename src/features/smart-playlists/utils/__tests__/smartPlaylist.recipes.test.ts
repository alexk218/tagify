import { describe, expect, it } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import type { SmartPlaylistCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import {
  createSmartPlaylistRecipeBundle,
  installSmartPlaylistRecipeBundle,
  isSmartPlaylistRecipeBundle,
} from "@/features/smart-playlists/utils/smartPlaylist.recipes";
import { createEmptyTaxonomy } from "@/utils/tagTaxonomy";

function playlist(tagId: string): SmartPlaylistCriteria {
  return {
    id: "smart-1",
    playlistId: "spotify-private-id",
    playlistName: "Late-night favourites",
    criteria: {
      includeTagClauses: [
        { tagIds: [tagId], excludedTagIds: [], operator: "OR" },
      ],
      clauseConnectors: [],
      ratingFilters: [4, 4.5],
      energyMinFilter: 2,
      energyMaxFilter: 4,
      bpmMinFilter: null,
      bpmMaxFilter: null,
      camelotKeyFilters: [],
    },
    isActive: true,
    createdAt: 10,
    updatedAt: 20,
    lastSyncAt: 30,
    smartPlaylistTrackUris: ["spotify:track:secret"],
  };
}

describe("smart-playlist recipes", async () => {
  it("exports rules and portable tag references without private Spotify state", async () => {
    const tagId = Object.keys(defaultTagData.taxonomy.tagsById)[0];
    const bundle = await createSmartPlaylistRecipeBundle(
      [playlist(tagId)],
      defaultTagData.taxonomy,
      new Date("2026-09-18T00:00:00.000Z"),
    );
    const serialized = JSON.stringify(bundle);

    expect(isSmartPlaylistRecipeBundle(bundle)).toBe(true);
    expect(bundle.recipes[0].tagReferences).toHaveLength(1);
    expect(serialized).not.toContain("spotify-private-id");
    expect(serialized).not.toContain("spotify:track:secret");
    expect(serialized).not.toContain("lastSyncAt");
    expect(serialized).not.toContain("isActive");
  });

  it("creates missing tag paths and installs an unbound, disabled recipe", async () => {
    const tagId = Object.keys(defaultTagData.taxonomy.tagsById)[0];
    const bundle = await createSmartPlaylistRecipeBundle(
      [playlist(tagId)],
      defaultTagData.taxonomy,
    );
    const installed = installSmartPlaylistRecipeBundle(
      bundle,
      createEmptyTaxonomy(),
      [],
      100,
    );

    expect(installed.createdTagCount).toBe(1);
    expect(Object.keys(installed.taxonomy.tagsById)).toHaveLength(1);
    expect(installed.playlists[0]).toMatchObject({
      playlistId: "",
      isActive: false,
      lastSyncAt: 0,
      smartPlaylistTrackUris: [],
    });
    const importedTagId = Object.keys(installed.taxonomy.tagsById)[0];
    expect(installed.playlists[0].criteria.includeTagClauses[0].tagIds).toEqual([
      importedTagId,
    ]);
  });

  it("skips a reimport without changing local edits, activation, or Spotify membership", async () => {
    const tagId = Object.keys(defaultTagData.taxonomy.tagsById)[0];
    const bundle = await createSmartPlaylistRecipeBundle([playlist(tagId)], defaultTagData.taxonomy);
    const first = installSmartPlaylistRecipeBundle(bundle, defaultTagData.taxonomy, [], 100).playlists[0];
    const bound = { ...first, playlistName: "My edited name", playlistId: "local-binding", isActive: true,
      criteria: { ...first.criteria, ratingFilters: [5] }, pendingTagChoices: ["spotify:track:pending"], smartPlaylistTrackUris: ["spotify:track:kept"] };
    bundle.recipes[0].name = "Changed by sender";
    bundle.recipes[0].criteria.ratingFilters = [1];
    const result = installSmartPlaylistRecipeBundle(bundle, defaultTagData.taxonomy, [bound], 200);
    expect(result.importedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.createdTagCount).toBe(0);
    expect(result.playlists).toEqual([bound]);
    expect(result.playlists[0]).toBe(bound);
  });
});
