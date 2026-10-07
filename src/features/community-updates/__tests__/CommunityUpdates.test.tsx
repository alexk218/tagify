import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommunityUpdates } from "../CommunityUpdates";
import { communityUpdateService } from "../communityUpdateService";

const updates = [{ revision: 1, title: "More ways to discover music", publishedAt: "2026-10-01T12:00:00Z", changes: ["Browse tags on albums and artists.", "<script>This remains plain text</script>"] }];
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(communityUpdateService, "check").mockResolvedValue(updates);
  vi.spyOn(communityUpdateService, "dismiss").mockImplementation(() => undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Community update popup", () => {
  it("shows plain text, traps keyboard focus, dismisses with Escape, and restores focus", async () => {
    const { unmount } = render(<><button>Tag a song</button><CommunityUpdates enabled /></>);
    screen.getByRole("button", { name: "Tag a song" }).focus();
    await advance(3000);
    await advance(1100);
    expect(screen.getByRole("dialog", { name: "What's new in Community" })).toBeInTheDocument();
    expect(screen.getByText("<script>This remains plain text</script>")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    const close = screen.getByRole("button", { name: "Close Community updates" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Got it" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(communityUpdateService.dismiss).toHaveBeenCalledWith(updates);
    expect(screen.getByRole("button", { name: "Tag a song" })).toHaveFocus();
    unmount();
  });

  it("waits for onboarding and for legacy Tagify portals without dialog roles", async () => {
    const legacy = document.createElement("div");
    legacy.className = "tagify-portal";
    legacy.innerHTML = "<div>Editing tags</div>";
    document.body.appendChild(legacy);
    const { rerender } = render(<CommunityUpdates enabled={false} />);
    await advance(5000);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<CommunityUpdates enabled />);
    await advance(2000);
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => { legacy.remove(); });
    await advance(1100);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not starve a waiting notice when the underlying player updates", async () => {
    render(<CommunityUpdates enabled />);
    await advance(3100);
    for (let index = 0; index < 6; index += 1) {
      await act(async () => { const element = document.createElement("span"); document.body.appendChild(element); element.remove(); });
      await advance(200);
    }
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not fetch in the background, resumes when visible, and cleans up on unmount", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const { unmount } = render(<CommunityUpdates enabled />);
    await advance(60 * 60 * 1000);
    expect(communityUpdateService.check).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await advance(1100);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    unmount();
    const count = vi.mocked(communityUpdateService.check).mock.calls.length;
    await advance(60 * 60 * 1000);
    window.dispatchEvent(new Event("focus"));
    expect(communityUpdateService.check).toHaveBeenCalledTimes(count);
  });

  it("opens only the fixed Community website and marks the displayed notes read", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<CommunityUpdates enabled />);
    await advance(3000);
    await advance(1100);
    fireEvent.click(screen.getByRole("button", { name: "Open Community" }));
    expect(open).toHaveBeenCalledWith("https://community.tagify.fm", "_blank", "noopener,noreferrer");
    expect(communityUpdateService.dismiss).toHaveBeenCalledWith(updates);
  });
});
