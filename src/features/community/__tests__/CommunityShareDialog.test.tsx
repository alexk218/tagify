import React from "react";
import type { PublicationPolicyV2 } from "@tagify/sync-contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setDesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { CommunityShareDialog, CommunitySharePanel, hiddenLine } from "../CommunityShareDialog";
import type { SharingSurface } from "../communityPublication";
import { useCommunitySharing } from "../useCommunitySharing";
import { policyFixture, taxonomyFixture, tracksFixture } from "./sharingFixtures";

const mocks = vi.hoisted(() => ({
  communityRequest: vi.fn(),
  syncNow: vi.fn(),
  notePublicationReviewed: vi.fn(),
  recordProductInteraction: vi.fn(),
}));

vi.mock("@/features/product-analytics/productAnalytics", () => ({ recordProductInteraction: mocks.recordProductInteraction }));
vi.mock("@/features/discovery-survey/services/tagifyUsage", () => ({ getUsageAccountDigest: vi.fn().mockResolvedValue("a".repeat(64)) }));
vi.mock("@/services/sync/SyncRuntime", () => ({
  syncRuntime: { communityRequest: mocks.communityRequest, syncNow: mocks.syncNow, notePublicationReviewed: mocks.notePublicationReviewed },
}));

function Harness({ surface = "workspace" }: { surface?: SharingSurface }) {
  const sharing = useCommunitySharing({ connected: true, status: "idle", active: true });
  return <CommunitySharePanel surface={surface} sharing={sharing} tracks={tracksFixture()} taxonomy={taxonomyFixture()} />;
}

/** Community answers GET with `current` and every save with the saved result, like the real routes. */
function serve(initial: PublicationPolicyV2) {
  let current = initial;
  mocks.communityRequest.mockImplementation(async (path: string, options?: { method?: string; body?: { policy?: PublicationPolicyV2 } }) => {
    if (options?.method === "PUT") current = { ...current, ...options.body?.policy, revision: current.revision + 1 };
    else if (path.endsWith("/unpublish")) current = { ...current, enabled: false, revision: current.revision + 1 };
    else if (path.endsWith("/resume")) current = { ...current, paused: false, revision: current.revision + 1 };
    return { policy: current };
  });
  return () => current;
}

const lastBody = () => mocks.communityRequest.mock.calls.at(-1)?.[1]?.body as { policy: PublicationPolicyV2; expectedRevision: number };
const events = () => mocks.recordProductInteraction.mock.calls;

