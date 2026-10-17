import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommunityConnectPrompt } from "../CommunityConnectPrompt";
import { COMMUNITY_CONNECT_PROMPT_PREFIX } from "../communityConnectPromptHistory";
import { getUsageAccountDigest } from "@/features/discovery-survey/services/tagifyUsage";
import { PENDING_PAIRING_STORAGE_KEY } from "@/services/sync/SyncPairingService";
import { setDisconnectedSyncProvenance } from "@/services/sync/SyncLocalState";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";

vi.mock("@/features/product-analytics/productAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/product-analytics/productAnalytics")>()),
  recordProductInteraction: vi.fn(),
}));

vi.mock("@/features/discovery-survey/services/tagifyUsage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/discovery-survey/services/tagifyUsage")>()),
  getUsageAccountDigest: vi.fn(),
}));

const ACCOUNT_A = "a".repeat(64);
const ACCOUNT_B = "b".repeat(64);
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
/** Lets the account lookup finish, then waits out the delay that keeps the invitation from flashing. */
const settle = async () => { await advance(0); await advance(1100); };
const prompt = () => screen.queryByRole("region", { name: "Connect to Community" });

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.mocked(getUsageAccountDigest).mockResolvedValue(ACCOUNT_A);
  vi.mocked(recordProductInteraction).mockClear();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Community connection invitation", () => {
  it("measures the invitation being seen and declined, without counting it while hidden", async () => {
    const { rerender } = render(<CommunityConnectPrompt enabled={false} connected={false} onConnect={vi.fn()} />);
    await settle();
    expect(recordProductInteraction).not.toHaveBeenCalled();

    rerender(<CommunityConnectPrompt enabled connected={false} onConnect={vi.fn()} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(prompt()).toBeNull();
    expect(vi.mocked(recordProductInteraction).mock.calls).toEqual([
      ["community_connect_prompt_shown"],
      ["community_connect_prompt_dismissed"],
    ]);
  });

  it("invites an unlinked listener without taking keyboard focus, and Connect starts setup", async () => {
    const onConnect = vi.fn();
    render(<><button>Tag a song</button><CommunityConnectPrompt enabled connected={false} onConnect={onConnect} /></>);
    screen.getByRole("button", { name: "Tag a song" }).focus();
    await settle();

    expect(prompt()).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Connect to Community" })).toBeInTheDocument();
    expect(prompt()).toHaveAccessibleDescription(
      "Back up your tags and share them with friends. If someone invited you, this finishes joining them.",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Tag a song" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(`${COMMUNITY_CONNECT_PROMPT_PREFIX}${ACCOUNT_A}`)).toBeNull();
  });

  it("stays hidden once Tagify is connected to Community", async () => {
    const { rerender } = render(<CommunityConnectPrompt enabled connected onConnect={vi.fn()} />);
    await advance(2000);
    expect(prompt()).toBeNull();

    rerender(<CommunityConnectPrompt enabled connected={false} onConnect={vi.fn()} />);
    await settle();
    expect(prompt()).toBeInTheDocument();
    rerender(<CommunityConnectPrompt enabled connected onConnect={vi.fn()} />);
    expect(prompt()).toBeNull();
  });

  it("stays hidden while connecting is still waiting for browser approval", async () => {
    localStorage.setItem(PENDING_PAIRING_STORAGE_KEY, JSON.stringify({
      apiBaseUrl: "https://community.tagify.fm", deviceCode: "device", verifier: "verifier",
      userCode: "ABCD-EFGH", verificationUri: "https://community.tagify.fm/link", expiresAt: Date.now() + 600_000, interval: 5,
    }));
    render(<CommunityConnectPrompt enabled connected={false} onConnect={vi.fn()} />);
    await advance(2000);
    expect(prompt()).toBeNull();
  });

  it("does not return after someone disconnected Tagify from Community", async () => {
    setDisconnectedSyncProvenance({ accountId: "account-a", libraryId: "library-a", disconnectedAt: "2026-10-01T12:00:00Z" });
    render(<CommunityConnectPrompt enabled connected={false} onConnect={vi.fn()} />);
    await advance(2000);
    expect(prompt()).toBeNull();
  });

  it("waits while Tagify is busy or another dialog is open", async () => {
    const welcome = document.createElement("div");
    welcome.className = "GenericModal";
    welcome.textContent = "Welcome to Tagify";
    document.body.appendChild(welcome);
    const { rerender } = render(<CommunityConnectPrompt enabled={false} connected={false} onConnect={vi.fn()} />);
    await advance(3000);
    expect(prompt()).toBeNull();

    rerender(<CommunityConnectPrompt enabled connected={false} onConnect={vi.fn()} />);
    await advance(3000);
    expect(prompt()).toBeNull();

    await act(async () => { welcome.remove(); });
    await settle();
    expect(prompt()).toBeInTheDocument();

    rerender(<CommunityConnectPrompt enabled={false} connected={false} onConnect={vi.fn()} />);
    expect(prompt()).toBeNull();
  });

  it("remembers Not now for this Spotify account only", async () => {
    const first = render(<CommunityConnectPrompt enabled connected={false} onConnect={vi.fn()} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(prompt()).toBeNull();
    expect(localStorage.getItem(`${COMMUNITY_CONNECT_PROMPT_PREFIX}${ACCOUNT_A}`)).toBe("1");
    first.unmount();

    const reopened = render(<CommunityConnectPrompt enabled connected={false} onConnect={vi.fn()} />);
    await advance(2000);
    expect(prompt()).toBeNull();
    reopened.unmount();

    vi.mocked(getUsageAccountDigest).mockResolvedValue(ACCOUNT_B);
    render(<CommunityConnectPrompt enabled connected={false} onConnect={vi.fn()} />);
    await settle();
    expect(prompt()).toBeInTheDocument();
  });

  it("waits until it knows which Spotify account to remember a choice for", async () => {
    vi.mocked(getUsageAccountDigest).mockResolvedValue(null);
    render(<CommunityConnectPrompt enabled connected={false} onConnect={vi.fn()} />);
    await advance(2000);
    expect(prompt()).toBeNull();
  });
});
