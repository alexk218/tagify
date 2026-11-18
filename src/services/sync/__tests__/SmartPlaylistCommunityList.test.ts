import { describe, expect, it } from "vitest";
import type { SmartPlaylistV1 } from "@tagify/sync-contracts";
import type { SmartPlaylistCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import {
  desktopFilledSpotifyPlaylist,
  sharedFingerprint,
  smartPlaylistsCapability,
  syncSmartPlaylistList,
  type CommunityAnswer,
  type CommunityOnlySmartPlaylist,
  type SmartPlaylistLinksRecord,
  type SmartPlaylistListContext,
} from "../SmartPlaylistCommunityList";

const DEVICE = "11111111-1111-4111-8111-111111111111";
const LIBRARY = "22222222-2222-4222-8222-222222222222";
const capability = { path: "/api/v2/sync/smart-playlists", movePath: "/api/v2/sync/smart-playlists/move" };
const spotifyId = (n: number) => `P${String(n).padStart(21, "0")}`;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tag = (n: number) => `tag_00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function criteria(tags: string[], extra: Partial<SmartPlaylistCriteria["criteria"]> = {}): SmartPlaylistCriteria["criteria"] {
  return {
    includeTagClauses: [{ tagIds: tags, excludedTagIds: [], operator: "AND" }],
    clauseConnectors: [],
    ratingFilters: [],
    energyMinFilter: null,
    energyMaxFilter: null,
    bpmMinFilter: null,
    bpmMaxFilter: null,
    camelotKeyFilters: [],
    ...extra,
  };
}

function local(n: number, overrides: Partial<SmartPlaylistCriteria> = {}): SmartPlaylistCriteria {
  return {
    id: `smart-playlist:${uuid(n)}`,
    playlistId: spotifyId(n),
    playlistName: `Playlist ${n}`,
    criteria: criteria([tag(n)]),
    isActive: true,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    lastSyncAt: 1_700_000_100_000,
    smartPlaylistTrackUris: ["spotify:track:AAAAAAAAAAAAAAAAAAAAAA"],
    ...overrides,
  };
}

/** Community's list as the routes answer it, with the move, conflicts and read-only playlists. */
function fakeCommunity(options: { moved?: boolean; paused?: boolean; document?: SmartPlaylistCriteria[] } = {}) {
  let clock = Date.parse("2026-11-17T00:00:00Z");
  const tick = () => new Date(++clock).toISOString();
  const playlists: SmartPlaylistV1[] = [];
  let moved = options.moved ?? false;
  let count = 100;
  const calls: string[] = [];
  const fromInput = (input: Record<string, unknown>, existing?: SmartPlaylistV1): SmartPlaylistV1 => ({
    id: existing?.id ?? uuid(++count),
    desktopId: existing?.desktopId ?? (input.desktopId as string | null) ?? null,
    name: String(input.name),
    description: String(input.description ?? ""),
    source: "library",
    origin: existing?.origin ?? "desktop",
    criteria: input.criteria as SmartPlaylistV1["criteria"],
    extras: (input.extras as Record<string, unknown>) ?? {},
    rules: {},
    desktopEditable: true,
    active: input.active !== false,
    spotifyPlaylistId: (input.spotifyPlaylistId as string | null) ?? existing?.spotifyPlaylistId ?? null,
    songLimit: 500,
    trackCount: 3,
    createdAt: existing?.createdAt ?? tick(),
    updatedAt: tick(),
  });
  const answer = (status: number, body: unknown): CommunityAnswer => ({ status, body });
  const call = async (method: string, path: string, body?: unknown): Promise<CommunityAnswer> => {
    calls.push(`${method} ${path.split("?")[0]}`);
    if (options.paused) return answer(503, { error: { code: "smart_playlists_paused" } });
    const input = body as Record<string, unknown> | undefined;
    if (method === "GET") return answer(200, { moved, playlists: structuredClone(playlists) });
    if (method === "POST" && path === capability.movePath) {
      let movedCount = 0;
      if (!moved) {
        for (const item of options.document ?? []) {
          if (playlists.some((playlist) => playlist.desktopId === item.id)) continue;
          playlists.push(fromInput({ desktopId: item.id, name: item.playlistName, criteria: item.criteria, active: item.isActive, spotifyPlaylistId: item.playlistId }));
          movedCount++;
        }
      }
      const already = moved;
      moved = true;
      return answer(200, { moved: movedCount, alreadyMoved: already, playlists: structuredClone(playlists) });
    }
    if (method === "POST") {
      const playlist = input!.playlist as Record<string, unknown>;
      const index = playlists.findIndex((item) => item.desktopId && item.desktopId === playlist.desktopId);
      const saved = fromInput(playlist, playlists[index]);
      if (index >= 0) playlists[index] = saved; else playlists.push(saved);
      return answer(200, { playlist: saved });
    }
    if (method === "PUT") {
      const index = playlists.findIndex((item) => item.id === input!.id);
      if (index < 0) return answer(404, { error: { code: "smart_playlist_gone" } });
      if (playlists[index].source !== "library") return answer(409, { error: { code: "edit_on_community" } });
      if (input!.expectedUpdatedAt && input!.expectedUpdatedAt !== playlists[index].updatedAt) return answer(409, { error: { code: "smart_playlist_changed" } });
      playlists[index] = fromInput(input!.playlist as Record<string, unknown>, playlists[index]);
      return answer(200, { playlist: playlists[index] });
    }
    if (method === "DELETE") {
      const index = playlists.findIndex((item) => item.id === input!.id);
      if (index < 0) return answer(404, { error: { code: "smart_playlist_gone" } });
      playlists.splice(index, 1);
      return answer(200, { deleted: true });
    }
    return answer(405, {});
  };
  /** A change made on the website. */
  const editOnWebsite = (id: string, change: Partial<SmartPlaylistV1>) => {
    const index = playlists.findIndex((item) => item.id === id);
    playlists[index] = { ...playlists[index], ...change, updatedAt: tick() };
  };
  const addOnWebsite = (playlist: Partial<SmartPlaylistV1>) => {
    const made: SmartPlaylistV1 = {
      id: uuid(++count), desktopId: null, name: "Made on Community", description: "", source: "library", origin: "community",
      criteria: criteria([tag(50)]) as SmartPlaylistV1["criteria"], extras: {}, rules: {}, desktopEditable: true, active: true,
      spotifyPlaylistId: null, songLimit: 500, trackCount: 7, createdAt: tick(), updatedAt: tick(), ...playlist,
    };
    playlists.push(made);
    return made;
  };
  return { playlists, call, calls, editOnWebsite, addOnWebsite };
}

function desktop(community: ReturnType<typeof fakeCommunity>, initial: SmartPlaylistCriteria[]) {
  let list = structuredClone(initial);
  let record: SmartPlaylistLinksRecord | undefined;
  let shown: CommunityOnlySmartPlaylist[] = [];
  let beforeSave: (() => void) | null = null;
  const removals: string[] = [];
  const sent: string[] = [];
  const context: SmartPlaylistListContext = {
    capability,
    libraryId: LIBRARY,
    deviceId: DEVICE,
    call: (method, path, body) => community.call(method, path, body),
    loadLocal: async () => structuredClone(list),
    updateLocal: async (updater) => { beforeSave?.(); list = updater(structuredClone(list)); return list; },
    getRecord: async () => record,
    putRecord: async (next) => { record = structuredClone(next); },
    showCommunityOnly: (playlists) => { shown = playlists; },
    pendingRemovals: () => [...removals],
    removalsSent: (ids) => { sent.push(...ids); removals.splice(0, removals.length, ...removals.filter((id) => !ids.includes(id))); },
    now: () => 1_800_000_000_000,
  };
  return {
    run: () => syncSmartPlaylistList(context),
    get list() { return list; },
    set list(value: SmartPlaylistCriteria[]) { list = value; },
    get record() { return record; },
    get shown() { return shown; },
    removals,
    sent,
    editBeforeSave(edit: () => void) { beforeSave = () => { beforeSave = null; edit(); }; },
  };
}

describe("Smart playlists shared with Community", () => {
  it("reads Community's capability only for this protocol", () => {
    expect(smartPlaylistsCapability({ smartPlaylists: { ...capability, protocolVersion: 1 } })).toEqual(capability);
    expect(smartPlaylistsCapability({ smartPlaylists: { ...capability, protocolVersion: 2 } })).toBeNull();
    expect(smartPlaylistsCapability({ smartPlaylists: { ...capability, path: "https://elsewhere.example/x", protocolVersion: 1 } })).toBeNull();
    expect(smartPlaylistsCapability({})).toBeNull();
  });

  it("keeps the local list against an older Community or while Community pauses smart playlists", async () => {
    const paused = fakeCommunity({ paused: true });
    const computer = desktop(paused, [local(1)]);
    expect(await computer.run()).toBe("paused");
    expect(computer.list).toEqual([local(1)]);
    expect(await syncSmartPlaylistList({ ...({} as SmartPlaylistListContext), capability: null })).toBe("unsupported");
  });

  it("moves the desktop list in once, keeping each Spotify playlist, with no second copy", async () => {
    const document = [local(1), local(2)];
    const community = fakeCommunity({ document });
    const computer = desktop(community, document);
    expect(await computer.run()).toBe("done");
    expect(community.calls).toEqual(["GET /api/v2/sync/smart-playlists", "POST /api/v2/sync/smart-playlists/move"]);
    expect(community.playlists.map((item) => [item.desktopId, item.spotifyPlaylistId])).toEqual([
      [local(1).id, spotifyId(1)], [local(2).id, spotifyId(2)],
    ]);
    // The same playlists, still tracking the same songs; nothing was sent twice.
    expect(computer.list).toEqual(document);
    expect(Object.keys(computer.record!.links)).toEqual([local(1).id, local(2).id]);
    community.calls.length = 0;
    expect(await computer.run()).toBe("done");
    expect(community.calls).toEqual(["GET /api/v2/sync/smart-playlists"]);
  });

  it("sends a playlist made on this computer after the move, once", async () => {
    const community = fakeCommunity({ moved: true });
    const computer = desktop(community, [local(3)]);
    await computer.run();
    await computer.run();
    expect(community.playlists).toHaveLength(1);
    expect(community.playlists[0]).toMatchObject({ desktopId: local(3).id, name: "Playlist 3", spotifyPlaylistId: spotifyId(3), active: true });
    expect(community.playlists[0].criteria).toEqual(local(3).criteria);
  });

  it("sends local edits with the updatedAt it last read, and leaves tracking bookkeeping alone", async () => {
    const community = fakeCommunity({ document: [local(1)] });
    const computer = desktop(community, [local(1)]);
    await computer.run();
    community.calls.length = 0;
    computer.list = [{ ...computer.list[0], lastSyncAt: 1_700_000_900_000, smartPlaylistTrackUris: [] }];
    await computer.run();
    expect(community.calls).toEqual(["GET /api/v2/sync/smart-playlists"]);
    computer.list = [{ ...computer.list[0], playlistName: "Renamed", criteria: criteria([tag(1)], { ratingFilters: [5, 4] }) }];
    await computer.run();
    expect(community.calls.at(-1)).toBe("PUT /api/v2/sync/smart-playlists");
    expect(community.playlists[0]).toMatchObject({ name: "Renamed" });
    expect(community.playlists[0].criteria?.ratingFilters).toEqual([5, 4]);
  });

  it("takes Community's edits into the local list, keeping what only this computer tracks", async () => {
    const community = fakeCommunity({ document: [local(1)] });
    const computer = desktop(community, [local(1)]);
    await computer.run();
    community.editOnWebsite(community.playlists[0].id, { name: "Edited on the website", criteria: criteria([tag(9)]) as SmartPlaylistV1["criteria"] });
    await computer.run();
    expect(computer.list[0]).toMatchObject({ id: local(1).id, playlistName: "Edited on the website", playlistId: spotifyId(1), smartPlaylistTrackUris: local(1).smartPlaylistTrackUris });
    expect(computer.list[0].criteria.includeTagClauses[0].tagIds).toEqual([tag(9)]);
  });

  it("lets Community's later save win when both sides changed the same playlist", async () => {
    const community = fakeCommunity({ document: [local(1)] });
    const computer = desktop(community, [local(1)]);
    await computer.run();
    community.editOnWebsite(community.playlists[0].id, { name: "Website" });
    computer.list = [{ ...computer.list[0], playlistName: "Desktop" }];
    await computer.run();
    expect(computer.list[0].playlistName).toBe("Website");
    expect(community.playlists[0].name).toBe("Website");
  });

  it("deletes on Community what this computer deleted, and here what Community deleted", async () => {
    const community = fakeCommunity({ document: [local(1), local(2)] });
    const computer = desktop(community, [local(1), local(2)]);
    await computer.run();
    computer.list = [computer.list[1]];
    await computer.run();
    expect(community.playlists.map((item) => item.desktopId)).toEqual([local(2).id]);
    community.playlists.splice(0, 1);
    await computer.run();
    expect(computer.list).toEqual([]);
  });

  it("adds your-tags playlists made on Community and shows everyone's or one person's tags read-only", async () => {
    const community = fakeCommunity({ moved: true });
    const made = community.addOnWebsite({ name: "From the website", spotifyPlaylistId: spotifyId(30) });
    community.addOnWebsite({ name: "Everyone's chill", source: "community", criteria: null, desktopEditable: false, rules: { tags: ["chill"], minPeople: 3 } });
    community.addOnWebsite({ name: "Ana's house", source: "member", criteria: null, desktopEditable: false });
    community.addOnWebsite({ name: "Short songs", desktopEditable: false, rules: { length: { max: 180 } } });
    const computer = desktop(community, []);
    await computer.run();
    expect(computer.list).toHaveLength(1);
    expect(computer.list[0]).toMatchObject({ id: `community-playlist:${made.id}`, playlistName: "From the website", playlistId: spotifyId(30), isActive: true, smartPlaylistTrackUris: [] });
    expect(computer.shown.map((item) => [item.name, item.source])).toEqual([
      ["Everyone's chill", "community"], ["Ana's house", "member"], ["Short songs", "library"],
    ]);
    // Editing it from this computer gives it this computer's id on Community, without a copy.
    computer.list = [{ ...computer.list[0], playlistName: "Renamed here" }];
    await computer.run();
    expect(community.playlists.filter((item) => item.source === "library" && item.desktopEditable).map((item) => item.name)).toEqual(["Renamed here"]);
  });

  it("deletes on Community a Community-filled playlist whose tracking was removed here, once", async () => {
    const community = fakeCommunity({ moved: true });
    const chill = community.addOnWebsite({ name: "Everyone's chill", source: "community", criteria: null, desktopEditable: false, spotifyPlaylistId: spotifyId(40) });
    community.addOnWebsite({ name: "Ana's house", source: "member", criteria: null, desktopEditable: false });
    const computer = desktop(community, []);
    computer.removals.push(chill.id, "00000000-0000-4000-8000-00000000dead");
    await computer.run();
    expect(community.calls.filter((call) => call.startsWith("DELETE"))).toHaveLength(1);
    expect(community.playlists.map((item) => item.name)).toEqual(["Ana's house"]);
    expect(computer.shown.map((item) => item.name)).toEqual(["Ana's house"]);
    expect(computer.sent).toEqual([chill.id, "00000000-0000-4000-8000-00000000dead"]);
    expect(computer.removals).toEqual([]);
    await computer.run();
    expect(community.calls.filter((call) => call.startsWith("DELETE"))).toHaveLength(1);
  });

  it("moves a playlist to read-only when Community gives it rules Tagify can't follow", async () => {
    const community = fakeCommunity({ document: [local(1)] });
    const computer = desktop(community, [local(1)]);
    await computer.run();
    community.editOnWebsite(community.playlists[0].id, { desktopEditable: false, rules: { released: { from: 1990 } } });
    await computer.run();
    expect(computer.list).toEqual([]);
    expect(computer.shown.map((item) => item.name)).toEqual(["Playlist 1"]);
  });

  it("keeps an edit made on this computer while a run was out, and sends it next run", async () => {
    const community = fakeCommunity({ document: [local(1)] });
    const computer = desktop(community, [local(1)]);
    await computer.run();
    community.editOnWebsite(community.playlists[0].id, { name: "Website" });
    computer.editBeforeSave(() => { computer.list = [{ ...computer.list[0], playlistName: "Typed meanwhile" }]; });
    await computer.run();
    expect(computer.list[0].playlistName).toBe("Typed meanwhile");
  });

  it("says which Spotify playlist Tagify fills itself, so Community's Keep in Spotify doesn't write it too", async () => {
    const community = fakeCommunity({ document: [local(1), local(2, { isActive: false })] });
    const computer = desktop(community, [local(1), local(2, { isActive: false })]);
    await computer.run();
    const [one, two] = community.playlists;
    expect(desktopFilledSpotifyPlaylist(one.id, computer.record, computer.list)).toBe(spotifyId(1));
    // Not kept updating here: Community's write goes ahead.
    expect(desktopFilledSpotifyPlaylist(two.id, computer.record, computer.list)).toBeNull();
    expect(desktopFilledSpotifyPlaylist(uuid(999), computer.record, computer.list)).toBeNull();
  });

  it("fingerprints only the fields both sides share", () => {
    expect(sharedFingerprint(local(1))).toBe(sharedFingerprint({ ...local(1), lastSyncAt: 5, smartPlaylistTrackUris: [], pendingTagChoices: ["x"] }));
    expect(sharedFingerprint(local(1))).not.toBe(sharedFingerprint({ ...local(1), isActive: false }));
  });
});
