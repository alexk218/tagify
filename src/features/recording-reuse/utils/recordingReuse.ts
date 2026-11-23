import type { RecordingIdentity, TrackData } from "@/types/tagData";

export const recordingName = (name: string) => name.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
export function normalizeRecordingIdentity(value: unknown): RecordingIdentity | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as Partial<RecordingIdentity>;
  if (typeof v.isrc !== "string" || !/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(v.isrc) ||
    !Array.isArray(v.artistIds) || !v.artistIds.length || !v.artistIds.every(id => typeof id === "string" && /^[A-Za-z0-9]{22}$/.test(id)) ||
    typeof v.durationMs !== "number" || !Number.isFinite(v.durationMs) || v.durationMs <= 0 || typeof v.name !== "string" || !v.name.trim()) return;
  const lead = typeof v.leadArtistId === "string" && v.artistIds.includes(v.leadArtistId) ? { leadArtistId: v.leadArtistId } : {};
  return { isrc: v.isrc, artistIds: [...new Set(v.artistIds)].sort(), durationMs: v.durationMs, name: v.name, ...lead };
}
/** Copies with the same ISRC may differ by this much, such as a release with added silence. */
export const SAME_ISRC_DURATION_TOLERANCE_MS = 5000;
// Version labels that mark a different recording, as Spotify writes them: "Song (Live)",
// "Song [Remix]" or "Song - Live at …". A shared ISRC is sometimes reused by mistake for one
// of these, so a label on only one of the two titles keeps them apart.
const VERSION_LABELS = /\b(?:remix(?:ed)?|live|acoustic|instrumental|karaoke|a ?cappella|acapella|unplugged|demo|remaster(?:ed)?|sped up|slowed|nightcore)\b/g;
const versionLabels = (name: string) => {
  const suffixes = recordingName(name).match(/[([][^)\]]*[)\]]|\s-\s.*$/g) || [];
  return [...new Set(suffixes.join(" ").match(VERSION_LABELS) || [])].map(label => label.replace(/^remixed$/, "remix").replace(/^remastered$/, "remaster")).sort().join("|");
};
export function sameRecording(a?: RecordingIdentity, b?: RecordingIdentity): boolean {
  if (!a || !b) return false;
  // The ISRC names the recording, so the title may differ (a translated or romanized
  // title, an added "feat." credit) and the credits only need to share an artist.
  if (a.isrc === b.isrc) return a.artistIds.some(id => b.artistIds.includes(id)) &&
    Math.abs(a.durationMs - b.durationMs) <= SAME_ISRC_DURATION_TOLERANCE_MS && versionLabels(a.name) === versionLabels(b.name);
  // Reissues can carry a different ISRC: require the full title, the same artists and exact timing.
  return similarRecording(a, b) && a.durationMs === b.durationMs;
}

/** Wider tolerance retained for links the user previously confirmed. */
export function similarRecording(a?: RecordingIdentity, b?: RecordingIdentity): boolean {
  return !!a && !!b && JSON.stringify([...a.artistIds].sort()) === JSON.stringify([...b.artistIds].sort()) &&
    Math.abs(a.durationMs - b.durationMs) <= 1000 && recordingName(a.name) === recordingName(b.name);
}
/**
 * The title without credits and soundtrack attributions: "(feat. …)", "(with …)" and a
 * trailing "[From …]", "(from …)" or " - From …", in any letter case. Remix, live,
 * remaster, edit and version labels stay.
 */
export function baseRecordingName(name: string) {
  let title = recordingName(name).replace(/\s*[([](?:feat\.?|ft\.|featuring|with)\s[^)\]]*[)\]]/g, "");
  for (let previous = ""; previous !== title;) {
    previous = title;
    title = title.replace(/\s*[([]from\s[^)\]]*[)\]]\s*$/, "").replace(/\s+-\s+from\s[^-()[\]]*$/, "");
  }
  return title.replace(/\s+/g, " ").trim();
}
/**
 * A likely other release of the same song, such as a single and its album cut, that
 * exact-copy linking rejects. Links only when both songs also report the same Spotify play
 * count (see findNearRecording); otherwise the songs stay apart.
 */
