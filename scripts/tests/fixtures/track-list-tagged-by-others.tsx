import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import TrackList from "@/features/track-session/components/TrackList";
import { TaggedByOthersSection } from "@/features/community/taggedByOthers/TaggedByOthersSection";
import { taggedByOthersStore } from "@/features/community/taggedByOthers/taggedByOthersStore";
import { useFilterState } from "@/features/filter-state";
import { capabilitiesCacheKey } from "@/services/sync/SyncRuntime";
import { buildTaxonomyFromCategoryTree } from "@/utils/tagTaxonomy";
import type { TrackData } from "@/types/tagData";
import "@/styles/globals.css";

// The track list's "Tagged by others" view and the "N others" sharing gate: production UI and request
// code, simulated Liked Songs and a faked Community answer. No request leaves the page.
// ?view=tagged | others          which view of the track list is open
//  &shared=1                     the member shares their tags (nothing locked)
//  &off=1                        both switches off (the track list before this)
//  &keep=1                      keep the saved check from an earlier load
//  &open=1                       the first row's "N others" is opened
//  &connected=0                  not connected to Community (no lookups); with
//  &teaser=1                     the preview for people who aren't connected, on both the
//                                "Tagged by others" view and Tagged Tracks rows (switch communityTeasers on)
//  &layout=1                     "Your songs | New to you" under Tagged by others, with Community's tag search
//                                faked and a richer set of own tags; &filter=<tag name> starts with that tag filter,
//                                &sub=new opens "New to you", &search=none|fail is what the tag search answers,
//                                &long=1 adds very long tag names
// The view's rows toggle members' tags, lock a song (blue), and open a playlist picker of five own playlists.
const params = new URLSearchParams(location.search);
const view = params.get("view") ?? "others";
const shared = params.get("shared") === "1";
const off = params.get("off") === "1";
const connected = params.get("connected") !== "0";
const teaser = params.get("teaser") === "1";
const layout = params.get("layout");
const startFilter = params.get("filter");
const searchAnswer = params.get("search") ?? "ok";
const longNames = params.get("long") === "1";
const ORIGIN = "https://community.tagify.fm";
const ACCOUNT = "9ca88f9f-1ff9-4f1f-8dad-fbd7191d78e7";

localStorage.clear();
localStorage.setItem("tagify:sync:account-id", "isolated-track-list-tagged-by-others");
if (teaser) {
  localStorage.setItem("tagify:switch:communityTeasers", "on");
}
if (connected) localStorage.setItem("tagify:sync:configuration", JSON.stringify({
  accountId: ACCOUNT, libraryId: "library-a", deviceId: "c61cb594-ae81-4977-9a10-fdca576e4939", apiBaseUrl: ORIGIN, supabaseUrl: "https://example.supabase.co",
  supabasePublishableKey: "publishable-key", accessToken: "fixture-token", refreshToken: "fixture-refresh", expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
  profile: { handle: "alex", displayName: "Alex" },
}));
localStorage.setItem(capabilitiesCacheKey(ORIGIN), JSON.stringify({ cachedAt: Date.now(), value: {
  supportedProtocolVersions: [2], taggedByOthersLookup: { maxSongs: 500 },
  ...(off ? { taggedByOthersTrackList: false, othersTagsSharingGate: false } : {}),
} }));
localStorage.setItem("tagify:trackListView", view === "others" ? "others" : "tagged");
if (layout) {
  localStorage.setItem("tagify:taggedByOthers:homeView", JSON.stringify(params.get("sub") === "new" ? "new" : "yours"));
  // The "New" marks are not what is being compared.
  localStorage.setItem("tagify:switch:communityTagSearch", "on");
}

const idOf = (index: number) => index.toString(36).padStart(22, "0");
const NAMES = ["Midnight City", "Open Eye Signal", "Teardrop", "Nightcall", "Glue", "Roygbiv", "Innerbloom", "Windowlicker", "Porcelain", "Strobe"];
const ARTISTS = ["M83", "Jon Hopkins", "Massive Attack", "Kavinsky", "Bicep", "Boards of Canada", "RÜFÜS DU SOL", "Aphex Twin", "Moby", "deadmau5"];
const LIKED = Array.from({ length: 400 }, (_, index) => ({
  uri: `spotify:track:${idOf(index)}`,
  name: index < NAMES.length ? NAMES[index] : `Liked song ${index + 1}`,
  artists: [{ name: ARTISTS[index % ARTISTS.length] }],
  album: { name: "Album", uri: "spotify:album:0000000000000000000000", images: [{ url: `https://i.scdn.co/image/fixture-${index % 6}` }] },
  duration: { milliseconds: 200_000 },
}));
Object.assign(window, { Spicetify: {
  showNotification: () => {}, Player: { data: null },
  Platform: {
    username: "fixture-track-list", History: { push: () => {} },
    LibraryAPI: { contains: async (...uris: string[]) => uris.map((_, position) => position === 2), getTracks: async ({ offset, limit }: { offset: number; limit: number }) => ({ items: LIKED.slice(offset, offset + limit), offset, limit, totalLength: LIKED.length }) },
  },
} });

