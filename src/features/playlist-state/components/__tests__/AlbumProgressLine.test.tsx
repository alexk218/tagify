import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AlbumProgressLine from "../AlbumProgressLine";
import { albumTrackTotalsStore } from "../../services/albumTrackTotals";
import { spotifyApiService } from "@/services/SpotifyApiService";

describe("AlbumProgressLine", () => {
  beforeEach(() => {
    vi.spyOn(spotifyApiService, "getAlbumTrackTotals").mockResolvedValue(new Map());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows how many of the album's tracks are rated or tagged", () => {
    render(
      <AlbumProgressLine
        albumUri="spotify:album:line-known"
        taggedTrackCount={9}
        knownTrackCount={13}
      />,
    );

    expect(screen.getByText("9/13 tracks")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Album progress" })).toHaveAttribute(
      "aria-valuenow",
      "9",
    );
    expect(screen.getByTitle("Album progress: 9 of 13 tracks rated or tagged"))
      .toBeInTheDocument();
  });

  it("marks a finished album", () => {
    render(
      <AlbumProgressLine
        albumUri="spotify:album:line-done"
        taggedTrackCount={13}
        knownTrackCount={13}
      />,
    );

    expect(screen.getByText("13/13 tracks").className).toMatch(/complete/);
  });

  it("uses a remembered album length and looks up unknown ones", async () => {
    vi.mocked(spotifyApiService.getAlbumTrackTotals).mockResolvedValue(
      new Map([["spotify:album:line-lookup", 12]]),
    );

    render(<AlbumProgressLine albumUri="spotify:album:line-lookup" taggedTrackCount={5} />);

    expect(screen.getByText("5 tracks rated or tagged")).toBeInTheDocument();
    expect(await screen.findByText("5/12 tracks")).toBeInTheDocument();
    expect(albumTrackTotalsStore.getSnapshot()["spotify:album:line-lookup"]).toBe(12);
  });

  it("stays out of the way for singles and albums with nothing to report", () => {
    const { container, rerender } = render(
      <AlbumProgressLine
        albumUri="spotify:album:line-single"
        taggedTrackCount={1}
        knownTrackCount={1}
      />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(
      <AlbumProgressLine albumUri="spotify:album:line-empty" taggedTrackCount={0} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
