import { describe, expect, it } from "vitest";
import { hidesEveryTag } from "../sharingLockReason";
import { taxonomyFixture, tracksFixture } from "./sharingFixtures";

describe("hidesEveryTag", () => {
  it("is true only when the hidden choices hide every tag the member put on a song", () => {
    expect(hidesEveryTag(tracksFixture(), taxonomyFixture(), { hiddenTagIds: [], hiddenNodeIds: ["mood", "workout"] })).toBe(true);
    expect(hidesEveryTag(tracksFixture(), taxonomyFixture(), { hiddenTagIds: ["rain", "happy"], hiddenNodeIds: ["workout"] })).toBe(true);
    expect(hidesEveryTag(tracksFixture(), taxonomyFixture(), { hiddenTagIds: [], hiddenNodeIds: ["workout"] })).toBe(false);
    expect(hidesEveryTag(tracksFixture(), taxonomyFixture(), { hiddenTagIds: [], hiddenNodeIds: [] })).toBe(false);
    expect(hidesEveryTag(tracksFixture(), taxonomyFixture(), null)).toBe(false);
  });

  it("doesn't count a member with no tagged songs as hiding everything", () => {
    expect(hidesEveryTag({}, taxonomyFixture(), { hiddenTagIds: [], hiddenNodeIds: ["mood", "workout"] })).toBe(false);
  });
});