const TAGS = [
  { label: "Chill", people: 14, path: "Mood / Chill" },
  { label: "Late night", people: 9, path: "Vibes / Late night" },
  { label: "Electronic", people: 7, path: "Genre & Style / Electronic" },
  { label: "Dreamy", people: 4, path: "Mood / Dreamy" },
  { label: "Focus", people: 2, path: "Mood / Focus" },
  { label: "Driving", people: 2, path: "Activity / Driving" },
  { label: "Synthwave", people: 1, path: "Genre & Style / Synthwave" },
];
// Community's tag search, faked: songs the member doesn't have, five and a lock for people who don't share.
const FOUND = [["Neverender", "Justice, Tame Impala"], ["Disco Ulysses", "Vulfpeck"], ["Get Lucky", "Daft Punk"], ["Cola", "CamelPhat, Elderbrook"], ["Lady (Hear Me Tonight)", "Modjo"],
  ["Music Sounds Better with You", "Stardust"], ["Sing It Back", "Moloko"], ["Around the World", "Daft Punk"], ["Finally", "Kings of Tomorrow"], ["Gypsy Woman", "Crystal Waters"],
  ["You Don't Know Me", "Armand Van Helden"], ["Flat Beat", "Mr. Oizo"]];
const tagSearchAnswer = async (url: URL) => {
  await new Promise((resolve) => setTimeout(resolve, 60));
  if (searchAnswer === "fail") return new Response("{}", { status: 500 });
  const wanted = url.searchParams.getAll("tag");
  const locked = !connected ? "connect" : shared ? null : "share";
  const total = searchAnswer === "none" ? 0 : 37;
  const items = (total ? FOUND : []).slice(0, locked ? 5 : 12).map(([title, artists], position) => ({
    spotifyTrackId: (position + 900).toString(36).padStart(22, "0"), title, artists: artists.split(", "), imageUrl: `https://i.scdn.co/image/fixture-found-${position % 6}`,
    people: 9 - (position % 7), tags: [...wanted.slice(0, 2), ...["Disco", "Groovy", "Warm-up"].slice(0, position % 3)].map((label) => ({ label, people: 1 })),
  }));
  return new Response(JSON.stringify({ items, totalCount: total, totalCountCapped: false, locked, nextCursor: !locked && total ? "next" : null }), { status: 200, headers: { "content-type": "application/json" } });
};
const index = new Map(LIKED.map((song, position) => [song.uri.slice("spotify:track:".length), position] as const));
const isTagged = (position: number) => position < 8 || position % 9 === 0;
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith(`${ORIGIN}/api/v2/desktop/tag-search`)) return tagSearchAnswer(new URL(url));
  if (!url.startsWith(`${ORIGIN}/api/v2/sync/tagged-by-others`)) return new Response("{}", { status: 404 });
  const body = JSON.parse(String(init?.body ?? "{}")) as { songs?: string[] };
  await new Promise((resolve) => setTimeout(resolve, 60));
  const items = (body.songs ?? []).flatMap((id) => {
    const position = index.get(id);
    if (position === undefined || !isTagged(position)) return [];
    const people = position < 8 ? 30 - position * 3 : 1 + (position * 7) % 11;
    return [{ providerId: id, others: { people, peopleCapped: false, sample: ["ana", "sam", "lena"].slice(0, 1 + position % 3), tags: TAGS.slice(position % 3, (position % 3) + 3 + (position % 4)) } }];
  });
  return new Response(JSON.stringify({ items }), { status: 200, headers: { "content-type": "application/json" } });
};

