import { afterEach, describe, expect, it, vi } from "vitest";
import { readLocalDurableAppState, restoreLocalDurableAppState } from "@/services/sync/DurableAppState";
import {
  TO_TAG_KEY,
  ToTagFullError,
  addToTag,
  fillToTagDetails,
  normalizeToTagList,
  readToTagList,
  removeFromToTag,
} from "../toTagStore";

afterEach(() => localStorage.clear());

describe("To Tag list", () => {
  it("adds songs once, keeps their order and when they were added", () => {
    expect(addToTag([{ uri: "spotify:track:a", name: "A" }], 1)).toBe(1);
    expect(addToTag([{ uri: "spotify:track:a", name: "A again" }, { uri: "spotify:track:b" }], 2)).toBe(1);
    expect(readToTagList()).toEqual([
      { uri: "spotify:track:a", name: "A", artists: "", album: "", image: "", addedAt: 1 },
      { uri: "spotify:track:b", name: "", artists: "", album: "", image: "", addedAt: 2 },
    ]);
  });

  it("removes a song only when ticked off", () => {
    addToTag([{ uri: "spotify:track:a" }, { uri: "spotify:local:x:y:z:1" }], 1);
    expect(removeFromToTag(["spotify:track:missing"])).toBe(0);
    expect(removeFromToTag(["spotify:track:a"])).toBe(1);
    expect(readToTagList().map((entry) => entry.uri)).toEqual(["spotify:local:x:y:z:1"]);
    removeFromToTag(["spotify:local:x:y:z:1"]);
    expect(localStorage.getItem(TO_TAG_KEY)).toBeNull();
  });

  it("never touches tag data, so no track record or date changes", () => {
    const tagData = JSON.stringify({ tracks: { "spotify:track:a": { rating: 3, dateModified: 111 } } });
    localStorage.setItem("tagify:tagData", tagData);
    addToTag([{ uri: "spotify:track:a" }, { uri: "spotify:track:new" }]);
    removeFromToTag(["spotify:track:a"]);
    expect(localStorage.getItem("tagify:tagData")).toBe(tagData);
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    expect(keys.filter((key) => key !== "tagify:tagData")).toEqual([TO_TAG_KEY]);
  });

  it("fills missing names without overwriting or moving entries", () => {
    addToTag([{ uri: "spotify:track:a", name: "Kept" }, { uri: "spotify:track:b" }], 5);
    fillToTagDetails({
      "spotify:track:a": { name: "Other", artists: "Artist" },
      "spotify:track:b": { name: "Filled", album: "Album" },
    });
    expect(readToTagList()).toEqual([
      { uri: "spotify:track:a", name: "Kept", artists: "Artist", album: "", image: "", addedAt: 5 },
      { uri: "spotify:track:b", name: "Filled", artists: "", album: "Album", image: "", addedAt: 5 },
    ]);
  });

  it("keeps an album cover only when it is a secure link", () => {
    addToTag([{ uri: "spotify:track:a", image: "http://insecure.example/a.jpg" }, { uri: "spotify:track:b" }], 5);
    fillToTagDetails({
      "spotify:track:a": { image: "javascript:alert(1)" },
      "spotify:track:b": { image: "https://i.scdn.co/image/b" },
    });
    fillToTagDetails({ "spotify:track:b": { image: "https://i.scdn.co/image/other" } });
    expect(readToTagList().map((entry) => entry.image)).toEqual(["", "https://i.scdn.co/image/b"]);
  });

  it("ignores anything that isn't a song", () => {
    expect(normalizeToTagList([{ uri: "spotify:album:x" }, null, { uri: "spotify:track:a", addedAt: "x" }, { uri: "spotify:track:a" }]))
      .toEqual([{ uri: "spotify:track:a", name: "", artists: "", album: "", image: "", addedAt: 0 }]);
    localStorage.setItem(TO_TAG_KEY, "{broken");
    expect(readToTagList()).toEqual([]);
  });

  it("syncs and backs up with saved settings and comes back on restore", async () => {
    addToTag([{ uri: "spotify:track:a", name: "A" }], 1);
    const saved = readLocalDurableAppState();
    expect((saved.preferences as Record<string, unknown>)[TO_TAG_KEY]).toEqual(readToTagList());
    localStorage.clear();
    expect(readToTagList()).toEqual([]);
    await restoreLocalDurableAppState({ preferences: saved.preferences });
    expect(readToTagList().map((entry) => entry.name)).toEqual(["A"]);
  });

  it("refuses to grow past its share of saved settings", () => {
    const songs = Array.from({ length: 2000 }, (_, i) => ({ uri: `spotify:track:${i}`, name: "x".repeat(150) }));
    expect(() => addToTag(songs)).toThrow(ToTagFullError);
    expect(readToTagList()).toEqual([]);
  });

  it("tells listeners when it changes", () => {
    const listener = vi.fn();
    window.addEventListener("tagify:toTagChanged", listener);
    addToTag([{ uri: "spotify:track:a" }]);
    window.removeEventListener("tagify:toTagChanged", listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
