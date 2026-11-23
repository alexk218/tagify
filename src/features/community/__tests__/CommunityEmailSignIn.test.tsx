import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { CommunityOnboardingModal } from "../CommunityOnboardingModal";
import { communityPairing } from "../communityPairing";
import { IN_APP_SIGN_UP_SWITCH_KEY } from "../inAppSignUp";
import { PENDING_PAIRING_STORAGE_KEY, syncPairingService } from "@/services/sync/SyncPairingService";
import { setDesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";
import { policyFixture, sharingStub, taxonomyFixture } from "./sharingFixtures";

vi.mock("@/features/product-analytics/productAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/product-analytics/productAnalytics")>()),
  recordProductInteraction: vi.fn(),
}));

vi.mock("../CommunityShareDialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../CommunityShareDialog")>()),
  CommunitySharePanel: () => <div>Your tags: Not public yet</div>,
}));

const API = "https://community.tagify.fm";
const sharing = sharingStub(policyFixture({ reviewedAt: null }));
const jwt = (claims: Record<string, string>) => `x.${btoa(JSON.stringify(claims)).replace(/=+$/, "")}.y`;
const approvedPayload = {
  status: "approved", accessToken: jwt({ sub: "account-b", iss: "https://example.supabase.co/auth/v1" }), refreshToken: "refresh",
  expiresAt: Date.now() + 3_600_000, libraryId: "library-b", deviceId: "device-b", supabasePublishableKey: "key",
};

type Spy<F extends (...args: never[]) => unknown> = MockInstance<Parameters<F>, ReturnType<F>>;
type Reply = { status: number; body: unknown; headers?: Record<string, string> };
let replies: { email: Reply[]; verify: Reply[] };
let requests: { url: string; body: Record<string, string> }[];
let codeNumber: number;

function json({ status, body, headers }: Reply) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function renderSetup(entry: "community" | "sync" = "community") {
  return render(<CommunityOnboardingModal entry={entry} sharing={sharing} tracks={{}} taxonomy={taxonomyFixture()} onClose={vi.fn()} />);
}

async function sendCodeTo(email: string) {
  fireEvent.change(await screen.findByLabelText("Email"), { target: { value: email } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Send code" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Send code" }));
  return screen.findByLabelText("Code");
}

