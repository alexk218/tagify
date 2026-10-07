import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UpdateBanner from "../UpdateBanner";
import { useUpdateChecker } from "../../hooks/useUpdateChecker";

function UpdateNotice() {
  const { updateInfo, dismissUpdate } = useUpdateChecker({
    currentVersion: "3.0.0",
    repoOwner: "alexk218",
    repoName: "tagify",
    delayMs: 0,
  });
  return updateInfo ? <UpdateBanner updateInfo={updateInfo} onDismiss={dismissUpdate} /> : null;
}

describe("Update reminder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: "v3.1.0", body: "A new release." }),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("offers only a temporary close and reminds again when reopened, including old hidden releases", async () => {
    localStorage.setItem("tagify:dismissedVersions", JSON.stringify(["3.1.0"]));
    const firstSession = render(<UpdateNotice />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Tagify 3.1.0 is available!")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/don't remind me/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle("Close this notification"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.queryByText("Tagify 3.1.0 is available!")).not.toBeInTheDocument();
    firstSession.unmount();

    render(<UpdateNotice />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Tagify 3.1.0 is available!")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Show changelog"));
    expect(screen.getByText("A new release.")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Show update instructions"));
    expect(screen.getByText("Manual Install")).toBeInTheDocument();
  });
});
