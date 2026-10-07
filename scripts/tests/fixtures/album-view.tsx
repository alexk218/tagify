import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
// eslint-disable-next-line css-modules/no-unused-class -- the example reuses only Tagify's layout classes
import appStyles from "../../../src/app.module.css";
import "../../../src/styles/globals.css";
import {
  buildAlbumTrackSummaries,
  PlaylistDetails,
  TaggedPlaylistsList,
} from "../../../src/features/playlist-state";
import { TagSelector } from "../../../src/features/tag-data";
import { TrackDetails } from "../../../src/features/track-session";
import { spotifyService } from "../../../src/services/SpotifyService";
import { audioFeaturesService } from "../../../src/services/AudioFeaturesService";
import { createInitialTrackData, withRating } from "../../../src/features/tag-data/utils/tagData.trackMutations";
import { isTrackEmpty } from "../../../src/features/tag-data/utils/tagData.helpers";
import type { SpotifyTrack } from "../../../src/types/SpotifyTypes";
import type { PlaylistMetadata, TrackMetadata } from "../../../src/features/tag-data";
import { spotifyApiService } from "../../../src/services/SpotifyApiService";
import { useFilterState } from "../../../src/features/filter-state";
import {
  createInitialPlaylistData,
  withPlaylistEnergy,
  withPlaylistRating,
  withToggledPlaylistTag,
} from "../../../src/features/tag-data/utils/tagData.playlistMutations";
import { buildCategoryTree, buildTaxonomyFromCategoryTree } from "../../../src/utils/tagTaxonomy";
import { applyBatchTagUpdatesToData } from "../../../src/features/tag-data/utils/tagData.batchUpdates";
import type { BatchTagUpdate, PlaylistData, TrackData } from "../../../src/types/tagData";

// Isolated example library for reviewing the Albums view with production components.
const taxonomy = buildTaxonomyFromCategoryTree([
  {
    id: "cat_genre",
    name: "Genre",
    subcategories: [
      {
        id: "sub_styles",
        name: "Styles",
        tags: [
          { id: "tag_house", name: "House" },
          { id: "tag_techno", name: "Techno" },
          { id: "tag_ambient", name: "Ambient" },
          { id: "tag_jazz", name: "Jazz" },
          { id: "tag_disco", name: "Disco" },
        ],
      },
    ],
  },
  {
    id: "cat_mood",
    name: "Mood",
    subcategories: [
      {
        id: "sub_feel",
        name: "Feel",
        tags: [
          { id: "tag_euphoric", name: "Euphoric" },
          { id: "tag_chill", name: "Chill" },
          { id: "tag_dark", name: "Dark" },
          { id: "tag_melancholic", name: "Melancholic" },
        ],
      },
    ],
  },
  {
    id: "cat_context",
    name: "Context",
    subcategories: [
      {
        id: "sub_moments",
        name: "Moments",
        tags: [
          { id: "tag_workout", name: "Workout" },
          { id: "tag_focus", name: "Focus" },
          { id: "tag_night-drive", name: "Night drive" },
        ],
      },
    ],
  },
]);
taxonomy.tagsById.tag_house.accentId = "blue";
taxonomy.tagsById.tag_euphoric.accentId = "amber";
taxonomy.tagsById.tag_dark.accentId = "rose";