export function nearRecording(a?: RecordingIdentity, b?: RecordingIdentity): boolean {
  if (!a?.leadArtistId || !b?.leadArtistId) return false;
  const [fewer, more] = a.artistIds.length <= b.artistIds.length ? [a, b] : [b, a];
  // A soundtrack single can add a credit, such as the game or film, ahead of the artist.
  // The lead may differ only when it is that added credit; swapped leads stay apart.
  if (a.leadArtistId !== b.leadArtistId && fewer.artistIds.includes(more.leadArtistId!)) return false;
  const base = baseRecordingName(a.name);
  return !!base && fewer.artistIds.every(id => more.artistIds.includes(id)) && base === baseRecordingName(b.name) && Math.abs(a.durationMs - b.durationMs) <= 5000;
}
/** Explicit confirmation belongs to the saved group, not to a Spotify identity. */
export function compatibleRecordingLinks(a: TrackData, b: TrackData): boolean {
  return sameRecording(a.recordingIdentity, b.recordingIdentity) ||
    (!!a.recordingGroupId && a.recordingGroupId === b.recordingGroupId && a.recordingGroupConfirmed === true && b.recordingGroupConfirmed === true &&
      (similarRecording(a.recordingIdentity, b.recordingIdentity) || nearRecording(a.recordingIdentity, b.recordingIdentity)));
}
/** The person said these two songs are different; don't ask again. */
export const notSameRecording = (aUri: string, a: TrackData | undefined, bUri: string, b: TrackData | undefined) =>
  !!a?.recordingNotSameAs?.includes(bUri) || !!b?.recordingNotSameAs?.includes(aUri);
const fields = ["rating", "energy", "tagIds"] as const;
const equalField = (a: unknown, b: unknown) => JSON.stringify(Array.isArray(a) ? [...a].sort() : a) === JSON.stringify(Array.isArray(b) ? [...b].sort() : b);
export const recordingAnnotations = (track: TrackData | undefined) => JSON.stringify([track?.rating || 0, track?.energy || 0, [...(track?.tagIds || [])].sort()]);
/**
 * The tagging a person sees. A tag ID that is no longer in the tag list (left
 * over on one copy, for example after a tag was removed elsewhere) can't be
 * shown, so it never makes two copies of a song look different.
 */
export const visibleRecordingAnnotations = (track: TrackData | undefined, validTagIds?: ReadonlySet<string>) => validTagIds
  ? JSON.stringify([track?.rating || 0, track?.energy || 0, [...new Set((track?.tagIds || []).filter(id => validTagIds.has(id)))].sort()])
  : recordingAnnotations(track);
export function recordingConflict(a: TrackData | undefined, b: TrackData | undefined) {
  return !!a && !!b && (["rating", "energy"] as const).some(field => {
    const av = a[field], bv = b[field];
    // Tags combine without loss; two different ratings/energy values need a choice.
    return av > 0 && bv > 0 && !equalField(av, bv);
  });
}

/** A restored independent cloud copy must not inherit a conflicting local link. */
export function detachInconsistentRecordingGroups(tracks: Record<string, TrackData>, validTagIds?: ReadonlySet<string>) {
  const groups = new Map<string, TrackData[]>();
  Object.values(tracks).forEach(track => {
    if (track.recordingGroupId) {
      const members = groups.get(track.recordingGroupId) || [];
      members.push(track); groups.set(track.recordingGroupId, members);
    }
  });
  const invalid = new Set([...groups].filter(([, members]) => members.some(track => visibleRecordingAnnotations(track, validTagIds) !== visibleRecordingAnnotations(members[0], validTagIds) || members.some(other => !compatibleRecordingLinks(track, other)))).map(([id]) => id));
  return Object.fromEntries(Object.entries(tracks).map(([uri, track]) => [uri, track.recordingGroupId && invalid.has(track.recordingGroupId) ? { ...track, recordingGroupId: undefined, ...(track.recordingGroupConfirmed ? { recordingGroupConfirmed: undefined } : {}) } : track]));
}

