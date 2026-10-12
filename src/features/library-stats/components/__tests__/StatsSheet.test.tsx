import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatsSheet } from "../StatsSheet";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>View your stats</button>
      <StatsSheet open={open} onClose={() => setOpen(false)}>
        <h2 id="tagify-stats-title">Stats</h2>
        <button type="button">Inside</button>
      </StatsSheet>
    </>
  );
}

describe("StatsSheet", () => {
  it("takes focus when it opens and gives it back when it closes", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "View your stats" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Stats" });
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("closes from the backdrop and keeps its content for next time", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "View your stats" }));
    const dialog = screen.getByRole("dialog", { name: "Stats" });
    fireEvent.mouseDown(dialog);
    expect(screen.getByRole("dialog", { name: "Stats" })).toBeInTheDocument();
    fireEvent.mouseDown(dialog.parentElement!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Still mounted, just hidden, so its scroll position and choices survive.
    expect(dialog).toBeInTheDocument();
    expect(dialog.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});
