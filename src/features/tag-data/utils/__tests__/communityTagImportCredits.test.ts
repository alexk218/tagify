import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushCommunityTagImportCredits, newlyImportedCommunityTagNames, queueCommunityTagImportCredits } from "../communityTagImportCredits";
import { buildTaxonomyFromCategoryTree } from "@/utils/tagTaxonomy";
import type { TagTaxonomy } from "@/types/tagData";

const KEY = "tagify:communityTagImportCredits:v1";
const connection = { accountId: "account-1", deviceId: "device-1" };
const outbox = () => JSON.parse(localStorage.getItem(KEY) || "[]") as Array<{ accountId: string; name: string }>;

function taxonomyWith(extra: Record<string, Partial<TagTaxonomy["tagsById"][string]>> = {}): TagTaxonomy {
  const taxonomy = buildTaxonomyFromCategoryTree([{ id: "mood", name: "Mood", subcategories: [{ id: "energy", name: "Energy", tags: [{ id: "peak", name: "Peak" }] }] }]);
  for (const [id, tag] of Object.entries(extra)) taxonomy.tagsById[id] = { id, name: id, subcategoryId: "energy", ...tag } as TagTaxonomy["tagsById"][string];
  return taxonomy;
}
const community = (name: string) => ({ type: "community" as const, publicTagKey: name.toLowerCase(), publicTagName: name, importedAt: "2026-10-16T00:00:00Z" });

describe("community tag import thank-yous", () => {
  beforeEach(() => localStorage.removeItem(KEY));

  it("counts only community tags this save adds", () => {
    const base = taxonomyWith({ earlier: { name: "Earlier", source: community("Earlier") } });
    const next = taxonomyWith({
      earlier: { name: "Earlier", source: community("Earlier") },
      added: { name: "Late night (mine)", source: community("Late night") },
      own: { name: "My own tag" },
    });
    expect(newlyImportedCommunityTagNames(base, next)).toEqual(["Late night"]);
  });

  it("sends queued imports for the signed-in account in batches of 25 and clears them", async () => {
    queueCommunityTagImportCredits("account-1", Array.from({ length: 30 }, (_, i) => `Tag ${i}`));
    queueCommunityTagImportCredits("account-2", ["Someone else's"]);
    queueCommunityTagImportCredits("account-1", ["tag 3"]); // already queued, by any case
    const request = vi.fn(async () => ({ recorded: true }));
    await flushCommunityTagImportCredits(connection, request);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]).toEqual(["/api/v2/tag-imports", { method: "POST", body: { deviceId: "device-1", tags: Array.from({ length: 25 }, (_, i) => ({ name: `Tag ${i}` })) } }]);
    expect((request.mock.calls[1] as unknown[])[1]).toMatchObject({ body: { tags: Array.from({ length: 5 }, (_, i) => ({ name: `Tag ${i + 25}` })) } });
    expect(outbox()).toEqual([expect.objectContaining({ accountId: "account-2", name: "Someone else's" })]);
  });

  it("keeps imports for later when Community can't take them yet, and drops ones it never will", async () => {
    queueCommunityTagImportCredits("account-1", ["Night"]);
    for (const status of [undefined, 401, 404, 503]) {
      await flushCommunityTagImportCredits(connection, vi.fn(async () => { throw Object.assign(new Error("nope"), { status }); }));
      expect(outbox()).toHaveLength(1);
    }
    await flushCommunityTagImportCredits(connection, vi.fn(async () => { throw Object.assign(new Error("bad"), { status: 400 }); }));
    expect(outbox()).toEqual([]);
  });

  it("does nothing without Community and forgets month-old imports", async () => {
    const request = vi.fn(async () => ({}));
    queueCommunityTagImportCredits("account-1", ["Old"], Date.now() - 31 * 24 * 60 * 60 * 1000);
    await flushCommunityTagImportCredits(null, request);
    expect(request).not.toHaveBeenCalled();
    await flushCommunityTagImportCredits(connection, request);
    expect(request).not.toHaveBeenCalled();
  });

  it("runs one flush at a time, and another after it settles", async () => {
    queueCommunityTagImportCredits("account-1", ["Night"]);
    let release: () => void = () => undefined;
    const request = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const first = flushCommunityTagImportCredits(connection, request);
    expect(flushCommunityTagImportCredits(connection, request)).toBe(first);
    release();
    await first;
    queueCommunityTagImportCredits("account-1", ["Rain"]);
    await flushCommunityTagImportCredits(connection, vi.fn(async () => ({})));
    expect(outbox()).toEqual([]);
  });
});