const isBlankAutomaticCopy = (track: TrackData) =>
  !track.rating && !track.energy && !track.tagIds.length && !track.recordingGroupConfirmed && !track.recordingReuseDisabled;
/**
 * Saved copies of songs Tagify linked on its own whose copies now have no rating, energy
 * or tags. Linked copies stay saved while one of them is cleared, so the change reaches the
 * others; once every copy is blank the link holds nothing the person chose, and the songs
 * leave the library (and backups) like any other song with nothing set. Links the person
 * confirmed and songs kept unlinked on purpose stay. Pass `groups` to check only those links.
 */
export function blankAutomaticRecordingCopies(tracks: Record<string, TrackData | null>, groups?: ReadonlySet<string>): string[] {
  const members = new Map<string, string[]>();
  for (const [uri, track] of Object.entries(tracks)) {
    const group = track?.recordingGroupId;
    if (!group || (groups && !groups.has(group))) continue;
    const uris = members.get(group) || []; uris.push(uri); members.set(group, uris);
  }
  return [...members.values()].filter(uris => uris.every(uri => isBlankAutomaticCopy(tracks[uri]!))).flat();
}

/** Copy only changed annotation fields; each release retains its own metadata. */
export function expandRecordingEdits(current: Record<string, TrackData>, changes: Record<string, TrackData | null>) {
  const result = { ...changes };
  const updates = new Map<string, Partial<Pick<TrackData, "rating" | "energy" | "tagIds">>>();
  const membersByGroup = new Map<string, TrackData[]>();
  Object.values(current).forEach(track => {
    if (!track.recordingGroupId) return;
    const members = membersByGroup.get(track.recordingGroupId) || [];
    members.push(track); membersByGroup.set(track.recordingGroupId, members);
  });
  const validated = new Set<string>();
  const now = Date.now();
  for (const [uri, after] of Object.entries(changes)) {
    const before = current[uri];
    const group = before?.recordingGroupId;
    if (!group || !after || after.recordingGroupId !== group || after.recordingReuseDisabled) continue;
    const members = membersByGroup.get(group) || [];
    if (!validated.has(group) && members.some(member => members.some(other => !compatibleRecordingLinks(member, other)))) throw new Error("This song's saved copies have changed. Reopen the song and try again.");
    validated.add(group);
    const delta = updates.get(group) || {};
    for (const field of fields) {
      if (equalField(before[field], after[field])) continue;
      if (field in delta && !equalField(delta[field], after[field])) throw new Error("This song has different changes in the selection. Choose the same tags and ratings for its copies and try again.");
      Object.assign(delta, { [field]: after[field] });
    }
    updates.set(group, delta);
  }
  for (const [uri, before] of Object.entries(current)) {
    const delta = before.recordingGroupId && updates.get(before.recordingGroupId);
    if (!delta || before.recordingReuseDisabled || !Object.keys(delta).length || result[uri] === null) continue;
    const after = result[uri] || before;
    if (after.recordingGroupId !== before.recordingGroupId) continue;
    if (fields.some(field => field in delta && !equalField(after[field], delta[field]))) result[uri] = { ...after, ...delta, dateModified: now };
  }
  const touched = new Set(Object.entries(changes).flatMap(([uri, after]) => [current[uri]?.recordingGroupId, after?.recordingGroupId].filter((id): id is string => !!id)));
  if (touched.size) blankAutomaticRecordingCopies({ ...current, ...result }, touched).forEach(uri => { result[uri] = null; });
  return result;
}
