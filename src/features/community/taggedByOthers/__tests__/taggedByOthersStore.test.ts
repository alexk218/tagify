import { IDBFactory } from "fake-indexeddb";
import { beforeEach, expect, it } from "vitest";
import type { TaggedByOthersOutcome } from "../taggedByOthersScan";
import { taggedByOthersStore, type SavedCheck } from "../taggedByOthersStore";

const outcome: TaggedByOthersOutcome = {
  scope: "liked", checked: 800, songIds: ["song-1"], playlistIds: [], playlistsLeft: null, stopped: null, playlistsRead: 3, playlists: 3, skippedPlaylists: 0, capped: false,
  matches: [{
    track: { uri: "spotify:track:1", name: "Song 1", artists: [{ name: "Artist" }], album: { name: "Album" }, duration_ms: 1 },
    tags: [{ label: "Chill", paths: ["Mood / Chill"], people: 2 }], people: 2, peopleCapped: false, sample: ["ana"], position: 0,
  }],
};
const check = (account: string): SavedCheck => ({ account, checkedAt: 1_700_000_000_000, outcome });

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

it("keeps the last check for the account it was made for", async () => {
  expect(await taggedByOthersStore.load("account-a")).toBeNull();
  await taggedByOthersStore.save(check("account-a"));
  expect(await taggedByOthersStore.load("account-a")).toEqual(check("account-a"));
});

it("reads a check saved before scopes existed as one that read Liked Songs and playlists", async () => {
  const { scope: _scope, songIds: _songs, playlistIds: _playlists, playlistsLeft: _left, ...older } = outcome;
  await taggedByOthersStore.save({ account: "account-a", checkedAt: 1_700_000_000_000, outcome: older as TaggedByOthersOutcome });
  expect((await taggedByOthersStore.load("account-a"))?.outcome).toMatchObject({ scope: "liked+playlists", songIds: [], playlistIds: [], playlistsLeft: null });
});

it("removes a check saved for another account instead of showing it", async () => {
  await taggedByOthersStore.save(check("account-a"));
  expect(await taggedByOthersStore.load("account-b")).toBeNull();
  // It is gone for the first account too: one computer keeps one member's list.
  expect(await taggedByOthersStore.load("account-a")).toBeNull();
});

it("forgets the check when cleared", async () => {
  await taggedByOthersStore.save(check("account-a"));
  await taggedByOthersStore.clear();
  expect(await taggedByOthersStore.load("account-a")).toBeNull();
});

it("keeps it apart from the library's own database", async () => {
  await taggedByOthersStore.save(check("account-a"));
  expect((await indexedDB.databases()).map((database) => database.name)).toEqual(["tagify-tagged-by-others"]);
});

it("answers with nothing, never an error, when this computer can't keep it", async () => {
  // @ts-expect-error A Spotify without storage.
  globalThis.indexedDB = undefined;
  await expect(taggedByOthersStore.save(check("account-a"))).resolves.toBeUndefined();
  await expect(taggedByOthersStore.load("account-a")).resolves.toBeNull();
  await expect(taggedByOthersStore.clear()).resolves.toBeUndefined();
});
