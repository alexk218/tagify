import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { CommunityWorkspace } from "@/features/community/CommunityWorkspace";
import { TaggedByOthersSection } from "@/features/community/taggedByOthers/TaggedByOthersSection";
import { scanTaggedByOthers, type TaggedByOthersMatch } from "@/features/community/taggedByOthers/taggedByOthersScan";
import { taggedByOthersStore } from "@/features/community/taggedByOthers/taggedByOthersStore";
import { taggedByOthersAllowance } from "@/features/community/taggedByOthers/taggedByOthersAllowance";
import { FirstSongCard } from "@/features/onboarding/components/FirstSongCard";
import { spotifyApiService } from "@/services/SpotifyApiService";
import type { CommunitySharing } from "@/features/community/useCommunitySharing";
import type { CommunityMatch, CommunityMatchTag } from "@/features/onboarding/services/communityMatches";
import { capabilitiesCacheKey } from "@/services/sync/SyncRuntime";
import type { TagTaxonomy, TrackData } from "@/types/tagData";

// ?scene= slow (Community answers slowly, so a check can be reloaded part way) | stale (a check from yesterday, refreshed quietly)
//        | results | checking | none | not-connected | spotify-stopped | unreachable | paused | limited | not-available | reconnect | before
//          | first-run | first-run-before (the first-run card, with and without its "See all" line)
//          | results-kept (whatever this browser already keeps)
//          | saved (a check from three hours ago, made before checks read Liked Songs only, is on this computer)
//          | playlists | skipped-playlist ("Also check playlists I made…" after the Liked Songs check) | cap (more Liked Songs than one check covers)
//          | reopen (Community closes and reopens mid-check) | allowance (the read limit is reached)
const scene = new URLSearchParams(location.search).get("scene") ?? "results";
const ORIGIN = "https://community.tagify.fm";
const ACCOUNT = "9ca88f9f-1ff9-4f1f-8dad-fbd7191d78e7";
const DEVICE = "c61cb594-ae81-4977-9a10-fdca576e4939";
const firstRun = scene.startsWith("first-run");
const connected = scene !== "not-connected" && !firstRun;

localStorage.clear();
if (connected) {
  localStorage.setItem("tagify:sync:configuration", JSON.stringify({
    accountId: ACCOUNT, libraryId: "library-a", deviceId: DEVICE, apiBaseUrl: ORIGIN, supabaseUrl: "https://example.supabase.co",
    supabasePublishableKey: "publishable-key", accessToken: "fixture-token", refreshToken: "fixture-refresh", expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
    profile: { handle: "alex", displayName: "Alex" },
  }));
  if (scene !== "not-available") {
    localStorage.setItem(capabilitiesCacheKey(ORIGIN), JSON.stringify({ cachedAt: Date.now(), value: { supportedProtocolVersions: [2], taggedByOthersLookup: { maxSongs: 500 } } }));
  }
}

// A Liked Songs list of 1,230 songs, newest first, with a duplicate and a local file, and three
// playlists: one that repeats Liked Songs, one with 300 songs of its own, one mixing both.
const idOf = (index: number) => index.toString(36).padStart(22, "0");
const NAMES = ["Midnight City", "Open Eye Signal", "A Very Long Song Title That Keeps Going Well Past The Edge Of Its Row (Extended Club Mix)", "Teardrop", "Nightcall", "Glue", "Roygbiv", "Innerbloom"];
const ARTISTS = ["M83", "Jon Hopkins", "Bicep, Clara La San, Hammer, Overmono", "Massive Attack", "Kavinsky", "Bicep", "Boards of Canada", "RÜFÜS DU SOL"];
const LIKED = Array.from({ length: 1_230 }, (_, index) => ({
  uri: `spotify:track:${idOf(index)}`,
  name: index < NAMES.length ? NAMES[index] : `Liked song ${index + 1}`,
  artists: [{ name: ARTISTS[index % ARTISTS.length] }],
  album: { name: "Album", uri: "spotify:album:0000000000000000000000", images: [{ url: `https://i.scdn.co/image/fixture-${index % 6}` }] },
  duration: { milliseconds: 200_000 },
}));
LIKED.splice(20, 0, LIKED[3], { ...LIKED[0], uri: "spotify:local:Artist:Album:Song:180" });

