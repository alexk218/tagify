import { describe, expect, it } from "vitest";
import { validRymCandidate, type SpotifyAlbumCandidate, type SpotifyAlbumSearchResult } from "../rym/albumCandidate";
import type { RymRelease } from "../rym/rymExport.mjs";
import { describeRymMatch, looseRymKey, preselectRymAlbum, rankRymCandidates, suggestRymAlbum } from "../rym/rymMatching";

// Cases below mirror releases and Spotify results observed in the live 128-release acceptance export.
let next = 0;
const release = (title: string, artists: string[], year: number | null, releaseType = "album"): RymRelease => ({
  id: String(++next), url: `https://rateyourmusic.com/release/${releaseType}/x/${next}/`, title, artists, year, releaseType, tags: ["rock"],
});
const album = (title: string, artists: string[], year: number | null, releaseType = "ALBUM", playable = true): SpotifyAlbumCandidate => ({
  uri: `spotify:album:${String(++next).padStart(22, "a")}`, title, artists, year, releaseType, playable, imageUrl: null,
});
const results = (...albums: SpotifyAlbumCandidate[]): Extract<SpotifyAlbumSearchResult, { status: "available" }> => ({ status: "available", albums, hasMore: true, omittedResults: false });
const other = album("Killing Joke", ["Killing Joke"], 1980);

describe("automatic RYM album matching", () => {
  it("preselects a unique exact identity even when Spotify has more result pages", () => {
    const exact = album("Absolute Dissent", ["Killing Joke"], 2010);
    expect(preselectRymAlbum(release("Absolute Dissent", ["Killing Joke"], 2010), results(exact, other))).toBe(exact);
  });

  it("ignores punctuation, accents, spacing and ampersands", () => {
    expect(looseRymKey("Hardwired...to Self-Destruct")).toBe(looseRymKey("Hardwired…To Self-Destruct"));
    expect(looseRymKey("Voïvod")).toBe(looseRymKey("Voivod"));
    const telex = album("High & Dry / Planet Telex", ["Radiohead"], 1995, "SINGLE");
    expect(preselectRymAlbum(release("High and Dry / Planet Telex", ["Radiohead"], 1995, "single"), results(telex))).toBe(telex);
    const war = album("War and Pain", ["Voivod"], 1984);
    expect(preselectRymAlbum(release("War and Pain", ["Voïvod"], 1984), results(war))).toBe(war);
  });

  it("accepts Spotify's EP suffix and its single type for EPs", () => {
    const dormancy = album("The End Of Dormancy - EP", ["Voivod"], 2020, "EP");
    expect(preselectRymAlbum(release("The End of Dormancy", ["Voivod"], 2020, "ep"), results(dormancy))).toBe(dormancy);
    const creep = album("Creep", ["Radiohead"], 1992, "SINGLE");
    expect(preselectRymAlbum(release("Creep", ["Radiohead"], 1992, "ep"), results(creep))).toBe(creep);
  });

  it("matches localized RYM names written as native [Latin]", () => {
    const anger = album("St. Anger", ["Metallica"], 2003);
    expect(preselectRymAlbum(release("セイント・アンガー [St. Anger]", ["メタリカ [Metallica]"], 2003), results(anger))).toBe(anger);
  });

  it("requires review for editions, other versions, duplicates, year or type differences and missing data", () => {
    const killEmAll = release("Kill 'Em All", ["Metallica"], 1983);
    expect(preselectRymAlbum(killEmAll, results(album("Kill 'Em All (Remastered)", ["Metallica"], 1983)))).toBeNull();
    const bleach = release("Bleach", ["Nirvana"], 1989);
    expect(preselectRymAlbum(bleach, results(album("Bleach", ["Nirvana"], 1989), album("Bleach (Deluxe Edition)", ["Nirvana"], 1989)))).toBeNull();
    const reload = release("Reload", ["Metallica"], 1997);
    expect(preselectRymAlbum(reload, results(album("Reload", ["Metallica"], 1997), album("Reload", ["Metallica"], 1997)))).toBeNull();
    expect(preselectRymAlbum(release("Creep", ["Radiohead"], 1993, "single"), results(album("Creep", ["Radiohead"], 1992, "SINGLE")))).toBeNull();
    expect(preselectRymAlbum(release("Lithium", ["Nirvana"], 1992, "single"), results(album("Lithium", ["Nirvana"], 1992, "COMPILATION")))).toBeNull();
    expect(preselectRymAlbum(release("Lulu", ["Lou Reed", "Metallica"], 2011), results(album("Lulu", ["Lou Reed"], 2011)))).toBeNull();
    const nothingface = album("Nothingface", ["Voivod"], 1989);
    expect(preselectRymAlbum(release("Nothingface", ["Voivod"], null), results(nothingface))).toBeNull();
    expect(preselectRymAlbum(release("Nothingface", ["Voivod"], 1989), { ...results(nothingface), omittedResults: true })).toBeNull();
    expect(preselectRymAlbum(release("Nothingface", ["Voivod"], 1989), results({ ...nothingface, playable: false }))).toBeNull();
    expect(preselectRymAlbum(release("Nothingface", ["Voivod"], 1989), { status: "unavailable" })).toBeNull();
  });

  it("does not treat a different title that starts the same as another version", () => {
    const sm = album("S&M", ["Metallica"], 1999);
    expect(preselectRymAlbum(release("S&M", ["Metallica"], 1999), results(sm, album("S&M2", ["Metallica"], 2020)))).toBe(sm);
  });
});

