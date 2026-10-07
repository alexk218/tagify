import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MainSettingsModal from "../MainSettingsModal";

function renderSettings() {
  return render(
    <MainSettingsModal
      onClose={vi.fn()}
      showSupportButtons
      onToggleSupportButtons={vi.fn()}
      showUpdateProtectionButton
      onToggleUpdateProtectionButton={vi.fn()}
    />,
  );
}

describe("MainSettingsModal display settings", () => {
  beforeEach(() => {
    localStorage.setItem(
      "tagify:extensionSettings",
      JSON.stringify({
        enableTracklistEnhancer: true,
        enablePlaybarEnhancer: true,
        tracklistDisplayMode: "combined",
        playbarDisplayMode: "combined",
      }),
    );
  });

  it("uses the display dropdowns as the only tracklist and playbar controls", async () => {
    renderSettings();

    expect(
      await screen.findByLabelText("Tagify Column Display"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Playbar Display")).toBeInTheDocument();
    expect(screen.queryByText("Tracklist Enhancer")).not.toBeInTheDocument();
    expect(screen.queryByText("Playbar Enhancer")).not.toBeInTheDocument();
  });

  it("keeps legacy enable flags coherent when a display mode changes", async () => {
    renderSettings();
    const tracklistDisplay = await screen.findByLabelText(
      "Tagify Column Display",
    );

    fireEvent.change(tracklistDisplay, { target: { value: "disabled" } });
    expect(
      JSON.parse(localStorage.getItem("tagify:extensionSettings") || "{}"),
    ).toMatchObject({
      enableTracklistEnhancer: false,
      tracklistDisplayMode: "disabled",
    });

    fireEvent.change(tracklistDisplay, { target: { value: "energy" } });
    expect(
      JSON.parse(localStorage.getItem("tagify:extensionSettings") || "{}"),
    ).toMatchObject({
      enableTracklistEnhancer: true,
      tracklistDisplayMode: "energy",
    });
  });

  it("migrates legacy disabled toggles to the disabled display mode", async () => {
    localStorage.setItem(
      "tagify:extensionSettings",
      JSON.stringify({
        enableTracklistEnhancer: false,
        enablePlaybarEnhancer: false,
      }),
    );

    renderSettings();

    expect(await screen.findByLabelText("Tagify Column Display")).toHaveValue(
      "disabled",
    );
    expect(screen.getByLabelText("Playbar Display")).toHaveValue("disabled");
  });
});