const playlistSong = (index: number) => ({ ...LIKED[30], uri: `spotify:track:${idOf(5_000 + index)}`, name: index === 0 ? "Only in a playlist" : `Playlist song ${index + 1}` });
const OWN = Array.from({ length: 300 }, (_, index) => playlistSong(index));
// The member made "Road trip", so it is checked first; "Daily Mix 1" is Spotify's and "Empty" has no
// songs: neither is ever read.
const PLAYLISTS = [
  { id: "1".repeat(22), name: "Liked again", owned: true, songs: LIKED.slice(0, 120) },
  { id: "2".repeat(22), name: "Road trip", owned: true, songs: OWN },
  { id: "3".repeat(22), name: "Mixed", owned: true, songs: [...LIKED.slice(100, 160), ...OWN.slice(250), ...Array.from({ length: 40 }, (_, index) => playlistSong(300 + index))] },
  { id: "4".repeat(22), name: "Daily Mix 1", owned: false, spotify: true, songs: OWN.slice(0, 50) },
  { id: "5".repeat(22), name: "Empty", owned: true, songs: [] },
  // Someone else's playlist the member follows: never listed, never read.
  { id: "6".repeat(22), name: "Sam's mix", owned: false, songs: Array.from({ length: 30 }, (_, index) => playlistSong(500 + index)) },
].map((playlist) => ({ ...playlist, songs: playlist.songs.filter((item) => item.uri.startsWith("spotify:track:")) }));
const rootItem = (playlist: (typeof PLAYLISTS)[number]) => ({
  type: "playlist", uri: `spotify:playlist:${playlist.id}`, name: playlist.name, isOwnedBySelf: playlist.owned, canEditItems: playlist.owned, totalLength: playlist.songs.length,
  owner: playlist.spotify ? { displayName: "Spotify", username: "spotify", uri: "spotify:user:spotify" } : { displayName: playlist.owned ? "Alex" : "Sam", username: playlist.owned ? "alex" : "sam" },
});

let spotifyReads = 0;
let rootlistReads = 0;
let playlistReads = 0;
const playlistsRead = new Set<string>();
Object.assign(window, { Spicetify: {
  showNotification: () => {},
  Platform: {
    username: "fixture-tagged-by-others",
    LibraryAPI: {
      getTracks: async ({ offset, limit }: { offset: number; limit: number }) => {
        spotifyReads += 1;
        if (firstRun) return { items: LIKED.slice(offset, offset + limit).slice(0, 6), offset, limit, totalLength: 6 };
        if (scene === "spotify-stopped" && offset >= 100) throw Object.assign(new Error("Too many requests"), { status: 429, headers: { "retry-after": "30" } });
        return { items: LIKED.slice(offset, offset + limit), offset, limit, totalLength: LIKED.length };
      },
    },
    RootlistAPI: {
      getContents: async () => (rootlistReads += 1, { items: [
        rootItem(PLAYLISTS[0]),
        { type: "folder", uri: "spotify:user:fixture:folder:abc123", name: "Trips", items: PLAYLISTS.slice(1).map(rootItem) },
      ] }),
    },
    PlaylistAPI: {
      getContents: async (uri: string, { offset, limit }: { offset: number; limit: number }) => {
        playlistReads += 1;
        playlistsRead.add(uri.split(":").pop()!);
        if (scene === "skipped-playlist" && uri.endsWith(PLAYLISTS[1].id)) throw new Error("Spotify couldn't open this playlist");
        const songs = PLAYLISTS.find((playlist) => uri.endsWith(playlist.id))!.songs;
        return { items: songs.slice(offset, offset + limit).map((item, index) => ({ ...item, uid: `${offset + index}` })), offset: 0, limit, totalLength: songs.length };
      },
    },
  },
} });

const TAGS = [
  { label: "Chill", key: "chill", people: 14, path: "Mood / Chill" },
  { label: "Late night", key: "late night", people: 9, path: "Vibes / Late night" },
  { label: "Electronic", key: "electronic", people: 7, path: "Genre & Style / Electronic" },
  { label: "A tag with a very long name that members somehow agreed on", key: "long", people: 2, path: null },
  { label: "Focus", key: "focus", people: 2, path: "Mood / Focus" },
];
// A song as heavily tagged as the most-tagged songs on Community: about 60 tags, the same tag in
// several spellings ("Nu Metal", "nu metal", "Nu-metal"), most used by one member.
const MANY = [
  ["Rock", 8], ["2000s", 6], ["English", 5], ["Metal", 5], ["nu metal", 4], ["2000s vibes", 3], ["Nu Metal", 2], ["Nu-metal", 1], ["Angry", 2], ["angry", 1],
  ...["9A", "Alt Metaly", "Alternative", "Alternative Metal", "anthemic", "atmospheric", "belting", "Best", "christian", "cold", "dark", "depressive", "duet",
    "energetic", "epic", "existential", "female vocalist", "Female Vocals", "gothic", "Gothic Metal", "heavy", "High Energy", "introspective", "Karaoke",
    "lonely", "longing", "male vocalist", "Mall Screamo", "melancholic", "melodic", "nocturnal", "passionate", "Rap Metal", "rhythmic", "romantic", "Scene",
    "sensual", "sombre", "Standalone", "Workout"].map((label) => [label, 1]),
].map(([label, people]) => ({ label: String(label), key: String(label).toLowerCase(), people: Number(people), path: null }));
const tagsFor = (index: number) => (index === 2 ? [...TAGS, ...MANY] : TAGS.slice(index % 3, (index % 3) + 1 + (index % 4)));
const answers = new Map([...LIKED, ...OWN].map((song, index) => [song.uri.slice("spotify:track:".length), index] as const));
// Roughly one song in eight has tags from other members, and the first few do.
const isTagged = (index: number) => index < 6 || index % 8 === 0;

