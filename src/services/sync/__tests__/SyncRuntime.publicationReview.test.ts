import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
import { syncRuntime, type SyncStatus } from "../SyncRuntime";

const configuration = { supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "public-fixture", accessToken: "fixture", libraryId: "library", deviceId: "device" };

type Handler = (message: { payload: Record<string, unknown> }) => void;
type RuntimeFixture = {
  started: boolean;
  status: SyncStatus;
  getStatus: () => SyncStatus;
  connectRealtime: (value: typeof configuration) => Promise<void>;
  refreshIfNeeded: (value: typeof configuration) => Promise<typeof configuration>;
  updateProjectionStatus: (projection: unknown) => void;
  setSettledStatus: () => void;
  notePublicationReviewed: () => void;
  stop: () => void;
};

/** Sync keeps asking for a sharing choice only until one exists, wherever it was made. */
describe("publication review status", () => {
  let runtime: RuntimeFixture;
  let handlers: Record<string, Handler>;

  beforeEach(() => {
    handlers = {};
    type Channel = { on: (type: string, filter: { event: string }, handler: Handler) => Channel; subscribe: () => Channel };
    const channel: Channel = {
      on: vi.fn((_type: string, filter: { event: string }, handler: Handler) => { handlers[filter.event] = handler; return channel; }),
      subscribe: vi.fn((): Channel => channel),
    };
    mocks.createClient.mockReset().mockReturnValue({
      realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
      channel: vi.fn(() => channel),
      removeChannel: vi.fn().mockResolvedValue(undefined),
    });
    runtime = new (syncRuntime.constructor as unknown as new () => RuntimeFixture)();
    runtime.started = true;
    runtime.refreshIfNeeded = vi.fn(async () => configuration);
  });
  afterEach(() => { runtime.stop(); vi.restoreAllMocks(); });

  it("stops asking once the member chose, even when the next sync sends nothing", () => {
    runtime.updateProjectionStatus({ errorCode: "publication_review_required", targetCursor: 7 });
    expect(runtime.getStatus()).toBe("publication-review-required");
    // A run with nothing to send settles from the last reply, which still asked for review.
    runtime.setSettledStatus();
    expect(runtime.getStatus()).toBe("publication-review-required");

    runtime.notePublicationReviewed();
    expect(runtime.getStatus()).toBe("idle");
    runtime.setSettledStatus();
    expect(runtime.getStatus()).toBe("idle");
  });

  it("leaves other states alone when a choice is noted", () => {
    runtime.status = "offline";
    runtime.notePublicationReviewed();
    expect(runtime.getStatus()).toBe("offline");
  });

  it("settles a review request when Community finishes publishing a choice made on the website", async () => {
    await runtime.connectRealtime(configuration);
    runtime.updateProjectionStatus({ errorCode: "publication_review_required", targetCursor: 7 });
    expect(runtime.getStatus()).toBe("publication-review-required");

    handlers.projection_cursor({ payload: { libraryId: "library", projectionCursor: 6 } });
    expect(runtime.getStatus()).toBe("publication-review-required");
    handlers.projection_cursor({ payload: { libraryId: "library", projectionCursor: 7 } });
    expect(runtime.getStatus()).toBe("idle");
  });
});
