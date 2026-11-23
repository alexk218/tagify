import "fake-indexeddb/auto";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "../app";
import { FIRST_RUN_TIPS_KEY } from "@/features/onboarding/firstRunTips";
import { defaultTagData } from "@/constants/defaultTagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";

const song = (uri: string, name: string) => ({
  track: { uri, name, artists: [{ name: "Artist" }], album: { name: "Album", images: [] }, duration_ms: 1 },
  tags: [{ label: "Dark", paths: [], people: 2 }],
  people: 2,
  peopleCapped: false,
});

vi.mock("@/features/community/taggedByOthers/communityTeaserPreview", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/community/taggedByOthers/communityTeaserPreview")>()),
  communityTeaserPreview: vi.fn(async () => ({ total: 42, asked: 500, songs: [song("spotify:track:a", "Self Aware")] })),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

it("a fresh install is walked through the tag buttons, rating, Manage Tags, Tagged Tracks and Tagged by others last", async () => {
  vi.stubGlobal("IntersectionObserver", vi.fn(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() })));
  vi.stubGlobal("ResizeObserver", vi.fn(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() })));
  // jsdom lays nothing out; give every control a size so the tip has something to point at.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 100, y: 100, top: 100, left: 100, bottom: 120, right: 300, width: 200, height: 20, toJSON: () => ({}),
  } as DOMRect);
  vi.stubGlobal("Spicetify", {
    ...Spicetify,
    Player: {
      ...Spicetify.Player,
      data: { item: { uri: "spotify:track:playing", name: "Housewife", artists: [{ name: "Tate McRae" }], album: { name: "So Close" } } },
    },
    Platform: {
      ...Spicetify.Platform,
      AuthorizationAPI: { getState: () => ({ token: { accessToken: "tips-token" } }) },
      UserAPI: { getUser: async () => ({ username: "tips-listener" }) },
    },
  });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
    url.includes("/updates") ? { schemaVersion: 1, releases: [] } : { tag_name: "v3.0.0" },
  ), { headers: { "Content-Type": "application/json" } })));
  sessionStorage.clear();
  // "What do you listen to?" comes before the tips; it has its own test (app.tasteQuestion.test.tsx).
  localStorage.setItem("tagify:taste-question:v1", "skipped");
  localStorage.setItem("tagify:switch:communityTeasers", "on");

  render(<App />);
  // Tip 1 points at the rating.
  const rateTip = await screen.findByRole("dialog", { name: "Rate it here" }, { timeout: 8000 });

  fireEvent.click(screen.getByRole("button", { name: "Got it" }));
  await waitFor(() => expect(rateTip).not.toBeInTheDocument());

  // Then the tag buttons, Manage Tags and the Tagged Tracks list, each moving on with Got it.
  for (const name of ["Tag the song that's playing", "Make the tags your own", "Your tagged songs"]) {
    const tip = await screen.findByRole("dialog", { name }, { timeout: 8000 });
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() => expect(tip).not.toBeInTheDocument());
  }

  // Tagged by others is always last, and opening the tab finishes it.
  await screen.findByRole("dialog", { name: "People already tagged 42 of your songs" }, { timeout: 8000 });
  fireEvent.click(screen.getByRole("tab", { name: /Tagged by others/ }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: /People already tagged/ })).not.toBeInTheDocument());

  // The playlist tip waits until songs share a tag; a new library has none.
  expect(screen.queryByRole("dialog", { name: "Make a playlist from your tags" })).not.toBeInTheDocument();
  const saved = JSON.parse(localStorage.getItem(FIRST_RUN_TIPS_KEY) ?? "{}");
  expect(saved.shown).toEqual(["rate", "tag", "manage", "tagged", "others"]);
  expect(saved.done).toMatchObject({ play: "action", tag: "got_it", rate: "got_it", manage: "got_it", tagged: "got_it", others: "action" });
}, 30_000);

it("after the core tips, a playlist made from the filters is followed by the Smart Playlists tip", async () => {
  vi.stubGlobal("IntersectionObserver", vi.fn(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() })));
  vi.stubGlobal("ResizeObserver", vi.fn(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() })));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 100, y: 100, top: 100, left: 100, bottom: 120, right: 140, width: 40, height: 20, toJSON: () => ({}),
  } as DOMRect);
  vi.stubGlobal("Spicetify", {
    ...Spicetify,
    Platform: {
      ...Spicetify.Platform,
      AuthorizationAPI: { getState: () => ({ token: { accessToken: "how-to-token" } }) },
      UserAPI: { getUser: async () => ({ username: "how-to-listener" }) },
    },
  });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
    url.includes("/updates") ? { schemaVersion: 1, releases: [] } : { tag_name: "v3.0.0" },
  ), { headers: { "Content-Type": "application/json" } })));
  sessionStorage.clear();
  // Two tagged songs, so the song list and its Smart Playlists button are on screen.
  const tag = Object.keys(defaultTagData.taxonomy.tagsById)[0];
  const tagged = { rating: 0, energy: 0, bpm: null, tagIds: [tag], name: "Housewife", artists: "Tate McRae", dateModified: 1 };
  indexedDBStorage.resetConnection();
  await indexedDBStorage.init();
  await indexedDBStorage.saveAll({ ...defaultTagData, tracks: { "spotify:track:one": tagged, "spotify:track:two": { ...tagged, name: "Greedy" } } });
  indexedDBStorage.resetConnection();
  // The tour ran on this device more than a minute ago, and a playlist was made from the filters since.
  localStorage.setItem(FIRST_RUN_TIPS_KEY, JSON.stringify({ shown: ["tag"], done: { play: "action", tag: "got_it", rate: "got_it", manage: "got_it", tagged: "got_it", others: "got_it", playlist: "action" }, skipped: false }));
  localStorage.setItem("tagify:first-run-tips:started-at", String(Date.now() - 5 * 60_000));
  localStorage.setItem("tagify:first-run-tips:playlist-made", "1");

  render(<App />);
  const tip = await screen.findByRole("dialog", { name: "Keep it updated" }, { timeout: 8000 });
  expect(tip).toHaveTextContent("A smart playlist adds new songs you tag.");

  // Opening Smart Playlists is what the tip asks for.
  fireEvent.click(screen.getByTitle(/^Smart Playlists \(/));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Keep it updated" })).not.toBeInTheDocument());
  const saved = JSON.parse(localStorage.getItem(FIRST_RUN_TIPS_KEY) ?? "{}");
  expect(saved.shown).toEqual(["tag", "smart"]);
  expect(saved.done).toMatchObject({ smart: "action" });
}, 30_000);
