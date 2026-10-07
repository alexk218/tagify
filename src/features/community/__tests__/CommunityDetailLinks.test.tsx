import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ArtistDetails from "../../artist-state/components/ArtistDetails";
import PlaylistDetails from "../../playlist-state/components/PlaylistDetails";
import type { TagTaxonomy } from "@/types/tagData";
import { spotifyApiService } from "@/services/SpotifyApiService";

const taxonomy: TagTaxonomy = {
  categoryOrder: [], categoriesById: {}, subcategoriesById: {}, tagsById: {},
  customAccentsById: {}, colorThemesById: {}, ungroupedColorIds: [],
};
const callbacks = {
  onSetRating: vi.fn(), onSetEnergy: vi.fn(), onRemoveTag: vi.fn(),
  onToggleTagIncludeOff: vi.fn(), onRefreshMetadata: vi.fn(),
};
function Details({ kind, uri }: { kind: "album" | "artist"; uri: string }) {
  const common = { taxonomy, activeTagFilters: [], excludedTagFilters: [], ...callbacks };
  return kind === "album"
    ? <PlaylistDetails {...common} playlistUri={uri} playlistData={{ trackCount: 1, tagIds: [], rating: 0, energy: 0 }} tracks={{}} onOpenPlaylist={vi.fn()} onLoadTrackUris={vi.fn()} onApplyTrackUpdates={vi.fn()} onTagTrack={vi.fn()} onSetTrackRating={vi.fn()} />
    : <ArtistDetails {...common} artistUri={uri} onOpenArtist={vi.fn()} />;
}
const withPerspectives = () => Response.json({ entity: {
  contributors: [{ handle: "mira", displayName: "Mira", tags: [{ label: "Soul" }] }],
} });
const withoutPerspectives = () => Response.json({ entity: { contributors: [] } });

// Album details also list the album's tracks; keep those Spotify lookups out of
// the Community request counts below.
beforeEach(() => {
  vi.spyOn(spotifyApiService, "getAlbumTracks").mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

for (const kind of ["album", "artist"] as const) {
  describe(`${kind} Community link`, () => {
    const uri = `spotify:${kind}:1234567890123456789012`;
    const name = `Open this ${kind} in Tagify Community`;

    it("stays hidden during loading and appears with the perspectives from the same request", async () => {
      let resolve!: (response: Response) => void;
      const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
      render(<Details kind={kind} uri={uri} />);
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
      await act(async () => { resolve(withPerspectives()); });
      expect(await screen.findByRole("link", { name })).toHaveAttribute("href", `https://community.tagify.fm/entity/${kind}/1234567890123456789012`);
      expect(screen.getByText("Community perspectives")).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["no contributors", withoutPerspectives],
      ["missing Community page", () => new Response(null, { status: 404 })],
      ["failed request", () => Promise.reject(new Error("Offline"))],
    ])("stays hidden with %s", async (_label, response) => {
      let settled = false;
      vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => {
        try { return await response(); } finally { settled = true; }
      });
      render(<Details kind={kind} uri={uri} />);
      await waitFor(() => expect(settled).toBe(true));
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
      expect(screen.queryByText("Community perspectives")).not.toBeInTheDocument();
    });

    it("hides the previous link immediately when selecting another entity", async () => {
      let resolve!: (response: Response) => void;
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(withPerspectives())
        .mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
      const { rerender } = render(<Details kind={kind} uri={uri} />);
      await screen.findByRole("link", { name });
      rerender(<Details kind={kind} uri={`spotify:${kind}:2234567890123456789012`} />);
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
      expect(screen.queryByText("Community perspectives")).not.toBeInTheDocument();
      await act(async () => { resolve(withoutPerspectives()); });
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
    });

    it("ignores a late response from the previously selected entity", async () => {
      let resolve!: (response: Response) => void;
      vi.spyOn(globalThis, "fetch")
        .mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }))
        .mockResolvedValueOnce(withoutPerspectives());
      const { rerender } = render(<Details kind={kind} uri={uri} />);
      rerender(<Details kind={kind} uri={`spotify:${kind}:2234567890123456789012`} />);
      await act(async () => { resolve(withPerspectives()); });
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
      expect(screen.queryByText("Community perspectives")).not.toBeInTheDocument();
    });
  });
}