describe("RYM album suggestions", () => {
  it("ranks the closest album first and suggests it with plain-language differences", () => {
    const remaster = album("Kill 'Em All (Remastered)", ["Metallica"], 1983);
    const ranked = rankRymCandidates(release("Kill 'Em All", ["Metallica"], 1983), [other, album("Metallica (Remastered)", ["Metallica"], 1991), remaster]);
    expect(ranked[0]).toBe(remaster);
    const source = release("Kill 'Em All", ["Metallica"], 1983);
    expect(suggestRymAlbum(source, ranked)).toBe(remaster);
    expect(describeRymMatch(source, remaster, ranked)).toEqual(["Different edition"]);
  });

  it("explains year, type and other versions", () => {
    const creep = album("Creep", ["Radiohead"], 1992, "SINGLE");
    expect(describeRymMatch(release("Creep", ["Radiohead"], 1993, "single"), creep)).toEqual(["Spotify lists 1992"]);
    const lithium = album("Lithium", ["Nirvana"], 1992, "COMPILATION");
    expect(describeRymMatch(release("Lithium", ["Nirvana"], 1992, "single"), lithium)).toEqual(["Spotify lists a compilation"]);
    const bleach = album("Bleach", ["Nirvana"], 1989);
    expect(describeRymMatch(release("Bleach", ["Nirvana"], 1989), bleach, [bleach, album("Bleach (Deluxe Edition)", ["Nirvana"], 1989)])).toEqual(["1 other version on Spotify"]);
  });

  it("tolerates censored titles but never suggests another artist's album", () => {
    const live = album("Live S**t: Binge & Purge", ["Metallica"], 1993);
    const binge = release("Live Shit: Binge & Purge", ["Metallica"], 1993);
    expect(suggestRymAlbum(binge, rankRymCandidates(binge, [other, live]))).toBe(live);
    expect(describeRymMatch(binge, live)).toEqual(["Title differs"]);
    const sixFeet = release("Six Feet Down Under EP", ["Metallica"], 2010, "ep");
    expect(suggestRymAlbum(sixFeet, rankRymCandidates(sixFeet, [album("Six Feet Under", ["Billie Eilish"], 2016, "SINGLE")]))).toBeNull();
  });

  it("does not suggest albums with different numbers or years more than one apart", () => {
    const woodstock = release("Woodstock 94", ["Various Artists"], 1994);
    expect(suggestRymAlbum(woodstock, rankRymCandidates(woodstock, [album("Woodstock '99", ["Various Artists"], 1994, "COMPILATION")]))).toBeNull();
    const promo = release("Metallica", ["Metallica"], 1988, "ep");
    expect(suggestRymAlbum(promo, rankRymCandidates(promo, [album("Metallica (Remastered)", ["Metallica"], 1991)]))).toBeNull();
  });

  it("prefers the closest edition when several need review", () => {
    const justice = release("...And Justice for All", ["Metallica"], 1988);
    const boxSet = album("...And Justice for All (Remastered Deluxe Box Set)", ["Metallica"], 1988);
    const remaster = album("...And Justice for All (Remastered)", ["Metallica"], 1988);
    expect(suggestRymAlbum(justice, rankRymCandidates(justice, [boxSet, remaster]))).toBe(remaster);
  });

  it("does not suggest an unrelated title or an unavailable album", () => {
    const voivod = release("Voivod", ["Voivod"], 2003);
    expect(suggestRymAlbum(voivod, rankRymCandidates(voivod, [album("The Best of Voivod", ["Voivod"], 1992, "COMPILATION")]))).toBeNull();
    const angel = release("Angel Rat", ["Voivod"], 1991);
    expect(suggestRymAlbum(angel, rankRymCandidates(angel, [album("Angel Rat", ["Voivod"], 1991, "ALBUM", false)]))).toBeNull();
  });
});

describe("validRymCandidate", () => {
  const album: SpotifyAlbumCandidate = { uri: "spotify:album:4LH4d3cOWNNsVw41Gqt2kv", title: "Nothingface", artists: ["Voivod"],
    year: 1989, releaseType: "album", playable: true, imageUrl: "https://i.scdn.co/image/example" };

  it("accepts a complete Spotify album", () => {
    expect(validRymCandidate(album)).toBe(true);
    expect(validRymCandidate({ ...album, year: null, releaseType: null, imageUrl: null })).toBe(true);
  });

  it.each([
    ["a track link", { uri: "spotify:track:4LH4d3cOWNNsVw41Gqt2kv" }],
    ["an empty title", { title: "  " }],
    ["no artists", { artists: [] }],
    ["an impossible year", { year: 99 }],
    ["an insecure cover", { imageUrl: "http://example.com/cover.jpg" }],
    ["unknown playability", { playable: "yes" }],
  ])("rejects %s", (_name, change) => {
    expect(validRymCandidate({ ...album, ...change })).toBe(false);
  });
});
