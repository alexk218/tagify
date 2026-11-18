// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SORT_OPTIONS, SORT_ORDERS } from "@/constants/trackList";
import { sortTrackEntries } from "@/features/track-session/utils/trackList.logic";
import type { TrackListEntry } from "@/features/track-session/model/trackList.types";
import { communityPeopleTitle, formatCommunityPeople } from "@/features/track-session/utils/communityPeople";

const entry = (id: string, dateModified: number): TrackListEntry => [
  `spotify:track:${id}`,
  { rating: 0, energy: 0, bpm: null, tagIds: [], dateModified },
];

const entries = [entry("a", 1), entry("b", 2), entry("c", 3), entry("d", 4)];
const ids = (sorted: TrackListEntry[]) => sorted.map(([uri]) => uri.slice("spotify:track:".length));

describe("sort by most tagged by others", () => {
  const communityPeople = new Map([["spotify:track:a", 12], ["spotify:track:c", 3]]);

  it("puts the songs most members tagged first, then Last updated order for the rest", () => {
    expect(ids(sortTrackEntries(entries, {}, { sortBy: SORT_OPTIONS.COMMUNITY_PEOPLE, sortOrder: SORT_ORDERS.DESC, communityPeople })))
      .toEqual(["a", "c", "d", "b"]);
  });

  it("reverses for ascending", () => {
    expect(ids(sortTrackEntries(entries, {}, { sortBy: SORT_OPTIONS.COMMUNITY_PEOPLE, sortOrder: SORT_ORDERS.ASC, communityPeople })))
      .toEqual(["b", "d", "c", "a"]);
  });

  it("keeps Last updated order before Community answers", () => {
    expect(ids(sortTrackEntries(entries, {}, { sortBy: SORT_OPTIONS.COMMUNITY_PEOPLE, sortOrder: SORT_ORDERS.DESC })))
      .toEqual(["d", "c", "b", "a"]);
  });
});

describe("community chip text", () => {
  it("counts others, with + when Community stopped counting", () => {
    expect(formatCommunityPeople({ people: 1, peopleCapped: false })).toBe("1 other");
    expect(formatCommunityPeople({ people: 12, peopleCapped: false })).toBe("12 others");
    expect(formatCommunityPeople({ people: 50, peopleCapped: true })).toBe("50+ others");
  });

  it("names up to three members and their top tags in the tooltip", () => {
    const tag = (label: string) => ({ label, paths: [label], people: 1 });
    expect(communityPeopleTitle({ people: 5, peopleCapped: false, sample: ["ana", "bo"], tags: [tag("techno"), tag("dark")] }))
      .toBe("Tagged on Community by @ana, @bo and 3 more\nTheir tags: techno, dark");
    expect(communityPeopleTitle({ people: 2, peopleCapped: false, sample: [], tags: [] }))
      .toBe("Tagged on Community by 2 others");
  });
});