describe("signing in inside Tagify", () => {
  let open: Spy<Window["open"]>;
  let begin: Spy<typeof syncPairingService.begin>;
  let complete: Spy<typeof syncPairingService.complete>;
  let activateCurrentAccount: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    communityPairing.reset();
    syncPairingService.cancelPending();
    localStorage.clear();
    localStorage.setItem(IN_APP_SIGN_UP_SWITCH_KEY, "on");
    vi.mocked(recordProductInteraction).mockClear();
    codeNumber = 0;
    requests = [];
    replies = { email: [], verify: [] };
    activateCurrentAccount = vi.fn().mockResolvedValue(undefined);
    window.TagifySync = {
      getStatus: () => "unlinked", getInitialMergePreview: () => null, getBackupHealth: () => null, activateCurrentAccount,
    } as unknown as NonNullable<typeof window.TagifySync>;
    open = vi.spyOn(window, "open").mockReturnValue(null);
    begin = vi.spyOn(syncPairingService, "begin").mockImplementation(async () => {
      codeNumber += 1;
      const pending = {
        apiBaseUrl: API, deviceCode: `device-code-${codeNumber}`, verifier: `verifier-${codeNumber}`, userCode: `CODE-000${codeNumber}`,
        verificationUri: `${API}/device?code=CODE-000${codeNumber}`, expiresAt: Date.now() + 600_000, interval: 600,
      };
      localStorage.setItem(PENDING_PAIRING_STORAGE_KEY, JSON.stringify(pending));
      return pending;
    });
    complete = vi.spyOn(syncPairingService, "complete").mockImplementation(async (next) => {
      setDesktopSyncConfiguration(next.configuration);
      syncPairingService.cancelPending();
      return { configuration: next.configuration, requiresReload: false };
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, string> : {};
      requests.push({ url, body });
      if (url.endsWith("/device-authorizations/email")) return json(replies.email.shift() ?? { status: 200, body: { status: "sent", resendAfter: 60 } });
      if (url.endsWith("/device-authorizations/email/verify")) return json(replies.verify.shift() ?? { status: 200, body: approvedPayload });
      if (url.endsWith("/device-authorizations/token")) return json({ status: 428, body: { status: "authorization_pending" } });
      return json({ status: 200, body: { profile: { id: "account-b", handle: "alex-b", displayName: "Alex B" } } });
    });
  });

  afterEach(() => {
    delete window.TagifySync;
    vi.restoreAllMocks();
    communityPairing.reset();
    syncPairingService.cancelPending();
    localStorage.clear();
  });

  it("creates the account or signs in with an emailed code, without opening the browser", async () => {
    renderSetup();
    expect(await screen.findByRole("heading", { name: "Create account or sign in" })).toBeInTheDocument();
    expect(screen.getByText(/It's not your Spotify login/)).toBeInTheDocument();
    await waitFor(() => expect(begin).toHaveBeenCalledTimes(1));
    expect(open).not.toHaveBeenCalled();

    const code = await sendCodeTo(" alex@example.com ");
    expect(requests.find((request) => request.url.endsWith("/email"))?.body).toEqual({ deviceCode: "device-code-1", verifier: "verifier-1", email: "alex@example.com" });
    expect(screen.getByText("alex@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send a new code in \d+s/ })).toBeDisabled();

    // A pasted code with spaces finishes by itself once all six digits are in.
    fireEvent.change(code, { target: { value: "123 456" } });
    expect(await screen.findByText("Your tags: Not public yet")).toBeInTheDocument();
    expect(requests.find((request) => request.url.endsWith("/verify"))?.body).toEqual({ deviceCode: "device-code-1", verifier: "verifier-1", email: "alex@example.com", code: "123456" });
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      relationship: "first-link",
      configuration: expect.objectContaining({ accountId: "account-b", profile: expect.objectContaining({ displayName: "Alex B" }) }),
    }), { confirmedAccountSwitch: false });
    await waitFor(() => expect(activateCurrentAccount).toHaveBeenCalledTimes(1));
    expect(open).not.toHaveBeenCalled();
    expect(vi.mocked(recordProductInteraction).mock.calls.filter(([event]) => event.startsWith("community_"))).toEqual([
      ["community_setup_opened", { entry: "community" }],
      ["community_connect_started", { entry: "community" }],
      ["community_connect_completed", { entry: "community", relationship: "first_link" }],
    ]);
  });

  it("asks for a valid email before sending", async () => {
    renderSetup();
    await waitFor(() => expect(begin).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "alex" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Send code" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter your email address, like name@example.com.");
    expect(requests.some((request) => request.url.endsWith("/email"))).toBe(false);
  });

  it("says when a code is wrong and keeps the code step open", async () => {
    replies.verify.push({ status: 400, body: { error: { code: "invalid_code", message: "Invalid code", attemptsRemaining: 1 } } });
    renderSetup();
    await waitFor(() => expect(begin).toHaveBeenCalled());
    const code = await sendCodeTo("alex@example.com");
    fireEvent.change(code, { target: { value: "000000" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("That code isn't right. You have 1 try left.");
    expect(screen.getByLabelText("Code")).toHaveValue("");
    expect(complete).not.toHaveBeenCalled();
    expect(vi.mocked(recordProductInteraction).mock.calls.some(([event]) => event === "community_connect_failed")).toBe(false);

    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "123456" } });
    expect(await screen.findByText("Your tags: Not public yet")).toBeInTheDocument();
  });

  it("starts a fresh request after too many wrong codes, so a new code works", async () => {
    replies.verify.push({ status: 410, body: { error: { code: "expired_token", message: "The device code expired" } } });
    renderSetup();
    await waitFor(() => expect(begin).toHaveBeenCalledTimes(1));
    const code = await sendCodeTo("alex@example.com");
    fireEvent.change(code, { target: { value: "000000" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("That code can't be used anymore. Send a new code.");
    await waitFor(() => expect(begin).toHaveBeenCalledTimes(2));
    expect(open).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Send a new code" }));
    await waitFor(() => expect(requests.filter((request) => request.url.endsWith("/email")).at(-1)?.body.deviceCode).toBe("device-code-2"));
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "654321" } });
    expect(await screen.findByText("Your tags: Not public yet")).toBeInTheDocument();
    expect(requests.filter((request) => request.url.endsWith("/verify")).at(-1)?.body.deviceCode).toBe("device-code-2");
  });

  it("shows Community's message and waits out the limit when too many codes were sent", async () => {
    replies.email.push({ status: 429, body: { error: { code: "rate_limited", message: "Too many codes were sent. Try again in a minute." } }, headers: { "retry-after": "45" } });
    renderSetup();
    await waitFor(() => expect(begin).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "alex@example.com" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Send code" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Send code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many codes were sent. Wait a moment, then send again.");
    expect(screen.getByRole("button", { name: /Send code in 4\ds/ })).toBeDisabled();
    expect(screen.queryByLabelText("Code")).not.toBeInTheDocument();
  });

  it("lets the member go back and use a different email", async () => {
    renderSetup();
    await waitFor(() => expect(begin).toHaveBeenCalled());
    await sendCodeTo("alex@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(await screen.findByLabelText("Email")).toHaveValue("alex@example.com");
  });

  it.each([
    ["Continue with Apple", "Choose Continue with Apple on the page that opened"],
    ["Use my browser instead", "Enter your email on the page that opened"],
  ])("%s opens the website's page and connects when approved there", async (button, step) => {
    renderSetup("sync");
    await waitFor(() => expect(screen.getByRole("button", { name: button })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: button }));

    expect(open).toHaveBeenCalledWith(`${API}/device?code=CODE-0001`, "_blank", expect.anything());
    expect(screen.getByRole("heading", { name: "Finish in your browser" })).toBeInTheDocument();
    expect(screen.getByText(step)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Create account or sign in" })).toBeInTheDocument();
    expect(begin).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: button }));
    vi.spyOn(syncPairingService, "poll").mockResolvedValue({ status: "approved", approval: {
      configuration: { accountId: "account-b", libraryId: "library-b", deviceId: "device-b", apiBaseUrl: API, supabaseUrl: "https://example.supabase.co",
        supabasePublishableKey: "key", accessToken: approvedPayload.accessToken, refreshToken: "refresh", expiresAt: approvedPayload.expiresAt },
      relationship: "first-link", previousAccount: null,
    } });
    act(() => { void communityPairing.check(); });
    expect(await screen.findByText("Your tags: Not public yet")).toBeInTheDocument();
  });

  it("opens the browser at once when the switch is off", async () => {
    localStorage.setItem(IN_APP_SIGN_UP_SWITCH_KEY, "off");
    renderSetup();
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("heading", { name: "Finish in your browser" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
  });
});