describe("CommunitySharePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setDesktopSyncConfiguration({
      accountId: "account-a", libraryId: "library-a", deviceId: "device-a",
      apiBaseUrl: "https://community.tagify.fm", supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "key",
      accessToken: "access", refreshToken: "refresh", expiresAt: Date.now() + 60_000,
      profile: { handle: "alex", displayName: "Alex" },
    });
  });

  it("publishes a member who never chose in one step, with what would appear", async () => {
    serve(policyFixture({ reviewedAt: null, revision: 0 }));
    render(<Harness />);

    expect(await screen.findByText((_, node) => node?.textContent === "3 tags on 3 songs would appear on your profile.")).toBeInTheDocument();
    expect(screen.getByText("Private notes and ratings stay private.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Choose which tags are public" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Publish my tags" }));

    expect(await screen.findByText("Publishing your tags. Your profile updates within a minute.")).toBeInTheDocument();
    expect(lastBody()).toMatchObject({ expectedRevision: 0, policy: { enabled: true, paused: false, hiddenTagIds: [], hiddenNodeIds: [] } });
    expect(lastBody().policy.reviewedAt).toEqual(expect.any(String));
    expect(events()).toEqual([
      ["community_share_opened", { surface: "workspace", sharing_state: "review" }],
      ["community_profile_published", { surface: "workspace" }],
    ]);
    expect(mocks.notePublicationReviewed).toHaveBeenCalled();
    expect(mocks.syncNow).toHaveBeenCalledOnce();
    expect(screen.getByText("Your tags are on your profile. Tags you hide stay private.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View my profile" })).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(localStorage.getItem(`tagify:community-publish-prompt:v1:${"a".repeat(64)}`) || "{}")).toMatchObject({ decided: true }));
  });

  it("counts a publish that followed the invitation as the invitation's own outcome", async () => {
    serve(policyFixture({ reviewedAt: null }));
    render(<Harness surface="invitation" />);
    fireEvent.click(await screen.findByRole("button", { name: "Publish my tags" }));
    await screen.findByText("Publishing your tags. Your profile updates within a minute.");
    expect(events().map(([event]) => event)).toEqual(["community_share_opened", "community_publish_prompt_published"]);
  });

  it("lets the member hide a folder first, and updates the count as they do", async () => {
    serve(policyFixture({ reviewedAt: null }));
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Choose what's hidden" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide Workout from your profile" }));

    expect(screen.getByText((_, node) => node?.textContent === "2 tags on 2 songs would appear on your profile.")).toBeInTheDocument();
    expect(screen.getByText("Workout stays private.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Publish my tags" }));
    await screen.findByText("Publishing your tags. Your profile updates within a minute.");
    expect(lastBody().policy).toMatchObject({ enabled: true, hiddenNodeIds: ["workout"] });
  });

  it("keeps tags private as a reviewed choice without publishing", async () => {
    serve(policyFixture({ reviewedAt: null }));
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Keep my tags private" }));

    expect(await screen.findByText("Your tags stay private. You can publish them from Community in Tagify any time.")).toBeInTheDocument();
    expect(lastBody().policy).toMatchObject({ enabled: false });
    expect(events().map(([event]) => event)).toEqual(["community_share_opened", "community_publish_kept_private"]);
    expect(screen.getByText("You're keeping your tags private. Tagify keeps backing up your library.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish my tags" })).toBeInTheDocument();
  });

  it("never republishes a member who keeps tags private when they change what's hidden", async () => {
    serve(policyFixture({ enabled: false }));
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Choose what's hidden" }));
    expect(screen.queryByRole("button", { name: "Save without publishing" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide Workout from your profile" }));
    fireEvent.click(screen.getByRole("button", { name: "Save without publishing" }));

    expect(await screen.findByText("Saved. Your profile updates within a minute.")).toBeInTheDocument();
    expect(lastBody().policy).toMatchObject({ enabled: false, hiddenNodeIds: ["workout"] });
    expect(events().map(([event]) => event)).toEqual(["community_share_opened"]);
  });

  it("asks before taking a public profile down", async () => {
    serve(policyFixture({ revision: 5 }));
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Stop sharing" }));
    expect(screen.getByText("Take down your public profile?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.communityRequest).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Stop sharing" }).at(-1)!);
    expect(await screen.findByText("Your profile is no longer public. Backup keeps running.")).toBeInTheDocument();
    expect(mocks.communityRequest).toHaveBeenLastCalledWith("/api/v2/publication-policy/unpublish", { method: "POST", body: { expectedRevision: 5 } });
    expect(events().map(([event]) => event)).toContain("community_sharing_stopped");
  });

  it("resumes paused updates", async () => {
    serve(policyFixture({ paused: true, revision: 2 }));
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Resume updates" }));
    expect(await screen.findByText("Updates resumed. Your profile catches up within a minute.")).toBeInTheDocument();
    expect(mocks.communityRequest).toHaveBeenLastCalledWith("/api/v2/publication-policy/resume", { method: "POST", body: { expectedRevision: 2 } });
    expect(events().map(([event]) => event)).toContain("community_sharing_resumed");
  });

  it("keeps unsaved choices when the sharing settings changed on Community meanwhile", async () => {
    const current = serve(policyFixture({ reviewedAt: null, revision: 3 }));
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Choose what's hidden" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide Workout from your profile" }));
    mocks.communityRequest.mockRejectedValueOnce(Object.assign(new Error("Publication policy revision conflict"), { status: 409 }));
    fireEvent.click(screen.getByRole("button", { name: "Publish my tags" }));

    expect(await screen.findByText("Your sharing settings changed on Community. Check your choices, then try again.")).toBeInTheDocument();
    await waitFor(() => expect(mocks.communityRequest).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("checkbox", { name: "Hide Workout from your profile" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Publish my tags" }));
    await screen.findByText("Publishing your tags. Your profile updates within a minute.");
    expect(lastBody()).toMatchObject({ expectedRevision: 3, policy: { hiddenNodeIds: ["workout"] } });
    expect(current().enabled).toBe(true);
  });

  it("offers another check when Community can't say what's public", async () => {
    serve(policyFixture());
    mocks.communityRequest.mockRejectedValueOnce(new Error("Unavailable"));
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Your tags are on your profile. Tags you hide stay private.")).toBeInTheDocument();
  });

  it("names up to three hidden folders and counts the rest", () => {
    expect(hiddenLine(["Workout"])).toBe("Workout stays private.");
    expect(hiddenLine(["Workout", "Guilty pleasures"])).toBe("Workout and Guilty pleasures stay private.");
    expect(hiddenLine(["A", "B", "C", "D", "E"])).toBe("A, B, C and 2 more stay private.");
  });
});

describe("CommunityShareDialog", () => {
  it("closes from its button and with Escape", () => {
    const onClose = vi.fn();
    render(<CommunityShareDialog surface="sync" sharing={{ phase: "loading", policy: null, state: null, handle: null, refresh: vi.fn() }} tracks={{}} taxonomy={taxonomyFixture()} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Share your tags" })).toBeInTheDocument();
    expect(screen.getByText("Checking what's public…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close sharing" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
