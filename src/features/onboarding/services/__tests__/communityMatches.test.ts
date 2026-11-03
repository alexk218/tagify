import { expect, it, vi } from "vitest";
import { communityTagsOf, findCommunityMatches } from "../communityMatches";

const song = (id: string) => ({ uri: `spotify:track:${id}`, name: id, artists: [], album: { name: "" }, duration_ms: 1 }) as never;
const entity = (contributors: unknown[]) => ({ contributors }) as never;
const person = (tags: [string, string?][], isOwn = false) => ({ isOwn, tags: tags.map(([label, path]) => ({ label, path: path ?? label })) });

it("counts each person once per tag, leaves out the member's own, and keeps the most common place", () => {
  const tags = communityTagsOf(entity([
    person([["Dark", "Mood / Dark"], ["dark", "Mood / Dark"], ["Techno", "Genre / Techno"]]),
    person([["Dark", "Feeling / Dark"], ["Night drive"]]),
    person([["Dark", "Mood / Dark"]]),
    person([["Mine"]], true),
    person([["Zed"], ["Aa"]]),
  ]));
  expect(tags).toEqual([
    { label: "Dark", people: 3, paths: ["Mood / Dark", "Feeling / Dark"] },
    { label: "Aa", people: 1, paths: ["Aa"] },
    { label: "Night drive", people: 1, paths: ["Night drive"] },
  ]);
});

it("leads with Community's agreed names, keeping where people file them", () => {
  const tags = communityTagsOf({
    contributors: [person([["about music"], ["romantic", "Mood / Feel / Romantic"]]), person([["Romantic", "Mood / Feel / Romantic"], ["Pop", "Genre / Pop"]])],
    tagAgreement: { taggers: 2, tags: [
      { label: "Romantic", spellings: ["romantic", "Romantic"], people: 2, members: 21, agreed: true },
      { label: "Pop", spellings: ["Pop"], people: 1, members: 31, agreed: false },
    ] },
  } as never);
  expect(tags).toEqual([
    { label: "Romantic", people: 2, paths: ["Mood / Feel / Romantic"] },
    { label: "Pop", people: 1, paths: ["Genre / Pop"] },
  ]);
});

it("asks a few songs at a time and shows the best-tagged first, in the songs' order", async () => {
  let running = 0, most = 0;
  const lookup = vi.fn(async (id: string) => {
    running++; most = Math.max(most, running);
    await new Promise((resolve) => setTimeout(resolve, 1));
    running--;
    const number = Number(id.slice(1));
    if (number === 40) return { found: true, entity: entity([person([["Dark"]]), person([["Dark"]])]) };
    return number % 3 === 0 ? { found: true, entity: entity([person([["Dark"]])]) } : { found: false, entity: null };
  });
  const songs = Array.from({ length: 60 }, (_, index) => song(`s${index}`));
  const matches = await findCommunityMatches([{ ...(song("local") as object), uri: "spotify:local:x" } as never, ...songs], { lookup });
  expect(lookup).toHaveBeenCalledTimes(60);
  expect(most).toBeLessThanOrEqual(4);
  // Two people beat one; the rest keep the Liked Songs order, ten at most.
  expect(matches.map((match) => match.track.uri)).toEqual(["s40", "s0", "s3", "s6", "s9", "s12", "s15", "s18", "s21", "s24"].map((id) => `spotify:track:${id}`));
});

const strongAt = (strong: number[]) => vi.fn(async (id: string) => strong.includes(Number(id.slice(1)))
  ? { found: true, entity: entity([person([["Dark"]]), person([["Dark"]])]) }
  : { found: false, entity: null });
const pages = (count: number, size = 50) => Array.from({ length: count }, (_, page) => Array.from({ length: size }, (_, index) => song(`s${page * size + index}`)));

it("reads further pages only until three songs carry tags several members agree on", async () => {
  const [first, ...rest] = pages(10);
  const loadMore = vi.fn(async () => rest.shift() ?? null);
  const lookup = strongAt([10, 70, 120, 400]);
  const matches = await findCommunityMatches(first, { lookup, loadMore });
  expect(loadMore).toHaveBeenCalledTimes(2);
  expect(lookup.mock.calls.length).toBeLessThanOrEqual(124);
  expect(matches.map((match) => match.track.uri)).toEqual(["s10", "s70", "s120"].map((id) => `spotify:track:${id}`));
});

it("checks at most 500 songs and keeps what it found when a page can't be read", async () => {
  const [first, ...rest] = pages(12);
  const lookup = strongAt([499, 500]);
  const matches = await findCommunityMatches(first, { lookup, loadMore: async () => rest.shift() ?? null });
  expect(lookup).toHaveBeenCalledTimes(500);
  expect(matches.map((match) => match.track.uri)).toEqual(["spotify:track:s499"]);

  const failing = vi.fn().mockRejectedValue(new Error("Spotify needs a short break."));
  const kept = await findCommunityMatches(pages(1)[0], { lookup: strongAt([5]), loadMore: failing });
  expect(failing).toHaveBeenCalledTimes(1);
  expect(kept.map((match) => match.track.uri)).toEqual(["spotify:track:s5"]);
});

it("stops asking once Community can't be reached", async () => {
  const lookup = vi.fn(async () => ({ found: false, entity: null, unavailable: true as const }));
  expect(await findCommunityMatches(Array.from({ length: 50 }, (_, index) => song(`s${index}`)), { lookup })).toEqual([]);
  expect(lookup.mock.calls.length).toBeLessThanOrEqual(4);
});
