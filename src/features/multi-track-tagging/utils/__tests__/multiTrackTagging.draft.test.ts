import { describe, expect, it } from "vitest";
import {
  calculateBatchChanges,
  createDraftTagState,
  findCommonEnergyRatingFromDraft,
  findCommonStarRatingFromDraft,
  findCommonTagsFromDraft,
  toggleEnergyRatingDraftState,
  toggleStarRatingDraftState,
  toggleTagForAllTracksDraft,
  toggleTagForTrackDraft,
} from "@/features/multi-track-tagging/utils/multiTrackTagging.draft";
import { DraftTagState } from "@/features/multi-track-tagging/model/useMultiTrackTagging.types";

const HOUSE_TAG = "tag_house";
const TECHNO_TAG = "tag_techno";
const CHILL_TAG = "tag_chill";

describe("multiTrackTagging draft utils", () => {
  it("creates initial draft state from track URIs and stored data", () => {
    const draft = createDraftTagState(
      ["spotify:track:a", "spotify:track:b", "spotify:track:c"],
      {
        "spotify:track:a": {
          rating: 4,
          energy: 8,
          bpm: 126,
          tagIds: [HOUSE_TAG],
        },
        "spotify:track:b": {
          rating: 2,
          energy: 3,
          bpm: null,
          tagIds: [],
        },
      },
    );

    expect(draft["spotify:track:a"]).toEqual({
      tagIds: [HOUSE_TAG],
      rating: 4,
      energy: 8,
    });
    expect(draft["spotify:track:b"]).toEqual({
      tagIds: [],
      rating: 2,
      energy: 3,
    });
    expect(draft["spotify:track:c"]).toEqual({
      tagIds: [],
      rating: 0,
      energy: 0,
    });
  });

  it("finds common tags, star rating, and energy across tracks", () => {
    const draft: DraftTagState = {
      "spotify:track:a": { tagIds: [HOUSE_TAG, CHILL_TAG], rating: 4, energy: 6 },
      "spotify:track:b": { tagIds: [HOUSE_TAG], rating: 4, energy: 6 },
      "spotify:track:c": { tagIds: [HOUSE_TAG, TECHNO_TAG], rating: 4, energy: 7 },
    };

    expect(findCommonTagsFromDraft(draft)).toEqual([HOUSE_TAG]);
    expect(findCommonStarRatingFromDraft(draft)).toBe(4);
    expect(findCommonEnergyRatingFromDraft(draft)).toBeUndefined();
  });

  it("toggles a tag on a specific track", () => {
    const original: DraftTagState = {
      "spotify:track:a": { tagIds: [HOUSE_TAG], rating: 0, energy: 0 },
    };

    const withAdded = toggleTagForTrackDraft(original, "spotify:track:a", CHILL_TAG);
    expect(withAdded["spotify:track:a"].tagIds).toEqual([HOUSE_TAG, CHILL_TAG]);

    const withRemoved = toggleTagForTrackDraft(withAdded, "spotify:track:a", HOUSE_TAG);
    expect(withRemoved["spotify:track:a"].tagIds).toEqual([CHILL_TAG]);
  });

  it("toggles a common tag across all selected tracks", () => {
    const tracks = [{ uri: "spotify:track:a" }, { uri: "spotify:track:b" }];

    const addTargetDraft: DraftTagState = {
      "spotify:track:a": { tagIds: [HOUSE_TAG], rating: 0, energy: 0 },
      "spotify:track:b": { tagIds: [], rating: 0, energy: 0 },
    };

    const added = toggleTagForAllTracksDraft(addTargetDraft, tracks, HOUSE_TAG);
    expect(added["spotify:track:a"].tagIds).toEqual([HOUSE_TAG]);
    expect(added["spotify:track:b"].tagIds).toEqual([HOUSE_TAG]);

    const removeTargetDraft: DraftTagState = {
      "spotify:track:a": { tagIds: [HOUSE_TAG, CHILL_TAG], rating: 0, energy: 0 },
      "spotify:track:b": { tagIds: [HOUSE_TAG], rating: 0, energy: 0 },
    };

    const removed = toggleTagForAllTracksDraft(removeTargetDraft, tracks, HOUSE_TAG);
    expect(removed["spotify:track:a"].tagIds).toEqual([CHILL_TAG]);
    expect(removed["spotify:track:b"].tagIds).toEqual([]);
  });

  it("toggles star rating for locked and unlocked modes", () => {
    const base: DraftTagState = {
      "spotify:track:a": { tagIds: [], rating: 4, energy: 0 },
      "spotify:track:b": { tagIds: [], rating: 4, energy: 0 },
    };

    const unlocked = toggleStarRatingDraftState(
      base,
      [{ uri: "spotify:track:a" }, { uri: "spotify:track:b" }],
      4,
      null,
    );

    expect(unlocked["spotify:track:a"].rating).toBe(0);
    expect(unlocked["spotify:track:b"].rating).toBe(0);

    const locked = toggleStarRatingDraftState(base, [], 4, "spotify:track:a");
    expect(locked["spotify:track:a"].rating).toBe(0);
    expect(locked["spotify:track:b"].rating).toBe(4);
  });

  it("toggles energy rating for locked and unlocked modes", () => {
    const base: DraftTagState = {
      "spotify:track:a": { tagIds: [], rating: 0, energy: 6 },
      "spotify:track:b": { tagIds: [], rating: 0, energy: 6 },
    };

    const unlocked = toggleEnergyRatingDraftState(
      base,
      [{ uri: "spotify:track:a" }, { uri: "spotify:track:b" }],
      6,
      null,
    );

    expect(unlocked["spotify:track:a"].energy).toBe(0);
    expect(unlocked["spotify:track:b"].energy).toBe(0);

    const locked = toggleEnergyRatingDraftState(base, [], 8, "spotify:track:a");
    expect(locked["spotify:track:a"].energy).toBe(8);
    expect(locked["spotify:track:b"].energy).toBe(6);
  });

  it("calculates minimal batch updates from original and draft states", () => {
    const original: DraftTagState = {
      "spotify:track:a": { tagIds: [HOUSE_TAG], rating: 3, energy: 5 },
      "spotify:track:b": { tagIds: [], rating: 0, energy: 0 },
      "spotify:track:c": { tagIds: [CHILL_TAG], rating: 1, energy: 2 },
    };

    const draft: DraftTagState = {
      "spotify:track:a": { tagIds: [TECHNO_TAG], rating: 4, energy: 5 },
      "spotify:track:b": { tagIds: [HOUSE_TAG], rating: 0, energy: 7 },
      "spotify:track:c": { tagIds: [CHILL_TAG], rating: 1, energy: 2 },
    };

    const updates = calculateBatchChanges(
      [
        { uri: "spotify:track:a" },
        { uri: "spotify:track:b" },
        { uri: "spotify:track:c" },
      ],
      original,
      draft,
    );

    expect(updates).toEqual([
      {
        trackUri: "spotify:track:a",
        toAdd: [TECHNO_TAG],
        toRemove: [HOUSE_TAG],
        newRating: 4,
      },
      {
        trackUri: "spotify:track:b",
        toAdd: [HOUSE_TAG],
        toRemove: [],
        newEnergy: 7,
      },
    ]);
  });
});
