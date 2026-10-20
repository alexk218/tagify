import { IDBFactory } from "fake-indexeddb";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { defaultTagData } from "@/constants/defaultTagData";
import { TAG_DATA_SCHEMA_VERSION } from "@/utils/tagTaxonomy";
import type { TagDataStructure, TagTaxonomy } from "@/types/tagData";
import { useTagData } from "../useTagData";
import { RECOVERY_UNAVAILABLE_SKIP_MS, RECOVERY_UNAVAILABLE_UNTIL_KEY } from "@/services/sync/SyncInstallRecovery";

const idOf = (name: string) => Object.values(defaultTagData.taxonomy.tagsById).find((tag) => tag.name === name)!.id;
const [rock, pop] = [idOf("Rock"), idOf("Pop")];
const genres = defaultTagData.taxonomy.tagsById[rock].parentId!;
const song = (tagIds: string[]) => ({ name: "Song", artists: "Artist", rating: 0, energy: 0, bpm: null, tagIds, dateCreated: 1_000, dateModified: 1_000 });
const [a, b, c] = ["a", "b", "c"].map((letter) => `spotify:track:${letter.repeat(22)}`);
const library: TagDataStructure = {
  ...JSON.parse(JSON.stringify(defaultTagData)),
  schemaVersion: TAG_DATA_SCHEMA_VERSION,
  tracks: { [a]: { ...song([rock]), rating: 4 }, [b]: song([pop]), [c]: { ...song([]), rating: 3 } },
};

function withLofi(taxonomy: TagTaxonomy): TagTaxonomy {
  const next = JSON.parse(JSON.stringify(taxonomy)) as TagTaxonomy;
  const folder = next.subcategoriesById[genres];
  next.tagsById.lofi = { id: "lofi", name: "Lo-fi", parentId: folder.id, subcategoryId: folder.id };
  folder.tagIds.push("lofi");
  folder.childIds = [...(folder.childIds ?? []), "lofi"];
  next.childrenByParentId![folder.id] = [...(next.childrenByParentId![folder.id] ?? []), "lofi"];
  return next;
}

beforeEach(async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.clear();
  // Community already found nothing to reconnect on this computer, so opening the library
  // doesn't wait 3 s for a Spotify sign-in this test page never provides.
  localStorage.setItem(RECOVERY_UNAVAILABLE_UNTIL_KEY, String(Date.now() + RECOVERY_UNAVAILABLE_SKIP_MS));
  expect(await indexedDBStorage.init()).toBe(true);
  expect(await indexedDBStorage.saveAll(library)).toBe(true);
  localStorage.setItem("tagify:migrationCompleted", "true");
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
});

afterEach(() => {
  indexedDBStorage.resetConnection();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// The tag manager can be opened before a tag is created elsewhere (the
// extension, another device). Saving it must keep that tag and its songs.
it("keeps a tag created elsewhere when a tag change from an older draft is saved", { timeout: 20_000 }, async () => {
  const { result } = renderHook(() => useTagData());
  await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 10_000 });
  const draftBase = result.current.tagData.taxonomy;

  const saved = await indexedDBStorage.loadAllStrict();
  expect(await indexedDBStorage.saveTaxonomy(withLofi(saved.taxonomy))).toBe(true);
  expect(await indexedDBStorage.saveTracks(new Map([[c, { ...saved.tracks[c], tagIds: ["lofi"] }]]), saved.tracks)).toBe(true);
  await act(async () => {
    window.dispatchEvent(new CustomEvent("tagify:dataUpdated", { detail: { type: "save" } }));
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
  expect(result.current.tagData.tracks[c].tagIds).toEqual(["lofi"]);
  const untouched = result.current.tagData.tracks[a];

  const draft = JSON.parse(JSON.stringify(draftBase)) as TagTaxonomy;
  delete draft.tagsById[pop];
  const folder = draft.subcategoriesById[genres];
  folder.tagIds = folder.tagIds.filter((tagId) => tagId !== pop);
  folder.childIds = folder.childIds?.filter((tagId) => tagId !== pop);
  draft.childrenByParentId![genres] = draft.childrenByParentId![genres].filter((tagId) => tagId !== pop);
  draft.tagsById[rock] = { ...draft.tagsById[rock], name: "Rock & Roll" };
  await act(async () => {
    result.current.replaceTaxonomy(draft, [pop], draftBase);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
  });


  for (const shown of [result.current.tagData, await indexedDBStorage.loadAllStrict()]) {
    expect(shown.taxonomy.tagsById.lofi?.name).toBe("Lo-fi");
    expect(shown.taxonomy.tagsById[rock].name).toBe("Rock & Roll");
    expect(shown.taxonomy.tagsById[pop]).toBeUndefined();
    expect(shown.tracks[c].tagIds).toEqual(["lofi"]);
    expect(shown.tracks[a]).toMatchObject({ tagIds: [rock], dateModified: 1_000 });
    expect(shown.tracks[b]).toBeUndefined();
  }
  expect(result.current.tagData.tracks[a]).toBe(untouched);
});
