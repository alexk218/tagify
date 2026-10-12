import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { resolveInitialLibraryMerge, type LibrarySnapshotV2 } from "@tagify/sync-contracts";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import { buildLocalSnapshot, syncRuntime } from "@/services/sync/SyncRuntime";
import { setDesktopSyncConfiguration, setLocalPersistencePaused } from "@/services/sync/SyncLocalState";
import { InitialLibraryMergeReview } from "@/features/community/InitialLibraryMergeReview";
import { StatsWorkspace } from "@/features/library-stats/components/StatsWorkspace";
import { useStatsBaseline } from "@/features/library-stats/hooks/useStatsBaseline";
import { computeLibraryStats } from "@/features/library-stats/model/libraryStats";
import { createEmptyTaxonomy } from "@/utils/tagTaxonomy";
import type { TagDataStructure } from "@/types/tagData";
import "@/styles/globals.css";

// Real controls, runtime and IndexedDB; all account and server state is isolated.
const NOW = Date.UTC(2026, 9, 12, 12);
Date.now = () => NOW;
const uri = "spotify:track:4uLU6hMCjMI75M1A2tKUQC";
const configuration = { accountId: "isolated-reconciliation", libraryId: "44444444-4444-4444-8444-444444444444", deviceId: "55555555-5555-4555-8555-555555555555", apiBaseUrl: "https://community.example", supabaseUrl: "https://supabase.example", supabasePublishableKey: "fixture", accessToken: "fixture", refreshToken: "fixture", expiresAt: NOW + 3_600_000 };
Object.assign(window, { reconciliationReadData: () => indexedDBStorage.loadAllStrict(), Spicetify: { showNotification: () => {}, Platform: { History: { push: () => {} } } } });
const taxonomy = createEmptyTaxonomy();
taxonomy.categoryOrder = ["genre"];
taxonomy.categoriesById.genre = { id: "genre", name: "Genre", childIds: ["house"], subcategoryIds: [] };
taxonomy.childrenByParentId = { genre: ["house"] };
taxonomy.tagsById.house = { id: "house", name: "House", parentId: "genre", subcategoryId: "genre" };
const scenario = new URLSearchParams(location.search);
const seed: TagDataStructure = { schemaVersion: 9, taxonomy: scenario.has("deleted") ? createEmptyTaxonomy() : taxonomy, tracks: {
  [uri]: { name: "Cleared song", artists: "Example Artist", rating: 0, energy: scenario.has("empty") ? 0 : 5, bpm: null, tagIds: [], dateCreated: Date.UTC(2026, 0, 2, 12), dateModified: Date.UTC(2026, 9, 1, 12) },
}, playlists: {}, artists: {}, smartPlaylists: [] };
let canonical: LibrarySnapshotV2;
const runtime = syncRuntime as unknown as { capabilities: unknown; ensureReplicaReady(config: typeof configuration, summary: unknown): Promise<boolean>; replaceWithRequiredSnapshot(config: typeof configuration): Promise<void> };
async function seedDevice(data: TagDataStructure) {
  setLocalPersistencePaused(true);
  try { await indexedDBStorage.saveAll(data); }
  finally { setLocalPersistencePaused(false); }
}
window.fetch = async (input, options) => {
  const path = new URL(String(input)).pathname;
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  if (path.endsWith("/snapshot")) return json({ snapshot: canonical });
  if (path.endsWith("/merge")) {
    if (new URLSearchParams(location.search).has("error")) return json({ error: { message: "Could not save your choices. Try again." } }, 503);
    const body = options?.body instanceof ArrayBuffer
      ? await new Response(new Blob([options.body]).stream().pipeThrough(new DecompressionStream("gzip"))).json()
      : JSON.parse(String(options?.body));
    canonical = { ...resolveInitialLibraryMerge(body.deviceSnapshot, canonical, body.resolutions), headCursor: 8 };
    canonical.annotations = canonical.annotations.filter((annotation) => !annotation.deleted);
    return json({ merge: { version: 1, headCursor: 8 }, projection: { complete: true } });
  }
  if (path.endsWith("/ack")) return json({ acknowledged: true });
  throw new Error(`Unexpected fixture request: ${path}`);
};

