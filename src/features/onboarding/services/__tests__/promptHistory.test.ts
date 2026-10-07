import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { PromptHistoryStore, LEGACY_SURVEY_KEY, MOBILE_TAGGING_INTRO_KEY } from "../promptHistory";

const empty = { mobileTaggingIntroSeen: false, discoverySurveyDismissed: false };
const a = "a".repeat(64);
const b = "b".repeat(64);
function response(promptHistory = empty) { return new Response(JSON.stringify({ recorded: true, promptHistory }), { status: 200 }); }

describe("account prompt history", () => {
  const stops: (() => void)[] = [];
  beforeEach(() => localStorage.clear());
  afterEach(() => { stops.splice(0).forEach((stop) => stop()); vi.restoreAllMocks(); });

  function start(identity = vi.fn().mockResolvedValue(a), request = vi.fn().mockImplementation(async () => response())) {
    const store = new PromptHistoryStore(identity, request);
    stops.push(store.start("3.0.0"));
    return { store, identity, request };
  }

  it("recovers both dismissals after local storage is erased", async () => {
    const server = new Map<string, typeof empty>();
    const request = vi.fn(async (_url, options) => {
      const body = JSON.parse(String(options?.body));
      const old = server.get(body.accountDigest) ?? empty;
      const history = {
        mobileTaggingIntroSeen: old.mobileTaggingIntroSeen || !!body.promptHistory.mobileTaggingIntroSeen,
        discoverySurveyDismissed: old.discoverySurveyDismissed || !!body.promptHistory.discoverySurveyDismissed,
      };
      server.set(body.accountDigest, history);
      return response(history);
    });
    const first = start(undefined, request).store;
    await waitFor(() => expect(first.getSnapshot().ready).toBe(true));
    first.markSeen("mobileTaggingIntroSeen");
    first.markSeen("discoverySurveyDismissed");
    await waitFor(() => expect(server.get(a)).toEqual({ mobileTaggingIntroSeen: true, discoverySurveyDismissed: true }));
    localStorage.clear();
    const reinstalled = start(undefined, request).store;
    expect(reinstalled.getSnapshot().ready).toBe(false);
    await waitFor(() => expect(reinstalled.getSnapshot()).toEqual({ accountDigest: a, ready: true, mobileTaggingIntroSeen: true, discoverySurveyDismissed: true }));
    expect(JSON.stringify(request.mock.calls)).not.toContain("accessToken");
  });

  it("adopts old dismissals for one account and never assigns them to another", async () => {
    localStorage.setItem(MOBILE_TAGGING_INTRO_KEY, "seen");
    localStorage.setItem(LEGACY_SURVEY_KEY, JSON.stringify({ skipCount: 1 }));
    const { store, identity, request } = start();
    await waitFor(() => expect(store.getSnapshot().ready).toBe(true));
    expect(store.getSnapshot().discoverySurveyDismissed).toBe(true);
    expect(JSON.parse(String(request.mock.calls[0][1].body)).promptHistory).toEqual({ mobileTaggingIntroSeen: true, discoverySurveyDismissed: true });
    identity.mockResolvedValue(b);
    await store.refresh();
    expect(store.getSnapshot()).toEqual({ ...empty, accountDigest: b, ready: true });
    identity.mockResolvedValue(a);
    await store.refresh();
    expect(store.getSnapshot().mobileTaggingIntroSeen).toBe(true);
  });

  it("defers prompts when cloud history or Spotify identity is unavailable", async () => {
    const { store, request, identity } = start(undefined, vi.fn().mockRejectedValue(new Error("Offline")));
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(store.getSnapshot().ready).toBe(false);
    store.markSeen("mobileTaggingIntroSeen");
    expect(store.getSnapshot().mobileTaggingIntroSeen).toBe(true);
    request.mockImplementation(async () => response());
    await store.refresh();
    await waitFor(() => expect(store.getSnapshot().ready).toBe(true));
    expect(store.getSnapshot().mobileTaggingIntroSeen).toBe(true);
    identity.mockResolvedValue(null);
    await store.refresh();
    expect(store.getSnapshot()).toEqual({ ...empty, accountDigest: null, ready: false });
  });

  it("does not treat an old endpoint's success response as recovered history", async () => {
    const { store, request } = start(undefined, vi.fn().mockResolvedValue(new Response('{"recorded":true}')));
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(store.getSnapshot().ready).toBe(false);
  });

  it("keeps a dismissal made during recovery and follows up with its correct account", async () => {
    let complete: ((response: Response) => void) | undefined;
    const request = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { complete = resolve; })).mockImplementation(async () => response());
    const { store, identity } = start(undefined, request);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    store.markSeen("mobileTaggingIntroSeen");
    identity.mockResolvedValue(b);
    await store.refresh();
    complete?.(response());
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    expect(store.getSnapshot()).toEqual({ ...empty, accountDigest: b, ready: true });
    const followup = JSON.parse(String(request.mock.calls[2][1].body));
    expect(followup.accountDigest).toBe(a);
    expect(followup.promptHistory.mobileTaggingIntroSeen).toBe(true);
  });
  it("remembers manual help dismissed before Spotify identifies the account", async () => {
    const identity = vi.fn().mockResolvedValue(null);
    const { store, request } = start(identity);
    await store.refresh();
    store.markSeen("mobileTaggingIntroSeen");
    identity.mockResolvedValue(a);
    await store.refresh();
    expect(store.getSnapshot().mobileTaggingIntroSeen).toBe(true);
    expect(JSON.parse(String(request.mock.calls[0][1].body)).promptHistory.mobileTaggingIntroSeen).toBe(true);
  });

  it("ignores an older account lookup that finishes after a newer login", async () => {
    let oldIdentity: ((account: string) => void) | undefined;
    const identity = vi.fn().mockImplementationOnce(() => new Promise<string>((resolve) => { oldIdentity = resolve; })).mockResolvedValue(b);
    const { store } = start(identity);
    await store.refresh();
    oldIdentity?.(a);
    await waitFor(() => expect(store.getSnapshot().ready).toBe(true));
    expect(store.getSnapshot().accountDigest).toBe(b);
  });

});
