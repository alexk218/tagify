import { describe, expect, it } from "vitest";
import type { SpotifyTrackSearchResult } from "@/services/SpotifyTrackSearch";
import { lookupSearchTerm, lookupTitle, pickSameSong } from "../NowPlayingLookupMatching";

const result = (id: string, name: string, artists: string[], album: string | null = null, playable = true): SpotifyTrackSearchResult => ({
  id: id.padEnd(22, "0"), name, artists, album, playable,
});
const lookup = (title: string, artists: string[], version: string | null = null, album: string | null = null) =>
  ({ requestId: "req-1", title, version, artists, album });

// Spotify's answer to "Baby Tony Romera Remix Clean Bandit", 2026-10-28 (first five results).
const baby = [
  result("remix", "Baby - Tony Romera Remix", ["Four Tet", "Tony Romera"], "Baby Love Cry"),
  result("single", "Baby (feat. MARINA & Luis Fonsi)", ["Clean Bandit", "MARINA", "Luis Fonsi"], "Baby (feat. MARINA & Luis Fonsi)"),
  result("deluxe", "Baby (feat. MARINA & Luis Fonsi)", ["Clean Bandit", "MARINA", "Luis Fonsi"], "What Is Love? (Deluxe Edition)"),
  result("gunlean", "Gun Lean Remix", ["Russ Millions", "Ms Banks"]),
  result("live", "Max Styler - Live at Portola Music Festival", ["Max Styler"]),
];

describe("Now playing lookup matching", () => {
  it("a remix is never the original, and the original is never the remix", () => {
    expect(pickSameSong(lookup("Baby", ["Four Tet"]), baby)).toBeNull();
    expect(pickSameSong(lookup("Baby", ["Four Tet"], "Tony Romera Remix"), baby)).toBe(baby[0].id);
    expect(pickSameSong(lookup("Baby - Tony Romera Remix", ["Four Tet"]), baby)).toBe(baby[0].id);
    expect(pickSameSong(lookup("Baby", ["Clean Bandit"], "Tony Romera Remix"), baby)).toBeNull();
  });

  it("featured artists and remasters name the same recording", () => {
    expect(pickSameSong(lookup("Baby", ["Clean Bandit"]), baby)).toBe(baby[1].id);
    expect(pickSameSong(lookup("Baby", ["Clean Bandit"], "Remastered 2011"), baby)).toBe(baby[1].id);
    expect(pickSameSong(lookup("Song", ["Band"]), [result("x", "Song - 2011 Remaster", ["Band"])])).toBe("x".padEnd(22, "0"));
  });

  it("needs an artist in common, and splits a lookup's joined artists", () => {
    expect(pickSameSong(lookup("Baby", ["Someone Else"]), baby)).toBeNull();
    expect(pickSameSong(lookup("Baby", ["Clean Bandit & MARINA"]), baby)).toBe(baby[1].id);
    expect(pickSameSong(lookup("Baby", ["The Clean Bandit"]), baby)).toBe(baby[1].id);
  });

  it("prefers the title written the same, then the lookup's album, then a playable song", () => {
    expect(pickSameSong(lookup("Baby", ["Clean Bandit"], null, "What Is Love? (Deluxe Edition)"), baby)).toBe(baby[2].id);
    const written = [result("feat", "Song (feat. X)", ["Band"]), result("plain", "Song", ["Band"])];
    expect(pickSameSong(lookup("Song", ["Band"]), written)).toBe(written[1].id);
    const playable = [result("blocked", "Song", ["Band"], null, false), result("open", "Song", ["Band"])];
    expect(pickSameSong(lookup("Song", ["Band"]), playable)).toBe(playable[1].id);
    expect(pickSameSong(lookup("Song", ["Band"]), [playable[0]])).toBe(playable[0].id);
  });

  it("other versions stay apart: live, edits, sped up", () => {
    const versions = [result("live", "Song - Live", ["Band"]), result("edit", "Song (Radio Edit)", ["Band"]), result("sped", "Song - Sped Up", ["Band"])];
    expect(pickSameSong(lookup("Song", ["Band"]), versions)).toBeNull();
    expect(pickSameSong(lookup("Song", ["Band"], "Radio Edit"), versions)).toBe(versions[1].id);
    expect(pickSameSong(lookup("Song", ["Band"], "Live"), versions)).toBe(versions[0].id);
  });

  it("writes the version once and searches for title, version and first artist", () => {
    expect(lookupTitle({ title: "Baby", version: "Tony Romera Remix" })).toBe("Baby (Tony Romera Remix)");
    expect(lookupTitle({ title: "Baby - Tony Romera Remix", version: "tony romera remix" })).toBe("Baby - Tony Romera Remix");
    expect(lookupTitle({ title: "baby tony romera remix", version: "tony romera remix" })).toBe("baby tony romera remix");
    expect(lookupTitle({ title: "Baby", version: null })).toBe("Baby");
    expect(lookupSearchTerm({ title: "Baby (feat. MARINA)", version: "Tony Romera Remix", artists: ["Four Tet", "Tony Romera"] }))
      .toBe("Baby Tony Romera Remix Four Tet");
  });
});
