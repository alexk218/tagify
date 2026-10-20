// Opt-in end-to-end tests: the real Tagify sync engine against a real local
// Community server and database, with real website edits racing its pushes.
// Skipped unless E2E_API_URL, E2E_PUBLISHABLE_KEY, E2E_SERVICE_ROLE_KEY,
// E2E_DB_URL and E2E_COMMUNITY_URL point at an isolated local stack (see
// docs/COMMUNITY_SYNC_E2E.md). They create members, devices and libraries, so
// never point them at a hosted project.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaxonomyNodeSnapshotV1 } from "@tagify/sync-contracts";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import type { TrackData } from "@/types/tagData";
import { getDesktopSyncConfiguration, type DesktopSyncConfiguration } from "../SyncLocalState";
import { syncPairingService } from "../SyncPairingService";
import { syncRuntime } from "../SyncRuntime";
import { expandSyncTaxonomy, flattenTaxonomy } from "../SyncTaxonomy";

const env = {
  api: process.env.E2E_API_URL!,
  key: process.env.E2E_PUBLISHABLE_KEY!,
  service: process.env.E2E_SERVICE_ROLE_KEY!,
  db: process.env.E2E_DB_URL!,
  community: process.env.E2E_COMMUNITY_URL!,
};
const realFetch = globalThis.fetch.bind(globalThis);

type Runtime = {
  settleLocalAndPublicSync(configuration: DesktopSyncConfiguration, explicit?: boolean): Promise<void>;
  capabilities: unknown;
  supportsV2: boolean;
  backupHealth: unknown;
  ownBatchIds?: Set<string>;
  taxonomyRefreshRequested: boolean;
};
const runtime = syncRuntime as unknown as Runtime;

function sql(query: string): string {
  return execFileSync("psql", [env.db, "-tA", "-v", "ON_ERROR_STOP=1", "-c", query], { encoding: "utf8" }).trim();
}

interface Member { id: string; email: string; password: string; webToken: string }

async function createMember(): Promise<Member> {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  const email = `sync-${suffix}@example.test`;
  const password = randomBytes(16).toString("hex");
  const created = await realFetch(`${env.api}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: env.service, authorization: `Bearer ${env.service}`, "content-type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!created.ok) throw new Error(`member: ${created.status}`);
  const { id } = await created.json() as { id: string };
  sql(`update public.profiles set handle='sync_${suffix}', display_name='Sync ${suffix}' where id='${id}'`);
  const session = await realFetch(`${env.api}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: env.key, "content-type": "application/json" }, body: JSON.stringify({ email, password }),
  });
  const { access_token: webToken } = await session.json() as { access_token: string };
  return { id, email, password, webToken };
}

/** Seeded runs make their own IDs, so a failing seed replays the same way. */
let uuidSource: (() => string) | null = null;
const uuid = () => uuidSource?.() ?? randomUUID();
const id = (prefix: "cat" | "sub" | "tag") => `${prefix}_${uuid()}`;
const node = (nodeId: string, kind: "category" | "folder" | "tag", parentId: string | null, name: string, position: number): TaxonomyNodeSnapshotV1 =>
  ({ id: nodeId, kind, parentId, name, accentId: null, position, nodeRevision: 0, parentListRevision: 0, deleted: false });
const track = (tagIds: string[]): TrackData => ({ rating: 0, energy: 0, bpm: null, camelotKey: null, tagIds, dateCreated: 1_700_000_000_000, dateModified: 1_700_000_000_000 });

/** The member's starting library: Mood › Chill › Calm, Genre › House, and one song tagged Calm. */
function startingLibrary() {
  const ids = { mood: id("cat"), chill: id("sub"), calm: id("tag"), genre: id("cat"), house: id("tag") };
  const nodes = [
    node(ids.mood, "category", null, "Mood", 0), node(ids.chill, "folder", ids.mood, "Chill", 0), node(ids.calm, "tag", ids.chill, "Calm", 0),
    node(ids.genre, "category", null, "Genre", 1), node(ids.house, "tag", ids.genre, "House", 0),
  ];
  return { ids, nodes };
}

async function localNodes(): Promise<Record<string, TaxonomyNodeSnapshotV1>> {
  return flattenTaxonomy(await storageService.getTaxonomy()).nodes;
}

/** A Tagify edit to the tag structure, made the way the app saves it. */
async function editTaxonomy(change: (nodes: Map<string, TaxonomyNodeSnapshotV1>) => void) {
  const nodes = new Map(Object.entries(await localNodes()));
  change(nodes);
  expect(await storageService.saveTaxonomy(expandSyncTaxonomy({ taxonomy: [...nodes.values()], colors: [], collections: [] }))).toBe(true);
}

function removeWithDescendants(nodes: Map<string, TaxonomyNodeSnapshotV1>, rootId: string) {
  const doomed = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of nodes.values()) if (item.parentId && doomed.has(item.parentId) && !doomed.has(item.id)) { doomed.add(item.id); grew = true; }
  }
  for (const doomedId of doomed) nodes.delete(doomedId);
}

/** Deleting a category or folder in Tagify's tag manager: its tags also leave the song. */
async function deleteInTagify(rootId: string, uris: string | string[]) {
  const before = new Set(Object.keys(await localNodes()));
  await editTaxonomy((nodes) => removeWithDescendants(nodes, rootId));
  const after = new Set(Object.keys(await localNodes()));
  const removed = [...before].filter((nodeId) => !after.has(nodeId));
  for (const uri of Array.isArray(uris) ? uris : [uris]) {
    const current = await indexedDBStorage.getTrack(uri);
    if (current && current.tagIds.some((tagId) => removed.includes(tagId))) {
      expect(await indexedDBStorage.saveTrack(uri, { ...current, tagIds: current.tagIds.filter((tagId) => !removed.includes(tagId)) })).toBe(true);
    }
  }
}

/** A song, album or artist as Tagify keeps it (albums are stored with playlists). */
async function getItem(uri: string): Promise<{ tagIds: string[]; dateModified?: number } | null> {
  if (uri.startsWith("spotify:artist:")) return indexedDBStorage.getArtist(uri);
  if (uri.startsWith("spotify:album:")) return indexedDBStorage.getPlaylist(uri);
  return indexedDBStorage.getTrack(uri);
}

async function editTrack(uri: string, change: (current: TrackData) => TrackData) {
  const current = (await indexedDBStorage.getTrack(uri)) ?? track([]);
  expect(await indexedDBStorage.saveTrack(uri, change(current))).toBe(true);
}

