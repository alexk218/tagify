import { expect, it } from "vitest";
import { collapseRecordingEntries, confirmedRecordingSets, hasRecordingConflict, recordingCandidates, recordingDisplayKeys } from "../recordingLibrary";
import { collectMatchingTrackUris } from "@/features/smart-playlists/utils/smartPlaylist.syncUtils";
const a = `spotify:track:${"a".repeat(22)}`, b = `spotify:track:${"b".repeat(22)}`, c = `spotify:track:${"c".repeat(22)}`;
const identity = { isrc: "USABC2400001", artistIds: ["d".repeat(22)], durationMs: 180000, name: "Song" };
const song = { name: "Song", rating: 3, energy: 4, bpm: null, tagIds: ["house"], recordingIdentity: identity, recordingGroupId: "group", dateModified: 10 };
it("only uses titles to find candidates, then requires confirmed identity and every duration pair", () => {
  const tracks = { [a]: song, [b]: { ...song, recordingIdentity: { ...identity, durationMs: 180800 } }, [c]: { ...song, recordingIdentity: { ...identity, durationMs: 181600 } }, "spotify:local:a": song };
  expect(recordingCandidates(tracks)).toEqual([[a, b, c]]);
  expect(confirmedRecordingSets(tracks).map(set => set.entries.map(([uri]) => uri))).toEqual([[a, b]]);
  expect(confirmedRecordingSets({ [a]: song, [b]: { ...song, recordingIdentity: { ...identity, isrc: "USABC2400002", durationMs: 180001 } } })).toEqual([]);
});
it("leaves conflicting, unconfirmed, and opted-out copies visible and collapses after filtering/sorting", () => {
  const tracks = { [a]: song, [b]: { ...song, albumName: "Other album", dateModified: 20 } };
  const keys = recordingDisplayKeys(tracks);
  expect(collapseRecordingEntries([[b, tracks[b]], [a, song]], keys).map(([uri]) => uri)).toEqual([b]);
  expect(collapseRecordingEntries([[a, song]], keys).map(([uri]) => uri)).toEqual([a]);
  for (const change of [{ rating: 5 }, { recordingIdentity: undefined }, { recordingReuseDisabled: true }]) {
    const different = { [a]: song, [b]: { ...song, ...change } };
    expect(collapseRecordingEntries(Object.entries(different), recordingDisplayKeys(different))).toHaveLength(2);
  }
  expect(hasRecordingConflict(confirmedRecordingSets({ [a]: song, [b]: { ...song, rating: 5 } })[0])).toBe(true);
});
it("new playlists use one confirmed copy and full sync prefers a copy already in the playlist", () => {
  const criteria = { includeTagClauses: [], clauseConnectors: [], ratingFilters: [], energyMinFilter: null, energyMaxFilter: null, bpmMinFilter: null, bpmMaxFilter: null };
  const tracks = { [a]: song, [b]: song, [c]: { ...song, recordingGroupId: undefined } };
  expect(collectMatchingTrackUris(tracks, criteria)).toEqual([a, c]);
  expect(collectMatchingTrackUris(tracks, criteria, [b])).toEqual([b, c]);
});