function Fixture() {
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<TagDataStructure | null>(null);
  const [result, setResult] = useState("");
  const [sequence, setSequence] = useState(0);
  const baseline = useStatsBaseline(data ?? seed, ready);
  useEffect(() => { void (async () => {
    setDesktopSyncConfiguration(configuration);
    await storageService.switchAccountDatabase();
    await seedDevice(seed);
    if (scenario.has("deleted")) await indexedDBStorage.deleteTrack(uri);
    await indexedDBStorage.saveStatsBaseline({ takenAt: NOW, dates: { [uri]: seed.tracks[uri].dateModified! } });
    const cloud = structuredClone(seed);
    cloud.taxonomy = taxonomy;
    cloud.tracks[uri] = { ...cloud.tracks[uri], rating: 4, energy: 6, tagIds: ["house"], dateCreated: Date.UTC(2024, 0, 2, 12), dateModified: Date.UTC(2025, 5, 7, 12) };
    canonical = { ...await buildLocalSnapshot(configuration.libraryId, cloud), protocolVersion: 2, appState: [], headCursor: 7 };
    runtime.capabilities = { initialMergeReviewVersion: 2 };
    await runtime.ensureReplicaReady(configuration, { counts: { annotations: 1, taxonomy: 2, appState: 0 } });
    setReady(true);
  })(); }, []);
  const showData = async () => {
    const saved = await indexedDBStorage.loadAllStrict();
    setData(saved);
    const savedBaseline = await indexedDBStorage.getStatsBaseline();
    const stats = computeLibraryStats(saved, "all", NOW, savedBaseline);
    const ranges = Object.fromEntries((["all", "12m", "90d", "30d"] as const).map((range) => { const value = computeLibraryStats(saved, range, NOW, savedBaseline); return [range, { tracks: value.overview.tracks, rated: value.overview.ratedTracks, tagged: value.overview.taggedTracks, lastTagged: value.activity.lastTaggedAt }]; }));
    setResult(JSON.stringify({ exists: Boolean(saved.tracks[uri]), rating: saved.tracks[uri]?.rating, tags: saved.tracks[uri]?.tagIds, created: saved.tracks[uri]?.dateCreated, modified: saved.tracks[uri]?.dateModified, recentTracks: ranges["12m"].tracks, lastTagged: stats.activity.lastTaggedAt, ranges }));
    setSequence((value) => value + 1);
  };
  if (!ready) return <p>Loading isolated reconciliation…</p>;
  return <main style={{ maxWidth: 1000, margin: "0 auto" }}>
    {!data ? <InitialLibraryMergeReview review={syncRuntime.getInitialMergePreview()!} onDownloadBackup={async () => {}} onCommit={async (choices) => { const response = await syncRuntime.commitInitialMerge(choices); await showData(); return response; }} /> : <>
      <p role="status">Library combined</p>
      <button onClick={async () => { await seedDevice({ ...seed, tracks: {} }); await runtime.replaceWithRequiredSnapshot(configuration); await showData(); }}>Restore on a fresh device</button>
      <button onClick={async () => { await seedDevice(seed); await runtime.replaceWithRequiredSnapshot(configuration); await showData(); }}>Update another existing device</button>
      <StatsWorkspace tagData={data} baseline={baseline} onShowTracks={() => {}} onOpenTrack={() => {}} onPlayTracks={() => {}} onClose={() => {}} />
    </>}
    <output aria-label="Reconciliation result" data-sequence={sequence}>{result}</output>
  </main>;
}
createRoot(document.getElementById("app")!).render(<Fixture />);
