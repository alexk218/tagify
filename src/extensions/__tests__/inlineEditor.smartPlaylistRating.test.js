import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmSmartPlaylistRatingRemoval, getSmartPlaylistRatingRemoval } from "../inlineEditor.smartPlaylistRating";

const track = { rating: 5, energy: 6, bpm: 120, tagIds: [], dateModified: 17 };
const playlist = { isActive: true, playlistName: "Favorites", smartPlaylistTrackUris: ["a", "b"],
  criteria: { includeTagClauses: [], clauseConnectors: [], ratingFilters: [5], energyMinFilter: null,
    energyMaxFilter: null, bpmMinFilter: null, bpmMaxFilter: null } };
const input = { playlist, trackUris: ["a"], tracks: { a: track, b: track }, rating: 4 };
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe("smart playlist rating removal", () => {
  it.each([0, 0.5, 4, 4.5])("detects removal for rating %s without changing the track", (rating) => {
    expect(getSmartPlaylistRatingRemoval({ ...input, rating })).toMatchObject({ removedTrackUris: ["a"], allowedRatings: [5], rating });
    expect(track).toMatchObject({ rating: 5, dateModified: 17 });
  });
  it("only counts unique selected members that would stop matching", () => {
    expect(getSmartPlaylistRatingRemoval({ ...input, trackUris: ["a", "a", "b", "c"], tracks: { ...input.tracks, c: track } }).removedTrackUris).toEqual(["a", "b"]);
  });
  it("allows another accepted rating, the same rating, and paused or regular playlists", () => {
    expect(getSmartPlaylistRatingRemoval({ ...input, rating: 5 })).toBeNull();
    expect(getSmartPlaylistRatingRemoval({ ...input, playlist: { ...playlist, criteria: { ...playlist.criteria, ratingFilters: [4, 5] } } })).toBeNull();
    expect(getSmartPlaylistRatingRemoval({ ...input, playlist: { ...playlist, isActive: false } })).toBeNull();
    expect(getSmartPlaylistRatingRemoval({ ...input, playlist: null })).toBeNull();
    expect(getSmartPlaylistRatingRemoval({ ...input, playlist: { ...playlist, criteria: { ...playlist.criteria, ratingFilters: [] } } })).toBeNull();
  });
  it("does not blame a rating change for a track that already fails another rule", () => {
    expect(getSmartPlaylistRatingRemoval({ ...input, playlist: { ...playlist, criteria: { ...playlist.criteria, energyMinFilter: 9 } } })).toBeNull();
    expect(getSmartPlaylistRatingRemoval({ ...input, playlist: { ...playlist, smartPlaylistTrackUris: [] } })).toBeNull();
  });
});

describe("rating removal confirmation", () => {
  // jsdom does not implement the browser's native dialog lifecycle.
  beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function () { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function () { this.open = false; } });
  });
  afterEach(() => {
    delete HTMLDialogElement.prototype.showModal;
    delete HTMLDialogElement.prototype.close;
  });
  function open(removal = getSmartPlaylistRatingRemoval(input)) {
    const result = confirmSmartPlaylistRatingRemoval(removal);
    return { result, dialog: document.querySelector("dialog") };
  }
  it("explains the rating rule and resolves only after a choice", async () => {
    const { dialog, result } = open();
    expect(dialog.textContent).toContain("Changing the rating to 4 stars will remove this song from “Favorites”");
    expect(dialog.textContent).toContain("only includes songs rated 5 stars");
    expect(dialog.querySelector("button").autofocus).toBe(true);
    dialog.querySelectorAll("button")[1].click();
    expect(await result).toBe(true);
    expect(document.querySelector("dialog")).toBeNull();
  });
  it.each(["button", "cancel", "close"])("treats %s dismissal as cancellation and restores focus", async (action) => {
    const origin = document.createElement("button"); document.body.append(origin); origin.focus();
    const { dialog, result } = open();
    if (action === "button") dialog.querySelector("button").click();
    else dialog.dispatchEvent(new Event(action, { cancelable: true }));
    expect(await result).toBe(false);
    expect(document.activeElement).toBe(origin);
    expect(document.querySelector("dialog")).toBeNull();
  });
  it("describes clearing and bulk removals and treats playlist names as text", async () => {
    const { dialog, result } = open({ ...getSmartPlaylistRatingRemoval(input), playlistName: "<img src=x>", rating: 0, removedTrackUris: ["a", "b"], allowedRatings: [4.5, 5] });
    expect(dialog.textContent).toContain("Clearing the rating will remove 2 selected songs");
    expect(dialog.textContent).toContain("rated 4.5 or 5 stars");
    expect(dialog.querySelector("img")).toBeNull();
    dialog.querySelector("button").click(); await result;
  });
});
