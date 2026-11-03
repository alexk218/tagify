import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  entityKeyV1,
  planInitialLibraryMerge,
  resolveInitialLibraryMerge,
  STARTER_TAG_SEEDS,
  type InitialMergeConflictV1,
  type InitialMergeRequestV2,
  type StarterTagVersion,
} from "@tagify/sync-contracts";
import { buildStarterTaxonomy, KNOWN_STARTER_TAXONOMIES } from "@/constants/defaultTagData";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import type { TagTaxonomy, TrackData } from "@/types/tagData";
import { classifyLocalReplica, type DesktopSyncConfiguration } from "../SyncLocalState";
import { syncRuntime, type InitialMergeReview } from "../SyncRuntime";
import { isStarterTagPlacementConflict, settleStarterTagPlacements } from "../SyncStarterTagMerge";
import { FakeCommunity, FakeDevice, resetDevices, runtime, useDevice } from "./fakeCommunity";

const SONG = "4uLU6hMCjMI75M1A2tKUQC";
const SONG_URI = `spotify:track:${SONG}`;
const tagId = (version: StarterTagVersion, name: string) => STARTER_TAG_SEEDS[version].find((row) => row.kind === "tag" && row.name === name)!.id;
const track = (tagIds: string[]): TrackData => ({ rating: 0, energy: 0, bpm: null, camelotKey: null, tagIds, dateCreated: 1_700_000_000_000, dateModified: 1_700_000_000_000 });

type ReconcileInternals = {
  ensureReplicaReady(configuration: DesktopSyncConfiguration, summary: unknown): Promise<boolean>;
};

let community: FakeCommunity;
/** The choices each library combination sent to Community. */
let merges: Array<InitialMergeRequestV2["resolutions"]>;

/** A Community library whose owner claimed a handle while the website gave out `version`'s starter tags. */
function seedWebsiteStarterTags(version: StarterTagVersion) {
  for (const row of STARTER_TAG_SEEDS[version]) {
    community.nodes.set(row.id, {
      id: row.id, kind: row.kind, parentId: row.parentId, name: row.name, accentId: null,
      position: row.position, nodeRevision: 1, parentListRevision: 0, deleted: false,
    });
  }
  community.headCursor = 1;
}

/**
 * Community's library combination route (app/api/v2/sync/merge): it plans the same review again,
 * refuses unless every difference has exactly one choice, and installs the combined library.
 */
async function communityFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  if (url.pathname !== "/api/v2/sync/merge") return community.fetch(input, init);
  const body = JSON.parse(gunzipSync(new Uint8Array(init?.body as ArrayBuffer)).toString("utf8")) as InitialMergeRequestV2;
  const current = community.snapshot();
  const plan = planInitialLibraryMerge(body.deviceSnapshot, current);
  const conflictIds = new Set(plan.conflicts.map((conflict) => conflict.id));
  if (plan.conflicts.some((conflict) => !body.resolutions[conflict.id])) {
    return Response.json({ error: { code: "invalid_request", message: "Every difference needs a choice" } }, { status: 400 });
  }
  if (Object.keys(body.resolutions).some((id) => !conflictIds.has(id))) {
    return Response.json({ error: { code: "invalid_request", message: "The library choices do not match this review" } }, { status: 400 });
  }
  merges.push(body.resolutions);
  const merged = resolveInitialLibraryMerge(body.deviceSnapshot, current, body.resolutions);
  community.nodes.clear();
  merged.taxonomy.forEach((node) => community.nodes.set(node.id, node));
  community.annotations.clear();
  merged.annotations.forEach((annotation) => community.annotations.set(entityKeyV1(annotation.entity), annotation));
  community.headCursor += 1;
  return Response.json({
    merge: { version: 1, headCursor: community.headCursor, additionsFromDevice: plan.additionsFromDevice, additionsFromCommunity: plan.additionsFromCommunity, conflictsResolved: conflictIds.size },
    projection: { complete: true },
  });
}

