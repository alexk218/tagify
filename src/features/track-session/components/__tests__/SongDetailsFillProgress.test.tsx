import React from "react";
import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SongDetailsProgressBar } from "../SongDetailsFillProgress";

it("shows how many songs have their length and release year so far", () => {
  render(<SongDetailsProgressBar progress={{ total: 3_000, waiting: 1_760 }} />);
  expect(screen.getByText("Finding song lengths and release years")).toBeTruthy();
  expect(screen.getByText(`${(1_240).toLocaleString()} of ${(3_000).toLocaleString()} songs`)).toBeTruthy();
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("41");
});

it("disappears once every song has been tried", () => {
  const { container } = render(<SongDetailsProgressBar progress={{ total: 3_000, waiting: 0 }} />);
  expect(container.innerHTML).toBe("");
});
