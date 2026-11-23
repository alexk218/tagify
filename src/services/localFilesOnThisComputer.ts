// Spotify's Web API refuses local files, but the desktop app's own PlaylistAPI adds, moves and
// removes them, and Spotify saves them to the playlist on its servers (verified 2026-11-22 on
// Spotify 1.2.92.148; see docs/LOCAL_FILES_IN_PLAYLISTS.md). A local-file link only plays where
// the file is, so Tagify adds one only when this computer's Spotify lists that exact file. Files
// on another computer are added when that computer's Tagify syncs.

interface DesktopLocalFiles {
  getTracks?: () => Promise<Array<{ uri?: unknown }>>;
}

const CACHE_MS = 30_000;
let cached: { at: number; uris: Promise<Set<string>> } | null = null;
let addsStopped = false;

export const isLocalFileUri = (uri: string) => uri.startsWith("spotify:local:");

/** The exact local-file links this computer's Spotify lists under Local Files. Empty when it can't tell. */
export function localFilesOnThisComputer(): Promise<Set<string>> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.uris;
  const api = (Spicetify.Platform as unknown as { LocalFilesAPI?: DesktopLocalFiles }).LocalFilesAPI;
  const uris = (async () => {
    try {
      const tracks = await api?.getTracks?.();
      return new Set((Array.isArray(tracks) ? tracks : []).flatMap(track => typeof track?.uri === "string" && isLocalFileUri(track.uri) ? [track.uri] : []));
    } catch (error) {
      console.warn("Spotify's local files could not be listed", error);
      return new Set<string>();
    }
  })();
  cached = { at: Date.now(), uris };
  return uris;
}

/** Whether Tagify still adds local files this session. A refused add stops it until Spotify reloads. */
export const localFileAddsAvailable = () => !addsStopped;

/** Called when Spotify refuses a local-file add, so later passes fall back to adding them by hand. */
export function stopLocalFileAdds(error: unknown) {
  if (!addsStopped) console.warn("Spotify refused a local file; Tagify stops adding local files until Spotify reloads", error);
  addsStopped = true;
}

/** Splits links into what Tagify can add here and the local files it can't (not on this computer, or adds stopped). */
export async function addableHere(uris: string[]): Promise<{ addable: string[]; localElsewhere: string[] }> {
  const local = uris.filter(isLocalFileUri);
  if (!local.length) return { addable: uris.filter(uri => uri.startsWith("spotify:track:")), localElsewhere: [] };
  const listed = addsStopped ? new Set<string>() : await localFilesOnThisComputer();
  return {
    addable: uris.filter(uri => uri.startsWith("spotify:track:") || (isLocalFileUri(uri) && listed.has(uri))),
    localElsewhere: local.filter(uri => !listed.has(uri)),
  };
}

/** Test hook. */
export function resetLocalFilesOnThisComputer() {
  cached = null;
  addsStopped = false;
}
