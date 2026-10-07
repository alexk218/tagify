import type { TagDataStructure } from "@/types/tagData";

export type TrackDateModifiedSnapshot = Map<string, number | undefined>;

export type MigrationDateModifiedPolicy =
  | { mode: "preserve" }
  | { mode: "rewrite"; reason: string };

export function captureTrackDateModified(
  data: TagDataStructure,
): TrackDateModifiedSnapshot {
  return new Map(
    Object.entries(data.tracks).map(([uri, track]) => [uri, track.dateModified]),
  );
}

/**
 * Track migrations preserve user-visible Last Updated ordering by default.
 * A timestamp rewrite is deliberately noisy and requires an explicit reason.
 */
export function enforceMigrationDateModifiedPolicy(
  data: TagDataStructure,
  before: TrackDateModifiedSnapshot,
  migrationName: string,
  policy: MigrationDateModifiedPolicy = { mode: "preserve" },
): TagDataStructure {
  const changedUris = [...before].flatMap(([uri, previous]) => {
    const current = data.tracks[uri];
    return current && current.dateModified !== previous ? [uri] : [];
  });
  if (changedUris.length === 0) return data;

  if (policy.mode === "rewrite") {
    const message = `${migrationName} intentionally changed Last Updated for ${changedUris.length.toLocaleString()} track${changedUris.length === 1 ? "" : "s"}: ${policy.reason}`;
    console.warn(`[Migration timestamp exception] ${message}`);
    globalThis.Spicetify?.showNotification?.(message, true);
    return data;
  }

  console.warn(
    `[Migration timestamp guard] ${migrationName} attempted to change Last Updated for ${changedUris.length} track(s); the original timestamps were restored.`,
  );
  const tracks = { ...data.tracks };
  changedUris.forEach((uri) => {
    const track = { ...tracks[uri] };
    const previous = before.get(uri);
    if (previous === undefined) delete track.dateModified;
    else track.dateModified = previous;
    tracks[uri] = track;
  });
  return { ...data, tracks };
}
