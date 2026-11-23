import React from "react";
import type { PublicationPolicyV2 } from "@tagify/sync-contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDesktopSyncConfiguration, setDesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { CommunityShareDialog, CommunitySharePanel, hiddenLine } from "../CommunityShareDialog";
import type { SharingSurface } from "../communityPublication";
import { useCommunitySharing } from "../useCommunitySharing";
import { policyFixture, sharingStub, taxonomyFixture, tracksFixture } from "./sharingFixtures";
import { ALL_HIDDEN_LINE, KEEP_PRIVATE_CONSEQUENCE } from "../communitySyncCopy";

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
  mocks.communityRequest.mockImplementation(async (path: string, options?: { method?: string; body?: { policy?: PublicationPolicyV2; share?: boolean } }) => {
    if (path === "/api/v2/rating-sharing") {
      const share = Boolean(options?.body?.share);
      return { ratingSharing: { available: true, shared: share, answered: true, profilePublic: true, rated: true, askOnDesktop: false } };
    }
    if (options?.method === "PUT") current = { ...current, ...options.body?.policy, revision: current.revision + 1 };
    else if (path.endsWith("/unpublish")) current = { ...current, enabled: false, revision: current.revision + 1 };
    else if (path.endsWith("/resume")) current = { ...current, paused: false, revision: current.revision + 1 };
    return { policy: current };
  });
  return () => current;
}

