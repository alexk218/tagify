import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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

function renderWorkspace({ connected = true, status = "idle" as SyncStatus, sharing = sharingStub(policyFixture()), ...handlers }: {
  connected?: boolean;
  status?: SyncStatus;
  sharing?: CommunitySharing;
  connectionPending?: boolean;
  onConnectCommunity?: () => void;
  onOpenCloudSync?: () => void;
  onOpenSharing?: () => void;
} = {}) {
  const props = {
    onConnectCommunity: vi.fn(),
    onOpenCloudSync: vi.fn(),
    onOpenSharing: vi.fn(),
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
    />,
  );
  return props;
}

describe("CommunityWorkspace", () => {
  it("leads members who aren't connected straight to sharing their tags", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const { onConnectCommunity, onOpenCloudSync } = renderWorkspace({ connected: false, status: "unlinked" });

    expect(screen.getByRole("heading", { name: "Back up your tags and use them on your phone" })).toBeInTheDocument();
    // Local files never publish, so only the three Spotify songs count.
    expect(screen.getByText("3 tags on 3 songs come with you. Nothing is public unless you choose.")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Create account or sign in" }));
    expect(onConnectCommunity).toHaveBeenCalledTimes(1);
    expect(onOpenCloudSync).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Visit Community" }));
    expect(openSpy).toHaveBeenCalledWith("https://tagify.fm", "_blank", "noopener,noreferrer");
    expect(screen.queryByRole("button", { name: "Sync" })).not.toBeInTheDocument();
  });

  it("asks to finish connecting while an approval waits in the browser", () => {
    const { onConnectCommunity } = renderWorkspace({ connected: false, status: "unlinked", connectionPending: true });
    expect(screen.getByRole("heading", { name: "Finish connecting in your browser" })).toBeInTheDocument();
    expect(screen.getByText("Enter your email on the page that opened and type the code we email you. Tagify finishes by itself.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Finish connecting" }));
    expect(onConnectCommunity).toHaveBeenCalledTimes(1);
  });

  it("shows how many tags would appear and opens sharing for a member who never chose", () => {
    const { onOpenSharing, onOpenCloudSync } = renderWorkspace({ status: "publication-review-required", sharing: sharingStub(policyFixture({ reviewedAt: null })) });

    expect(screen.getByRole("heading", { name: "Your tags aren't public yet" })).toBeInTheDocument();
    expect(screen.getByText("3 tags on 3 songs would appear on your profile if you publish.")).toBeInTheDocument();
    expect(screen.getByText("Not public yet · Backed up")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Publish my tags" }));
    expect(onOpenSharing).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    expect(onOpenCloudSync).toHaveBeenCalledTimes(1);
  });

  it("counts only what isn't hidden for a member who keeps tags private", () => {
    renderWorkspace({ sharing: sharingStub(policyFixture({ enabled: false, hiddenNodeIds: ["workout"] })) });
    expect(screen.getByRole("heading", { name: "Your tags are private" })).toBeInTheDocument();
    expect(screen.getByText("2 tags on 2 songs would appear on your profile if you publish.")).toBeInTheDocument();
    expect(screen.getByText("Private · Backed up")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish my tags" })).toBeInTheDocument();
  });

  it("links to the profile and hidden-tag choices once tags are public", () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const { onOpenSharing } = renderWorkspace();

    expect(screen.getByRole("heading", { name: "Your tags are public" })).toBeInTheDocument();
    expect(screen.getByText("Public · Backed up")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "@alex" }));
    expect(openSpy).toHaveBeenCalledWith("https://tagify.fm/@alex", "_blank", "noopener,noreferrer");
    fireEvent.click(screen.getByRole("button", { name: "Choose what's hidden" }));
    expect(onOpenSharing).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Visit Community" })).toBeInTheDocument();
  });

  it("keeps \"View my profile\" until the handle is known", () => {
    renderWorkspace({ sharing: sharingStub(policyFixture(), { handle: null }) });
    expect(screen.getByRole("button", { name: "View my profile" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "@alex" })).not.toBeInTheDocument();
  });

  it("resumes paused updates in one step", async () => {
    const paused = policyFixture({ paused: true, revision: 4 });
    const request = vi.spyOn(syncRuntime, "communityRequest").mockResolvedValue({ policy: { ...paused, paused: false, revision: 5 } });
    vi.spyOn(syncRuntime, "notePublicationReviewed").mockImplementation(() => undefined);
    renderWorkspace({ sharing: sharingStub(paused) });

    expect(screen.getByRole("heading", { name: "Updates are paused" })).toBeInTheDocument();
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

  it("has no Disconnect on the card", () => {
    const { onOpenCloudSync } = renderWorkspace();

    expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sync" }));
    expect(onOpenCloudSync).toHaveBeenCalledTimes(1);
  });

  it("shows a revoked device as requiring reconnection instead of connected", () => {
    const { onOpenCloudSync } = renderWorkspace({ status: "reauthorize", sharing: sharingStub(null, { phase: "idle" }) });

    expect(screen.getByRole("heading", { name: "Reconnect this computer" })).toBeInTheDocument();
    expect(screen.getByText("Device revoked · Reconnect required")).toBeInTheDocument();
    expect(screen.queryByText(/Backed up/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sync" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect device" }));
    expect(onOpenCloudSync).toHaveBeenCalledTimes(1);
  });
});
