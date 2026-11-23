import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PhoneTaggingGuide } from "../PhoneTaggingGuide";
import { CONNECT_FOR_PHONE_EVENT } from "../phoneConnection";

describe("Phone Tagging in the Tagify Guide", () => {
  beforeEach(() => {
    localStorage.clear();
    window.open = vi.fn() as typeof window.open;
  });

  it("shows the three iPhone steps and asks a computer that isn't connected to connect first", () => {
    const onConnect = vi.fn();
    const connectRequested = vi.fn();
    window.addEventListener(CONNECT_FOR_PHONE_EVENT, connectRequested);
    render(<PhoneTaggingGuide onConnect={onConnect} />);

    expect(screen.getByText("Tap Share in Spotify")).toBeVisible();
    expect(screen.getByText("Pick Tagify")).toBeVisible();
    expect(screen.getByText("Rate it, tag it, Done")).toBeVisible();
    expect(screen.getByText(/connect this computer first/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Connect this computer" }));
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(connectRequested).toHaveBeenCalledTimes(1);
    window.removeEventListener(CONNECT_FOR_PHONE_EVENT, connectRequested);

    fireEvent.click(screen.getByRole("button", { name: "Open the App Store page" }));
    expect(window.open).toHaveBeenCalledWith("https://tagify.fm/iphone", "_blank", "noopener,noreferrer");
  });

  it("names the account once this computer is connected", () => {
    localStorage.setItem("tagify:sync:configuration", JSON.stringify({
      accountId: "a", deviceId: "d", apiBaseUrl: "https://community.tagify.fm", profile: { displayName: "Alex" },
    }));
    render(<PhoneTaggingGuide onConnect={() => {}} />);
    expect(screen.getByText("Alex")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Connect this computer" })).toBeNull();
  });
});