const taxonomy = buildTaxonomyFromCategoryTree([{ id: "mood", name: "Mood", subcategories: [{ id: "feel", name: "Feel", tags: [{ id: "chill", name: "Chill" }, { id: "happy", name: "Happy" }, { id: "dark", name: "Dark" },
  ...(layout ? ["Funky", "Late night", "Driving", "Warm-up", "Peak time", "Melodic", "Vocal", "Groovy", "Deep House", "Sunrise", "Focus"].map((name) => ({ id: name.toLowerCase().replace(/[^a-z]+/g, "-"), name })) : []),
  ...(longNames ? [{ id: "long-a", name: "Songs for the very last hour of an open air when the sun comes up" }, { id: "long-b", name: "Übertrieben langer deutscher Schlagwortname ohne Leerzeichenpause" }] : []),
] }] }]);
const tagId = (name: string) => Object.values(taxonomy.tagsById).find((tag) => tag.name.toLowerCase() === name)!.id;
const tagged = (position: number, names: string[], rating: number) => [LIKED[position].uri, {
  name: LIKED[position].name, artists: LIKED[position].artists[0].name, albumName: "Album", albumImageUrl: `https://i.scdn.co/image/fixture-${position % 6}`, rating, energy: 5 + position % 4, bpm: 118 + position, tagIds: names.map(tagId),
  dateCreated: Date.now() - (10 - position) * 86_400_000, dateModified: Date.now() - (10 - position) * 3_600_000,
}] as const;
const tracks = Object.fromEntries([tagged(0, ["chill"], 4.5), tagged(3, ["dark"], 4), tagged(5, ["happy", "chill"], 3.5), tagged(12, ["happy"], 3),
  ...(layout ? [tagged(14, ["funky", "groovy", "warm-up"], 4), tagged(15, ["funky", "late night"], 5), tagged(16, ["driving", "melodic", "funky"], 3.5), tagged(17, ["peak time", "vocal"], 4),
    tagged(18, ["deep house", "sunrise", "focus", "funky"], 4.5), tagged(19, ["late night", "melodic"], 3)] : []),
  ...(longNames ? [tagged(20, ["songs for the very last hour of an open air when the sun comes up", "übertrieben langer deutscher schlagwortname ohne leerzeichenpause", "funky"], 4)] : []),
  // Not connected: more tagged songs, so "first 5 rows only" has rows past the fifth.
  ...(connected ? [] : [tagged(1, ["happy"], 4), tagged(2, ["dark", "chill"], 3), tagged(4, ["chill"], 0), tagged(6, ["happy"], 5), tagged(7, ["dark"], 2),
    tagged(8, ["chill"], 3), tagged(9, ["happy", "dark"], 4), tagged(10, ["chill"], 0)]),
]) as unknown as Record<string, TrackData>;

// What the anonymous preview would answer for someone not connected: how many people and their tags, never who.
const othersOf = (position: number) => ({
  providerId: idOf(position), people: position < 8 ? 30 - position * 3 : 1 + (position * 7) % 11, peopleCapped: false, sample: [] as string[],
  tags: TAGS.slice(position % 3, (position % 3) + 3 + (position % 4)).map((tag) => ({ label: tag.label, paths: [tag.path], people: tag.people })),
});
const teaserOthers = new Map(LIKED.map((song, position) => [song.uri, position] as const).filter(([, position]) => isTagged(position)).map(([uri, position]) => [uri, othersOf(position)] as const));
const preview = {
  total: 42,
  songs: LIKED.slice(0, 40).flatMap((song, position) => (isTagged(position) ? [{
    track: { uri: song.uri, name: song.name, artists: song.artists, album: { name: "Album", images: song.album.images }, duration_ms: 200_000 },
    tags: othersOf(position).tags, people: othersOf(position).people, peopleCapped: false,
  }] : [])),
};

const PLAYLISTS = [
  { playlistId: "1".repeat(22), playlistName: "Gym", folders: [], owned: true, ownerName: null, songCount: 84 },
  { playlistId: "2".repeat(22), playlistName: "Late night drives", folders: [{ id: "moods", name: "Moods" }], owned: true, ownerName: null, songCount: 212 },
  { playlistId: "3".repeat(22), playlistName: "Rainy Sunday", folders: [{ id: "moods", name: "Moods" }], owned: true, ownerName: null, songCount: 57 },
  { playlistId: "4".repeat(22), playlistName: "Warm-up", folders: [{ id: "dj", name: "DJ sets" }, { id: "dj-2026", name: "2026" }], owned: true, ownerName: null, songCount: 140 },
  { playlistId: "5".repeat(22), playlistName: "Peak time", folders: [{ id: "dj", name: "DJ sets" }, { id: "dj-2026", name: "2026" }], owned: true, ownerName: null, songCount: 96 },
];

