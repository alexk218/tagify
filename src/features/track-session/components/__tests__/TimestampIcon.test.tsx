import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RowTimestamps } from "../TimestampIcon";

describe("RowTimestamps", () => {
  it("shows the full date when the icon itself is hovered (the only thing left when the row is crowded)", () => {
    const created = new Date(2026, 10, 1, 9, 30).getTime();
    const modified = new Date(2026, 10, 20, 18, 5).getTime();
    render(<RowTimestamps created={created} modified={modified} />);
    // The browser shows the nearest title, so the icon's own title must carry the date.
    expect(screen.getByRole("img", { name: /^Created: / })).toHaveAttribute("title", `Created: ${new Date(created).toLocaleString()}`);
    expect(screen.getByRole("img", { name: /^Last updated: / })).toHaveAttribute("title", `Last updated: ${new Date(modified).toLocaleString()}`);
  });
});