function cover(from: string, to: string, label: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/><text x="24" y="270" font-family="Helvetica,Arial" font-size="40" font-weight="700" fill="rgba(255,255,255,0.85)">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

interface CatalogAlbum {
  name: string;
  artist: string;
  imageUrl: string;
  released: string;
  trackNames: string[];
}

const catalog: Record<string, CatalogAlbum> = {
  "spotify:album:4glassHorizons00000000": {
    name: "Glass Horizons",
    artist: "Maya Fields",
    imageUrl: cover("#1e3a8a", "#f472b6", "GH"),
    released: "2021-05-07",
    trackNames: [
      "Opening Lights", "Paper Planes", "Glass Horizons", "Slow Tide", "Northbound",
      "Halcyon", "Mirrors", "Static Bloom", "Overpass", "Weightless", "Signal Fire",
      "Low Sun", "Home Again",
    ],
  },
  "spotify:album:machines": {
    name: "Quiet Machines",
    artist: "Low Orbit",
    imageUrl: cover("#0f172a", "#14b8a6", "QM"),
    released: "1992-02-12",
    trackNames: [
      "Hum", "Tin Garden", "Coolant", "Relay", "Cathode", "Idle Loop",
      "Soft Reset", "Fieldnotes", "Carrier", "Breathe Out", "Clockwork", "Sleep Mode",
    ],
  },
  "spotify:album:bluehour": {
    name: "Blue Hour Sessions",
    artist: "The Ellis Quintet",
    imageUrl: cover("#172554", "#60a5fa", "BH"),
    released: "1959-08-17",
    trackNames: ["So It Goes", "Freddie's Walk", "Blue Hour", "All Night", "Flamingo Sketch", "Coda"],
  },
  "spotify:album:afterglow": {
    name: "Afterglow Disco",
    artist: "Neon Harbor",
    imageUrl: cover("#7c2d12", "#facc15", "AD"),
    released: "2001-03-12",
    trackNames: [
      "One More Round", "Brighter", "Digital Love Song", "Harder Faster", "Crescent",
      "Night Vision", "Superheroes", "High Life", "Something", "Voyage",
      "Veridis", "Short Circuit", "Face to Face", "Too Long",
    ],
  },
  "spotify:album:rain": {
    name: "Rain Over Sublets",
    artist: "Hollow Choir",
    imageUrl: cover("#111827", "#6b7280", "RS"),
    released: "2007-11-05",
    trackNames: [
      "Untold", "Archangels", "Near Dark", "Ghost Hardware", "Endorphin",
      "Etched", "Raver", "Shell", "In McDonalds", "Untrue", "Homeless",
    ],
  },
  "spotify:album:moons": {
    name: "Paper Moons",
    artist: "Juno Park",
    imageUrl: cover("#4c1d95", "#f0abfc", "PM"),
    released: "2024-09-20",
    trackNames: ["Paper Moons"],
  },
};

function albumTrackUris(albumUri: string): string[] {
  const albumId = albumUri.split(":").pop();
  return catalog[albumUri].trackNames.map((_, index) => `spotify:track:${albumId}${index + 1}`);
}

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

function track(
  albumUri: string,
  index: number,
  values: Partial<TrackData>,
): [string, TrackData] {
  const album = catalog[albumUri];
  return [
    albumTrackUris(albumUri)[index],
    {
      rating: 0,
      energy: 0,
      bpm: null,
      name: album.trackNames[index],
      artists: album.artist,
      albumName: album.name,
      albumUri,
      albumImageUrl: album.imageUrl,
      dateCreated: now - 20 * DAY,
      dateModified: now - 2 * DAY,
      ...values,
      tagIds: (values.tagIds || []).map((tagId) => `tag_${tagId}`),
    },
  ];
}

const initialTracks: Record<string, TrackData> = Object.fromEntries([
  track("spotify:album:4glassHorizons00000000", 0, { rating: 4, energy: 5, tagIds: ["house", "chill"] }),
  track("spotify:album:4glassHorizons00000000", 1, { rating: 4.5, energy: 7, tagIds: ["house", "euphoric"] }),
  track("spotify:album:4glassHorizons00000000", 2, { rating: 5, energy: 8, tagIds: ["house", "euphoric", "night-drive"] }),
  track("spotify:album:4glassHorizons00000000", 3, { rating: 3.5, energy: 4, tagIds: ["chill"] }),
  track("spotify:album:4glassHorizons00000000", 4, { rating: 4, energy: 7, tagIds: ["house"] }),
  track("spotify:album:4glassHorizons00000000", 5, { rating: 3, energy: 0, tagIds: [] }),
  track("spotify:album:4glassHorizons00000000", 6, { rating: 4.5, energy: 6, tagIds: ["euphoric", "workout"] }),
  track("spotify:album:4glassHorizons00000000", 8, { rating: 0, energy: 6, tagIds: ["house", "night-drive"] }),
  track("spotify:album:4glassHorizons00000000", 10, { rating: 5, energy: 9, tagIds: ["house", "euphoric", "workout"] }),
  track("spotify:album:machines", 0, { rating: 4.5, energy: 2, tagIds: ["ambient", "focus"] }),
  track("spotify:album:machines", 2, { rating: 4, energy: 3, tagIds: ["ambient", "focus"] }),
  track("spotify:album:machines", 3, { rating: 5, energy: 3, tagIds: ["ambient", "techno"] }),
  track("spotify:album:machines", 6, { rating: 3.5, energy: 2, tagIds: ["ambient", "melancholic"] }),
  track("spotify:album:machines", 9, { rating: 4, energy: 1, tagIds: ["ambient", "chill", "focus"] }),
  ...catalog["spotify:album:afterglow"].trackNames.map((_, index) =>
    track("spotify:album:afterglow", index, {
      rating: [4, 5, 4.5, 4, 3, 3.5, 4, 4, 3.5, 3, 4, 3, 4.5, 4][index],
      energy: [8, 9, 7, 9, 6, 7, 9, 8, 6, 5, 7, 6, 7, 8][index],
      tagIds: index % 3 === 0 ? ["disco", "euphoric"] : ["disco"],
    }),
  ),
  track("spotify:album:rain", 2, { rating: 4.5, energy: 4, tagIds: ["dark", "night-drive"] }),
  track("spotify:album:rain", 9, { rating: 5, energy: 5, tagIds: ["dark", "melancholic"] }),
  track("spotify:album:moons", 0, { rating: 4, energy: 6, tagIds: ["chill"] }),
]);

function albumData(albumUri: string, values: Partial<PlaylistData>): [string, PlaylistData] {
  const album = catalog[albumUri];
  return [
    albumUri,
    {
      rating: 0,
      energy: 0,
      name: album.name,
      ownerName: album.artist,
      imageUrl: album.imageUrl,
      description: `Released ${album.released}`,
      trackCount: album.trackNames.length,
      snapshotId: null,
      dateCreated: now - 10 * DAY,
      dateModified: now - DAY,
      ...values,
      tagIds: (values.tagIds || []).map((tagId) => `tag_${tagId}`),
    },
  ];
}

const initialPlaylists: Record<string, PlaylistData> = Object.fromEntries([
  albumData("spotify:album:4glassHorizons00000000", { rating: 4.5, energy: 7, tagIds: ["house", "euphoric"], dateModified: now - 3 * 60 * 60 * 1000 }),
  // Rated before its length was known, like albums tagged while Spotify's Web API was throttled.
  albumData("spotify:album:bluehour", { rating: 5, energy: 0, tagIds: ["jazz", "night-drive"], trackCount: null, dateModified: now - 4 * DAY }),
  albumData("spotify:album:afterglow", { rating: 0, energy: 0, tagIds: ["disco"], dateModified: now - 6 * DAY }),
  [
    "spotify:playlist:roadtrip",
    {
      rating: 4,
      energy: 8,
      tagIds: ["tag_night-drive", "tag_euphoric"],
      name: "Road Trip Mix",
      ownerName: "Alex",
      imageUrl: cover("#065f46", "#a3e635", "RT"),
      description: "Windows down, volume up.",
      trackCount: 6,
      dateCreated: now - 12 * DAY,
      dateModified: now - 5 * DAY,
    },
  ],
]);
const roadTripTrackUris = [
  ...albumTrackUris("spotify:album:4glassHorizons00000000").slice(0, 3),
  ...albumTrackUris("spotify:album:afterglow").slice(0, 3),
];

let notificationTimer = 0;
function showNotification(message: string, isError = false) {
  const element = document.getElementById("notification");
  if (!element) return;
  element.textContent = message;
  element.dataset.error = String(isError);
  element.hidden = false;
  window.clearTimeout(notificationTimer);
  notificationTimer = window.setTimeout(() => {
    element.hidden = true;
  }, 4000);
}

const params = new URLSearchParams(window.location.search);
const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const albumLookups: string[] = [];

// Spotify's internal album answer, in the shape the current client receives
// (track counts live under tracksV2, not the older tracks field).
async function requestGraphQL(
  definition: { name: string },
  variables: { uri?: string; offset?: number; limit?: number },
) {
  if (params.has("slow")) await pause(600);
  if (params.has("spotifyDown")) throw new Error("Spotify unavailable");
  const album = variables.uri ? catalog[variables.uri] : undefined;
  if (!album || definition.name !== "getAlbum") {
    return { data: { albumUnion: { __typename: "NotFound" } } };
  }
  albumLookups.push(`graphql ${variables.uri}`);
  return {
    data: {
      albumUnion: {
        __typename: "Album",
        uri: variables.uri,
        name: album.name,
        artists: { items: [{ profile: { name: album.artist } }] },
        coverArt: { sources: [{ url: album.imageUrl }] },
        date: { isoString: `${album.released}T00:00:00Z`, year: Number(album.released.slice(0, 4)) },
        discs: { items: [{ number: 1, tracks: { totalCount: album.trackNames.length } }] },
        tracksV2: {
          totalCount: album.trackNames.length,
          items: albumTrackUris(variables.uri!)
            .map((uri, index) => ({
              uid: `uid-${index}`,
              track: {
                uri,
                name: album.trackNames[index],
                trackNumber: index + 1,
                discNumber: 1,
                artists: { items: [{ uri: "spotify:artist:example", profile: { name: album.artist } }] },
                duration: { totalMilliseconds: 225_000 },
                playability: { playable: true },
              },
            }))
            .slice(variables.offset ?? 0, (variables.offset ?? 0) + (variables.limit ?? 50)),
        },
      },
    },
  };
}

Object.assign(globalThis, {
  Spicetify: {
    showNotification,
    Locale: { getLocale: () => "en" },
    GraphQL: {
      Definitions: {
        getAlbum: { name: "getAlbum" },
        getAlbumNameAndTracks: { name: "getAlbumNameAndTracks" },
      },
      Request: requestGraphQL,
    },
    Platform: {
      History: { push: (path: string) => showNotification(`Opened ${path} in Spotify`) },
      PlaylistAPI: {},
      AuthorizationAPI: { getState: () => ({ token: { accessToken: "example-token" } }) },
    },
  },
});
// Inspection hooks for reviewing the example in a browser.
const fixtureWindow = window as Window & {
  albumLookups?: typeof albumLookups;
  albumFixture?: { tracks: Record<string, TrackData>; playlists: Record<string, PlaylistData> };
};
fixtureWindow.albumLookups = albumLookups;
const nativeFetch = window.fetch.bind(window);
// Spotify throttles the public Web API for the desktop client's token, so it
// answers 429 here unless ?webApi=up is given. Add ?slow to watch lookups, or
// ?spotifyDown to make Spotify's own client API fail too.
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith("https://community.tagify.fm")) {
    return new Response("{}", { status: 404 });
  }
  if (url.startsWith("https://api.spotify.com/")) {
    albumLookups.push(`webapi ${url.replace("https://api.spotify.com", "")}`);
    if (params.get("webApi") !== "up") {
      return new Response("", { status: 429, headers: { "Retry-After": "30" } });
    }
  }
  if (url.startsWith("https://api.spotify.com/v1/albums?ids=")) {
    if (params.has("slow")) await pause(1500);
    const ids = new URL(url).searchParams.get("ids")!.split(",");
    const albums = ids.map((id) => {
      const album = catalog[`spotify:album:${id}`];
      return album ? { id, total_tracks: album.trackNames.length } : null;
    });
    return new Response(JSON.stringify({ albums }), { status: 200 });
  }
  return nativeFetch(input, init);
};

