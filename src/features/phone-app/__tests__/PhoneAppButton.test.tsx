import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import DataManager from "@/features/tag-data/components/DataManager";
import { PHONE_APP_STATE_KEY } from "../phoneAppState";

const renderBar = () => render(
  <DataManager onExportTagData={vi.fn()} onImportTagData={vi.fn()} onOpenStats={vi.fn()} onResetTagifyData={vi.fn()} onRetryMigration={vi.fn()} onConnectCommunity={vi.fn()} onOpenSync={vi.fn()} />,
);
const stored = () => JSON.parse(localStorage.getItem(PHONE_APP_STATE_KEY) ?? "{}");

describe("Get Tagify on your phone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.open = vi.fn() as typeof window.open;
  });

  it("is new until opened, then offers the App Store and an Android alert", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Get Tagify on your phone (new)" }));
    expect(screen.getByRole("dialog", { name: "Tagify on your phone" })).toBeVisible();
    expect(screen.getByRole("img", { name: "QR code for Tagify on the App Store" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Get Tagify on your phone" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Open the App Store page" }));
    expect(window.open).toHaveBeenCalledWith("https://tagify.fm/iphone", "_blank", "noopener,noreferrer");

    fireEvent.click(screen.getByRole("button", { name: "Notify me when it's out" }));
    expect(screen.getByRole("status")).toHaveTextContent("We'll tell you here in Tagify when it's out.");
    expect(stored().androidNotify).toBe(true);
  });

  it("shows in a quiet menu once, and leaves it after being opened", () => {
    localStorage.setItem("tagify:showOptionalButtons", "false");
    const { unmount } = renderBar();
    expect(screen.queryByRole("button", { name: "Join the Discord!" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Get Tagify on your phone (new)" }));
    expect(stored().quietSince).toEqual(expect.any(Number));
    unmount();

    renderBar();
    expect(screen.queryByRole("button", { name: /Get Tagify on your phone/ })).not.toBeInTheDocument();
  });

  it("Don't show again removes it from the optional buttons too, and Settings brings it back", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: /Get Tagify on your phone/ }));
    fireEvent.click(screen.getByRole("button", { name: "Don't show this button again" }));
    expect(screen.queryByRole("button", { name: /Get Tagify on your phone/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join the Discord!" })).toBeVisible();
    expect(Spicetify.showNotification).toHaveBeenCalledWith("Phone app button hidden. You can bring it back in Settings.");

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const toggle = screen.getByRole("checkbox", { name: "Show phone app button" });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Get Tagify on your phone" })).toBeInTheDocument();
  });
});
