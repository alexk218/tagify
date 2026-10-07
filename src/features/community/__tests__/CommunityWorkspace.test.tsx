import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommunityWorkspace } from "../CommunityWorkspace";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CommunityWorkspace", () => {
  it("shows a distinct Community connection action while disconnected", () => {
    const onConnectCommunity = vi.fn();
    const onOpenCloudSync = vi.fn();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(
      <CommunityWorkspace
        onConnectCommunity={onConnectCommunity}
        onOpenCloudSync={onOpenCloudSync}
        connected={false}
        status="unlinked"
        connectedAccountId={null}
        connectedDeviceId={null}
        onDisconnect={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Discover tags. Share your own." }),
    ).toBeInTheDocument();
    expect(screen.getByText("Discover tags.")).toBeInTheDocument();
    expect(screen.getByText("Share your own.")).toBeInTheDocument();
    expect(
      screen.queryByText(/Tagify Community is where music lovers/),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Visit Community" }));
    expect(openSpy).toHaveBeenCalledWith(
      "https://community.tagify.fm",
      "_blank",
      "noopener,noreferrer",
    );

    expect(screen.queryByRole("button", { name: "Sync" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Connect Community" }));
    expect(onConnectCommunity).toHaveBeenCalledTimes(1);
    expect(onOpenCloudSync).not.toHaveBeenCalled();

    expect(screen.queryByText("Discover")).not.toBeInTheDocument();
    expect(screen.queryByText("Following")).not.toBeInTheDocument();
    expect(screen.queryByText("My Taxonomy")).not.toBeInTheDocument();
    expect(screen.queryByText("Installed")).not.toBeInTheDocument();
    expect(screen.queryByText("Notifications")).not.toBeInTheDocument();
  });

  it("shows Sync and offers a confirmed disconnect only while connected", async () => {
    const onOpenCloudSync = vi.fn();
    const onDisconnect = vi.fn().mockResolvedValue(undefined);
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    render(
      <CommunityWorkspace
        onConnectCommunity={vi.fn()}
        onOpenCloudSync={onOpenCloudSync}
        connected
        status="idle"
        connectedAccountId="9ca88f9f-1ff9-4f1f-8dad-fbd7191d78e7"
        connectedDeviceId="c61cb594-ae81-4977-9a10-fdca576e4939"
        onDisconnect={onDisconnect}
      />,
    );

    expect(screen.queryByRole("button", { name: "Connect Community" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    expect(onOpenCloudSync).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Cloud backup is on")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(screen.getByText("Stop cloud backup?")).toBeInTheDocument();
    expect(
      screen.getByText("Your tags stay here. Cloud sync stops, and Community signs out in your browser."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect now" }));

    await waitFor(() => expect(onDisconnect).toHaveBeenCalledTimes(1));
    expect(openSpy).toHaveBeenCalledWith(
      "https://community.tagify.fm/auth/disconnect?account=9ca88f9f-1ff9-4f1f-8dad-fbd7191d78e7&device=c61cb594-ae81-4977-9a10-fdca576e4939",
      "_blank",
      "noopener,noreferrer",
    );
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(openSpy.mock.invocationCallOrder[0]).toBeLessThan(
      onDisconnect.mock.invocationCallOrder[0],
    );
  });

  it("opens the browser handoff immediately even when remote disconnect later fails", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);

    render(
      <CommunityWorkspace
        onConnectCommunity={vi.fn()}
        onOpenCloudSync={vi.fn()}
        connected
        status="idle"
        connectedAccountId="9ca88f9f-1ff9-4f1f-8dad-fbd7191d78e7"
        connectedDeviceId="c61cb594-ae81-4977-9a10-fdca576e4939"
        onDisconnect={vi.fn().mockRejectedValue(new Error("Community is unavailable"))}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect now" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't disconnect safely. Your library is still on this device.");
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining("/auth/disconnect?account="),
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("shows a revoked device as requiring reconnection instead of connected", () => {
    const onOpenCloudSync = vi.fn();

    render(
      <CommunityWorkspace
        onConnectCommunity={vi.fn()}
        onOpenCloudSync={onOpenCloudSync}
        connected
        status="reauthorize"
        connectedAccountId="9ca88f9f-1ff9-4f1f-8dad-fbd7191d78e7"
        connectedDeviceId="c61cb594-ae81-4977-9a10-fdca576e4939"
        onDisconnect={vi.fn()}
      />,
    );

    expect(screen.getByText("Device revoked · Reconnect required")).toBeInTheDocument();
    expect(screen.queryByText("Cloud backup is on")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect device" }));
    expect(onOpenCloudSync).toHaveBeenCalledTimes(1);
  });
});
