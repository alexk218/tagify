import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import InfoModal from "../InfoModal";

describe("InfoModal", () => {
  it("summarizes the Tagify 3.0.0 highlights and retains release history", async () => {
    render(<InfoModal initialSection="whats-new" onClose={vi.fn()} />);

    const communityHeading = await screen.findByRole("heading", {
      name: "Tagify Community",
    });
    const mobileTaggingHeading = screen.getByRole("heading", {
      name: "Tag Songs from Your Phone",
    });
    expect(
      communityHeading.compareDocumentPosition(mobileTaggingHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /visit tagify community/i }),
    ).toHaveAttribute("href", "https://community.tagify.fm");
    expect(
      screen.getByText(/if Spotify ever clears your Tagify data/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/restore your tags, ratings, Smart Playlists, and settings/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/you never have to start over/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/see community perspectives on tracks you already tagged/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/compare your organization with tags shared by other listeners/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/open manage tags and choose community/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/import tags other people have applied to their tracks/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/share your tags and explore public profiles/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/choosing what stays private/i)).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: /community perspectives showing another listener's public tags/i,
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: /view the community perspectives example at full size/i,
      }),
    );
    expect(
      screen.getByRole("dialog", { name: /community perspectives example/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /enlarged community perspectives example/i }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /close enlarged screenshot/i }),
    );
    expect(
      screen.queryByRole("dialog", { name: /community perspectives example/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/add a song to an active smart playlist from spotify on your phone/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/tells you exactly what changed/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Find Tags from Other Users" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Share Tags That Look Like Yours" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/music taxonomies/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/native workspace/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/exact taxonomy revision/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/safe local forks/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/private by default/i)).not.toBeInTheDocument();
    expect(screen.getByText("What's New in Tagify 2.5.0")).toBeInTheDocument();
  });
});
