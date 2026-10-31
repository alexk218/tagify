import { describe, expect, it } from "vitest";
import { catalogFillItem, catalogFillLive, watchedRequest, watchedReserve } from "../CatalogFillLive";
import { catalogFillRun } from "../CommunityCatalogFillRunLog";

describe("catalog filler live view", () => {
  it("names the item behind each kind of reservation", () => {
    expect(catalogFillItem("spotify:track:4uLU6hMCjMI75M1A2tKUQC")).toEqual({ kind: "track", id: "4uLU6hMCjMI75M1A2tKUQC" });
    expect(catalogFillItem("catalog-fill:spotify:artist:0OdUWJ0sBjDrqHygGUXeCF:2")).toEqual({ kind: "artist", id: "0OdUWJ0sBjDrqHygGUXeCF" });
    expect(catalogFillItem("something else")).toEqual({ kind: "other", id: "" });
  });

  it("counts a run's reads, refusals and sent items while it runs, then keeps its summary", async () => {
    catalogFillLive.started("catalogFill");
    let allow = true;
    const reserve = watchedReserve(() => allow);
    expect(reserve("catalog-fill:spotify:album:1DFixLWuPkv3KT3TnV35m3")).toBe(true);
    allow = false;
    expect(reserve("catalog-fill:spotify:album:2DFixLWuPkv3KT3TnV35m3")).toBe(false);
    const request = watchedRequest(async () => new Response("{}", { status: 200 }));
    await request("https://example.test", { method: "POST", body: JSON.stringify({ items: [1, 2, 3] }) });
    await request("https://example.test", { method: "GET" });

    const live = catalogFillLive.snapshot();
    expect(live.running).toMatchObject({ job: "catalogFill", reads: 1, sent: 3 });
    expect(live.events.map((event) => event.type)).toEqual(["sent", "refused", "read"]);
    expect(live.minutes.at(-1)).toMatchObject({ reads: 1, refused: 1, sent: 3 });
    expect((globalThis as { TagifyCatalogFillLive?: { snapshot(): unknown } }).TagifyCatalogFillLive?.snapshot()).toMatchObject({ version: 1 });

    const start = { job: "catalogFill" as const, trigger: "schedule" as const, startedAt: new Date().toISOString() };
    catalogFillLive.finished(catalogFillRun(start, { reads: 1, sent: 3, stopped: "budget" }, new Date()));
    const after = catalogFillLive.snapshot();
    expect(after.running).toBeNull();
    expect(after.runs[0]).toMatchObject({ job: "catalogFill", reads: 1, sent: 3, stopped: "budget" });
  });

  it("doesn't count a POST Community refused", async () => {
    catalogFillLive.started("songReleases");
    const request = watchedRequest(async () => new Response("{}", { status: 503 }));
    await request("https://example.test", { method: "POST", body: JSON.stringify({ items: [1] }) });
    expect(catalogFillLive.snapshot().running?.sent).toBe(0);
  });
});
