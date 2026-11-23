// @vitest-environment node
import { describe, expect, it } from "vitest";
import { filterTrackEntries, listedTaggedTrackEntries } from "@/features/track-session/utils/trackList.logic";
import type {
  TrackListEntry,
  TrackListFilterInputs,
} from "@/features/track-session/model/trackList.types";

const trackEntries: TrackListEntry[] = [
  [
    "spotify:track:pop-sfw",
    {
      rating: 4,
      energy: 6,
      bpm: 120,
      tagIds: ["tag_pop", "tag_sfw"],
      name: "Pop Song",
      artists: "Artist One",
    },
  ],
  [
    "spotify:track:rock-sfw",
    {
      rating: 5,
      energy: 7,
      bpm: 124,
      tagIds: ["tag_rock", "tag_sfw"],
      name: "Rock Song",
      artists: "Artist Two",
    },
  ],
  [
    "spotify:track:rock-nsfw",
    {
      rating: 3,
      energy: 7,
      bpm: 126,
      tagIds: ["tag_rock", "tag_nsfw"],
      name: "Rock After Dark",
      artists: "Artist Three",
    },
  ],
];

const trackInfo = {
  "spotify:track:pop-sfw": {
    name: "Pop Song",
    artists: "Artist One",
  },
  "spotify:track:rock-sfw": {
    name: "Rock Song",
    artists: "Artist Two",
  },
  "spotify:track:rock-nsfw": {
    name: "Rock After Dark",
    artists: "Artist Three",
  },
};

function createFilterInputs(overrides: Partial<TrackListFilterInputs> = {}) {
  return {
    includeTagClauses: [],
    clauseConnectors: [],
    ratingFilters: [],
    energyMinFilter: null,
    energyMaxFilter: null,
    bpmMinFilter: null,
    bpmMaxFilter: null,
    normalizedCamelotKeyFilters: [],
    searchTerm: "",
    ...overrides,
  };
}

describe("filterTrackEntries", () => {
  it("returns all tracks when filters are empty", () => {
    expect(
      filterTrackEntries(trackEntries, trackInfo, createFilterInputs(), null),
    ).toHaveLength(3);
  });

  it("matches single-clause AND logic", () => {
    const filtered = filterTrackEntries(
      trackEntries,
      trackInfo,
      createFilterInputs({
        includeTagClauses: [
          {
            tagIds: ["tag_rock", "tag_sfw"],
            excludedTagIds: [],
            operator: "AND",
          },
        ],
      }), null,
    );

    expect(filtered.map(([uri]) => uri)).toEqual(["spotify:track:rock-sfw"]);
  });

  it("supports OR groups within AND logic", () => {
    const filtered = filterTrackEntries(
      trackEntries,
      trackInfo,
      createFilterInputs({
        includeTagClauses: [
          {
            tagIds: ["tag_pop", "tag_rock"],
            excludedTagIds: [],
            operator: "OR",
          },
          {
            tagIds: ["tag_sfw"],
            excludedTagIds: [],
            operator: "AND",
          },
        ],
        clauseConnectors: ["AND"],
      }), null,
    );

    expect(filtered.map(([uri]) => uri)).toEqual([
      "spotify:track:pop-sfw",
      "spotify:track:rock-sfw",
    ]);
  });

  it("applies clause-local NOT tags during matching", () => {
    const filtered = filterTrackEntries(
      trackEntries,
      trackInfo,
      createFilterInputs({
        includeTagClauses: [
          {
            tagIds: ["tag_pop", "tag_rock"],
            excludedTagIds: ["tag_nsfw"],
            operator: "OR",
          },
        ],
      }), null,
    );

    expect(filtered.map(([uri]) => uri)).toEqual([
      "spotify:track:pop-sfw",
      "spotify:track:rock-sfw",
    ]);
  });
});

describe("listedTaggedTrackEntries", () => {
  it("lists songs with a rating, energy or tag and leaves out linked releases with nothing on them", () => {
    const blank = { rating: 0, energy: 0, bpm: null, tagIds: [] };
    const entries: TrackListEntry[] = [
      ["spotify:track:rated", { ...blank, rating: 2 }],
      ["spotify:track:energy", { ...blank, energy: 5 }],
      ["spotify:track:tagged", { ...blank, tagIds: ["tag_pop"] }],
      ["spotify:track:linked-cleared", { ...blank, bpm: 120, recordingGroupId: "group-1", recordingGroupConfirmed: true }],
      ["spotify:track:unlinked-cleared", { ...blank, recordingReuseDisabled: true }],
    ];

    expect(listedTaggedTrackEntries(entries).map(([uri]) => uri)).toEqual([
      "spotify:track:rated",
      "spotify:track:energy",
      "spotify:track:tagged",
    ]);
  });
});
