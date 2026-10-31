import { describe, expect, it, vi } from "vitest";
import { spotifyLocalPause } from "@/utils/spotifyRequestFailure";
import { CATALOG_FILL_MAX_FAILURES_IN_A_ROW, CatalogFillFailures, catalogFillCause } from "../CatalogFillFailures";
import { catalogFillRun } from "../CommunityCatalogFillRunLog";

describe("catalog fill failures", () => {
  it("names the cause without music or IDs", () => {
    expect(catalogFillCause(Object.assign(new Error("x"), { status: 500 }), "GraphQL getAlbum")).toEqual({ kind: "http-error", status: 500, endpoint: "GraphQL getAlbum" });
    expect(catalogFillCause(Object.assign(new Error("x"), { status: 429, retryAfterSeconds: 30 }))).toEqual({ kind: "rate-limit", status: 429, retryAfterSeconds: 30 });
    expect(catalogFillCause(new Error("Spotify took too long to read a list"))).toEqual({ kind: "no-answer" });
    expect(catalogFillCause(new Error("boom"), "spotify:album:123")).toEqual({ kind: "error" });
  });

  it("stops at once when Spotify asked Tagify to wait", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failures = new CatalogFillFailures();
    expect(failures.failed(spotifyLocalPause(60))).toBe(true);
    expect(failures.summary()).toEqual({ cause: expect.objectContaining({ kind: "local-pause", retryAfterSeconds: 60 }) });
    warn.mockRestore();
  });

  it("skips single failures and stops only after enough in a row", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failures = new CatalogFillFailures();
    const error = Object.assign(new Error("x"), { status: 500 });
    for (let n = 1; n < CATALOG_FILL_MAX_FAILURES_IN_A_ROW; n++) {
      expect(failures.failed(error)).toBe(false);
      failures.succeeded();
    }
    for (let n = 1; n < CATALOG_FILL_MAX_FAILURES_IN_A_ROW; n++) expect(failures.failed(error)).toBe(false);
    expect(failures.failed(error)).toBe(true);
    expect(failures.summary()).toEqual({ cause: { kind: "http-error", status: 500 }, skipped: 2 * CATALOG_FILL_MAX_FAILURES_IN_A_ROW - 2, lastSkip: { kind: "http-error", status: 500 } });
    warn.mockRestore();
  });

  it("puts the cause and skips in the run summary, but no cause for finishing or the allowance", () => {
    const start = { job: "catalogFill" as const, trigger: "start" as const, startedAt: "2026-10-29T11:22:26.000Z" };
    const at = new Date("2026-10-29T11:25:44.000Z");
    const cause = { kind: "http-error" as const, status: 500, endpoint: "GraphQL queryArtistDiscographyAll" };
    expect(catalogFillRun(start, { sent: 154, reads: 172, stopped: "spotify", cause, skipped: 1, lastSkip: cause }, at))
      .toEqual({ ...start, finishedAt: at.toISOString(), reads: 172, sent: 154, stopped: "spotify", cause, skipped: 1, lastSkip: cause });
    expect(catalogFillRun(start, { sent: 1, reads: 1, stopped: "budget", cause }, at)).not.toHaveProperty("cause");
    expect(catalogFillRun(start, "error", at)).toMatchObject({ stopped: "error", cause: { kind: "error" } });
  });
});