let communityRequests = 0;
const communityBodies: unknown[] = [];
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  // The first run's anonymous preview asks about one song at a time.
  const single = url.match(/\/api\/v2\/public-entities\/track\/([0-9A-Za-z]{22})$/);
  if (single) {
    const index = answers.get(single[1]) ?? -1;
    if (index < 0 || index > 2) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "content-type": "application/json" } });
    const contributors = [0, 1].map((person) => ({ isOwn: false, tags: tagsFor(index + 1).map((tag) => ({ label: tag.label, path: tag.path })).slice(0, 2 - (person && index === 2 ? 1 : 0)) }));
    return new Response(JSON.stringify({ entity: { contributors } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (!url.startsWith(`${ORIGIN}/api/v2/sync/tagged-by-others`)) return new Response("{}", { status: 503 });
  communityRequests += 1;
  const body = JSON.parse(String(init?.body ?? "{}")) as { deviceId?: string; songs?: string[] };
  communityBodies.push({ authorization: (init?.headers as Record<string, string> | undefined)?.authorization, deviceId: body.deviceId, songs: body.songs?.length });
  if (scene === "unreachable") throw new TypeError("Failed to fetch");
  if (scene === "limited" && communityRequests > 2) return new Response(JSON.stringify({ error: "tagged_by_others_limited" }), { status: 429, headers: { "retry-after": "3600" } });
  if (scene === "paused") return new Response(JSON.stringify({ error: "tagged_by_others_paused" }), { status: 503 });
  if (scene === "not-available") return new Response("<html>Not found</html>", { status: 404 });
  // The second request never answers, so the check stays visible mid-way.
  if ((scene === "checking" || scene === "reopen") && communityRequests > 1) return new Promise<Response>(() => {});
  await new Promise((resolve) => setTimeout(resolve, scene === "slow" || scene === "stale" ? 1_500 : 150));
  const items = scene === "none" ? [] : (body.songs ?? []).flatMap((id) => {
    const index = answers.get(id);
    if (index === undefined || !isTagged(index)) return [];
    const tags = tagsFor(index);
    // The first Liked Songs are the ones most members tagged.
    const people = index < 6 ? 40 - index : 1 + (index * 7) % 23;
    return [{ providerId: id, entityId: `entity-${index}`, others: { people, peopleCapped: false, sample: ["ana", "sam", "a_member_with_a_long_handle"].slice(0, Math.min(people, 1 + index % 3)), tags } }];
  });
  return new Response(JSON.stringify({ items }), { status: 200, headers: { "content-type": "application/json" } });
};
Object.assign(window, { fixtureCounts: () => ({ spotifyReads, rootlistReads, playlistReads, communityRequests, communityBodies }), fixturePlaylistsRead: () => [...playlistsRead] });

const taxonomy = {
  categoryOrder: ["mood"],
  categoriesById: { mood: { id: "mood", name: "Mood", subcategoryIds: [], childIds: ["chill", "happy"] } },
  foldersById: {}, subcategoriesById: {}, childrenByParentId: { mood: ["chill", "happy"] },
  tagsById: { chill: { id: "chill", name: "Chill", parentId: "mood" }, happy: { id: "happy", name: "Happy", parentId: "mood" } },
  customAccentsById: {}, colorThemesById: {}, colorThemeOrder: [], ungroupedColorIds: [],
} as unknown as TagTaxonomy;
const song = (tagIds: string[]) => ({ rating: 0, energy: 0, bpm: null, tagIds }) as TrackData;
// The member already has Chill on the first Liked Song.
const tracks: Record<string, TrackData> = { [LIKED[0].uri]: song(["chill"]), "spotify:track:two": song(["happy"]), "spotify:track:three": song(["happy"]) };
const sharing = { phase: "ready", policy: null, state: connected ? "public" : null, handle: "alex", refresh: () => {} } as unknown as CommunitySharing;

// A check finished three hours ago, kept on this computer.
const savedMatches: TaggedByOthersMatch[] = [0, 1, 4, 5, 8, 16, 24, 32].map((index, position) => ({
  track: { uri: LIKED[index].uri, name: LIKED[index].name, artists: LIKED[index].artists, album: { name: "Album", images: LIKED[index].album.images }, duration_ms: 200_000 },
  tags: tagsFor(index).map((tag) => ({ label: tag.label, paths: [tag.path ?? tag.label], people: tag.people })),
  people: 12 - position, peopleCapped: false, sample: ["ana", "sam"].slice(0, 1 + position % 2), position,
}));
const ready = scene === "saved"
  ? taggedByOthersStore.save({ account: ACCOUNT, checkedAt: Date.now() - 3 * 60 * 60_000,
      // Saved before checks read Liked Songs only: no scope or song list.
      outcome: { checked: 1_570, matches: savedMatches, stopped: null, playlistsRead: 3, playlists: 3, skippedPlaylists: 0, capped: false } as never })
  : scene === "stale"
  ? taggedByOthersStore.save({ account: ACCOUNT, checkedAt: Date.now() - 26 * 60 * 60_000,
      outcome: { scope: "liked", checked: 1_230, matches: savedMatches, stopped: null, playlistsRead: 0, playlists: null, skippedPlaylists: 0, capped: false, songIds: [], playlistIds: [], playlistsLeft: null } })
  : scene === "results-kept" ? Promise.resolve() : taggedByOthersStore.clear();

function Fixture() {
  const [log, setLog] = useState<string[]>([]);
  const [open, setOpen] = useState(true);
  const addMembersTags = async (match: CommunityMatch, tags: CommunityMatchTag[]) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    setLog((current) => [...current, `${match.track.name}: ${tags.map((tag) => tag.label).join(", ")}`]);
  };
  if (scene === "cap") {
    // A small ceiling, so "more Liked Songs than one check covers" fits in a fixture.
    return (
      <TaggedByOthersSection connected accountId={ACCOUNT} tracks={tracks} taxonomy={taxonomy} onConnectCommunity={() => {}} onAddMembersTags={addMembersTags}
        check={({ signal, onProgress, allowance }) => scanTaggedByOthers({ library: spotifyApiService, maxSongs: 1_000, allowance, signal, onProgress })} />
    );
  }
  if (scene === "allowance") {
    // One read an hour: the check stops after one Liked Songs page.
    return (
      <TaggedByOthersSection connected accountId={ACCOUNT} tracks={tracks} taxonomy={taxonomy} onConnectCommunity={() => {}} onAddMembersTags={addMembersTags}
        allowance={(account) => taggedByOthersAllowance(account, { perHour: 1 })} />
    );
  }
  if (firstRun) {
    return (
      <>
        <FirstSongCard currentTrack={null} onPick={() => {}} onAddMembersTags={addMembersTags}
          onSeeAllMembersTags={scene === "first-run-before" ? undefined : () => setLog((current) => [...current, "see all"])} />
        <output aria-label="Fixture log" hidden>{JSON.stringify(log)}</output>
      </>
    );
  }
  return (
    <>
      {/* Out of the layout and the screenshots: the runner closes and reopens Community with it. */}
      <button type="button" style={{ position: "fixed", top: 0, right: 0, opacity: 0 }} onClick={() => setOpen((current) => !current)}>{open ? "Close Community" : "Open Community"}</button>
      {open ? <CommunityWorkspace
        onConnectCommunity={() => setLog((current) => [...current, "connect"])}
        onOpenCloudSync={() => {}}
        onOpenSharing={() => {}}
        connected={connected}
        status={scene === "reconnect" ? "reauthorize" : connected ? "idle" : "unlinked"}
        sharing={sharing}
        tracks={tracks}
        taxonomy={taxonomy}
        connectedAccountId={connected ? ACCOUNT : null}
        connectedDeviceId={connected ? DEVICE : null}
        onDisconnect={async () => {}}
        onAddMembersTags={scene === "before" ? undefined : addMembersTags}
        onConnectFromLibraryCheck={() => setLog((current) => [...current, "connect from the list"])}
        onOpenSong={(uri) => setLog((current) => [...current, `open ${LIKED.find((item) => item.uri === uri)?.name ?? uri}`])}
      /> : null}
      <output aria-label="Fixture log" hidden>{JSON.stringify(log)}</output>
    </>
  );
}
void ready.then(() => createRoot(document.getElementById("app")!).render(<Fixture />));
