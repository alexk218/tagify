import { describe, expect, it } from "vitest";
import { READS_PER_DAY, READS_PER_HOUR, taggedByOthersAllowance } from "../taggedByOthersAllowance";

function memory() {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); } };
}
const HOUR = 60 * 60_000;

describe("how much the check may read from Spotify", () => {
  it("allows a Liked Songs check of a large library, then stops for the hour", () => {
    const allowance = taggedByOthersAllowance("account-a", { storage: memory(), now: () => Date.parse("2026-11-15T10:00:00Z") });
    // 26,384 Liked Songs are 528 pages: two checks fit in an hour, a third doesn't.
    for (let page = 0; page < 1_056; page += 1) expect(allowance.take(1)).toBe(true);
    expect(allowance.take(528)).toBe(false);
    expect(READS_PER_HOUR).toBeLessThan(528 * 3);
  });

  it("keeps counting after Spotify reloads, so restarting a check doesn't start a fresh allowance", () => {
    const storage = memory();
    const now = () => Date.parse("2026-11-15T10:00:00Z");
    expect(taggedByOthersAllowance("account-a", { storage, now }).take(READS_PER_HOUR)).toBe(true);
    expect(taggedByOthersAllowance("account-a", { storage, now }).take(1)).toBe(false);
  });

  it("refuses a read that would pass a limit without counting it", () => {
    const allowance = taggedByOthersAllowance("account-a", { storage: memory(), now: () => 0, perHour: 10 });
    expect(allowance.take(8)).toBe(true);
    expect(allowance.take(5)).toBe(false);
    expect(allowance.take(2)).toBe(true);
  });

  it("starts a new hour after an hour, and a new day after the day, within the day's limit", () => {
    let now = Date.parse("2026-11-15T10:00:00Z");
    const allowance = taggedByOthersAllowance("account-a", { storage: memory(), now: () => now, perHour: 100, perDay: 150 });
    expect(allowance.take(100)).toBe(true);
    expect(allowance.take(1)).toBe(false);
    now += HOUR;
    expect(allowance.take(50)).toBe(true);
    // The day's limit holds even in a new hour.
    expect(allowance.take(1)).toBe(false);
    now = Date.parse("2026-11-16T00:00:01Z");
    expect(allowance.take(100)).toBe(true);
  });

  it("counts another account separately", () => {
    const storage = memory();
    const now = () => 0;
    expect(taggedByOthersAllowance("account-a", { storage, now, perHour: 5 }).take(5)).toBe(true);
    expect(taggedByOthersAllowance("account-b", { storage, now, perHour: 5 }).take(5)).toBe(true);
  });

  it("still limits in memory when this computer can't keep the count", () => {
    const allowance = taggedByOthersAllowance("account-a", { storage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } }, now: () => 0, perHour: 3 });
    expect(allowance.take(3)).toBe(true);
    expect(allowance.take(1)).toBe(false);
    expect(READS_PER_DAY).toBeGreaterThan(READS_PER_HOUR);
  });
});