function Fixture() {
  const filters = useFilterState("tracks");
  const [log, setLog] = useState<string[]>([]);
  const note = (entry: string) => setLog((current) => [...current, entry]);
  // Members' tags go on and come off the song here, as the app does through the editor.
  const [library, setLibrary] = useState({ tracks, taxonomy });
  const [activeUri, setActiveUri] = useState<string | null>(null);
  useEffect(() => {
    for (const name of (startFilter ?? "").split(",").filter(Boolean)) filters.toggleBasicTagFilter(tagId(name.toLowerCase()));
  }, []);
  const toggle = async (match: { track: { uri: string; name: string; artists: { name: string }[] } }, tag: { label: string }, on: boolean) => {
    note(`${on ? "add" : "remove"} ${tag.label} ${on ? "to" : "from"} ${match.track.name}`);
    setActiveUri(match.track.uri);
    setLibrary((current) => {
      const tagsById = { ...current.taxonomy.tagsById };
      let id = Object.values(tagsById).find((item) => item.name.toLowerCase() === tag.label.toLowerCase())?.id;
      if (!id) { id = `tried-${tag.label}`; tagsById[id] = { id, name: tag.label } as never; }
      const track = current.tracks[match.track.uri] ?? { name: match.track.name, artists: match.track.artists.map((artist) => artist.name).join(", "), rating: 0, energy: 0, tagIds: [] };
      const tagIds = on ? [...new Set([...(track.tagIds ?? []), id])] : (track.tagIds ?? []).filter((item) => item !== id);
      return { taxonomy: { ...current.taxonomy, tagsById }, tracks: { ...current.tracks, [match.track.uri]: { ...track, tagIds } as TrackData } };
    });
  };
  return (
    <main style={{ margin: "0 auto", padding: "16px 24px" }}>
      <TrackList tracks={tracks} taxonomy={taxonomy} includeTagClauses={filters.includeTagClauses} clauseConnectors={filters.clauseConnectors} activeTagFilters={filters.activeTagFilters} excludedTagFilters={filters.excludedTagFilters} selectedClauseIndex={filters.selectedClauseIndex} activeTrackUri={activeUri}
        onAddIncludeClause={filters.addIncludeClause} onRemoveIncludeClause={filters.removeIncludeClause} onSelectClause={filters.setSelectedClauseIndex} onSetIncludeClauseOperator={filters.setIncludeClauseOperator} onSetClauseConnector={filters.setClauseConnector} onRemoveTagFilter={filters.removeTagFilter} onToggleTagIncludeOff={filters.toggleTagIncludeOff} onMoveTagToClauseLane={filters.moveTagToClauseLane} onReplaceTagFilterFormula={filters.replaceTagFilterFormula} onPlayTrack={(uri) => note(`play ${uri}`)} onTagTrack={(uri) => { note(`tag ${uri}`); setActiveUri(uri); }} onClearTagFilters={filters.clearTagFilters}
        onCreatePlaylist={async () => null} onCreateSmartPlaylist={async () => {}} smartPlaylists={[]} onSetSmartPlaylists={async () => {}} onSyncPlaylist={async () => {}} onExportSmartPlaylists={() => {}} onImportSmartPlaylists={async () => ({ importedCount: 0, relinkedCount: 0, unresolvedCount: 0, verificationUnavailable: false })}
        onAddCommunityTags={async (uri, tags) => note(`add ${tags.map((tag) => tag.label).join(", ")} to ${uri}`)}
        taggedByOthersView={off ? undefined : (
          <TaggedByOthersSection inTrackList connected={connected} accountId={connected ? ACCOUNT : null} preview={connected ? undefined : preview} tracks={library.tracks} taxonomy={library.taxonomy} onConnectCommunity={() => note("connect")}
            onAddMembersTags={async (match, tags) => note(`add ${tags.map((tag) => tag.label).join(", ")} to ${match.track.name}`)}
            onToggleTag={toggle} onLockSong={(match) => { note(`lock ${match.track.name}`); setActiveUri(match.track.uri); }} activeUri={activeUri}
            onPlaySong={(uri) => note(`play ${uri}`)} ratingOf={(uri) => library.tracks[uri]?.rating ?? 0}
            listPlaylists={async () => PLAYLISTS}
            sharingLocked={!shared} onShareTags={() => note("share")} />
        )}
        othersTagsLocked={connected && !off && !shared}
        onShareTags={() => note("share")}
        communityTagSearch={layout ? { viewer: `${connected ? "me" : "signed-out"}:${shared ? "sharing" : "not-sharing"}`, onConnect: () => note("connect"), onShare: () => note("share"), onPlay: (uri) => note(`play ${uri}`) } : undefined}
        communityTeaser={connected ? undefined : { others: teaserOthers, onConnect: () => note("connect") }}
      />
      <output aria-label="Fixture log" hidden>{JSON.stringify(log)}</output>
    </main>
  );
}
// &keep=1 keeps the check saved by an earlier load, like reopening Spotify.
void (params.get("keep") === "1" ? Promise.resolve() : taggedByOthersStore.clear()).then(() => createRoot(document.getElementById("app")!).render(<Fixture />));
