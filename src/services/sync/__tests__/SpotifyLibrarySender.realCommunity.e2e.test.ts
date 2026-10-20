// Opt-in end to end: the member asks on Community for their Spotify lists, and Tagify's real sync
// engine (with Spotify's desktop APIs stubbed) sends them to a real local Community server and
// database (Community migrations 0233 and 9001): Tagify reports it can send, picks the send up,
// reports progress the website shows, keeps unchanged lists on a second send, stops when the
// member cancels, and reports why it failed. Skipped unless E2E_API_URL, E2E_PUBLISHABLE_KEY,
// E2E_SERVICE_ROLE_KEY, E2E_DB_URL and E2E_COMMUNITY_URL point at an isolated local stack (see
// docs/COMMUNITY_SYNC_E2E.md). It creates members and devices, so never point it at a hosted project.
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import { spotifyApiService } from "@/services/SpotifyApiService";
import type { SpotifyTrack } from "@/types/SpotifyTypes";
import { syncPairingService } from "../SyncPairingService";
import { syncRuntime } from "../SyncRuntime";

const env = {
  api: process.env.E2E_API_URL!,
  key: process.env.E2E_PUBLISHABLE_KEY!,
  service: process.env.E2E_SERVICE_ROLE_KEY!,
  db: process.env.E2E_DB_URL!,
  community: process.env.E2E_COMMUNITY_URL!,
};
const realFetch = globalThis.fetch.bind(globalThis);
const sql = (query: string) => execFileSync("psql", [env.db, "-tA", "-v", "ON_ERROR_STOP=1", "-c", query], { encoding: "utf8" }).trim();
const songId = () => randomUUID().replace(/-/g, "").slice(0, 22);
const track = (id: string, name: string): SpotifyTrack => ({ uri: `spotify:track:${id}`, name, artists: [{ name: "Artist" }], album: { name: "Album", images: [{ url: "spotify:image:ab67616d0000485100000000000000000000" }] }, duration_ms: 1000 });

interface Member { id: string; webToken: string }