async function readOutbox(): Promise<unknown[]> {
  const { getTagifyDatabaseName } = await import("../SyncLocalState");
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(getTagifyDatabaseName());
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<unknown[]>((resolve, reject) => {
      const request = database.transaction("sync-outbox").objectStore("sync-outbox").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { database.close(); }
}

/** Links this simulated Tagify install to the member's Community account, as the Cloud Sync dialog does. */
async function link(member: Member, name = "Tagify E2E"): Promise<DesktopSyncConfiguration> {
  const pending = await syncPairingService.begin(env.community, name, "darwin");
  const approved = await realFetch(`${env.community}/api/v2/device-authorizations/approve`, {
    method: "POST", headers: { authorization: `Bearer ${member.webToken}`, "content-type": "application/json" },
    body: JSON.stringify({ userCode: pending.userCode }),
  });
  expect(approved.status, await approved.clone().text()).toBe(200);
  const result = await syncPairingService.poll();
  if (result.status !== "approved") throw new Error("pairing was not approved");
  const { configuration } = await syncPairingService.complete(result.approval);
  return configuration;
}

/** One full Tagify sync, the same run Sync Now starts. Returns the errors it logged. */
async function syncTagify(): Promise<string[]> {
  const errors: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { errors.push(args.map(String).join(" ")); });
  try { await syncRuntime.syncNow(); } finally { spy.mockRestore(); }
  const status = syncRuntime.getStatus();
  if (process.env.E2E_DEBUG && !["idle", "publishing", "publication-review-required"].includes(status)) console.log(batchHistory(getDesktopSyncConfiguration()!.libraryId));
  expect(["idle", "publishing", "publication-review-required"], `sync status ${status}: ${errors.join(" | ")}`).toContain(status);
  return errors;
}

/** A website edit through the same database function the website calls. */
async function webEdit(member: Member, edits: unknown): Promise<{ status: string; idMap: Record<string, string> } & Record<string, unknown>> {
  const response = await realFetch(`${env.api}/rest/v1/rpc/apply_web_library_edits_v1`, {
    method: "POST",
    headers: { apikey: env.key, authorization: `Bearer ${member.webToken}`, "content-type": "application/json" },
    body: JSON.stringify({ p_request_id: randomUUID(), p_edits: edits }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`web edit failed: ${JSON.stringify(body)}`);
  return body;
}

let pushHook: (() => Promise<unknown>) | null = null;
let installAddress = "";

/** Runs once just before Tagify's next push reaches Community, like an edit on the website at that moment. */
function beforeNextPush(action: () => Promise<unknown>) {
  pushHook = action;
}

/** Every request Tagify makes goes to the real local server; each test is its own computer. */
function routeTagifyRequests() {
  installAddress = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (process.env.E2E_DEBUG_PUSH && url.includes("/api/v2/sync/push")) {
      const intents = await readOutbox() as Array<{ type: string; uri?: string; entity?: { providerId: string }; base?: { tagIds?: string[] } | null; desired?: { tagIds?: string[] } }>;
      pushLog.push(`  outbox of ${activeInstall?.name ?? "?"}: ${intents.map((intent) => `${intent.type}:${(intent.entity?.providerId ?? intent.uri ?? "").slice(-6)} base=${intent.base ? (intent.base.tagIds ?? []).map((t) => t.slice(4, 8)).join("/") : "none"} desired=${(intent.desired?.tagIds ?? []).map((t) => t.slice(4, 8)).join("/")}`).join("; ")}`);
    }
    if (pushHook && url.includes("/api/v2/sync/push")) { const action = pushHook; pushHook = null; await action(); }
    if (url.startsWith(env.community)) {
      const headers = new Headers(init?.headers);
      headers.set("x-forwarded-for", installAddress);
      const response = await realFetch(input as RequestInfo, { ...init, headers });
      if (process.env.E2E_DEBUG_PUSH && url.includes("/api/v2/sync/push") && typeof init?.body === "string") {
        const batch = JSON.parse(init.body) as { operations: Array<Record<string, unknown>> };
        const result = await response.clone().json().catch(() => ({})) as { changes?: unknown[]; conflictIds?: unknown[]; cursor?: number };
        pushLog.push(`push ${activeInstall === null ? "?" : activeInstall.name ?? "?"} -> cursor ${result.cursor}: ${batch.operations.map((op) => `${op.type}(${(op.node as { name?: string } | undefined)?.name ?? String(op.tagId).slice(4, 12)}${op.present === undefined ? "" : op.present ? "+" : "-"} exp ${op.expectedRevision ?? op.expectedNodeRevision}/${op.expectedParentListRevision ?? ""})`).join(", ")} => accepted ${result.changes?.length ?? "?"}, conflicts ${result.conflictIds?.length ?? "?"}`);
      }
      return response;
    }
    return realFetch(input as RequestInfo, init);
  });
}

/** The song's Community catalog entry, which backing up the song already created. */
function catalogTrack(providerId: string): string {
  sql(`insert into public.catalog_entities(provider,kind,provider_id) values('spotify','track','${providerId}') on conflict do nothing`);
  return sql(`select id from public.catalog_entities where provider='spotify' and kind='track' and provider_id='${providerId}'`);
}

const libraryOf = (member: Member) => sql(`select id from tagify_sync.libraries where owner_user_id='${member.id}'`);
const cloudNames = (library: string, where = "true") => sql(`select coalesce(string_agg(name, ',' order by name), '') from tagify_sync.taxonomy_nodes where library_id='${library}' and deleted_at is null and ${where}`);
const openConflicts = (library: string) => sql(`select count(*) from tagify_sync.conflicts where library_id='${library}' and resolved_at is null`);
const songId = () => uuid().replace(/-/g, "").slice(0, 22);

/** Tagify and Community hold the same tag structure and song tags, with nothing left to send and nothing stranded. */
async function expectInSync(library: string, uri: string, providerId: string) {
  expect(await readOutbox(), "Tagify has nothing left to send").toEqual([]);
  const local = Object.values(await localNodes()).map((item) => `${item.id}:${item.name}:${item.parentId ?? ""}`).sort();
  const cloud = sql(`select coalesce(string_agg(client_id || ':' || name || ':' || coalesce(parent_client_id, ''), E'\n' order by client_id), '')
    from tagify_sync.taxonomy_nodes where library_id='${library}' and deleted_at is null`).split("\n").filter(Boolean).sort();
  const onlyLocal = local.filter((item) => !cloud.includes(item));
  const onlyCloud = cloud.filter((item) => !local.includes(item));
  expect({ onlyLocal, onlyCloud }, "Tagify and Community show the same tags").toEqual({ onlyLocal: [], onlyCloud: [] });
  // Each place lists its items in one order everywhere (ties in position go by ID).
  const localOrder = Object.values(await localNodes()).sort((left, right) => left.position - right.position)
    .reduce<Record<string, string[]>>((lists, item) => ({ ...lists, [item.parentId ?? ""]: [...(lists[item.parentId ?? ""] ?? []), item.id] }), {});
  const cloudOrder = Object.fromEntries(sql(`select coalesce(string_agg(coalesce(parent_client_id, '') || '=' || ids, E'\\n'), '') from (
      select parent_client_id, string_agg(client_id, ',' order by position, client_id) ids from tagify_sync.taxonomy_nodes
      where library_id='${library}' and deleted_at is null group by parent_client_id) lists`).split("\n").filter(Boolean)
    .map((line) => { const [parent, ids] = line.split("="); return [parent, ids.split(",")]; }));
  expect(localOrder, "items appear in the same order in Tagify and Community").toEqual(cloudOrder);
  expect(sql(`select count(*) from tagify_sync.taxonomy_nodes n left join tagify_sync.taxonomy_nodes p on p.library_id=n.library_id and p.client_id=n.parent_client_id
    where n.library_id='${library}' and n.deleted_at is null and n.parent_client_id is not null and (p.client_id is null or p.deleted_at is not null)`), "no tag is left inside a deleted category or folder").toBe("0");
  const localTags = [...((await getItem(uri))?.tagIds ?? [])].sort();
  // Exactly the same tag list on the song, including a tag deleted meanwhile that neither side shows.
  const cloudTags = sql(`select coalesce(string_agg(m.tag_id, ',' order by m.tag_id), '') from tagify_sync.annotation_tag_memberships m
    join tagify_sync.entities e on e.library_id=m.library_id and e.id=m.entity_id
    join tagify_sync.annotations a on a.library_id=m.library_id and a.entity_id=m.entity_id and a.deleted_at is null
    where m.library_id='${library}' and e.provider_id='${providerId}' and m.present`).split(",").filter(Boolean).sort();
  const names = Object.fromEntries(Object.values(await localNodes()).map((item) => [item.id, item.name]));
  const label = (tagIds: string[]) => tagIds.map((tagId) => `${names[tagId] ?? sql(`select coalesce(max(name || case when deleted_at is null then '' else ' (deleted)' end), '?') from tagify_sync.taxonomy_nodes where library_id='${library}' and client_id='${tagId}'`)}:${tagId.slice(4, 12)}`);
  expect(label(localTags), `the song ${uri.slice(-6)} has the same tags in Tagify and Community`).toEqual(label(cloudTags));
}

/** The song keeps the time of its last real edit (the website's), on both sides; cleaning up never moves it. */
async function expectDateOfWebsiteEdit(library: string, uri: string, providerId: string) {
  const webTime = sql(`select max(c->>'modifiedAt') from tagify_sync.change_batches b join tagify_sync.devices d on d.id=b.device_id
    cross join jsonb_array_elements(b.changes) c where b.library_id='${library}' and d.kind='web' and c->'entity'->>'providerId'='${providerId}'`);
  const cloudTime = sql(`select (extract(epoch from a.client_modified_at)*1000)::bigint from tagify_sync.annotations a join tagify_sync.entities e
    on e.library_id=a.library_id and e.id=a.entity_id where a.library_id='${library}' and e.provider_id='${providerId}'`);
  expect(Number(cloudTime)).toBe(new Date(webTime).getTime());
  expect((await indexedDBStorage.getTrack(uri))?.dateModified).toBe(new Date(webTime).getTime());
}

const tagNamesOnSong = async (uri: string) => {
  const nodes = await localNodes();
  return ((await getItem(uri))?.tagIds ?? []).map((tagId) => nodes[tagId]?.name ?? `missing:${tagId}`).sort();
};

/** One Spotify installation: its own IndexedDB, local storage and record of the batches it sent. */
interface Install { factory: IDBFactory; storage: Map<string, string>; ownBatchIds: Set<string>; name?: string }
const pushLog: string[] = [];
let activeInstall: Install | null = null;

async function useInstall(install: Install) {
  if (activeInstall === install) return;
  if (activeInstall) {
    activeInstall.storage.clear();
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)!;
      activeInstall.storage.set(key, localStorage.getItem(key)!);
    }
    activeInstall.ownBatchIds = new Set(runtime.ownBatchIds ?? []);
  }
  indexedDBStorage.resetConnection();
  vi.stubGlobal("indexedDB", install.factory);
  localStorage.clear();
  install.storage.forEach((value, key) => localStorage.setItem(key, value));
  runtime.ownBatchIds?.clear();
  install.ownBatchIds.forEach((batchId) => runtime.ownBatchIds?.add(batchId));
  runtime.taxonomyRefreshRequested = false;
  runtime.backupHealth = null;
  activeInstall = install;
  expect(await storageService.switchAccountDatabase()).toBe(true);
}

function newInstall(): Install {
  return { factory: new IDBFactory(), storage: new Map(), ownBatchIds: new Set() };
}

function batchHistory(library: string): string {
  return sql(`select string_agg(b.cursor || ' ' || case when d.kind = 'web' then 'web' else d.name end || ' ' || (select string_agg(c->>'type' || coalesce('(' || coalesce(c->'node'->>'name', c->>'tagId') || coalesce(' @' || (c->'node'->>'position'), '') || ')', ''), ', ') from jsonb_array_elements(b.changes) c), E'\n' order by b.cursor)
    from tagify_sync.change_batches b join tagify_sync.devices d on d.id=b.device_id where b.library_id='${library}'`);
}

async function setup() {
  const member = await createMember();
  const { ids, nodes } = startingLibrary();
  const providerId = songId();
  const uri = `spotify:track:${providerId}`;
  // The member's Tagify library before linking Cloud Sync.
  expect(await storageService.saveTaxonomy(expandSyncTaxonomy({ taxonomy: nodes, colors: [], collections: [] }), { captureSync: false })).toBe(true);
  expect(await indexedDBStorage.saveTrack(uri, track([ids.calm]))).toBe(true);
  const configuration = await link(member);
  await syncTagify();
  const library = libraryOf(member);
  expect(library).toBe(configuration.libraryId);
  expect(cloudNames(library)).toBe("Calm,Chill,Genre,House,Mood");
  const catalogId = catalogTrack(providerId);
  return { member, ids, uri, providerId, catalogId, library };
}

const localStack = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/;
const enabled = Boolean(env.db && env.service && env.key && localStack.test(env.api ?? "") && localStack.test(env.community ?? ""));

