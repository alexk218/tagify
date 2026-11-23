// @vitest-environment node
import { describe, expect, it } from "vitest";
import { baseRecordingName, compatibleRecordingLinks, detachInconsistentRecordingGroups, nearRecording, normalizeRecordingIdentity, sameRecording } from "../recordingReuse";

// Justice, "Flower In A Hurricane": the single (with the GTA VI soundtrack credit) and the album cut.
const justice = "1gR0gsQYfi6joyO1dlp76N", tameImpala = "5INjqkS1o8h1imAzPqGZBb", sza = "7tYKF4w9nC0nq9CsPZTHyP";
const gta = "15o7qdDTBzs6xWRUYUtZc1", kingGizzard = "6XYvaoDGE0VmRt83Jss9Sn";
const single = normalizeRecordingIdentity({ isrc: "FR6P12602660", artistIds: [justice, tameImpala, sza, gta, kingGizzard], leadArtistId: justice, durationMs: 224877,
  name: "Flower In A Hurricane (feat. Tame Impala, SZA, King Gizzard & the Lizard Wizard) [From GTAVI: Original Score]" })!;
const album = normalizeRecordingIdentity({ isrc: "USAT22606646", artistIds: [justice, tameImpala, sza, kingGizzard], leadArtistId: justice, durationMs: 221189,
  name: "Flower In A Hurricane (feat. Tame Impala, SZA, King Gizzard & The Lizard Wizard)" })!;

describe("nearRecording", () => {
  it("keeps the lead artist through normalization", () => {
    expect(single.leadArtistId).toBe(justice);
    expect(single.artistIds).toEqual([...single.artistIds].sort());
    expect(normalizeRecordingIdentity({ ...album, leadArtistId: "x".repeat(22) })).not.toHaveProperty("leadArtistId");
  });
  it("removes credits and soundtrack attributions but keeps version labels", () => {
    expect(baseRecordingName(single.name)).toBe("flower in a hurricane");
    expect(baseRecordingName(album.name)).toBe("flower in a hurricane");
    expect(baseRecordingName("Song (with Someone) (From \"A Film\")")).toBe("song");
    expect(baseRecordingName("Song (feat. X) [Remix]")).toBe("song [remix]");
    expect(baseRecordingName("Song (Live) [From The Tour]")).toBe("song (live)");
    expect(baseRecordingName("Song - Radio Edit")).toBe("song - radio edit");
  });
  it("matches the single and the album cut, which automatic linking keeps apart", () => {
    expect(sameRecording(single, album)).toBe(false);
    expect(nearRecording(single, album)).toBe(true);
    expect(nearRecording(album, single)).toBe(true);
  });
  it("rejects a remix, a different version, a much shorter edit and a different lead artist", () => {
    expect(nearRecording(single, { ...album, name: "Flower In A Hurricane (feat. Tame Impala) [Remix]" })).toBe(false);
    expect(nearRecording(single, { ...album, name: "Flower In A Hurricane (Live)" })).toBe(false);
    expect(nearRecording(single, { ...album, name: "Flower In A Hurricane (Radio Edit)", durationMs: 190000 })).toBe(false);
    expect(nearRecording(single, { ...album, durationMs: single.durationMs - 5001 })).toBe(false);
    expect(nearRecording(single, { ...album, durationMs: single.durationMs - 5000 })).toBe(true);
    expect(nearRecording(single, { ...album, leadArtistId: tameImpala })).toBe(false);
  });
  it("needs overlapping artists and a known lead artist on both", () => {
    expect(nearRecording(single, { ...album, artistIds: [justice, "z".repeat(22)].sort() })).toBe(false);
    expect(nearRecording(single, { ...album, artistIds: [justice] })).toBe(true);
    const { leadArtistId: _, ...older } = album;
    expect(nearRecording(single, older)).toBe(false);
  });
  it("keeps a confirmed near link through restore and edits, but not an unconfirmed one", () => {
    const a = { rating: 4, energy: 6, bpm: null, tagIds: ["t"], recordingGroupId: "g", recordingGroupConfirmed: true, recordingIdentity: single, dateModified: 10 };
    const b = { ...a, recordingIdentity: album, dateModified: 20 };
    expect(compatibleRecordingLinks(a, b)).toBe(true);
    expect(detachInconsistentRecordingGroups({ a, b })).toEqual({ a, b });
    const unconfirmed = { a: { ...a, recordingGroupConfirmed: undefined }, b: { ...b, recordingGroupConfirmed: undefined } };
    expect(detachInconsistentRecordingGroups(unconfirmed).b.recordingGroupId).toBeUndefined();
  });
  it("matches Suzuki's album cut and its GTA VI single, whatever the attribution's brackets or letter case", () => {
    // Album: USAT22606650. Single: USAT22607218, titled "(from GTAVI: The Album)" with the game as an added artist.
    const artist = "3Suzuki0Artist0Id00000";
    const albumCut = normalizeRecordingIdentity({ isrc: "USAT22606650", artistIds: [artist], leadArtistId: artist, durationMs: 187000, name: "Suzuki" })!;
    const suzukiSingle = normalizeRecordingIdentity({ isrc: "USAT22607218", artistIds: [artist, gta], leadArtistId: artist, durationMs: 187000, name: "Suzuki (from GTAVI: The Album)" })!;
    expect(sameRecording(albumCut, suzukiSingle)).toBe(false);
    expect(nearRecording(albumCut, suzukiSingle)).toBe(true);
    for (const name of ["Suzuki (From GTAVI: The Album)", "Suzuki [from GTAVI: The Album]", "Suzuki [FROM GTAVI: Original Score]", "Suzuki - From GTAVI: The Album"]) {
      expect(baseRecordingName(name)).toBe("suzuki");
      expect(nearRecording(albumCut, { ...suzukiSingle, name })).toBe(true);
    }
    // The game's credit may come first on the single; the artists otherwise agree.
    expect(nearRecording(albumCut, { ...suzukiSingle, leadArtistId: gta })).toBe(true);
    expect(nearRecording(albumCut, { ...suzukiSingle, artistIds: [gta], leadArtistId: gta })).toBe(false);
  });
  it("keeps songs apart whose shared artists swap the lead", () => {
    const duet = normalizeRecordingIdentity({ ...album, artistIds: [justice, sza], leadArtistId: justice })!;
    expect(nearRecording(duet, { ...duet, isrc: "USAT22600001", leadArtistId: sza })).toBe(false);
  });
});