const policyCalls = () => mocks.communityRequest.mock.calls.filter(([path]) => String(path).startsWith("/api/v2/publication-policy"));
const lastBody = () => policyCalls().at(-1)?.[1]?.body as { policy: PublicationPolicyV2; expectedRevision: number };
const ratingCalls = () => mocks.communityRequest.mock.calls.filter(([path]) => path === "/api/v2/rating-sharing");
/** Sharing events; the rating sharing question's own events are checked in their own tests. */
const events = () => mocks.recordProductInteraction.mock.calls.filter(([event]) => !String(event).startsWith("community_rating_sharing_"));
const ratingEvents = () => mocks.recordProductInteraction.mock.calls.filter(([event]) => String(event).startsWith("community_rating_sharing_"));

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
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText(/Private notes always stay private\./)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Choose which tags are public" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Publish my tags" }));

    expect(await screen.findByText("Publishing your tags. Your profile updates within a minute.")).toBeInTheDocument();
    expect(lastBody()).toMatchObject({ expectedRevision: 0, policy: { enabled: true, paused: false, hiddenTagIds: [], hiddenNodeIds: [] } });
    expect(lastBody().policy.entities).toEqual({ track: { tags: true, rating: true }, album: { tags: true, rating: true }, artist: { tags: true, rating: false } });
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
    fireEvent.click(await screen.findByRole("button", { name: /^(Choose what's hidden|Hide any tag or folder)$/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide Workout from your profile" }));

    expect(screen.getByText((_, node) => node?.textContent === "2 tags on 2 songs would appear on your profile.")).toBeInTheDocument();
    expect(screen.getByText("Workout stays private.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Publish my tags" }));
    await screen.findByText("Publishing your tags. Your profile updates within a minute.");
    expect(lastBody().policy).toMatchObject({ enabled: true, hiddenNodeIds: ["workout"] });
  });

  it("offers people who tag like the member once their tags are published", async () => {
    serve(policyFixture({ reviewedAt: null }));
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Publish my tags" }));

    fireEvent.click(await screen.findByRole("button", { name: "See people who tag like you" }));
    // Opens signed in when Community answers a link; this stub answers none, so the plain page opens.
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://tagify.fm/feed", "_blank", "noopener,noreferrer"));
    open.mockRestore();
  });

  it("offers people who tag alike only after publishing, not after other saves", async () => {
    serve(policyFixture({ reviewedAt: null }));
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Keep my tags private" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep everything private" }));

    await screen.findByText("Your tags stay private. You can publish them from Community in Tagify any time.");
    expect(screen.queryByRole("button", { name: "See people who tag like you" })).not.toBeInTheDocument();
  });

  it("keeps tags private as a reviewed choice without publishing", async () => {
    serve(policyFixture({ reviewedAt: null }));
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Keep my tags private" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep everything private" }));

    expect(await screen.findByText("Your tags stay private. You can publish them from Community in Tagify any time.")).toBeInTheDocument();
    expect(lastBody().policy).toMatchObject({ enabled: false });
    expect(events().map(([event]) => event)).toEqual(["community_share_opened", "community_publish_kept_private"]);
    expect(screen.getByText("You're keeping your tags private. Tagify keeps backing up your library.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish my tags" })).toBeInTheDocument();
  });

  it("asks once before keeping every tag private and names the Community features that stay locked", async () => {
    serve(policyFixture({ reviewedAt: null }));
    render(<Harness />);
    await screen.findByRole("button", { name: "Publish my tags" });
    expect(screen.getByRole("button", { name: "Hide any tag or folder" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText(/Keeping your tags private locks Community features in Tagify: Tagged by others/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Keep my tags private" }));
    const confirm = screen.getByRole("group", { name: "Keep all your tags private?" });
    expect(confirm).toHaveAccessibleDescription(KEEP_PRIVATE_CONSEQUENCE);
    expect(KEEP_PRIVATE_CONSEQUENCE).toMatch(/^Private tags lock Community features in Tagify: Tagged by others.*Backup keeps working either way\.$/);
    expect(policyCalls().filter(([, options]) => options?.method === "PUT")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Hide some instead" }));
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Keep my tags private" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep everything private" }));
    expect(await screen.findByText("Your tags stay private. You can publish them from Community in Tagify any time.")).toBeInTheDocument();
    expect(lastBody().policy).toMatchObject({ enabled: false });
  });

  it("counts a public profile with every tag hidden as private and says so", async () => {
    serve(policyFixture({ hiddenNodeIds: ["mood", "workout"] }));
    render(<Harness />);
    expect(await screen.findByText(ALL_HIDDEN_LINE)).toBeInTheDocument();
    // The hide list opens so they can show some tags again.
    expect(screen.getByRole("checkbox", { name: "Hide Workout from your profile" })).toBeChecked();
  });

  it("asks before saving hidden choices that hide every tag", async () => {
    serve(policyFixture());
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Choose what's hidden" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide Workout from your profile" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide Mood from your profile" }));
    expect(screen.getByText(ALL_HIDDEN_LINE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("group", { name: "Keep all your tags private?" })).toBeInTheDocument();
    expect(policyCalls().filter(([, options]) => options?.method === "PUT")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Keep everything private" }));
    await screen.findByText("Saved. Your profile updates within a minute.");
    expect(lastBody().policy).toMatchObject({ enabled: true, hiddenNodeIds: expect.arrayContaining(["workout", "mood"]) });
  });

  it("shares ratings too when a member who kept tags private publishes later", async () => {
    serve(policyFixture({ enabled: false }));
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Publish my tags" }));

    await screen.findByText("Publishing your tags. Your profile updates within a minute.");
    expect(lastBody().policy).toMatchObject({ enabled: true, entities: { track: { rating: true }, album: { rating: true }, artist: { rating: false } } });
  });

  it("sends a public member's rating choice unchanged when they change what's hidden", async () => {
    serve(policyFixture());
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Choose what's hidden" }));
    expect(screen.queryByText("Your tags and star ratings would be public. Private notes stay private.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide Workout from your profile" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await screen.findByText("Saved. Your profile updates within a minute.");
    expect(lastBody().policy).toMatchObject({ enabled: true, hiddenNodeIds: ["workout"], entities: policyFixture().entities });
  });

  it("never republishes a member who keeps tags private when they change what's hidden", async () => {
    serve(policyFixture({ enabled: false }));
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: /^(Choose what's hidden|Hide any tag or folder)$/ }));
    expect(screen.queryByRole("button", { name: "Save without publishing" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide Workout from your profile" }));
    fireEvent.click(screen.getByRole("button", { name: "Save without publishing" }));

    expect(await screen.findByText("Saved. Your profile updates within a minute.")).toBeInTheDocument();
    expect(lastBody().policy).toMatchObject({ enabled: false, hiddenNodeIds: ["workout"] });
    expect(events().map(([event]) => event)).toEqual(["community_share_opened"]);
  });

  it("leaves stopping sharing to Community", async () => {
    serve(policyFixture({ revision: 5 }));
    render(<Harness />);
    expect(await screen.findByRole("button", { name: "View my profile" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop sharing" })).not.toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole("button", { name: /^(Choose what's hidden|Hide any tag or folder)$/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide Workout from your profile" }));
    mocks.communityRequest.mockRejectedValueOnce(Object.assign(new Error("Publication policy revision conflict"), { status: 409 }));
    fireEvent.click(screen.getByRole("button", { name: "Publish my tags" }));

    expect(await screen.findByText("Your sharing settings changed on Community. Check your choices, then try again.")).toBeInTheDocument();
    await waitFor(() => expect(policyCalls()).toHaveLength(3));
    expect(screen.getByRole("checkbox", { name: "Hide Workout from your profile" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Publish my tags" }));
    await screen.findByText("Publishing your tags. Your profile updates within a minute.");
    expect(lastBody()).toMatchObject({ expectedRevision: 3, policy: { hiddenNodeIds: ["workout"] } });
    expect(current().enabled).toBe(true);
  });

  it("shares star ratings with the publish, and records the answer on Community", async () => {
    serve(policyFixture({ reviewedAt: null }));
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Publish my tags" }));
    await screen.findByText("Publishing your tags. Your profile updates within a minute.");

    expect(lastBody().policy.entities).toMatchObject({ track: { tags: true, rating: true }, album: { tags: true, rating: true }, artist: { rating: false } });
    await waitFor(() => expect(ratingCalls()).toEqual([["/api/v2/rating-sharing", { method: "POST", body: { share: true, surface: "desktop_publish" } }]]));
    await waitFor(() => expect(ratingEvents()).toEqual([
      ["community_rating_sharing_answered", { answer: "yes", surface: "desktop_publish" }],
    ]));
  });

  it("still publishes when Community can't record the ratings answer", async () => {
    serve(policyFixture({ reviewedAt: null }));
    const base = mocks.communityRequest.getMockImplementation()!;
    mocks.communityRequest.mockImplementation(async (path: string, options?: never) => {
      if (path === "/api/v2/rating-sharing") throw Object.assign(new Error("Not found"), { status: 404 });
      return base(path, options);
    });
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Publish my tags" }));
    expect(await screen.findByText("Publishing your tags. Your profile updates within a minute.")).toBeInTheDocument();
    expect(lastBody().policy.entities.track.rating).toBe(true);
    await waitFor(() => expect(ratingCalls()).toHaveLength(1));
    expect(ratingEvents()).toEqual([]);
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
    render(<CommunityShareDialog surface="sync" sharing={{ phase: "loading", policy: null, state: null, handle: null, handleMissing: false, refresh: vi.fn() }} tracks={{}} taxonomy={taxonomyFixture()} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Share your tags" })).toBeInTheDocument();
    expect(screen.getByText("Checking what's public…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close sharing" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("CommunitySharePanel for a member who connected before picking a handle", () => {
  const handleless = () => sharingStub(policyFixture({ reviewedAt: null, revision: 0 }), { handle: null, handleMissing: true });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setDesktopSyncConfiguration({
      accountId: "account-a", libraryId: "library-a", deviceId: "device-a",
      apiBaseUrl: "https://community.tagify.fm", supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "key",
      accessToken: "access", refreshToken: "refresh", expiresAt: Date.now() + 60_000,
    });
  });

  it("picks the handle, then publishes", async () => {
    const policy = serve(policyFixture({ reviewedAt: null, revision: 0 }));
    const base = mocks.communityRequest.getMockImplementation()!;
    mocks.communityRequest.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
      if (path === "/api/v2/device/profile") return { profile: { id: "member-a", handle: "new_member", displayName: "new_member" } };
      return base(path, options);
    });
    render(<CommunitySharePanel surface="onboarding" sharing={handleless()} tracks={tracksFixture()} taxonomy={taxonomyFixture()} />);

    expect(screen.getByText(/By publishing, you confirm you're 16 or older/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Your handle"), { target: { value: "@New_Member" } });
    expect(screen.getByText("Your profile will be at tagify.fm/@new_member. You can't change it later.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Publish my tags" }));

    await waitFor(() => expect(mocks.communityRequest.mock.calls.some(([, options]) => options?.method === "PUT")).toBe(true));
    expect(policy().enabled).toBe(true);
    expect(mocks.communityRequest.mock.calls[0]).toEqual(["/api/v2/device/profile", { method: "POST", body: { handle: "new_member", acceptTerms: true } }]);
    expect(getDesktopSyncConfiguration()?.profile?.handle).toBe("new_member");
  });

  it("explains a handle that breaks the rules without asking Community, and a taken one after", async () => {
    mocks.communityRequest.mockRejectedValue(Object.assign(new Error("Someone already has that handle. Try another one."), { status: 409 }));
    render(<CommunitySharePanel surface="onboarding" sharing={handleless()} tracks={tracksFixture()} taxonomy={taxonomyFixture()} />);

    fireEvent.click(screen.getByRole("button", { name: "Publish my tags" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Pick a handle to publish your tags.");
    fireEvent.change(screen.getByLabelText("Your handle"), { target: { value: "ab" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish my tags" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Use 3–30 lowercase letters, numbers, or underscores.");
    expect(mocks.communityRequest).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Your handle"), { target: { value: "taken" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish my tags" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Someone already has that handle. Try another one.");
    expect(mocks.communityRequest).toHaveBeenCalledTimes(1);
  });

  it("keeps tags private without a handle", async () => {
    const policy = serve(policyFixture({ reviewedAt: null, revision: 0 }));
    render(<CommunitySharePanel surface="onboarding" sharing={handleless()} tracks={tracksFixture()} taxonomy={taxonomyFixture()} />);

    fireEvent.click(screen.getByRole("button", { name: "Keep my tags private" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep everything private" }));
    await waitFor(() => expect(policy().reviewedAt).not.toBeNull());
    expect(policy().enabled).toBe(false);
    expect(mocks.communityRequest.mock.calls.some(([path]) => path === "/api/v2/device/profile")).toBe(false);
  });
});