/** This computer's Tagify library before linking: `version`'s starter tags and, optionally, one tagged song. */
async function desktopLibrary(version: StarterTagVersion, taggedWith: string[] = [], change?: (taxonomy: TagTaxonomy) => void) {
  const device = new FakeDevice("starter");
  await useDevice(device);
  const taxonomy = buildStarterTaxonomy(version);
  change?.(taxonomy);
  expect(await storageService.saveTaxonomy(taxonomy, { captureSync: false })).toBe(true);
  if (taggedWith.length) expect(await indexedDBStorage.saveTrack(SONG_URI, track(taggedWith.map((name) => tagId(version, name))))).toBe(true);
  return device;
}

/** Linking reaches Community's existing library: the first sync decides how the two come together. */
async function firstSync(device: FakeDevice): Promise<boolean> {
  const summary = { counts: { annotations: community.annotations.size, taxonomy: community.nodes.size, appState: 0 } };
  return (runtime as unknown as ReconcileInternals).ensureReplicaReady(device.configuration, summary);
}

const communityNames = () => [...community.nodes.values()].filter((node) => !node.deleted && node.kind === "tag").map((node) => node.name);
const communityTagsOnSong = () => community.tags(SONG).map((id) => community.nodes.get(id)?.name).sort();
const conflictsIn = (review: InitialMergeReview | null) => review?.conflicts.map((conflict) => conflict.subjectId).sort() ?? [];

beforeEach(() => {
  community = new FakeCommunity();
  merges = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(communityFetch);
  runtime.supportsV2 = true;
  runtime.capabilities = { initialMergeReviewVersion: 2 };
});