type FixtureView = "tracks" | "albums" | "playlists";
const EMPTY_TRACK_DATA = { rating: 0, energy: 0, bpm: null, camelotKey: null, tagIds: [] };
const playableTrackUris = Object.keys(catalog)
  .filter((albumUri) => albumUri.startsWith("spotify:album:"))
  .flatMap((albumUri) => albumTrackUris(albumUri));

function getCatalogTrack(trackUri: string): SpotifyTrack {
  const albumUri = Object.keys(catalog).find((uri) => albumTrackUris(uri).includes(trackUri))!;
  const album = catalog[albumUri];
  const index = albumTrackUris(albumUri).indexOf(trackUri);
  return {
    uri: trackUri,
    name: album.trackNames[index],
    artists: [{ name: album.artist }],
    album: { name: album.name, uri: albumUri, images: [{ url: album.imageUrl }] },
    duration_ms: 225_000,
  };
}

spotifyService.getTrackMetadata = async (trackUri: string) => {
  const track = getCatalogTrack(trackUri);
  return {
    releaseDate: catalog[track.album.uri!].released,
    trackLength: "3:45",
    playCount: 1_204_331,
    albumCoverUrl: track.album.images?.[0]?.url ?? null,
    genres: [],
  };
};
audioFeaturesService.getAudioFeaturesFromUri = async () => ({
  bpm: 122,
  key: "A",
  mode: 0,
  camelotKey: "8A",
});

