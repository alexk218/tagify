import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SyncStatus } from "@/services/sync/SyncRuntime";
import { syncRuntime } from "@/services/sync/SyncRuntime";
import { CommunityWorkspace } from "../CommunityWorkspace";
import type { CommunitySharing } from "../useCommunitySharing";
import { policyFixture, sharingStub, taxonomyFixture, tracksFixture } from "./sharingFixtures";

vi.mock("@/features/product-analytics/productAnalytics", () => ({ recordProductInteraction: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
});

const ACCOUNT = "9ca88f9f-1ff9-4f1f-8dad-fbd7191d78e7";
const DEVICE = "c61cb594-ae81-4977-9a10-fdca576e4939";

function renderWorkspace({ connected = true, status = "idle" as SyncStatus, sharing = sharingStub(policyFixture()), ...handlers }: {
  connected?: boolean;
  status?: SyncStatus;
  sharing?: CommunitySharing;
  connectionPending?: boolean;
  onConnectCommunity?: () => void;
  onOpenCloudSync?: () => void;
  onOpenSharing?: () => void;
  onDisconnect?: () => Promise<void>;
} = {}) {
  const props = {
    onConnectCommunity: vi.fn(),
    onOpenCloudSync: vi.fn(),
    onOpenSharing: vi.fn(),
    onDisconnect: vi.fn().mockResolvedValue(undefined),
    ...handlers,
  };
  render(
    <CommunityWorkspace
      {...props}
      connected={connected}
      connectionPending={handlers.connectionPending}
      status={status}
      sharing={connected ? sharing : sharingStub(null, { phase: "idle" })}
      tracks={tracksFixture()}
      taxonomy={taxonomyFixture()}
      connectedAccountId={connected ? ACCOUNT : null}
      connectedDeviceId={connected ? DEVICE : null}
    />,
  );
  return props;
}

describe("CommunityWorkspace", () => {
  it("leads members who aren't connected straight to sharing their tags", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const { onConnectCommunity, onOpenCloudSync } = renderWorkspace({ connected: false, status: "unlinked" });

    expect(screen.getByRole("heading", { name: "Discover tags. Share your own." })).toBeInTheDocument();
    // Local files never publish, so only the three Spotify songs count.
    expect(screen.getByText("3 tags on 3 songs are ready to share.")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Share my tags" }));
    expect(onConnectCommunity).toHaveBeenCalledTimes(1);
    expect(onOpenCloudSync).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Visit Community" }));
    expect(openSpy).toHaveBeenCalledWith("https://community.tagify.fm", "_blank", "noopener,noreferrer");
    expect(screen.queryByRole("button", { name: "Sync" })).not.toBeInTheDocument();
  });

  it("asks to finish connecting while an approval waits in the browser", () => {
    const { onConnectCommunity } = renderWorkspace({ connected: false, status: "unlinked", connectionPending: true });
    expect(screen.getByText("Finish connecting in your browser, then come back here.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Finish connecting" }));
    expect(onConnectCommunity).toHaveBeenCalledTimes(1);
  });

  it("shows how many tags would appear and opens sharing for a member who never chose", () => {
    const { onOpenSharing, onOpenCloudSync } = renderWorkspace({ status: "publication-review-required", sharing: sharingStub(policyFixture({ reviewedAt: null })) });

    expect(screen.getByText("Your tags aren't public yet. 3 tags on 3 songs would appear.")).toBeInTheDocument();
    expect(screen.getByText("Not public yet · Backed up")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Publish my tags" }));
    expect(onOpenSharing).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    expect(onOpenCloudSync).toHaveBeenCalledTimes(1);
  });

  it("counts only what isn't hidden for a member who keeps tags private", () => {
    renderWorkspace({ sharing: sharingStub(policyFixture({ enabled: false, hiddenNodeIds: ["workout"] })) });
    expect(screen.getByText("You're keeping your tags private. 2 tags on 2 songs would appear if you publish.")).toBeInTheDocument();
    expect(screen.getByText("Private · Backed up")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish my tags" })).toBeInTheDocument();
  });

  it("links to the profile and hidden-tag choices once tags are public", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const { onOpenSharing } = renderWorkspace();

    expect(screen.getByText("Public · Backed up")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View my profile" }));
    expect(openSpy).toHaveBeenCalledWith("https://community.tagify.fm/@alex", "_blank", "noopener,noreferrer");
    fireEvent.click(screen.getByRole("button", { name: "Choose what's hidden" }));
    expect(onOpenSharing).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Visit Community" })).toBeInTheDocument();
  });

  it("resumes paused updates in one step", async () => {
    const paused = policyFixture({ paused: true, revision: 4 });
    const request = vi.spyOn(syncRuntime, "communityRequest").mockResolvedValue({ policy: { ...paused, paused: false, revision: 5 } });
    vi.spyOn(syncRuntime, "notePublicationReviewed").mockImplementation(() => undefined);
    renderWorkspace({ sharing: sharingStub(paused) });

    expect(screen.getByText("Updates paused · Backed up")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume updates" }));
    expect(await screen.findByText("Updates resumed. Your profile catches up within a minute.")).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith("/api/v2/publication-policy/resume", { method: "POST", body: { expectedRevision: 4 } });
  });

  it("sends a member with libraries to combine to Sync first", () => {
    const { onOpenCloudSync, onOpenSharing } = renderWorkspace({ status: "merge-required", sharing: sharingStub(policyFixture({ reviewedAt: null })) });
    expect(screen.getByText("Choose how to combine this computer's library with Community before sharing.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Combine libraries" }));
    expect(onOpenCloudSync).toHaveBeenCalledTimes(1);
    expect(onOpenSharing).not.toHaveBeenCalled();
  });

  it("offers another check when Community can't say what's public", () => {
    const sharing = sharingStub(null, { phase: "error" });
    renderWorkspace({ sharing });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(sharing.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Backed up")).toBeInTheDocument();
  });

  it("offers a confirmed disconnect while connected", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const { onDisconnect } = renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(screen.getByText("Stop cloud backup?")).toBeInTheDocument();
    expect(screen.getByText("Your tags stay here. Cloud sync stops, and Community signs out in your browser.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect now" }));

    await waitFor(() => expect(onDisconnect).toHaveBeenCalledTimes(1));
    expect(openSpy).toHaveBeenCalledWith(
      `https://community.tagify.fm/auth/disconnect?account=${ACCOUNT}&device=${DEVICE}`,
      "_blank",
      "noopener,noreferrer",
    );
    expect(openSpy.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(onDisconnect).mock.invocationCallOrder[0]);
  });

  it("opens the browser handoff immediately even when remote disconnect later fails", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    renderWorkspace({ onDisconnect: vi.fn().mockRejectedValue(new Error("Community is unavailable")) });

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect now" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't disconnect safely. Your library is still on this device.");
    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining("/auth/disconnect?account="), "_blank", "noopener,noreferrer");
  });

  it("shows a revoked device as requiring reconnection instead of connected", () => {
    const { onOpenCloudSync } = renderWorkspace({ status: "reauthorize", sharing: sharingStub(null, { phase: "idle" }) });

    expect(screen.getByText("Device revoked · Reconnect required")).toBeInTheDocument();
    expect(screen.queryByText(/Backed up/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sync" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect device" }));
    expect(onOpenCloudSync).toHaveBeenCalledTimes(1);
  });
});