afterEach(() => {
  indexedDBStorage.resetConnection();
  resetDevices();
  runtime.supportsV2 = false;
  runtime.capabilities = null;
  runtime.backupHealth = null;
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("linking a library started with other starter tags than Community's", () => {
  it("treats an untouched 73-tag library as new, so Community's backup can be restored onto it", async () => {
    seedWebsiteStarterTags(2);
    const device = await desktopLibrary(1);

    expect(classifyLocalReplica(await storageService.loadAll(), KNOWN_STARTER_TAXONOMIES, null)).toBe("fresh-default");
    expect(await firstSync(device)).toBe(false);
    expect(syncRuntime.getStatus()).toBe("recovery-available");
    expect(merges).toEqual([]);
  });

  it.each([
    { desktop: 2 as const, website: 1 as const, song: ["Rock", "Metal"] },
    { desktop: 1 as const, website: 2 as const, song: ["Rock", "Vintage"] },
  ])("combines a tagged $desktop version library with a $website version website library without asking", async ({ desktop, website, song }) => {
    seedWebsiteStarterTags(website);
    const device = await desktopLibrary(desktop, song);

    expect(await firstSync(device)).toBe(true);

    expect(syncRuntime.getStatus()).not.toBe("merge-required");
    expect(merges).toHaveLength(1);
    // Only starter tags the newer version moved were settled, each keeping Community's place.
    const settled = Object.keys(merges[0]);
    expect(settled.length).toBeGreaterThan(0);
    expect(Object.values(merges[0]).every((source) => source === "community")).toBe(true);
    expect(settled.map((id) => community.nodes.get(id.replace(/^taxonomy:/, ""))?.name)).toContain("R&B");
    // Nothing is lost: both versions' tags are there, and the song keeps its tags.
    const names = communityNames();
    for (const version of [1, 2] as const) {
      for (const row of STARTER_TAG_SEEDS[version].filter((item) => item.kind === "tag")) expect(names).toContain(row.name);
    }
    expect(communityTagsOnSong()).toEqual([...song].sort());
    const local = await storageService.loadAll();
    expect(local.tracks[SONG_URI]?.tagIds.sort()).toEqual(song.map((name) => tagId(desktop, name)).sort());
    expect(Object.keys(local.taxonomy.tagsById).sort()).toEqual([...community.nodes.values()].filter((node) => node.kind === "tag").map((node) => node.id).sort());
  });

  it("still asks about a starter tag the member moved themselves, and sends the settled moves with their choices", async () => {
    seedWebsiteStarterTags(1);
    // The member put Chill first in Energy Level.
    const device = await desktopLibrary(2, ["Rock"], (taxonomy) => {
      const folder = STARTER_TAG_SEEDS[2].find((row) => row.name === "Energy Level")!.id;
      const chill = tagId(2, "Chill");
      const order = taxonomy.childrenByParentId![folder].filter((id) => id !== chill);
      taxonomy.childrenByParentId![folder] = [chill, ...order];
      taxonomy.subcategoriesById[folder].childIds = [chill, ...order];
      taxonomy.subcategoriesById[folder].tagIds = [chill, ...order];
    });

    expect(await firstSync(device)).toBe(false);
    expect(syncRuntime.getStatus()).toBe("merge-required");
    const review = syncRuntime.getInitialMergePreview();
    const energyLevel = STARTER_TAG_SEEDS[2].filter((row) => row.parentId === STARTER_TAG_SEEDS[2].find((item) => item.name === "Energy Level")!.id);
    // Chill and the three tags it moved past; R&B and the other version changes aren't asked about.
    expect(conflictsIn(review)).toEqual(["Chill", "High Energy", "Upbeat", "Moderate"].map((name) => energyLevel.find((row) => row.name === name)!.id).sort());
    expect(Object.keys(review!.automaticResolutions ?? {})).toContain(`taxonomy:${tagId(2, "R&B")}`);

    await syncRuntime.commitInitialMerge(Object.fromEntries(review!.conflicts.map((conflict) => [conflict.id, "device" as const])));

    expect(merges).toHaveLength(1);
    expect(merges[0][`taxonomy:${tagId(2, "Chill")}`]).toBe("device");
    expect(merges[0][`taxonomy:${tagId(2, "R&B")}`]).toBe("community");
    expect(community.nodes.get(tagId(2, "Chill"))?.position).toBe(0);
  });
});

describe("telling a starter tag's move from the member's own change", () => {
  const rnb = tagId(2, "R&B");
  const conflict = (device: Record<string, unknown>, communityValue: Record<string, unknown>): InitialMergeConflictV1 => ({
    id: `taxonomy:${rnb}`, kind: "taxonomy", subjectId: rnb, field: null,
    deviceValue: { kind: "tag", parentId: "sub_sb6d4r", name: "R&B", accentId: null, position: 6, deleted: false, ...device },
    communityValue: { kind: "tag", parentId: "sub_sb6d4r", name: "R&B", accentId: null, position: 7, deleted: false, ...communityValue },
  });

  it("settles a tag each version placed differently, keeping Community's place", () => {
    expect(isStarterTagPlacementConflict(conflict({}, {}))).toBe(true);
    expect(settleStarterTagPlacements([conflict({}, {})])).toEqual({ conflicts: [], automaticResolutions: { [`taxonomy:${rnb}`]: "community" } });
  });

  it("leaves renames, recolors, other folders, deletions and the member's own places to the member", () => {
    expect(isStarterTagPlacementConflict(conflict({ name: "RnB" }, { name: "RnB" }))).toBe(false);
    expect(isStarterTagPlacementConflict(conflict({ accentId: "red" }, {}))).toBe(false);
    expect(isStarterTagPlacementConflict(conflict({ parentId: "sub_11rx725", position: 0 }, {}))).toBe(false);
    expect(isStarterTagPlacementConflict(conflict({ deleted: true }, {}))).toBe(false);
    expect(isStarterTagPlacementConflict(conflict({ position: 2 }, {}))).toBe(false);
    expect(isStarterTagPlacementConflict({ ...conflict({}, {}), kind: "color" })).toBe(false);
    expect(isStarterTagPlacementConflict({ ...conflict({}, {}), subjectId: "tag_member" })).toBe(false);
  });
});
