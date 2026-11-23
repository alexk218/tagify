import "fake-indexeddb/auto";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "../app";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";

// Its own file, so the library starts genuinely empty.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

it("a fresh install is asked What do you listen to? first, and the tips start right after Continue", async () => {
  vi.stubGlobal("IntersectionObserver", vi.fn(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() })));
  vi.stubGlobal("ResizeObserver", vi.fn(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() })));
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

  render(<App />);
  const question = await screen.findByRole("dialog", { name: "What do you listen to?" }, { timeout: 8000 });
  // No tip competes with the question.
  expect(screen.queryByRole("dialog", { name: "Rate it here" })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("checkbox", { name: "Metal & Heavy" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(question).not.toBeInTheDocument(), { timeout: 8000 });
  await screen.findByRole("dialog", { name: "Rate it here" }, { timeout: 8000 });

  const taxonomy = (await indexedDBStorage.loadAll())!.taxonomy;
  expect(taxonomy.categoryOrder.map((id) => taxonomy.categoriesById[id].name)).toEqual(["Mood & Energy", "Usage & Context", "Genre & Style"]);
  expect(Object.values(taxonomy.subcategoriesById).map((folder) => folder.name)).toContain("Metal & Heavy");
  expect(localStorage.getItem("tagify:taste-question:v1")).toBe("added");
}, 30_000);