function FixtureApp() {
  const [view, setView] = useState<FixtureView>(() => {
    const requestedView = params.get("view");
    return requestedView === "tracks" || requestedView === "playlists" ? requestedView : "albums";
  });
  const [tracks, setTracks] = useState(initialTracks);
  const [playlists, setPlaylists] = useState(initialPlaylists);
  const entityType = view === "playlists" ? "playlist" : "album";
  const [activeAlbumUri, setActiveAlbumUri] = useState<string | null>(
    () => params.get("album") ?? "spotify:album:4glassHorizons00000000",
  );
  const [displayedTrackUri, setDisplayedTrackUri] = useState(
    () => params.get("track") ?? albumTrackUris("spotify:album:4glassHorizons00000000")[7],
  );
  const activeUri = view === "playlists" ? "spotify:playlist:roadtrip" : activeAlbumUri;
  const albumFilters = useFilterState("albums");
  const playlistFilters = useFilterState("playlists");
  const trackFilters = useFilterState("tracks");
  const filters = view === "playlists" ? playlistFilters : albumFilters;
  const categoryTree = useMemo(() => buildCategoryTree(taxonomy), []);
  const albumTrackSummaries = useMemo(() => buildAlbumTrackSummaries(tracks, taxonomy), [tracks]);
  const activeEntityData = activeUri ? playlists[activeUri] : undefined;
  const activeCatalogAlbum = activeUri ? catalog[activeUri] : undefined;
  const isAlbumSelected = Boolean(activeUri?.startsWith("spotify:album:"));
  const [activeAlbumMetadata, setActiveAlbumMetadata] = useState<PlaylistMetadata | null>(null);
  const hasSavedDetails = Boolean(activeUri && playlists[activeUri]?.name);

  // Like Tagify, albums without saved details are looked up through Spotify.
  useEffect(() => {
    setActiveAlbumMetadata(null);
    if (!activeUri || !activeCatalogAlbum || hasSavedDetails) return;
    let isCurrent = true;
    void spotifyApiService.getPlaylistMetadata(activeUri).then((metadata) => {
      if (isCurrent && metadata) setActiveAlbumMetadata(metadata);
    });
    return () => {
      isCurrent = false;
    };
  }, [activeUri, activeCatalogAlbum, hasSavedDetails]);
  const displayedTrack = getCatalogTrack(displayedTrackUri);
  const displayedAlbumUri = displayedTrack.album.uri!;
  const displayedTrackMetadata = {
    name: displayedTrack.name,
    artists: displayedTrack.artists.map((artist) => artist.name).join(", "),
    albumName: displayedTrack.album.name,
    albumUri: displayedAlbumUri,
    albumImageUrl: displayedTrack.album.images?.[0]?.url ?? null,
  };

  useEffect(() => {
    fixtureWindow.albumFixture = { tracks, playlists };
  }, [playlists, tracks]);

  const updateActiveEntity = (update: (entity: PlaylistData) => PlaylistData) => {
    if (!activeUri) return;
    setPlaylists((current) => ({
      ...current,
      [activeUri]: update(
        current[activeUri] || createInitialPlaylistData(Date.now(), activeAlbumMetadata),
      ),
    }));
  };

  // Mirrors Tagify: tagging a new track saves its album so it counts at once.
  const updateDisplayedTrack = (update: (track: TrackData) => TrackData) => {
    setTracks((current) => {
      const now = Date.now();
      const existing = current[displayedTrackUri] || createInitialTrackData(now, 122, displayedTrackMetadata, "8A");
      const next = { ...update(existing), dateModified: now };
      const nextTracks = { ...current, [displayedTrackUri]: next };
      if (isTrackEmpty(next)) {
        delete nextTracks[displayedTrackUri];
      }
      return nextTracks;
    });
  };

  // Mirrors Tagify: a new track is saved with its album after its details load.
  const rateTrack = (trackUri: string, rating: number, metadata: TrackMetadata) => {
    const save = () =>
      setTracks((current) => {
        const now = Date.now();
        const next = withRating(
          current[trackUri] || createInitialTrackData(now, null, metadata, null),
          rating,
          now,
        );
        const nextTracks = { ...current, [trackUri]: next };
        if (isTrackEmpty(next)) {
          delete nextTracks[trackUri];
        }
        return nextTracks;
      });
    if (tracks[trackUri]) save();
    else setTimeout(save, 350);
  };

  const loadTrackUris = async (uri: string) => {
    await new Promise((resolve) => setTimeout(resolve, params.has("slow") ? 1500 : 300));
    if (params.has("failTracks")) throw new Error("Spotify unavailable");
    return uri.startsWith("spotify:playlist:") ? roadTripTrackUris : albumTrackUris(uri);
  };

  const applyTrackUpdates = async (updates: BatchTagUpdate[]) => {
    setTracks((current) =>
      applyBatchTagUpdatesToData(
        { schemaVersion: 9, taxonomy, tracks: current, playlists: {}, artists: {} },
        updates,
        Date.now(),
      ).nextData.tracks,
    );
  };

  const stepTrack = (offset: number) => {
    const index = playableTrackUris.indexOf(displayedTrackUri);
    setDisplayedTrackUri(
      playableTrackUris[(index + offset + playableTrackUris.length) % playableTrackUris.length],
    );
  };

  return (
    <>
      {view === "tracks" ? (
        <div className="fixtureBar">
          <button onClick={() => stepTrack(-1)}>◀ Previous</button>
          <span>
            Example player: {displayedTrack.album.name} · track{" "}
            {albumTrackUris(displayedAlbumUri).indexOf(displayedTrackUri) + 1}
          </span>
          <button onClick={() => stepTrack(1)}>Next ▶</button>
        </div>
      ) : null}
      <div className={appStyles.container}>
        <div className={appStyles.header}>
          <div className={appStyles.titleArea}>
            <h1 className={appStyles.title}>Tagify</h1>
          </div>
          <div className={appStyles.viewTabs} role="tablist" aria-label="Tagify views">
            {(["tracks", "albums", "playlists"] as const).map((tabView) => (
              <button
                key={tabView}
                className={`${appStyles.viewTab} ${view === tabView ? appStyles.viewTabActive : ""}`}
                role="tab"
                aria-selected={view === tabView}
                onClick={() => setView(tabView)}
              >
                {tabView[0].toUpperCase() + tabView.slice(1)}
              </button>
            ))}
            <button className={appStyles.viewTab} role="tab" aria-selected={false} disabled>
              Artists
            </button>
          </div>
          <span />
        </div>
        <div className={appStyles.content}>
          {view === "tracks" ? (
            <>
              <TrackDetails
                displayedTrack={displayedTrack}
                currentlyPlayingTrack={displayedTrack}
                trackData={tracks[displayedTrackUri] || EMPTY_TRACK_DATA}
                taxonomy={taxonomy}
                activeTagFilters={trackFilters.activeTagFilters}
                excludedTagFilters={trackFilters.excludedTagFilters}
                onSetRating={(rating) => updateDisplayedTrack((track) => ({ ...track, rating }))}
                onSetEnergy={(energy) => updateDisplayedTrack((track) => ({ ...track, energy }))}
                onSetBpm={() => undefined}
                onSetCamelotKey={() => undefined}
                onRemoveTag={(tagId) =>
                  updateDisplayedTrack((track) => ({
                    ...track,
                    tagIds: track.tagIds.filter((id) => id !== tagId),
                  }))
                }
                onToggleTagIncludeOff={trackFilters.toggleTagIncludeOff}
                onPlayTrack={(uri) => showNotification(`Playing ${uri}`)}
                isLocked={false}
                onToggleLock={() => undefined}
                onSwitchToCurrentTrack={() => undefined}
                onUpdateBpm={async () => 122}
                albumProgress={{
                  albumUri: displayedAlbumUri,
                  taggedTrackCount: albumTrackSummaries.get(displayedAlbumUri)?.taggedTrackCount ?? 0,
                  knownTrackCount: playlists[displayedAlbumUri]?.trackCount ?? null,
                }}
              />
              <TagSelector
                categories={categoryTree}
                customAccentsById={taxonomy.customAccentsById}
                selectedTagIds={tracks[displayedTrackUri]?.tagIds || []}
                onToggleTag={(tagId) =>
                  updateDisplayedTrack((track) => ({
                    ...track,
                    tagIds: track.tagIds.includes(tagId)
                      ? track.tagIds.filter((id) => id !== tagId)
                      : [...track.tagIds, tagId],
                  }))
                }
                onOpenTagManager={() => showNotification("Tag Manager is not part of this example")}
                targetType="track"
                isMultiTagging={false}
                isLockedTrack={false}
              />
            </>
          ) : (
            <>
              {activeUri ? (
                <>
                  <PlaylistDetails
                    playlistUri={activeUri}
                    playlistData={activeEntityData}
                    playlistMetadata={activeAlbumMetadata}
                    albumTrackSummary={isAlbumSelected ? albumTrackSummaries.get(activeUri) : undefined}
                    tracks={tracks}
                    taxonomy={taxonomy}
                    activeTagFilters={filters.activeTagFilters}
                    excludedTagFilters={filters.excludedTagFilters}
                    onSetRating={(rating) => updateActiveEntity((entity) => withPlaylistRating(entity, rating, Date.now()))}
                    onSetEnergy={(energy) => updateActiveEntity((entity) => withPlaylistEnergy(entity, energy, Date.now()))}
                    onRemoveTag={(tagId) => updateActiveEntity((entity) => withToggledPlaylistTag(entity, tagId, Date.now()))}
                    onToggleTagIncludeOff={filters.toggleBasicTagFilter}
                    onOpenPlaylist={(uri) => showNotification(`Opened ${uri} in Spotify`)}
                    onRefreshMetadata={() => undefined}
                    onLoadTrackUris={loadTrackUris}
                    onApplyTrackUpdates={applyTrackUpdates}
                    onTagTrack={(trackUri) => {
                      setDisplayedTrackUri(trackUri);
                      setView("tracks");
                    }}
                    onSetTrackRating={rateTrack}
                  />
                  <TagSelector
                    categories={categoryTree}
                    customAccentsById={taxonomy.customAccentsById}
                    selectedTagIds={activeEntityData?.tagIds || []}
                    onToggleTag={(tagId) => updateActiveEntity((entity) => withToggledPlaylistTag(entity, tagId, Date.now()))}
                    onOpenTagManager={() => showNotification("Tag Manager is not part of this example")}
                    targetType={entityType}
                    isMultiTagging={false}
                    isLockedTrack={false}
                  />
                </>
              ) : null}
              <TaggedPlaylistsList
                playlists={playlists}
                tracks={tracks}
                albumTrackSummaries={albumTrackSummaries}
                entityType={entityType}
                taxonomy={taxonomy}
                includeTagClauses={filters.includeTagClauses}
                clauseConnectors={filters.clauseConnectors}
                activeTagFilters={filters.activeTagFilters}
                excludedTagFilters={filters.excludedTagFilters}
                activePlaylistUri={activeUri}
                onSelectPlaylist={(uri) => (view === "playlists" ? undefined : setActiveAlbumUri(uri))}
                onOpenPlaylist={(uri) => showNotification(`Opened ${uri} in Spotify`)}
                onCycleTagFilter={filters.cycleTagIncludeExcludeOff}
                onToggleTagFilter={filters.toggleBasicTagFilter}
                onRemoveTagFilter={filters.removeTagFilter}
                onSetTagFilterOperator={(operator) => filters.setIncludeClauseOperator(0, operator)}
                onClearTagFilters={filters.clearTagFilters}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}

if (params.has("reset")) {
  window.localStorage.clear();
}
createRoot(document.getElementById("app")!).render(<FixtureApp />);
