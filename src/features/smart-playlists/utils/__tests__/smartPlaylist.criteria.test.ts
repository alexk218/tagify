import { describe, expect, it } from "vitest";
import { TrackData } from "@/types/tagData";
import { SmartPlaylistFilterCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import { evaluateTrackMatchesCriteria } from "../smartPlaylist.criteria";

function createBaseTrack(overrides: Partial<TrackData> = {}): TrackData {
  return {
    rating: 4,
    energy: 7,
    bpm: 126,
    camelotKey: "8A",
    tagIds: ["tag_house", "tag_peak"],
    ...overrides,
  };
}

function createCriteria(
  overrides: Partial<SmartPlaylistFilterCriteria> = {},
): SmartPlaylistFilterCriteria {
  return {
    includeTagClauses: [],
    clauseConnectors: [],
    ratingFilters: [],
    energyMinFilter: null,
    energyMaxFilter: null,
    bpmMinFilter: null,
    bpmMaxFilter: null,
    camelotKeyFilters: [],
    camelotMinFilter: null,
    camelotMaxFilter: null,
    ...overrides,
  };
}

describe("evaluateTrackMatchesCriteria", () => {
  it("matches when all filters are empty", () => {
    const track = createBaseTrack();
    const criteria = createCriteria();

    expect(evaluateTrackMatchesCriteria(track, criteria)).toBe(true);
  });

  it("enforces AND include-tag mode", () => {
    const track = createBaseTrack();
    const criteria = createCriteria({
      includeTagClauses: [
        {
          tagIds: ["tag_house", "tag_peak"],
          excludedTagIds: [],
          operator: "AND",
        },
      ],
    });

    expect(evaluateTrackMatchesCriteria(track, criteria)).toBe(true);

    const missingTagCriteria = createCriteria({
      includeTagClauses: [
        {
          tagIds: ["tag_house", "tag_chill"],
          excludedTagIds: [],
          operator: "AND",
        },
      ],
    });

    expect(evaluateTrackMatchesCriteria(track, missingTagCriteria)).toBe(false);
  });

  it("enforces OR include-tag mode", () => {
    const track = createBaseTrack();
    const criteria = createCriteria({
      includeTagClauses: [
        {
          tagIds: ["tag_house", "tag_techno"],
          excludedTagIds: [],
          operator: "OR",
        },
      ],
    });

    expect(evaluateTrackMatchesCriteria(track, criteria)).toBe(true);

    const noMatchCriteria = createCriteria({
      includeTagClauses: [
        {
          tagIds: ["tag_techno", "tag_chill"],
          excludedTagIds: [],
          operator: "OR",
        },
      ],
    });

    expect(evaluateTrackMatchesCriteria(track, noMatchCriteria)).toBe(false);
  });

  it("supports AND of OR groups", () => {
    const track = createBaseTrack({ tagIds: ["tag_house", "tag_sfw"] });
    const criteria = createCriteria({
      includeTagClauses: [
        {
          tagIds: ["tag_house", "tag_techno"],
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
    });

    expect(evaluateTrackMatchesCriteria(track, criteria)).toBe(true);

    const failingCriteria = createCriteria({
      includeTagClauses: [
        {
          tagIds: ["tag_house", "tag_techno"],
          excludedTagIds: [],
          operator: "OR",
        },
        {
          tagIds: ["tag_peak", "tag_sfw"],
          excludedTagIds: [],
          operator: "AND",
        },
      ],
      clauseConnectors: ["AND"],
    });

    expect(
      evaluateTrackMatchesCriteria(
        createBaseTrack({ tagIds: ["tag_house"] }),
        failingCriteria,
      ),
    ).toBe(false);
  });

  it("supports OR between groups", () => {
    const criteria = createCriteria({
      includeTagClauses: [
        {
          tagIds: ["tag_house"],
          excludedTagIds: [],
          operator: "AND",
        },
        {
          tagIds: ["tag_sfw"],
          excludedTagIds: [],
          operator: "AND",
        },
      ],
      clauseConnectors: ["OR"],
    });

    expect(
      evaluateTrackMatchesCriteria(
        createBaseTrack({ tagIds: ["tag_sfw"] }),
        criteria,
      ),
    ).toBe(true);
  });

  it("rejects tracks with clause-local NOT tags", () => {
    const track = createBaseTrack();
    const criteria = createCriteria({
      includeTagClauses: [
        {
          tagIds: [],
          excludedTagIds: ["tag_peak"],
          operator: "OR",
        },
      ],
    });

    expect(evaluateTrackMatchesCriteria(track, criteria)).toBe(false);
  });

  it("applies rating, energy, and BPM ranges", () => {
    const track = createBaseTrack();
    const passing = createCriteria({
      ratingFilters: [4, 5],
      energyMinFilter: 6,
      energyMaxFilter: 8,
      bpmMinFilter: 124,
      bpmMaxFilter: 128,
      camelotKeyFilters: ["7A", "8A", "9A"],
    });

    const failingRating = createCriteria({ ratingFilters: [1, 2, 3] });
    const failingEnergy = createCriteria({ energyMinFilter: 8 });
    const failingBpm = createCriteria({ bpmMaxFilter: 120 });
    const failingCamelotKey = createCriteria({ camelotKeyFilters: ["9A"] });

    expect(evaluateTrackMatchesCriteria(track, passing)).toBe(true);
    expect(evaluateTrackMatchesCriteria(track, failingRating)).toBe(false);
    expect(evaluateTrackMatchesCriteria(track, failingEnergy)).toBe(false);
    expect(evaluateTrackMatchesCriteria(track, failingBpm)).toBe(false);
    expect(evaluateTrackMatchesCriteria(track, failingCamelotKey)).toBe(false);
  });

  it("fails BPM filter when track BPM is null and BPM filter is set", () => {
    const track = createBaseTrack({ bpm: null });
    const criteria = createCriteria({ bpmMinFilter: 120 });

    expect(evaluateTrackMatchesCriteria(track, criteria)).toBe(false);
  });

  it("fails key filter when track key is missing and key filter is set", () => {
    const track = createBaseTrack({ camelotKey: null });
    const criteria = createCriteria({ camelotKeyFilters: ["8A"] });

    expect(evaluateTrackMatchesCriteria(track, criteria)).toBe(false);
  });

  it("supports legacy key range criteria when key filter array is not present", () => {
    const track = createBaseTrack({ camelotKey: "8A" });
    const criteria = createCriteria({
      camelotKeyFilters: [],
      camelotMinFilter: "7A",
      camelotMaxFilter: "9A",
    });

    expect(evaluateTrackMatchesCriteria(track, criteria)).toBe(true);
  });
});
