import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SpotifyShareTip } from "../SpotifyShareTip";
import { useSpotifyShareTip } from "../useSpotifyShareTip";
import { openPhoneStore } from "../PhoneAppPanel";
import { PHONE_APP_STATE_KEY } from "../phoneAppState";

function Host({ enabled = true, connected = true, onConnect = () => {} }: { enabled?: boolean; connected?: boolean; onConnect?: () => void }) {
  const tip = useSpotifyShareTip({ enabled });
  return tip.shown ? <SpotifyShareTip connected={connected} onConnect={() => { tip.done(); onConnect(); }} onGetApp={() => openPhoneStore("app_store")} onClose={tip.done} /> : null;
}

const settle = () => act(() => { vi.advanceTimersByTime(1100); });
const stored = () => JSON.parse(localStorage.getItem(PHONE_APP_STATE_KEY) ?? "{}");

describe("Tag Spotify songs from your phone", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    // Someone who had Tagify before this version; new installations are covered below.
    localStorage.setItem("tagify:lastSeenVersion", "3.3.0");
    window.open = vi.fn() as typeof window.open;
  });
  afterEach(() => { vi.useRealTimers(); });

  it("shows the three steps once, offers the App Store, and stays closed after Got it", () => {
    const { unmount } = render(<Host />);
    settle();
    const dialog = screen.getByRole("dialog", { name: "Tag Spotify songs from your phone" });
    expect(dialog).toBeVisible();
    expect(screen.getAllByRole("img")).toHaveLength(4);
    expect(screen.getByText("Tap Share in Spotify")).toBeVisible();
    expect(screen.getByText("Pick Tagify")).toBeVisible();
    expect(screen.getByRole("img", { name: "QR code for Tagify on the App Store" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Open the App Store page" }));
    expect(window.open).toHaveBeenCalledWith("https://tagify.fm/iphone", "_blank", "noopener,noreferrer");
    expect(screen.getByRole("dialog")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(stored().spotifyShareTipDone).toBe(true);

    unmount();
    render(<Host />);
    settle();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks a computer that isn't connected to connect first", () => {
    const onConnect = vi.fn();
    render(<Host connected={false} onConnect={onConnect} />);
    settle();
    expect(screen.getByText(/connect this computer first/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Got it" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Connect this computer" }));
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(stored().spotifyShareTipDone).toBe(true);
  });

  it("closes for good with Escape", () => {
    render(<Host />);
    settle();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(stored().spotifyShareTipDone).toBe(true);
  });

  it("waits while another dialog is open or prompts are held back", async () => {
    const other = document.createElement("div");
    other.setAttribute("role", "dialog");
    document.body.appendChild(other);
    const { rerender } = render(<Host />);
    settle();
    expect(screen.queryByRole("dialog", { name: "Tag Spotify songs from your phone" })).toBeNull();
    await act(async () => { other.remove(); });
    settle();
    expect(screen.getByRole("dialog", { name: "Tag Spotify songs from your phone" })).toBeVisible();
    rerender(<Host enabled={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("never shows to someone who just installed Tagify, not even after a later update", () => {
    localStorage.clear();
    const { unmount } = render(<Host />);
    settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(stored().spotifyShareTipDone).toBe(true);
    unmount();

    localStorage.setItem("tagify:installed-version", JSON.stringify({ version: "3.0.0", atOrBefore: false }));
    render(<Host />);
    settle();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("skips people who hid the phone apps button", () => {
    localStorage.setItem(PHONE_APP_STATE_KEY, JSON.stringify({ hidden: true }));
    render(<Host />);
    settle();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
