import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import InfoModal from "../InfoModal";

describe("InfoModal", () => {
  it("summarizes the Tagify 2.5.0 highlights", async () => {
    render(<InfoModal initialSection="whats-new" onClose={vi.fn()} />);

    expect(
      await screen.findByRole("heading", { name: "Inline Ratings & Tags" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/rate, tag, and bulk edit tracks/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Color Collections" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Filters & Albums" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Community Requests" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "Tagify inline ratings with the energy and tag menu open in Spotify",
      }),
    ).toHaveAttribute(
      "src",
      "https://raw.githubusercontent.com/alexk218/tagify/main/src/assets/INLINE_RATINGS_AND_TAGS.png",
    );
  });
});
