import { describe, expect, it } from "vitest";
import {
  buildBpmDistribution,
  buildRatingDistribution,
  formatRatingStars,
} from "../ExportModal";

describe("ExportModal statistics", () => {
  it("keeps half-star ratings in their own distribution buckets", () => {
    const distribution = buildRatingDistribution([
      { rating: 4 },
      { rating: 4.5 },
      { rating: 4.5 },
      { rating: 5 },
    ]);

    expect(distribution.find((bucket) => bucket.rating === 4)?.count).toBe(1);
    expect(distribution.find((bucket) => bucket.rating === 4.5)?.count).toBe(2);
    expect(distribution.find((bucket) => bucket.rating === 5)?.count).toBe(1);
  });

  it("formats half-star rating labels", () => {
    expect(formatRatingStars(0.5)).toBe("½☆☆☆☆");
    expect(formatRatingStars(3.5)).toBe("★★★½☆");
    expect(formatRatingStars(5)).toBe("★★★★★");
  });

  it("counts BPM values through the 160+ bucket", () => {
    const distribution = buildBpmDistribution([
      { bpm: 79 },
      { bpm: 135 },
      { bpm: 145 },
      { bpm: 155 },
      { bpm: 160 },
      { bpm: 172 },
      { bpm: null },
    ]);

    expect(distribution.find((bucket) => bucket.label === "<80")?.count).toBe(1);
    expect(distribution.find((bucket) => bucket.label === "135-140")?.count).toBe(1);
    expect(distribution.find((bucket) => bucket.label === "140-150")?.count).toBe(1);
    expect(distribution.find((bucket) => bucket.label === "150-160")?.count).toBe(1);
    expect(distribution.find((bucket) => bucket.label === "160+")?.count).toBe(2);
  });
});
