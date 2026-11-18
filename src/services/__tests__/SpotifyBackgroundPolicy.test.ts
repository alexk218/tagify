import { expect, it } from "vitest";
import { MAX_HOURLY_RESERVATIONS, SpotifyBackgroundPolicy } from "@/services/SpotifyBackgroundPolicy";

const memoryStorage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};

it("counts an hourly limit above 200 exactly, up to MAX_HOURLY_RESERVATIONS", () => {
  const storage = memoryStorage();
  const account = new SpotifyBackgroundPolicy(() => storage, () => "hourly-count");
  let reserved = 0;
  for (let index = 0; index < 700; index++) if (account.reserve("song-details", `spotify:track:${index}`, 600)) reserved += 1;
  expect(MAX_HOURLY_RESERVATIONS).toBeGreaterThanOrEqual(600);
  expect(reserved).toBe(600);
});