async function createMember(): Promise<Member> {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10), email = `lists-${suffix}@example.test`, password = randomBytes(16).toString("hex");
  const created = await realFetch(`${env.api}/auth/v1/admin/users`, {
    method: "POST", headers: { apikey: env.service, authorization: `Bearer ${env.service}`, "content-type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!created.ok) throw new Error(`member: ${created.status}`);
  const { id } = await created.json() as { id: string };
  sql(`update public.profiles set handle='lists_${suffix}', display_name='Lists ${suffix}' where id='${id}'`);
  const session = await realFetch(`${env.api}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: env.key, "content-type": "application/json" }, body: JSON.stringify({ email, password }),
  });
  const { access_token: webToken } = await session.json() as { access_token: string };
  return { id, webToken };
}

/** A website call as the signed-in member, through the same database functions the website calls. */
async function website<T>(member: Member, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const response = await realFetch(`${env.api}/rest/v1/rpc/${name}`, {
    method: "POST", headers: { apikey: env.key, authorization: `Bearer ${member.webToken}`, "content-type": "application/json" }, body: JSON.stringify(args),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${name} failed: ${JSON.stringify(body)}`);
  return body as T;
}

async function link(member: Member) {
  const pending = await syncPairingService.begin(env.community, "Tagify lists E2E", "darwin");
  const approved = await realFetch(`${env.community}/api/v2/device-authorizations/approve`, {
    method: "POST", headers: { authorization: `Bearer ${member.webToken}`, "content-type": "application/json" }, body: JSON.stringify({ userCode: pending.userCode }),
  });
  expect(approved.status, await approved.clone().text()).toBe(200);
  const result = await syncPairingService.poll();
  if (result.status !== "approved") throw new Error("pairing was not approved");
  return (await syncPairingService.complete(result.approval)).configuration;
}

interface Send { id: string; phase: string; device: string | null; listsTotal: number | null; listsDone: number; listsUnchanged: number; songsSent: number; failure: string | null; lists: number | null; songs: number | null }
interface Desktop { linked: boolean; canSend: boolean; requestedAt: string | null; sentAt: string | null; send: Send | null; desktops: Array<{ name: string; version: string | null; canSend: boolean }> }
interface Overview { lists: Array<{ key: string; name: string; songCount: number }>; desktop: Desktop }
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const localStack = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/;
const enabled = Boolean(env.db && env.service && env.key && localStack.test(env.api ?? "") && localStack.test(env.community ?? ""));

describe.skipIf(!enabled)("sending Spotify lists to a real Community", () => {
  beforeEach(async () => {
    vi.stubGlobal("indexedDB", new IDBFactory());
    localStorage.clear();
    sql("update public.community_feature_flags set enabled = true where key = 'spotify_library_import'");
    expect(await storageService.switchAccountDatabase()).toBe(true);
  });
  afterEach(() => {
    syncRuntime.stop();
    indexedDBStorage.resetConnection();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sends as a send the website watches, keeps unchanged lists, stops on cancel and explains a failure", async () => {
    const liked = Array.from({ length: 120 }, (_, index) => track(songId(), `Liked ${index + 1}`));
    const gym = [track(songId(), "Run"), track(songId(), "Lift")];
    const playlistId = songId();
    let playlistDelay = 0;
    let playlistFailure: unknown = null;
    // Spotify's desktop APIs: Liked Songs newest first in pages of 50, one playlist.
    vi.spyOn(spotifyApiService, "getTaggingQueuePage").mockImplementation(async (_playlist, offset = 0) => ({
      tracks: liked.slice(offset, offset + 50), checked: 50, unavailable: 0, nextOffset: offset + 50 < liked.length ? offset + 50 : null, total: liked.length,
    }));
    vi.spyOn(spotifyApiService, "getAllUserPlaylistReferencesStrict").mockResolvedValue([{ playlistId, playlistName: "Gym" }]);
    vi.spyOn(spotifyApiService, "readPlaylistTracks").mockImplementation(async () => {
      await delay(playlistDelay);
      if (playlistFailure) throw playlistFailure;
      return gym;
    });
    // This Spotify has the desktop APIs the sender reads.
    Object.assign(Spicetify.Platform as object, { RootlistAPI: { getContents: () => null }, LibraryAPI: { getTracks: () => null }, PlaylistAPI: { getContents: () => null } });

    const member = await createMember();
    await link(member);
    syncRuntime.start();
    await syncRuntime.syncNow();
    // Tagify told Community, on its first pull, that it can send lists.
    await vi.waitFor(async () => expect((await website<Overview>(member, "list_spotify_lists_v1")).desktop.canSend).toBe(true), { timeout: 15_000, interval: 250 });
    expect((await website<Desktop>(member, "get_spotify_library_send_v1")).desktops[0]).toMatchObject({ name: "Tagify lists E2E", canSend: true });

    // 1. A send the website watches: picked up by this computer, progress, then done.
    playlistDelay = 2_500;
    await website(member, "request_spotify_library_from_desktop_v1");
    await syncRuntime.syncNow();
    await vi.waitFor(async () => {
      const send = (await website<Desktop>(member, "get_spotify_library_send_v1")).send;
      expect(send).toMatchObject({ phase: "sending", device: "Tagify lists E2E", listsTotal: 2 });
    }, { timeout: 15_000, interval: 200 });
    await vi.waitFor(async () => expect((await website<Desktop>(member, "get_spotify_library_send_v1")).send?.phase).toBe("done"), { timeout: 30_000, interval: 250 });
    const first = await website<Overview>(member, "list_spotify_lists_v1");
    expect(first.desktop.send).toMatchObject({ lists: 2, songs: 122, listsUnchanged: 0 });
    expect(first.lists.map((list) => [list.key, list.name, list.songCount])).toEqual([["desktop:liked", "Liked Songs", 120], [`desktop:${playlistId}`, "Gym", 2]]);
    const page = await website<{ songs: Array<{ id: string; name: [string, string, string, string | null] }> }>(member, "get_spotify_list_page_v1", { p_list_key: "desktop:liked", p_chunk: 0 });
    // Stored oldest first; the website shows Liked Songs newest first.
    expect(page.songs[0].name).toEqual(["Liked 120", "Artist", "Album", "https://i.scdn.co/image/ab67616d0000485100000000000000000000"]);
    expect(page.songs.at(-1)!.name[0]).toBe("Liked 1");
    expect(Spicetify.showNotification).toHaveBeenCalledWith("Sent 122 songs in 2 lists to Tagify Community.", false);

    // 2. Nothing changed: both lists are kept, none sent again.
    playlistDelay = 0;
    await website(member, "request_spotify_library_from_desktop_v1");
    await syncRuntime.syncNow();
    await vi.waitFor(async () => {
      const send = (await website<Desktop>(member, "get_spotify_library_send_v1")).send;
      expect(send).toMatchObject({ phase: "done", listsUnchanged: 2, songsSent: 0 });
    }, { timeout: 30_000, interval: 250 });

    // 3. The member cancels while the playlist is read: Tagify stops and doesn't finish.
    playlistDelay = 3_000;
    await website(member, "request_spotify_library_from_desktop_v1");
    await syncRuntime.syncNow();
    await vi.waitFor(async () => expect((await website<Desktop>(member, "get_spotify_library_send_v1")).send?.phase).toBe("sending"), { timeout: 15_000, interval: 200 });
    await website(member, "cancel_spotify_library_send_v1");
    await vi.waitFor(() => expect(Spicetify.showNotification).toHaveBeenCalledWith("Stopped sending your Spotify lists, as you asked on Community.", false), { timeout: 30_000, interval: 250 });
    expect((await website<Desktop>(member, "get_spotify_library_send_v1")).send?.phase).toBe("cancelled");
    expect((await website<Overview>(member, "list_spotify_lists_v1")).lists).toHaveLength(2);

    // 4. Spotify asks Tagify to wait: the website hears why.
    playlistDelay = 0;
    playlistFailure = Object.assign(new Error("Spotify needs a short break. Wait a moment, then check more tracks."), { status: 429 });
    await website(member, "request_spotify_library_from_desktop_v1");
    await syncRuntime.syncNow();
    await vi.waitFor(async () => expect((await website<Desktop>(member, "get_spotify_library_send_v1")).send).toMatchObject({ phase: "failed", failure: "spotify_busy" }), { timeout: 30_000, interval: 250 });
    expect(Spicetify.showNotification).toHaveBeenLastCalledWith("Spotify asked Tagify to slow down, so your Spotify lists weren't all sent to Community. Try again there in a minute.", true);
  }, 180_000);
});