describe.skipIf(!enabled)("Tagify and the Community website editing one library", () => {
  beforeEach(async () => {
    activeInstall = null;
    vi.stubGlobal("indexedDB", new IDBFactory());
    localStorage.clear();
    runtime.capabilities = null;
    runtime.backupHealth = null;
    runtime.ownBatchIds?.clear();
    pushHook = null;
    routeTagifyRequests();
    expect(await storageService.switchAccountDatabase()).toBe(true);
  });

  afterEach(() => {
    indexedDBStorage.resetConnection();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("links, backs up, and applies a website folder, tag and song tag", async () => {
    const { member, ids, uri, catalogId, library } = await setup();
    const late = id("sub");
    const neon = id("tag");
    expect((await webEdit(member, {
      create: [{ id: late, kind: "folder", parentId: ids.chill, name: "Late" }, { id: neon, kind: "tag", parentId: late, name: "Neon" }],
      items: [{ catalogEntityId: catalogId, add: [neon, ids.house] }],
    })).status).toBe("applied");
    await syncTagify();
    expect((await indexedDBStorage.getTrack(uri))?.tagIds.sort()).toEqual([ids.calm, ids.house, neon].sort());
    const local = await localNodes();
    expect(local[neon]).toMatchObject({ name: "Neon", parentId: late });
    expect(local[late]).toMatchObject({ name: "Late", parentId: ids.chill });
    expect(await readOutbox()).toEqual([]);
    expect(openConflicts(library)).toBe("0");
  }, 60_000);

  it("after pulling website edits, Tagify's own edits next to and on them back up without conflicts", async () => {
    const { member, ids, uri, providerId, catalogId, library } = await setup();
    const late = id("sub");
    const neon = id("tag");
    await webEdit(member, {
      create: [{ id: late, kind: "folder", parentId: ids.chill, name: "Late" }, { id: neon, kind: "tag", parentId: late, name: "Neon" }],
      items: [{ catalogEntityId: catalogId, add: [neon] }],
    });
    await syncTagify();
    // A new tag beside the website's folder, a rename of the website's tag, and a tag change on the song.
    const dusk = id("tag");
    await editTaxonomy((nodes) => {
      nodes.set(dusk, node(dusk, "tag", ids.chill, "Dusk", 9));
      nodes.set(neon, { ...nodes.get(neon)!, name: "Neon lights" });
    });
    await editTrack(uri, (current) => ({ ...current, tagIds: [...current.tagIds.filter((tagId) => tagId !== ids.calm), dusk] }));
    await syncTagify();
    expect(openConflicts(library)).toBe("0");
    await expectInSync(library, uri, providerId);
    expect(await tagNamesOnSong(uri)).toEqual(["Dusk", "Neon lights"]);
    // Removing the website's folder in Tagify also backs up cleanly.
    await deleteInTagify(late, uri);
    await syncTagify();
    expect(openConflicts(library)).toBe("0");
    await expectInSync(library, uri, providerId);
  }, 60_000);

  it("a website edit while Tagify is closed, then Tagify's own offline edits, all end up in both places", async () => {
    const { member, ids, uri, providerId, catalogId, library } = await setup();
    // Tagify edits while it can't reach Community.
    const offline = id("tag");
    await editTaxonomy((nodes) => nodes.set(offline, node(offline, "tag", ids.genre, "Techno", 5)));
    await editTrack(uri, (current) => ({ ...current, tagIds: [...current.tagIds, offline] }));
    // Meanwhile the website imports a folder into Genre and tags the same song.
    const disco = id("sub");
    const nu = id("tag");
    await webEdit(member, { create: [{ id: disco, kind: "folder", parentId: ids.genre, name: "Disco" }, { id: nu, kind: "tag", parentId: disco, name: "Nu disco" }], items: [{ catalogEntityId: catalogId, add: [nu, ids.house] }] });
    await syncTagify();
    await expectInSync(library, uri, providerId);
    expect(await tagNamesOnSong(uri)).toEqual(["Calm", "House", "Nu disco", "Techno"]);
  }, 60_000);

  it("the website adds a tag beside one Tagify is creating at that moment", async () => {
    const { member, ids, uri, providerId, catalogId, library } = await setup();
    const dusk = id("tag");
    await editTaxonomy((nodes) => nodes.set(dusk, node(dusk, "tag", ids.chill, "Dusk", 9)));
    await editTrack(uri, (current) => ({ ...current, tagIds: [...current.tagIds, dusk] }));
    const neon = id("tag");
    beforeNextPush(() => webEdit(member, { create: [{ id: neon, kind: "tag", parentId: ids.chill, name: "Neon" }], items: [{ catalogEntityId: catalogId, add: [neon] }] }));
    await syncTagify();
    await expectInSync(library, uri, providerId);
    expect(await tagNamesOnSong(uri)).toEqual(["Calm", "Dusk", "Neon"]);
  }, 60_000);

  it("Tagify renames a tag while the website adds one beside it", async () => {
    const { member, ids, uri, providerId, library } = await setup();
    await editTaxonomy((nodes) => nodes.set(ids.calm, { ...nodes.get(ids.calm)!, name: "Calm and slow" }));
    beforeNextPush(() => webEdit(member, { create: [{ id: id("tag"), kind: "tag", parentId: ids.chill, name: "Neon" }] }));
    await syncTagify();
    await expectInSync(library, uri, providerId);
    expect(cloudNames(library, `parent_client_id='${ids.chill}'`)).toBe("Calm and slow,Neon");
  }, 60_000);

  it("Tagify deletes a category while the website adds a tag inside it and puts it on a song", async () => {
    const { member, ids, uri, providerId, catalogId, library } = await setup();
    await editTrack(uri, (current) => ({ ...current, tagIds: [...current.tagIds, ids.house] }));
    await syncTagify();
    await deleteInTagify(ids.mood, uri);
    const neon = id("tag");
    beforeNextPush(() => webEdit(member, { create: [{ id: neon, kind: "tag", parentId: ids.chill, name: "Neon" }], items: [{ catalogEntityId: catalogId, add: [neon] }] }));
    await syncTagify();
    await syncTagify();
    await expectInSync(library, uri, providerId);
    expect(cloudNames(library)).toBe("Genre,House");
    expect(await tagNamesOnSong(uri)).toEqual(["House"]);
    await expectDateOfWebsiteEdit(library, uri, providerId);
  }, 60_000);

  it("Tagify removes a tag from a song while the website adds another to it", async () => {
    const { member, ids, uri, providerId, catalogId, library } = await setup();
    await editTrack(uri, (current) => ({ ...current, tagIds: [...current.tagIds, ids.house] }));
    await syncTagify();
    await editTrack(uri, (current) => ({ ...current, tagIds: current.tagIds.filter((tagId) => tagId !== ids.calm) }));
    const neon = id("tag");
    beforeNextPush(() => webEdit(member, { create: [{ id: neon, kind: "tag", parentId: ids.chill, name: "Neon" }], items: [{ catalogEntityId: catalogId, add: [neon] }] }));
    await syncTagify();
    await expectInSync(library, uri, providerId);
    expect(await tagNamesOnSong(uri)).toEqual(["House", "Neon"]);
  }, 60_000);

  it("Tagify removes a song's last tag while the website tags that song", async () => {
    const { member, ids, uri, providerId, catalogId, library } = await setup();
    await editTrack(uri, (current) => ({ ...current, tagIds: [] }));
    beforeNextPush(() => webEdit(member, { items: [{ catalogEntityId: catalogId, add: [ids.house] }] }));
    await syncTagify();
    await syncTagify();
    await expectInSync(library, uri, providerId);
    // The website's newer tag is kept rather than wiped by Tagify clearing the song.
    expect(await tagNamesOnSong(uri)).toEqual(["House"]);
  }, 60_000);

  it("Tagify clears a song while offline, then the website tags it before Tagify reconnects", async () => {
    const { member, ids, uri, providerId, catalogId, library } = await setup();
    await editTrack(uri, (current) => ({ ...current, tagIds: [] }));
    await webEdit(member, { items: [{ catalogEntityId: catalogId, add: [ids.house] }] });
    await syncTagify();
    await expectInSync(library, uri, providerId);
    // The website's later tag is kept.
    expect(await tagNamesOnSong(uri)).toEqual(["House"]);
  }, 60_000);

  it("Tagify deletes a category while offline, then the website adds a tag inside it before Tagify reconnects", async () => {
    const { member, ids, uri, providerId, catalogId, library } = await setup();
    await editTrack(uri, (current) => ({ ...current, tagIds: [...current.tagIds, ids.house] }));
    await syncTagify();
    await deleteInTagify(ids.mood, uri);
    const neon = id("tag");
    await webEdit(member, { create: [{ id: neon, kind: "tag", parentId: ids.chill, name: "Neon" }], items: [{ catalogEntityId: catalogId, add: [neon] }] });
    await syncTagify();
    await syncTagify();
    await expectInSync(library, uri, providerId);
    expect(cloudNames(library)).toBe("Genre,House");
    expect(await tagNamesOnSong(uri)).toEqual(["House"]);
    await expectDateOfWebsiteEdit(library, uri, providerId);
  }, 60_000);

  it("Tagify and the website create the same tag name in the same place at once: both are kept, alike everywhere", async () => {
    const { member, ids, uri, providerId, library } = await setup();
    const mine = id("tag");
    await editTaxonomy((nodes) => nodes.set(mine, node(mine, "tag", ids.chill, "Neon", 9)));
    await editTrack(uri, (current) => ({ ...current, tagIds: [...current.tagIds, mine] }));
    beforeNextPush(() => webEdit(member, { create: [{ id: id("tag"), kind: "tag", parentId: ids.chill, name: "Neon" }] }));
    await syncTagify();
    await syncTagify();
    await expectInSync(library, uri, providerId);
    // Community never rewrites what a device made, so a name both sides used at once stays twice.
    expect(cloudNames(library, `parent_client_id='${ids.chill}'`)).toBe("Calm,Neon,Neon");
    expect((await indexedDBStorage.getTrack(uri))?.tagIds).toContain(mine);
  }, 60_000);

  it("Tagify and the website create the same folder at once: both folders keep their tags", async () => {
    const { member, ids, uri, providerId, catalogId, library } = await setup();
    const myFolder = id("sub");
    const dusk = id("tag");
    await editTaxonomy((nodes) => {
      nodes.set(myFolder, node(myFolder, "folder", ids.chill, "Late", 9));
      nodes.set(dusk, node(dusk, "tag", myFolder, "Dusk", 0));
    });
    await editTrack(uri, (current) => ({ ...current, tagIds: [...current.tagIds, dusk] }));
    const theirFolder = id("sub");
    const neon = id("tag");
    beforeNextPush(() => webEdit(member, {
      create: [{ id: theirFolder, kind: "folder", parentId: ids.chill, name: "late" }, { id: neon, kind: "tag", parentId: theirFolder, name: "Neon" }],
      items: [{ catalogEntityId: catalogId, add: [neon] }],
    }));
    await syncTagify();
    await syncTagify();
    await expectInSync(library, uri, providerId);
    expect(cloudNames(library, `parent_client_id='${myFolder}'`)).toBe("Dusk");
    expect(cloudNames(library, `parent_client_id='${theirFolder}'`)).toBe("Neon");
    expect(await tagNamesOnSong(uri)).toEqual(["Calm", "Dusk", "Neon"]);
  }, 60_000);

  it("Tagify renames a tag to a name the website just used beside it: both stay, nothing is lost", async () => {
    const { member, ids, uri, providerId, library } = await setup();
    await editTaxonomy((nodes) => nodes.set(ids.calm, { ...nodes.get(ids.calm)!, name: "Neon" }));
    beforeNextPush(() => webEdit(member, { create: [{ id: id("tag"), kind: "tag", parentId: ids.chill, name: "Neon" }] }));
    await syncTagify();
    await syncTagify();
    await expectInSync(library, uri, providerId);
    expect(cloudNames(library, `parent_client_id='${ids.chill}'`)).toBe("Neon,Neon");
    expect(await tagNamesOnSong(uri)).toEqual(["Neon"]);
  }, 60_000);

  it("a song emptied by deleting its tags, then tagged again before syncing, keeps its new tag", async () => {
    const { ids, uri, providerId, library } = await setup();
    await deleteInTagify(ids.chill, uri);
    expect((await indexedDBStorage.getTrack(uri))?.tagIds ?? []).toEqual([]);
    await editTrack(uri, (current) => ({ ...current, tagIds: [...current.tagIds, ids.house] }));
    await syncTagify();
    await expectInSync(library, uri, providerId);
    expect(await tagNamesOnSong(uri)).toEqual(["House"]);
  }, 60_000);

  it("both sides change the same tag on the same song at once", async () => {
    const { member, ids, uri, providerId, catalogId, library } = await setup();
    // Both remove Calm: nothing to disagree about.
    await editTrack(uri, (current) => ({ ...current, tagIds: [] }));
    beforeNextPush(() => webEdit(member, { items: [{ catalogEntityId: catalogId, remove: [ids.calm] }] }));
    await syncTagify();
    await expectInSync(library, uri, providerId);
    expect(await tagNamesOnSong(uri)).toEqual([]);
  }, 60_000);

  describe("with a second Tagify computer", () => {
    async function twoComputers() {
      const first = newInstall();
      await useInstall(first);
      const context = await setup();
      const second = newInstall();
      await useInstall(second);
      await link(context.member);
      // A new computer offers to bring the cloud library down; the member accepts.
      await syncRuntime.syncNow();
      expect(syncRuntime.getStatus()).toBe("recovery-available");
      await syncRuntime.restoreFromCloud();
      await syncTagify();
      expect(await tagNamesOnSong(context.uri)).toEqual(["Calm"]);
      return { ...context, first, second };
    }

    it("a computer restored from the cloud adds a tag to a folder whose tags were all deleted", async () => {
      const first = newInstall();
      await useInstall(first);
      const { member, ids, uri, providerId, library } = await setup();
      // The first computer empties Chill.
      await deleteInTagify(ids.calm, uri);
      await syncTagify();
      expect(cloudNames(library, `parent_client_id='${ids.chill}'`)).toBe("");
      // A second computer links and brings the library down.
      const second = newInstall();
      await useInstall(second);
      await link(member);
      await syncRuntime.syncNow();
      expect(syncRuntime.getStatus()).toBe("recovery-available");
      await syncRuntime.restoreFromCloud();
      await syncTagify();
      // Adding a tag to the empty folder backs up, instead of waiting forever.
      const dusk = id("tag");
      await editTaxonomy((nodes) => nodes.set(dusk, node(dusk, "tag", ids.chill, "Dusk", 0)));
      await editTrack(uri, (current) => ({ ...current, tagIds: [...current.tagIds, dusk] }));
      await syncTagify();
      await expectInSync(library, uri, providerId);
      expect(cloudNames(library, `parent_client_id='${ids.chill}'`)).toBe("Dusk");
    }, 90_000);

    it("a computer that emptied a song and re-tagged it, while the other deleted that tag, ends up like Community", async () => {
      const first = newInstall();
      await useInstall(first);
      const { member, ids, uri, providerId, catalogId, library } = await setup();
      const otherSong = songId();
      const otherUri = `spotify:track:${otherSong}`;
      const second = newInstall();
      await useInstall(second);
      await link(member, "B");
      await syncRuntime.syncNow();
      await syncRuntime.restoreFromCloud();
      await syncTagify();
      // A deletes House and Genre, moves Calm into Mood and takes it off the song.
      await useInstall(first);
      await deleteInTagify(ids.house, [uri, otherUri]);
      await deleteInTagify(ids.genre, [uri, otherUri]);
      await editTrack(otherUri, (current) => ({ ...current, tagIds: [...current.tagIds, ids.calm] }));
      await editTaxonomy((all) => all.set(ids.calm, { ...all.get(ids.calm)!, parentId: ids.mood, position: 99 }));
      await editTrack(uri, (current) => ({ ...current, tagIds: current.tagIds.filter((tagId) => tagId !== ids.calm) }));
      beforeNextPush(() => webEdit(member, { items: [{ catalogEntityId: catalogId, add: [ids.house] }] }));
      await syncTagify();
      // B, not yet updated: a folder in Genre, deletes Chill (emptying the song), then puts House on it.
      await useInstall(second);
      const haze = id("sub");
      await editTaxonomy((all) => all.set(haze, node(haze, "folder", ids.genre, "Haze", 9)));
      await deleteInTagify(ids.chill, [uri, otherUri]);
      await editTrack(uri, (current) => ({ ...current, tagIds: [...current.tagIds, ids.house] }));
      beforeNextPush(() => webEdit(member, { items: [{ catalogEntityId: catalogId, add: [ids.calm] }] }));
      await syncTagify();
      for (let pass = 0; pass < 3; pass++) for (const install of [first, second]) { await useInstall(install); await syncTagify(); }
      for (const install of [first, second]) {
        await useInstall(install);
        await expectInSync(library, uri, providerId);
      }
    }, 120_000);

    it("one computer deletes a category while the other and the website add inside it", async () => {
      const { member, ids, uri, providerId, catalogId, library, first, second } = await twoComputers();
      await useInstall(first);
      await editTrack(uri, (current) => ({ ...current, tagIds: [...current.tagIds, ids.house] }));
      await syncTagify();
      await deleteInTagify(ids.mood, uri);
      // While the first computer is offline, the second adds Neon in Chill and the website adds Glow.
      await useInstall(second);
      await syncTagify();
      const neon = id("tag");
      await editTaxonomy((nodes) => nodes.set(neon, node(neon, "tag", ids.chill, "Neon", 9)));
      await editTrack(uri, (current) => ({ ...current, tagIds: [...current.tagIds, neon] }));
      await syncTagify();
      const glow = id("tag");
      await webEdit(member, { create: [{ id: glow, kind: "tag", parentId: ids.chill, name: "Glow" }], items: [{ catalogEntityId: catalogId, add: [glow] }] });
      await useInstall(first);
      await syncTagify();
      await syncTagify();
      await expectInSync(library, uri, providerId);
      expect(await tagNamesOnSong(uri)).toEqual(["House"]);
      await useInstall(second);
      await syncTagify();
      await expectInSync(library, uri, providerId);
      expect(await tagNamesOnSong(uri)).toEqual(["House"]);
      expect(cloudNames(library)).toBe("Genre,House");
    }, 90_000);

    it("both computers create the same tag: both are kept, with their music, alike on both", async () => {
      const { uri, providerId, library, ids, first, second } = await twoComputers();
      await useInstall(first);
      const mine = id("tag");
      await editTaxonomy((nodes) => nodes.set(mine, node(mine, "tag", ids.genre, "Dusk", 9)));
      await useInstall(second);
      const theirs = id("tag");
      await editTaxonomy((nodes) => nodes.set(theirs, node(theirs, "tag", ids.genre, "Dusk", 9)));
      await editTrack(uri, (current) => ({ ...current, tagIds: [...current.tagIds, theirs] }));
      await syncTagify();
      await useInstall(first);
      await syncTagify();
      await syncTagify();
      await expectInSync(library, uri, providerId);
      expect(cloudNames(library, `parent_client_id='${ids.genre}'`)).toBe("Dusk,Dusk,House");
      expect(await tagNamesOnSong(uri)).toEqual(["Calm", "Dusk"]);
      await useInstall(second);
      await syncTagify();
      await expectInSync(library, uri, providerId);
      expect(await tagNamesOnSong(uri)).toEqual(["Calm", "Dusk"]);
    }, 90_000);
  });

  // Community builds before the Tags studio (migration 0166) don't have these functions.
  const hasTagStudio = enabled && sql(`select coalesce(to_regprocedure('public.apply_web_structure_edit_v1(uuid,jsonb)')::text, '')`) !== "";

  describe.skipIf(!hasTagStudio)("organizing tags in the website's Tags studio", () => {
    const rpc = (member: Member, name: string, args: Record<string, unknown>) => realFetch(`${env.api}/rest/v1/rpc/${name}`, {
      method: "POST", headers: { apikey: env.key, authorization: `Bearer ${member.webToken}`, "content-type": "application/json" }, body: JSON.stringify(args),
    });
    /** A Tags studio request, through the database functions the website calls. */
    async function studio<T = Record<string, unknown>>(member: Member, name: string, args: Record<string, unknown>): Promise<T> {
      const response = await rpc(member, name, args);
      const body = await response.json();
      if (!response.ok) throw new Error(`${name} failed: ${JSON.stringify(body)}`);
      return body as T;
    }
    /** A Tags studio request Community must refuse; returns the refusal's code. */
    async function refusal(member: Member, name: string, args: Record<string, unknown>): Promise<string> {
      const response = await rpc(member, name, args);
      const body = await response.json() as { code?: string };
      expect(response.ok, `${name} should be refused: ${JSON.stringify(body)}`).toBe(false);
      return body.code ?? JSON.stringify(body);
    }
    const structureEdit = (member: Member, edit: Record<string, unknown>) =>
      studio<{ status: string; trashId?: string; merged?: number }>(member, "apply_web_structure_edit_v1", { p_request_id: randomUUID(), p_edit: edit });
    const restore = (member: Member, trashId: string) =>
      studio<{ status: string; restored: number }>(member, "restore_my_deleted_tags_v1", { p_request_id: randomUUID(), p_trash_id: trashId });
    const deletePreview = (member: Member, nodeId: string) =>
      studio<{ token: string; tags: number; songs: number; albums: number; artists: number }>(member, "preview_web_tag_delete_v1", { p_node_id: nodeId });
    const recentlyDeleted = async (member: Member) => (await studio<Array<{ id: string }>>(member, "list_my_deleted_tags_v1", {})).map((entry) => entry.id).sort();
    /** Deleting in the studio: the delete preview, then the delete with its token. */
    const studioDelete = async (member: Member, nodeId: string) => structureEdit(member, { op: "delete", nodeId, token: (await deletePreview(member, nodeId)).token });

    /** The tag tree as a member sees it, in order (ties by ID), with each tag's color: `Genre(House[#7C3AED], Techno[teal])`. */
    async function outline(): Promise<string> {
      const taxonomy = await storageService.getTaxonomy();
      const nodes = Object.values(flattenTaxonomy(taxonomy).nodes);
      const color = (accentId: string | null) => (accentId ? `[${taxonomy.customAccentsById[accentId]?.color ?? accentId}]` : "");
      const render = (parentId: string | null): string => nodes.filter((item) => item.parentId === parentId)
        .sort((left, right) => left.position - right.position || (left.id < right.id ? -1 : 1))
        .map((item) => item.kind === "tag" ? `${item.name}${color(item.accentId)}` : `${item.name}(${render(item.id)})`).join(", ");
      return render(null);
    }

    const tag = (tagId: string, parentId: string, name: string, position: number, accentId: string | null = null) => ({ ...node(tagId, "tag", parentId, name, position), accentId });

    /** Mood(Chill(Calm[green], Dusk), Bright), Genre(House, Techno[teal], Disco, Deep(Dub)), and five songs. */
    function standardLibrary() {
      const ids = { mood: id("cat"), chill: id("sub"), calm: id("tag"), dusk: id("tag"), bright: id("tag"),
        genre: id("cat"), house: id("tag"), techno: id("tag"), disco: id("tag"), deep: id("sub"), dub: id("tag") };
      const tree = [
        node(ids.mood, "category", null, "Mood", 0), node(ids.chill, "folder", ids.mood, "Chill", 0),
        tag(ids.calm, ids.chill, "Calm", 0, "green"), tag(ids.dusk, ids.chill, "Dusk", 1), tag(ids.bright, ids.mood, "Bright", 1),
        node(ids.genre, "category", null, "Genre", 1), tag(ids.house, ids.genre, "House", 0), tag(ids.techno, ids.genre, "Techno", 1, "teal"),
        tag(ids.disco, ids.genre, "Disco", 2), node(ids.deep, "folder", ids.genre, "Deep", 3), tag(ids.dub, ids.deep, "Dub", 0),
      ];
      const songs = makeItems("track", [[ids.calm, ids.house], [ids.dusk, ids.techno], [ids.calm, ids.dub, ids.disco], [ids.techno], [ids.bright]]);
      return { ids, tree, songs };
    }
    const STANDARD_OUTLINE = "Mood(Chill(Calm[green], Dusk), Bright), Genre(House, Techno[teal], Disco, Deep(Dub))";
    const STANDARD_TAGS = [["Calm", "House"], ["Dusk", "Techno"], ["Calm", "Disco", "Dub"], ["Techno"], ["Bright"]];

    interface Item { uri: string; providerId: string; tagIds: string[]; modifiedAt: number }
    /** Songs, albums or artists, each last edited at its own known time. */
    function makeItems(kind: "track" | "album" | "artist", tagLists: string[][], first = 0): Item[] {
      return tagLists.map((tagIds, index) => {
        const providerId = songId();
        return { uri: `spotify:${kind}:${providerId}`, providerId, tagIds, modifiedAt: 1_700_000_000_000 + (first + index) * 86_400_123 + 7 };
      });
    }

    interface World { member: Member; library: string; first: Install; second: Install; items: Item[]; desktopBatches: string }
    const batchCount = (library: string, devices: "web" | "desktop" | "all") => sql(`select count(*) from tagify_sync.change_batches b join tagify_sync.devices d on d.id=b.device_id
      where b.library_id='${library}' and ${devices === "web" ? "d.kind = 'web'" : devices === "desktop" ? "d.kind <> 'web'" : "true"}`);

    /** Computer A backs up this library, then computer B links and brings it down. */
    async function studioWorld(tree: TaxonomyNodeSnapshotV1[], items: Item[]): Promise<World> {
      // A fresh local stack has the Tags studio switched off.
      sql(`update public.community_feature_flags set enabled=true where key='tag_studio'`);
      const member = await createMember();
      const first = newInstall();
      first.name = "A";
      await useInstall(first);
      expect(await storageService.saveTaxonomy(expandSyncTaxonomy({ taxonomy: tree, colors: [], collections: [] }), { captureSync: false })).toBe(true);
      const record = (item: Item) => ({ rating: 0, energy: 0, tagIds: item.tagIds, dateCreated: item.modifiedAt - 1_000, dateModified: item.modifiedAt });
      const songs = items.filter((item) => item.uri.startsWith("spotify:track:"));
      if (songs.length) expect(await indexedDBStorage.saveTracks(new Map(songs.map((item) => [item.uri, { ...track(item.tagIds), ...record(item) }])))).toBe(true);
      for (const item of items) {
        if (item.uri.startsWith("spotify:album:")) expect(await indexedDBStorage.savePlaylist(item.uri, record(item))).toBe(true);
        if (item.uri.startsWith("spotify:artist:")) expect(await indexedDBStorage.saveArtist(item.uri, record(item))).toBe(true);
      }
      await link(member, "A");
      expect(await syncTagify()).toEqual([]);
      const library = libraryOf(member);
      const second = newInstall();
      second.name = "B";
      await useInstall(second);
      await link(member, "B");
      await syncRuntime.syncNow();
      expect(syncRuntime.getStatus()).toBe("recovery-available");
      await syncRuntime.restoreFromCloud();
      expect(await syncTagify()).toEqual([]);
      return { member, library, first, second, items, desktopBatches: batchCount(library, "desktop") };
    }

    async function syncEach(world: World, step: string, passes = 1) {
      for (let pass = 0; pass < passes; pass++) {
        for (const install of [world.first, world.second]) {
          await useInstall(install);
          expect(await syncTagify(), `${step}: ${install.name} syncs without errors`).toEqual([]);
        }
      }
    }

    /**
     * Every computer holds exactly Community's tag tree, order and colors, and every item exactly
     * Community's tags. Each item keeps its original time unless listed in `edited`.
     */
    async function expectAgreement(world: World, step: string, expected: { outline?: string; tags?: string[][]; edited?: string[] } = {}): Promise<string> {
      const { library, items } = world;
      const cloudAccents = sql(`select coalesce(string_agg(n.client_id || '=' || coalesce(c.color, n.accent_id, ''), ',' order by n.client_id), '') from tagify_sync.taxonomy_nodes n
        left join tagify_sync.custom_colors c on c.library_id=n.library_id and c.client_id=n.accent_id and c.deleted_at is null
        where n.library_id='${library}' and n.deleted_at is null and n.kind='tag'`);
      const rows = (query: string) => new Map(sql(query).split("\n").filter(Boolean).map((line) => line.split("=") as [string, string]));
      const cloudTags = rows(`select e.provider_id || '=' || coalesce(string_agg(m.tag_id, ',' order by m.tag_id) filter (where m.present), '') from tagify_sync.entities e
        join tagify_sync.annotations a on a.library_id=e.library_id and a.entity_id=e.id and a.deleted_at is null
        left join tagify_sync.annotation_tag_memberships m on m.library_id=e.library_id and m.entity_id=e.id
        where e.library_id='${library}' group by e.provider_id`);
      const cloudTimes = rows(`select e.provider_id || '=' || (extract(epoch from a.client_modified_at)*1000)::bigint from tagify_sync.annotations a
        join tagify_sync.entities e on e.library_id=a.library_id and e.id=a.entity_id where a.library_id='${library}' and a.deleted_at is null`);
      const outlines: string[] = [];
      for (const install of [world.first, world.second]) {
        await useInstall(install);
        const shown = await outline();
        if (expected.outline !== undefined) expect(shown, `${step}: ${install.name} shows the tag tree`).toBe(expected.outline);
        outlines.push(shown);
        // Nothing left to send, the same tree and order, nothing stranded; the first item in detail.
        await expectInSync(library, items[0].uri, items[0].providerId);
        const taxonomy = await storageService.getTaxonomy();
        const nodes = flattenTaxonomy(taxonomy).nodes;
        const localAccents = Object.values(nodes).filter((item) => item.kind === "tag").sort((left, right) => (left.id < right.id ? -1 : 1))
          .map((item) => `${item.id}=${item.accentId ? taxonomy.customAccentsById[item.accentId]?.color ?? item.accentId : ""}`).join(",");
        expect(localAccents, `${step}: ${install.name} shows Community's tag colors`).toBe(cloudAccents);
        const tracks = await indexedDBStorage.getTracks(items.filter((item) => item.uri.startsWith("spotify:track:")).map((item) => item.uri));
        const differences: string[] = [];
        const shownTags: string[][] = [];
        for (const [index, item] of items.entries()) {
          const local = item.uri.startsWith("spotify:track:") ? tracks.get(item.uri) ?? null : await getItem(item.uri);
          const localTags = [...(local?.tagIds ?? [])].sort().join(",");
          if (localTags !== (cloudTags.get(item.providerId) ?? "")) differences.push(`item ${index + 1} tags: ${install.name} ${localTags || "-"}, Community ${cloudTags.get(item.providerId) || "-"}`);
          shownTags.push((local?.tagIds ?? []).map((tagId) => nodes[tagId]?.name ?? `deleted:${tagId.slice(4, 12)}`).sort());
          if (expected.edited?.includes(item.uri)) continue;
          if (local?.dateModified !== item.modifiedAt) differences.push(`item ${index + 1} time on ${install.name}: ${local?.dateModified}`);
          if (Number(cloudTimes.get(item.providerId)) !== item.modifiedAt) differences.push(`item ${index + 1} time on Community: ${cloudTimes.get(item.providerId)}`);
        }
        expect(differences, `${step}: ${install.name} holds Community's tags on every item, each keeping its time`).toEqual([]);
        if (expected.tags) expect(shownTags, `${step}: ${install.name} item tags`).toEqual(expected.tags.map((names) => [...names].sort()));
      }
      expect(outlines[1], `${step}: both computers show the same tree`).toBe(outlines[0]);
      return outlines[0];
    }

    /** Both computers sync once and only listen, then agree with Community, every item (except `edited`) keeping its time. */
    async function syncAndExpect(world: World, step: string, expectedOutline: string, expectedTags: string[][], edited: Item[] = []) {
      await syncEach(world, step);
      expect(openConflicts(world.library), `${step}: no conflicts`).toBe("0");
      // The computers only listened: neither sent anything back to undo or redo the website's change.
      expect(batchCount(world.library, "desktop"), `${step}: no computer sent a change`).toBe(world.desktopBatches);
      await expectAgreement(world, step, { outline: expectedOutline, tags: expectedTags, edited: edited.map((item) => item.uri) });
    }

    it("every computer applies renames, a new color, moves, reorders, a merge, a delete and both restores", async () => {
      const { ids, tree, songs } = standardLibrary();
      const world = await studioWorld(tree, songs);
      const { member } = world;

      await syncAndExpect(world, "linked", STANDARD_OUTLINE, STANDARD_TAGS);

      expect((await structureEdit(member, { op: "rename", nodeId: ids.calm, name: "Calm and slow" })).status).toBe("applied");
      await syncAndExpect(world, "rename",
        "Mood(Chill(Calm and slow[green], Dusk), Bright), Genre(House, Techno[teal], Disco, Deep(Dub))",
        [["Calm and slow", "House"], ["Dusk", "Techno"], ["Calm and slow", "Disco", "Dub"], ["Techno"], ["Bright"]]);

      expect((await structureEdit(member, { op: "recolor", nodeId: ids.house, color: "#7C3AED" })).status).toBe("applied");
      await syncAndExpect(world, "recolor",
        "Mood(Chill(Calm and slow[green], Dusk), Bright), Genre(House[#7C3AED], Techno[teal], Disco, Deep(Dub))",
        [["Calm and slow", "House"], ["Dusk", "Techno"], ["Calm and slow", "Disco", "Dub"], ["Techno"], ["Bright"]]);

      expect((await structureEdit(member, { op: "move", nodeId: ids.deep, parentId: ids.mood })).status).toBe("applied");
      await syncAndExpect(world, "move",
        "Mood(Chill(Calm and slow[green], Dusk), Bright, Deep(Dub)), Genre(House[#7C3AED], Techno[teal], Disco)",
        [["Calm and slow", "House"], ["Dusk", "Techno"], ["Calm and slow", "Disco", "Dub"], ["Techno"], ["Bright"]]);

      expect((await structureEdit(member, { op: "reorder", parentId: ids.genre, orderedIds: [ids.disco, ids.techno, ids.house] })).status).toBe("applied");
      await syncAndExpect(world, "reorder",
        "Mood(Chill(Calm and slow[green], Dusk), Bright, Deep(Dub)), Genre(Disco, Techno[teal], House[#7C3AED])",
        [["Calm and slow", "House"], ["Dusk", "Techno"], ["Calm and slow", "Disco", "Dub"], ["Techno"], ["Bright"]]);

      const merged = await structureEdit(member, { op: "merge", nodeId: ids.techno, intoId: ids.house });
      expect(merged.status).toBe("applied");
      await syncAndExpect(world, "merge",
        "Mood(Chill(Calm and slow[green], Dusk), Bright, Deep(Dub)), Genre(Disco, House[#7C3AED])",
        [["Calm and slow", "House"], ["Dusk", "House"], ["Calm and slow", "Disco", "Dub"], ["House"], ["Bright"]]);

      const deleted = await studioDelete(member, ids.chill);
      expect(deleted.status).toBe("applied");
      await syncAndExpect(world, "delete",
        "Mood(Bright, Deep(Dub)), Genre(Disco, House[#7C3AED])",
        [["House"], ["House"], ["Disco", "Dub"], ["House"], ["Bright"]]);

      expect((await restore(member, deleted.trashId!)).status).toBe("applied");
      await syncAndExpect(world, "restore the delete",
        "Mood(Bright, Deep(Dub), Chill(Calm and slow[green], Dusk)), Genre(Disco, House[#7C3AED])",
        [["Calm and slow", "House"], ["Dusk", "House"], ["Calm and slow", "Disco", "Dub"], ["House"], ["Bright"]]);

      expect((await restore(member, merged.trashId!)).status).toBe("applied");
      await syncAndExpect(world, "restore the merge",
        "Mood(Bright, Deep(Dub), Chill(Calm and slow[green], Dusk)), Genre(Disco, House[#7C3AED], Techno[teal])",
        [["Calm and slow", "House"], ["Dusk", "Techno"], ["Calm and slow", "Disco", "Dub"], ["Techno"], ["Bright"]]);
    }, 180_000);

    describe("while a computer sends its own edit to the same tag or folder", () => {
      type Ids = ReturnType<typeof standardLibrary>["ids"];
      /**
       * The standard library on two computers. Computer A makes its edit and syncs; the studio
       * change lands just before A's push reaches Community. Then both computers sync until
       * settled and must agree with Community, with nothing left to send and nothing stranded.
       */
      async function race(edit: (ids: Ids, songs: Item[]) => Promise<unknown>, change: (member: Member, ids: Ids) => Promise<{ status: string; trashId?: string }>, edited: (songs: Item[]) => Item[]) {
        const { ids, tree, songs } = standardLibrary();
        const world = await studioWorld(tree, songs);
        await useInstall(world.first);
        pushLog.length = 0;
        await edit(ids, songs);
        let status = "not sent";
        let lastStudio: { status: string; trashId?: string } = { status };
        beforeNextPush(async () => { lastStudio = await change(world.member, ids); status = lastStudio.status; });
        expect(await syncTagify(), "A syncs without errors").toEqual([]);
        expect(status, "the studio change landed while A was sending").toBe("applied");
        await syncEach(world, "settling", 3);
        if (process.env.E2E_DEBUG) console.log(`pushes:\n${pushLog.join("\n")}\nbatches:\n${batchHistory(world.library)}`);
        const shown = await expectAgreement(world, "settled", { edited: edited(songs).map((song) => song.uri) });
        expect(openConflicts(world.library), "nothing left for the member to resolve").toBe("0");
        world.desktopBatches = batchCount(world.library, "desktop");
        await useInstall(world.first);
        return { world, ids, songs, shown, status: lastStudio };
      }

      it("a rename in the studio and on a computer at once", async () => {
        const { songs, shown } = await race(
          (ids) => editTaxonomy((nodes) => nodes.set(ids.calm, { ...nodes.get(ids.calm)!, name: "Calm on A" })),
          (member, ids) => structureEdit(member, { op: "rename", nodeId: ids.calm, name: "Calm on the web" }),
          () => []);
        // The computer's rename reached Community last, so it is the name everyone keeps.
        expect(shown).toBe("Mood(Chill(Calm on A[green], Dusk), Bright), Genre(House, Techno[teal], Disco, Deep(Dub))");
        expect(await tagNamesOnSong(songs[0].uri)).toEqual(["Calm on A", "House"]);
      }, 120_000);

      it("a move in the studio and on a computer at once", async () => {
        const { shown } = await race(
          (ids) => editTaxonomy((nodes) => nodes.set(ids.dusk, { ...nodes.get(ids.dusk)!, parentId: ids.genre, position: 99 })),
          (member, ids) => structureEdit(member, { op: "move", nodeId: ids.dusk, parentId: ids.mood }),
          () => []);
        // The computer's move reached Community last.
        expect(shown).toBe("Mood(Chill(Calm[green]), Bright), Genre(House, Techno[teal], Disco, Deep(Dub), Dusk)");
      }, 120_000);

      // Between a delete and an edit that crossed, the one that reaches Community last wins
      // (Community migration 0138, section 8): a computer's later edit inside what the studio
      // deleted brings back what was deleted around it. Restoring from Recently deleted then
      // brings back the rest.
      it("the studio merges a tag a computer is renaming and putting on a song", async () => {
        const { world, songs, shown, status } = await race(
          async (ids, items) => {
            await editTaxonomy((nodes) => nodes.set(ids.techno, { ...nodes.get(ids.techno)!, name: "Techno on A" }));
            await editTrack(items[4].uri, (current) => ({ ...current, tagIds: [...current.tagIds, ids.techno] }));
          },
          (member, ids) => structureEdit(member, { op: "merge", nodeId: ids.techno, intoId: ids.house }),
          (items) => [items[4]]);
        // The merge moved Techno's songs to House; the computer's later rename and tag brought Techno back.
        expect(shown).toBe("Mood(Chill(Calm[green], Dusk), Bright), Genre(House, Techno on A[teal], Disco, Deep(Dub))");
        await expectAgreement(world, "after the merge", { tags: [["Calm", "House"], ["Dusk", "House"], ["Calm", "Disco", "Dub"], ["House"], ["Bright", "Techno on A"]], edited: [songs[4].uri] });
        // Recently deleted still offers the merge. Restoring it gives Techno its songs back and takes House off them again.
        expect(await recentlyDeleted(world.member)).toContain(status.trashId);
        expect((await restore(world.member, status.trashId!)).status).toBe("applied");
        await syncAndExpect(world, "restore the merge", "Mood(Chill(Calm[green], Dusk), Bright), Genre(House, Techno on A[teal], Disco, Deep(Dub))",
          [["Calm", "House"], ["Dusk", "Techno on A"], ["Calm", "Disco", "Dub"], ["Techno on A"], ["Bright", "Techno on A"]], [songs[4]]);
      }, 120_000);

      it("the studio deletes a folder while a computer adds a tag inside it, tags a song with it and renames another", async () => {
        const { world, songs, shown, status } = await race(
          async (ids, items) => {
            const neon = id("tag");
            await editTaxonomy((nodes) => {
              nodes.set(neon, node(neon, "tag", ids.chill, "Neon", 9));
              nodes.set(ids.dusk, { ...nodes.get(ids.dusk)!, name: "Dusk on A" });
            });
            await editTrack(items[4].uri, (current) => ({ ...current, tagIds: [...current.tagIds, neon] }));
          },
          (member, ids) => studioDelete(member, ids.chill),
          (items) => [items[4]]);
        // The computer's later edits brought back the folder with the tags it touched; Calm stays deleted.
        // The delete had already taken Calm and Dusk off their songs.
        expect(shown).toBe("Mood(Bright, Chill(Dusk on A, Neon)), Genre(House, Techno[teal], Disco, Deep(Dub))");
        await expectAgreement(world, "after the delete", { tags: [["House"], ["Techno"], ["Disco", "Dub"], ["Techno"], ["Bright", "Neon"]], edited: [songs[4].uri] });
        // Recently deleted still offers the delete. Restoring it brings back Calm and puts Calm and Dusk back on their songs.
        expect(await recentlyDeleted(world.member)).toContain(status.trashId);
        expect((await restore(world.member, status.trashId!)).status).toBe("applied");
        await syncAndExpect(world, "restore the delete", "Mood(Bright, Chill(Calm[green], Dusk on A, Neon)), Genre(House, Techno[teal], Disco, Deep(Dub))",
          [["Calm", "House"], ["Dusk on A", "Techno"], ["Calm", "Disco", "Dub"], ["Techno"], ["Bright", "Neon"]], [songs[4]]);
      }, 120_000);

      it("a computer deletes a folder while the studio moves its tag out", async () => {
        const { shown } = await race(
          (ids, items) => deleteInTagify(ids.deep, items.map((song) => song.uri)),
          (member, ids) => structureEdit(member, { op: "move", nodeId: ids.dub, parentId: ids.genre }),
          (items) => [items[2]]);
        // Community applies the move first; the computer's later delete still removes the tag it deleted.
        expect(shown).toBe("Mood(Chill(Calm[green], Dusk), Bright), Genre(House, Techno[teal], Disco)");
      }, 120_000);
    });

    it("a merge and a delete carry albums and artists along with songs, and restoring brings them back", async () => {
      const { ids, tree } = standardLibrary();
      const items = [
        ...makeItems("track", [[ids.calm, ids.techno], [ids.dusk, ids.house]]),
        ...makeItems("album", [[ids.techno], [ids.calm, ids.house, ids.techno]], 2),
        ...makeItems("artist", [[ids.techno, ids.dusk], [ids.calm]], 4),
      ];
      const world = await studioWorld(tree, items);
      const { member } = world;
      const original = [["Calm", "Techno"], ["Dusk", "House"], ["Techno"], ["Calm", "House", "Techno"], ["Dusk", "Techno"], ["Calm"]];
      await syncAndExpect(world, "linked", STANDARD_OUTLINE, original);

      const merged = await structureEdit(member, { op: "merge", nodeId: ids.techno, intoId: ids.house });
      expect(merged).toMatchObject({ status: "applied", merged: 3 });
      const afterMerge = [["Calm", "House"], ["Dusk", "House"], ["House"], ["Calm", "House"], ["Dusk", "House"], ["Calm"]];
      await syncAndExpect(world, "merge", "Mood(Chill(Calm[green], Dusk), Bright), Genre(House, Disco, Deep(Dub))", afterMerge);

      expect(await deletePreview(member, ids.chill)).toMatchObject({ tags: 2, songs: 2, albums: 1, artists: 2 });
      const deleted = await studioDelete(member, ids.chill);
      expect(deleted.status).toBe("applied");
      await syncAndExpect(world, "delete", "Mood(Bright), Genre(House, Disco, Deep(Dub))",
        [["House"], ["House"], ["House"], ["House"], ["House"], []]);

      expect((await restore(member, deleted.trashId!)).status).toBe("applied");
      await syncAndExpect(world, "restore the delete", "Mood(Bright, Chill(Calm[green], Dusk)), Genre(House, Disco, Deep(Dub))", afterMerge);

      expect((await restore(member, merged.trashId!)).status).toBe("applied");
      await syncAndExpect(world, "restore the merge", "Mood(Bright, Chill(Calm[green], Dusk)), Genre(House, Disco, Deep(Dub), Techno[teal])", original);
    }, 180_000);

    it("a merge of a tag on more than 500 songs, and restoring it, reach every computer", async () => {
      const ids = { genre: id("cat"), keep: id("tag"), bulk: id("tag") };
      const tree = [node(ids.genre, "category", null, "Genre", 0), tag(ids.keep, ids.genre, "Keep", 0), tag(ids.bulk, ids.genre, "Bulk", 1, "rose")];
      // 620 songs carry Bulk; the first three also carry Keep, so the merge adds Keep to 617.
      const songs = makeItems("track", Array.from({ length: 620 }, (_, index) => (index < 3 ? [ids.keep, ids.bulk] : [ids.bulk])));
      const world = await studioWorld(tree, songs);
      const { member, library } = world;
      const original = songs.map((_, index) => (index < 3 ? ["Bulk", "Keep"] : ["Bulk"]));
      await syncAndExpect(world, "linked", "Genre(Keep, Bulk[rose])", original);

      // The website batches after a cursor, by their number of changes.
      const webBatchSizes = (after: number) => sql(`select coalesce(string_agg(jsonb_array_length(b.changes)::text, ',' order by b.cursor), '') from tagify_sync.change_batches b
        join tagify_sync.devices d on d.id=b.device_id where b.library_id='${library}' and d.kind='web' and b.cursor > ${after}`);
      const lastCursor = () => Number(sql(`select coalesce(max(cursor), 0) from tagify_sync.change_batches where library_id='${library}'`));
      const beforeMerge = lastCursor();
      const merged = await structureEdit(member, { op: "merge", nodeId: ids.bulk, intoId: ids.keep });
      expect(merged).toMatchObject({ status: "applied", merged: 617 });
      // More than one website batch holds, so Community sent it as consecutive batches.
      const mergeBatches = webBatchSizes(beforeMerge);
      expect(mergeBatches.split(",").length, `the merge's batch sizes: ${mergeBatches}`).toBeGreaterThanOrEqual(2);
      await syncAndExpect(world, "merge", "Genre(Keep)", songs.map(() => ["Keep"]));

      const beforeRestore = lastCursor();
      expect((await restore(member, merged.trashId!)).status).toBe("applied");
      const restoreBatches = webBatchSizes(beforeRestore);
      expect(restoreBatches.split(",").length, `the restore's batch sizes: ${restoreBatches}`).toBeGreaterThanOrEqual(3);
      await syncAndExpect(world, "restore the merge", "Genre(Keep, Bulk[rose])", original);
    }, 600_000);

    it("restores Community refuses leave every computer as it was, and work once the reason is gone", async () => {
      const { ids, tree, songs } = standardLibrary();
      const world = await studioWorld(tree, songs);
      const { member, library } = world;
      await syncAndExpect(world, "linked", STANDARD_OUTLINE, STANDARD_TAGS);

      /** A refused restore changes nothing: no batch, the same tree and tags on both computers, still restorable. */
      async function expectRefused(trashId: string, code: string, step: string, expectedOutline: string, expectedTags: string[][]) {
        const batches = batchCount(library, "all");
        const restorable = await recentlyDeleted(member);
        expect(await refusal(member, "restore_my_deleted_tags_v1", { p_request_id: randomUUID(), p_trash_id: trashId }), step).toBe(code);
        expect(batchCount(library, "all"), `${step}: nothing was sent to any computer`).toBe(batches);
        expect(await recentlyDeleted(member), `${step}: it can still be restored`).toEqual(restorable);
        await syncAndExpect(world, step, expectedOutline, expectedTags);
      }

      // Dub goes, then the folder it was in.
      const dub = await studioDelete(member, ids.dub);
      expect(dub.status).toBe("applied");
      await syncAndExpect(world, "delete Dub", "Mood(Chill(Calm[green], Dusk), Bright), Genre(House, Techno[teal], Disco, Deep())",
        [["Calm", "House"], ["Dusk", "Techno"], ["Calm", "Disco"], ["Techno"], ["Bright"]]);
      const deep = await studioDelete(member, ids.deep);
      expect(deep.status).toBe("applied");
      const withoutDeep = "Mood(Chill(Calm[green], Dusk), Bright), Genre(House, Techno[teal], Disco)";
      const withoutDub = [["Calm", "House"], ["Dusk", "Techno"], ["Calm", "Disco"], ["Techno"], ["Bright"]];
      await syncAndExpect(world, "delete Deep", withoutDeep, withoutDub);

      // Dub can't come back while the folder it was in is gone.
      await expectRefused(dub.trashId!, "TWX02", "restore Dub without its folder", withoutDeep, withoutDub);
      expect((await restore(member, deep.trashId!)).status).toBe("applied");
      await syncAndExpect(world, "restore Deep", "Mood(Chill(Calm[green], Dusk), Bright), Genre(House, Techno[teal], Disco, Deep())", withoutDub);
      expect((await restore(member, dub.trashId!)).status).toBe("applied");
      await syncAndExpect(world, "restore Dub", "Mood(Chill(Calm[green], Dusk), Bright), Genre(House, Techno[teal], Disco, Deep(Dub))", STANDARD_TAGS);

      // Calm goes, and computer A makes a new "calm" in the same folder.
      const calm = await studioDelete(member, ids.calm);
      expect(calm.status).toBe("applied");
      const withoutCalm = [["House"], ["Dusk", "Techno"], ["Disco", "Dub"], ["Techno"], ["Bright"]];
      await syncAndExpect(world, "delete Calm", "Mood(Chill(Dusk), Bright), Genre(House, Techno[teal], Disco, Deep(Dub))", withoutCalm);
      await useInstall(world.first);
      const newCalm = id("tag");
      await editTaxonomy((nodes) => nodes.set(newCalm, node(newCalm, "tag", ids.chill, "calm", 9)));
      expect(await syncTagify()).toEqual([]);
      world.desktopBatches = batchCount(library, "desktop");
      // Tagify sends the new tag right after Dusk, at the position Dusk holds on Community; items at
      // one position are listed in ID order everywhere.
      const afterDusk = (label: string) => (newCalm < ids.dusk ? `${label}, Dusk` : `Dusk, ${label}`);
      const withNewCalm = `Mood(Chill(${afterDusk("calm")}), Bright), Genre(House, Techno[teal], Disco, Deep(Dub))`;
      await syncAndExpect(world, "a computer adds calm", withNewCalm, withoutCalm);

      // Calm can't come back next to a tag with the same name.
      await expectRefused(calm.trashId!, "TWN01", "restore Calm next to calm", withNewCalm, withoutCalm);
      await useInstall(world.first);
      await editTaxonomy((nodes) => nodes.set(newCalm, { ...nodes.get(newCalm)!, name: "Calm too" }));
      expect(await syncTagify()).toEqual([]);
      world.desktopBatches = batchCount(library, "desktop");
      expect((await restore(member, calm.trashId!)).status).toBe("applied");
      await syncAndExpect(world, "restore Calm", `Mood(Chill(${afterDusk("Calm too")}, Calm[green]), Bright), Genre(House, Techno[teal], Disco, Deep(Dub))`, STANDARD_TAGS);
    }, 240_000);
  });

  describe("songs only rated in Tagify", () => {
    // Tagify backs up songs that have a rating, energy, BPM or key but no tags, and restoring,
    // second computers, combining and resetting all depend on Community keeping them.
    const RATED_AT = 1_700_000_500_000;
    const rated = (fields: Partial<TrackData>): TrackData => ({ ...track([]), dateCreated: RATED_AT, dateModified: RATED_AT, ...fields });
    const values = (item: TrackData | null) => item && { rating: item.rating, energy: item.energy, bpm: item.bpm ?? null, key: item.camelotKey ?? null, tagIds: item.tagIds, dateCreated: item.dateCreated };
    const shelf = () => sql("select to_regclass('tagify_sync.shelved_annotations') is not null") === "t";
    /** Whether this Community keeps such songs on its compact shelf (migration "ratings store", switch on). */
    const shelving = () => shelf() && sql("select coalesce((select enabled from public.community_feature_flags where key='shelve_rated_only_songs'), false)") === "t";
    const onShelf = (library: string, providerId: string) => sql(`select count(*) from tagify_sync.shelved_annotations where library_id='${library}' and provider_id='${providerId}'`) === "1";
    /** The song as Community keeps it, wherever it is stored: rating|energy|bpm|key, or "" when Community has no live copy. */
    const cloudSong = (library: string, providerId: string) => sql(`select coalesce((
        select concat(a.rating, '|', a.energy, '|', a.bpm, '|', a.musical_key) from tagify_sync.annotations a join tagify_sync.entities e on e.library_id=a.library_id and e.id=a.entity_id
        where a.library_id='${library}' and e.provider_id='${providerId}' and a.deleted_at is null)${shelf() ? `, (
        select concat(s.rating, '|', s.energy, '|', s.bpm, '|', s.musical_key) from tagify_sync.shelved_annotations s
        where s.library_id='${library}' and s.provider_id='${providerId}')` : ""}, '')`);
    async function memberRpc(member: Member, name: string, body: unknown) {
      const response = await realFetch(`${env.api}/rest/v1/rpc/${name}`, {
        method: "POST", headers: { apikey: env.key, authorization: `Bearer ${member.webToken}`, "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(`${name} failed: ${JSON.stringify(result)}`);
      return result;
    }
    /** Brings the cloud library down onto a new computer, as accepting the restore offer does. */
    async function restoreOnNewComputer(member: Member) {
      const install = newInstall();
      await useInstall(install);
      await link(member);
      await syncRuntime.syncNow();
      expect(syncRuntime.getStatus()).toBe("recovery-available");
      await syncRuntime.restoreFromCloud();
      expect(await syncTagify()).toEqual([]);
      return install;
    }
    /** Computer A with the starting library and two untagged songs: one rated, one with only energy, BPM and key. */
    async function ratedOnTwoComputers() {
      const first = newInstall();
      await useInstall(first);
      const context = await setup();
      const ratedId = songId(), detailsId = songId();
      const ratedUri = `spotify:track:${ratedId}`, detailsUri = `spotify:track:${detailsId}`;
      expect(await indexedDBStorage.saveTrack(ratedUri, rated({ rating: 4.5 }))).toBe(true);
      expect(await indexedDBStorage.saveTrack(detailsUri, rated({ energy: 7, bpm: 124, camelotKey: "8A" }))).toBe(true);
      expect(await syncTagify()).toEqual([]);
      expect(cloudSong(context.library, ratedId)).toBe("4.5|||");
      expect(cloudSong(context.library, detailsId)).toBe("|7|124.00|8A");
      if (shelving()) expect([onShelf(context.library, ratedId), onShelf(context.library, detailsId)], "Community keeps them on its shelf").toEqual([true, true]);
      const second = await restoreOnNewComputer(context.member);
      return { ...context, first, second, ratedId, ratedUri, detailsId, detailsUri };
    }

    it("reach a second computer and a newly restored one with their values and dates", async () => {
      const world = await ratedOnTwoComputers();
      expect(values(await indexedDBStorage.getTrack(world.ratedUri))).toEqual({ rating: 4.5, energy: 0, bpm: null, key: null, tagIds: [], dateCreated: RATED_AT });
      expect(values(await indexedDBStorage.getTrack(world.detailsUri))).toEqual({ rating: 0, energy: 7, bpm: 124, key: "8A", tagIds: [], dateCreated: RATED_AT });
      // A later change on the first computer reaches the second.
      await useInstall(world.first);
      await editTrack(world.ratedUri, (current) => ({ ...current, rating: 3, dateModified: RATED_AT + 1000 }));
      expect(await syncTagify()).toEqual([]);
      await useInstall(world.second);
      expect(await syncTagify()).toEqual([]);
      expect((await indexedDBStorage.getTrack(world.ratedUri))?.rating).toBe(3);
      expect((await indexedDBStorage.getTrack(world.ratedUri))?.dateModified).toBe(RATED_AT + 1000);
      expect(await readOutbox()).toEqual([]);
      expect(openConflicts(world.library)).toBe("0");
    }, 120_000);

    it("stay on the other computer after one computer resets the cloud copy, and after a new computer combines its own", async () => {
      const world = await ratedOnTwoComputers();
      // The first computer resets Community to its own copy.
      await useInstall(world.first);
      syncRuntime.armCloudReplacement();
      await syncRuntime.replaceCloudWithCurrentLocalState();
      expect(cloudSong(world.library, world.ratedId)).toBe("4.5|||");
      // The second computer must reload Community's copy, and keeps the ratings.
      await useInstall(world.second);
      expect(await syncTagify()).toEqual([]);
      expect((await indexedDBStorage.getTrack(world.ratedUri))?.rating).toBe(4.5);
      expect((await indexedDBStorage.getTrack(world.detailsUri))?.camelotKey).toBe("8A");
      // A third computer that already rated a song of its own combines its library with Community's.
      const third = newInstall();
      await useInstall(third);
      const ownId = songId(), ownUri = `spotify:track:${ownId}`;
      expect(await indexedDBStorage.saveTrack(ownUri, rated({ rating: 2 }))).toBe(true);
      await link(world.member, "Tagify E2E third");
      await syncRuntime.syncNow();
      if (syncRuntime.getStatus() === "merge-required") await syncRuntime.commitInitialMerge({});
      expect(await syncTagify()).toEqual([]);
      expect((await indexedDBStorage.getTrack(ownUri))?.rating).toBe(2);
      expect((await indexedDBStorage.getTrack(world.ratedUri))?.rating).toBe(4.5);
      expect(cloudSong(world.library, ownId)).toBe("2.0|||");
      // Both earlier computers keep every rating and receive the new one.
      for (const install of [world.first, world.second]) {
        await useInstall(install);
        expect(await syncTagify()).toEqual([]);
        expect((await indexedDBStorage.getTrack(world.ratedUri))?.rating).toBe(4.5);
        expect((await indexedDBStorage.getTrack(world.detailsUri))?.bpm).toBe(124);
        expect((await indexedDBStorage.getTrack(ownUri))?.rating).toBe(2);
        expect(await readOutbox()).toEqual([]);
      }
    }, 240_000);

    it("keep their rating and date when the song is tagged on the website", async () => {
      const world = await ratedOnTwoComputers();
      const catalogId = catalogTrack(world.ratedId);
      expect((await webEdit(world.member, { items: [{ catalogEntityId: catalogId, add: [world.ids.calm] }] })).status).toBe("applied");
      for (const install of [world.first, world.second]) {
        await useInstall(install);
        expect(await syncTagify()).toEqual([]);
        const song = await indexedDBStorage.getTrack(world.ratedUri);
        expect(song?.rating).toBe(4.5);
        expect(song?.dateCreated).toBe(RATED_AT);
        expect(await tagNamesOnSong(world.ratedUri)).toEqual(["Calm"]);
        await expectInSync(world.library, world.ratedUri, world.ratedId);
      }
      expect(cloudSong(world.library, world.ratedId)).toBe("4.5|||");
    }, 180_000);

    it("rated differently on two computers at once end with one rating everywhere", async () => {
      const world = await ratedOnTwoComputers();
      await useInstall(world.first);
      await editTrack(world.ratedUri, (current) => ({ ...current, rating: 1, dateModified: RATED_AT + 2000 }));
      await useInstall(world.second);
      await editTrack(world.ratedUri, (current) => ({ ...current, rating: 5, dateModified: RATED_AT + 3000 }));
      await useInstall(world.first);
      expect(await syncTagify()).toEqual([]);
      await useInstall(world.second);
      expect(await syncTagify()).toEqual([]);
      await useInstall(world.first);
      expect(await syncTagify()).toEqual([]);
      const cloud = cloudSong(world.library, world.ratedId);
      expect(["1.0|||", "5.0|||"]).toContain(cloud);
      for (const install of [world.first, world.second]) {
        await useInstall(install);
        expect(await syncTagify()).toEqual([]);
        expect((await indexedDBStorage.getTrack(world.ratedUri))?.rating).toBe(Number(cloud.split("|")[0]));
        expect(await readOutbox()).toEqual([]);
      }
      expect(openConflicts(world.library)).toBe("0");
    }, 180_000);

    it("come back when an earlier backup is restored, and their removal reaches the other computer", async () => {
      const world = await ratedOnTwoComputers();
      sql(`select tagify_sync.create_recovery_point('${world.library}', 'daily')`);
      const point = sql(`select id from tagify_sync.recovery_points where library_id='${world.library}' and reason='daily' order by created_at desc limit 1`);
      // The first computer removes the rating; the song now holds nothing, and the second computer loses the rating too.
      await useInstall(world.first);
      await editTrack(world.ratedUri, (current) => ({ ...current, rating: 0, dateModified: RATED_AT + 4000 }));
      expect(await syncTagify()).toEqual([]);
      expect(cloudSong(world.library, world.ratedId)).not.toContain("4.5");
      await useInstall(world.second);
      expect(await syncTagify()).toEqual([]);
      expect((await indexedDBStorage.getTrack(world.ratedUri))?.rating ?? 0).toBe(0);
      // Restoring the earlier backup on the website brings the rating back on both computers.
      await memberRpc(world.member, "restore_private_sync_recovery_point", { p_recovery_point_id: point, p_operation_id: randomUUID() });
      expect(cloudSong(world.library, world.ratedId)).toBe("4.5|||");
      for (const install of [world.first, world.second]) {
        await useInstall(install);
        expect(await syncTagify()).toEqual([]);
        expect((await indexedDBStorage.getTrack(world.ratedUri))?.rating).toBe(4.5);
        expect((await indexedDBStorage.getTrack(world.detailsUri))?.energy).toBe(7);
      }
    }, 180_000);
  });

  describe("random edits from two computers and the website", () => {
    const NAMES = ["Neon", "Dusk", "Glow", "Late", "calm", "Haze"];
    const seeds = (process.env.E2E_FUZZ_SEEDS ?? "1,2,3,4,5,6").split(",").map(Number);
    const rounds = Number(process.env.E2E_FUZZ_ROUNDS ?? 40);
    const random = (seed: number) => {
      let state = seed >>> 0;
      return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
      };
    };
    const family = (kind: string) => (kind === "subcategory" ? "folder" : kind);
    const nameKey = (name: string) => name.normalize("NFKC").trim().toLowerCase();

    async function webRead(member: Member, name: string, args: Record<string, unknown>) {
      const response = await realFetch(`${env.api}/rest/v1/rpc/${name}`, {
        method: "POST", headers: { apikey: env.key, authorization: `Bearer ${member.webToken}`, "content-type": "application/json" }, body: JSON.stringify(args),
      });
      expect(response.status, await response.clone().text()).toBe(200);
      return response.json();
    }

    for (const seed of seeds) {
      it(`settles into one library (seed ${seed})`, async () => {
        const rand = random(seed);
        const idRandom = random(seed * 7919);
        uuidSource = () => {
          const hex = Array.from({ length: 32 }, () => Math.floor(idRandom() * 16).toString(16)).join("");
          return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${"89ab"[Math.floor(idRandom() * 4)]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
        };
        const pick = <T,>(items: T[]): T => items[Math.floor(rand() * items.length)];
        const log: string[] = [];
        const first = newInstall();
        await useInstall(first);
        const { member, uri, providerId, catalogId, library } = await setup();
        sql(`update tagify_sync.devices set name='A' where library_id='${library}' and kind='desktop'`);
        const second = newInstall();
        await useInstall(second);
        await link(member, "B");
        await syncRuntime.syncNow();
        await syncRuntime.restoreFromCloud();
        await syncTagify();
        const songs = [{ uri, providerId, catalogId }];
        for (let index = 0; index < 2; index++) {
          const songProvider = songId();
          songs.push({ uri: `spotify:track:${songProvider}`, providerId: songProvider, catalogId: catalogTrack(songProvider) });
        }
        const installs: Array<[string, Install]> = [["A", first], ["B", second]];
        first.name = "A"; second.name = "B";
        // E2E_FUZZ_COMPUTERS=3 adds a third computer, linked and restored like the second.
        for (const label of ["C", "D"].slice(0, Math.max(0, Number(process.env.E2E_FUZZ_COMPUTERS ?? 2) - 2))) {
          const extra = newInstall();
          extra.name = label;
          await useInstall(extra);
          await link(member, label);
          await syncRuntime.syncNow();
          await syncRuntime.restoreFromCloud();
          await syncTagify();
          installs.push([label, extra]);
        }
        pushLog.length = 0;
        // The once-per-15-minutes repair from the cloud copy is a safety net; a
        // healthy exchange must not need it, so these runs leave it unavailable.
        if (process.env.E2E_FUZZ_NO_REPAIR) (syncRuntime as unknown as { lastShadowRepairAt: number }).lastShadowRepairAt = Date.now();

        const freeName = (nodes: TaxonomyNodeSnapshotV1[], parentId: string | null, kind: string, except?: string) => {
          const taken = new Set(nodes.filter((item) => item.parentId === parentId && family(item.kind) === family(kind) && item.id !== except).map((item) => nameKey(item.name)));
          const options = NAMES.filter((label) => !taken.has(nameKey(label)));
          return options.length ? pick(options) : null;
        };

        async function websiteAction(raced: boolean) {
          const taxonomy = await webRead(member, "get_my_library_taxonomy_v1", {}) as { nodes: TaxonomyNodeSnapshotV1[] };
          const containers = taxonomy.nodes.filter((item) => item.kind !== "tag");
          const tags = taxonomy.nodes.filter((item) => item.kind === "tag");
          const roll = rand();
          const prefix = raced ? "website (racing a push)" : "website";
          if ((roll < 0.35 || !tags.length) && containers.length) {
            const parent = pick(containers);
            const label = pick(NAMES);
            log.push(`${prefix} creates tag ${label} in ${parent.name}`);
            await webEdit(member, { create: [{ id: id("tag"), kind: "tag", parentId: parent.id, name: label }] });
          } else if (roll < 0.5 && containers.length) {
            const parent = pick(containers.filter((item) => item.kind === "category" || rand() < 0.5).concat(containers[0]));
            const folder = id("sub");
            const label = pick(NAMES);
            const song = pick(songs);
            log.push(`${prefix} imports folder ${label} with a tag into ${parent.name}, on song ${songs.indexOf(song)}`);
            const tag = id("tag");
            await webEdit(member, { create: [{ id: folder, kind: "folder", parentId: parent.id, name: label }, { id: tag, kind: "tag", parentId: folder, name: pick(NAMES) }],
              items: [{ catalogEntityId: song.catalogId, add: [tag] }] });
          } else if (tags.length) {
            const song = pick(songs);
            const tag = pick(tags);
            const held = await webRead(member, "get_my_library_tags_v1", { p_catalog_entity_ids: [song.catalogId] }) as { items: Array<{ tagIds: string[] }> };
            const present = (held.items[0]?.tagIds ?? []).includes(tag.id);
            log.push(`${prefix} ${present ? "removes" : "adds"} ${tag.name} on song ${songs.indexOf(song)}`);
            await webEdit(member, { items: [{ catalogEntityId: song.catalogId, ...(present ? { remove: [tag.id] } : { add: [tag.id] }) }] });
          }
        }

        async function tagifyAction() {
          const [name, install] = pick(installs);
          await useInstall(install);
          const nodes = Object.values(await localNodes());
          const containers = nodes.filter((item) => item.kind !== "tag");
          const tags = nodes.filter((item) => item.kind === "tag");
          const roll = rand();
          if (roll < 0.18 && containers.length) {
            const parent = pick(containers);
            const kind = rand() < 0.7 ? "tag" : "folder";
            const label = freeName(nodes, parent.id, kind);
            if (!label) return;
            const created = id(kind === "tag" ? "tag" : "sub");
            log.push(`${name} creates ${kind} ${label} in ${parent.name}`);
            await editTaxonomy((all) => all.set(created, node(created, kind as "tag" | "folder", parent.id, label, 99)));
          } else if (roll < 0.28 && nodes.length) {
            const target = pick(nodes);
            const label = freeName(nodes, target.parentId, target.kind, target.id);
            if (!label) return;
            log.push(`${name} renames ${target.name} to ${label}`);
            await editTaxonomy((all) => all.set(target.id, { ...all.get(target.id)!, name: label }));
          } else if (roll < 0.36 && tags.length && containers.length) {
            const target = pick(tags);
            const parent = pick(containers);
            if (parent.id === target.parentId || !freeName(nodes.filter((item) => item.name !== target.name || item.parentId !== parent.id), parent.id, "tag")
              || nodes.some((item) => item.parentId === parent.id && item.kind === "tag" && nameKey(item.name) === nameKey(target.name))) return;
            log.push(`${name} moves ${target.name} into ${parent.name}`);
            await editTaxonomy((all) => all.set(target.id, { ...all.get(target.id)!, parentId: parent.id, position: 99 }));
          } else if (roll < 0.44 && nodes.length > 3) {
            const target = pick(nodes);
            log.push(`${name} deletes ${target.kind} ${target.name}`);
            await deleteInTagify(target.id, songs.map((song) => song.uri));
          } else if (roll < 0.7 && tags.length) {
            const song = pick(songs);
            const tag = pick(tags);
            log.push(`${name} toggles ${tag.name} on song ${songs.indexOf(song)}`);
            await editTrack(song.uri, (current) => ({ ...current, tagIds: current.tagIds.includes(tag.id) ? current.tagIds.filter((tagId) => tagId !== tag.id) : [...current.tagIds, tag.id] }));
          } else {
            const raced = rand() < 0.35;
            log.push(`${name} syncs${raced ? " while the website edits" : ""}`);
            if (raced) beforeNextPush(() => websiteAction(true));
            await syncTagify();
            pushHook = null;
          }
        }

        try {
          for (let round = 0; round < rounds; round++) {
            if (rand() < 0.3) await websiteAction(false); else await tagifyAction();
          }
          // Everyone syncs until nothing is left to exchange.
          for (let pass = 0; pass < 3; pass++) {
            for (const [, install] of installs) { await useInstall(install); await syncTagify(); }
          }
          for (const [name, install] of installs) {
            await useInstall(install);
            log.push(`checking ${name}`);
            for (const song of songs) await expectInSync(library, song.uri, song.providerId);
          }
          // The website shows each song's tags exactly as Community holds them.
          const held = await webRead(member, "get_my_library_tags_v1", { p_catalog_entity_ids: songs.map((song) => song.catalogId) }) as { items: Array<{ catalogEntityId: string; tagIds: string[] }> };
          for (const song of songs) {
            const shown = [...(held.items.find((item) => item.catalogEntityId === song.catalogId)?.tagIds ?? [])].sort();
            await useInstall(first);
            // The tags Tagify can show (it skips a tag deleted meanwhile, as the website does).
            const reachable = new Set(Object.keys(await localNodes()));
            expect(shown, `website tags on song ${songs.indexOf(song)}`).toEqual([...((await indexedDBStorage.getTrack(song.uri))?.tagIds ?? [])].filter((tagId) => reachable.has(tagId)).sort());
          }
        } catch (error) {
          const report = `seed ${seed} rounds ${rounds}\n${error instanceof Error ? error.message : String(error)}\n\npushes:\n${pushLog.join("\n")}\n\nactions:\n${log.join("\n")}\n\nbatches:\n${batchHistory(library)}\n\ncloud nodes:\n${sql(`select string_agg(client_id || ' ' || kind || ' ' || name || ' parent=' || coalesce(parent_client_id, '-') || ' @' || position || case when deleted_at is null then '' else ' DELETED' end, E'\\n' order by client_id) from tagify_sync.taxonomy_nodes where library_id='${library}'`)}`;
          if (process.env.E2E_FUZZ_REPORT_DIR) writeFileSync(`${process.env.E2E_FUZZ_REPORT_DIR}/seed-${seed}.txt`, report);
          else console.log(report);
          throw error;
        } finally {
          uuidSource = null;
        }
      }, 240_000);
    }
  });
});
