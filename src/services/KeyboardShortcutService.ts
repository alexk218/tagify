/**
 * GLOBAL KEYBOARD SHORTCUT SERVICE
 *
 * Manages keyboard shortcuts for rating tracks OUTSIDE of React lifecycle.
 * This allows shortcuts to work even when the Tagify app is not mounted.
 * Does this by changing saved records in IndexedDB (see extensionEdits).
 * And emits global events - listened by useGlobalKeyboardShortcuts (which runs INSIDE of React).
 *
 * This is a service (and not a hook) because shortcuts must:
 *  - work when app is not mounted, and survive React unmounts
 *  - intercept events globally
 *
 * KeyboardShortcutService exists to make things happen.
 * useGlobalKeyboardShortcuts exists to tell React that something happened.
 *
 * Every shortcut changes the current saved record inside one storage
 * transaction (see extensionEdits), so it never replaces tags or other edits
 * saved by the Tagify page, sync, or background lookups in the meantime.
 */
import { ArtistData, PlaylistData, TrackData } from "@/types/tagData";
import { audioFeaturesService } from "@/services/AudioFeaturesService";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { getTagifyDatabaseName } from "@/services/sync/SyncLocalState";
import { dispatchTagDataUpdatedEvent } from "@/features/tag-data/utils/tagData.events";
import {
  announceSavedTracks,
  getEditErrorMessage,
  saveEntityEdit,
  saveTrackEdits,
  type AnnotationEdit,
} from "@/extensions/extensionEdits";

const PLAYLIST_CHANGED_EVENT = "tagify:playlistChanged";
const ARTIST_CHANGED_EVENT = "tagify:artistChanged";
const LOCK_STATE_KEY = "tagify:lockState";
const LOCKED_TRACK_KEY = "tagify:lockedTrack";
const APP_MOUNTED_KEY = "tagify:appMounted";
const SETTINGS_KEY = "tagify:keyboardShortcutSettings";
const SHORTCUT_TARGET_KEY = "tagify:shortcutTarget";

type ShortcutTarget =
  | { type: "track"; uri: string }
  | {
      type: "playlist";
      uri: string;
      metadata?: ShortcutPlaylistMetadata | null;
    }
  | {
      type: "artist";
      uri: string;
      metadata?: ShortcutArtistMetadata | null;
    }
  | { type: "none" };

interface ShortcutPlaylistMetadata {
  name?: string;
  ownerName?: string | null;
  imageUrl?: string | null;
  description?: string | null;
  trackCount?: number | null;
  snapshotId?: string | null;
}

interface ShortcutArtistMetadata {
  name?: string;
  imageUrl?: string | null;
  followerCount?: number | null;
  genres?: string[];
}

class KeyboardShortcutService {
  private isInitialized = false;
  private boundHandler: ((event: KeyboardEvent) => void) | null = null;
  private boundSettingsHandler: ((event: Event) => void) | null = null;
  private audioFeaturesBackfillInFlight = new Set<string>();

  private getShortcutTarget(): ShortcutTarget {
    const isAppMounted = localStorage.getItem(APP_MOUNTED_KEY) === "true";

    if (!isAppMounted) {
      const targetTrackUri = this.getTargetTrackUri();
      return targetTrackUri ? { type: "track", uri: targetTrackUri } : { type: "none" };
    }

    try {
      const rawTarget = localStorage.getItem(SHORTCUT_TARGET_KEY);
      const target = rawTarget ? JSON.parse(rawTarget) : null;

      if (target?.view === "playlists") {
        return typeof target.playlistUri === "string" && target.playlistUri.length > 0
          ? {
              type: "playlist",
              uri: target.playlistUri,
              metadata: target.playlistMetadata ?? null,
            }
          : { type: "none" };
      }

      if (target?.view === "artists") {
        return typeof target.artistUri === "string" && target.artistUri.length > 0
          ? {
              type: "artist",
              uri: target.artistUri,
              metadata: target.artistMetadata ?? null,
            }
          : { type: "none" };
      }
    } catch (error) {
      console.error("Tagify: Error reading shortcut target", error);
    }

    const targetTrackUri = this.getTargetTrackUri();
    return targetTrackUri ? { type: "track", uri: targetTrackUri } : { type: "none" };
  }

  private getTargetTrackUri(): string | null {
    try {
      const isAppMounted = localStorage.getItem(APP_MOUNTED_KEY) === "true";
      const isLocked = localStorage.getItem(LOCK_STATE_KEY) === "true";
      if (isAppMounted && isLocked) {
        const lockedTrackJson = localStorage.getItem(LOCKED_TRACK_KEY);
        if (lockedTrackJson) {
          const lockedTrack = JSON.parse(lockedTrackJson);
          if (lockedTrack?.uri) {
            return lockedTrack.uri;
          }
        }
      }
    } catch (error) {
      console.error("Tagify: Error reading locked track state", error);
    }
    return this.getCurrentlyPlayingTrackUri();
  }

  private isTrackMusic(trackUri: string | null): boolean {
    if (!trackUri) return false;
    return trackUri.startsWith("spotify:track:");
  }

  // initialize keyboard shortcut listener. call once when Spotify starts (called from extension.js)
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Check if shortcuts are disabled in settings
    const settings = this.getSettings();
    if (!settings.enabled) {
      this.listenForSettingsChanges();
      return;
    }

    // when you pass a method as a callback, it loses its 'this' context
    // so we use 'bind(this)' -> creates a new function where 'this' is the value that we're passing to it ('this' in this case!)
    // Now `this` inside handleKeyPress will always be your KeyboardShortcutService instance
    // we use boundHandler so that removeEventListener works:
    //    it needs the exact same function reference that was passed to addEventListener - and bind() creates a new function object
    //    so we can't do addEventListener(..., this.handleKeyPress.bind(this)) and removeEventListener(..., this.handleKeyPress.bind(this)) -> this would create a 2nd function object
    this.boundHandler = this.handleKeyPress.bind(this);
    document.addEventListener("keydown", this.boundHandler, true); // use capture phase to intercept before Spotify's handlers

    this.listenForSettingsChanges();

    this.isInitialized = true;
  }

  private listenForSettingsChanges(): void {
    if (this.boundSettingsHandler) return;

    this.boundSettingsHandler = (event: Event) => {
      const customEvent = event as CustomEvent;
      const enabled = customEvent.detail?.enableKeyboardShortcuts;

      if (typeof enabled === "boolean") {
        if (enabled && !this.isInitialized) {
          // Re-initialize
          this.boundHandler = this.handleKeyPress.bind(this);
          document.addEventListener("keydown", this.boundHandler, true);
          this.isInitialized = true;
        } else if (!enabled && this.isInitialized) {
          // Destroy
          if (this.boundHandler) {
            document.removeEventListener("keydown", this.boundHandler, true);
            this.boundHandler = null;
          }
          this.isInitialized = false;
        }
      }
    };

    window.addEventListener(
      "tagify:keyboardSettingsChanged",
      this.boundSettingsHandler
    );
  }

  private getSettings(): { enabled: boolean } {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (error) {
      console.error("Tagify: Error reading keyboard shortcut settings", error);
    }
    return { enabled: true }; // default to enabled
  }

  // clean up.. unused for now
  destroy(): void {
    if (this.boundHandler) {
      document.removeEventListener("keydown", this.boundHandler, true);
      this.boundHandler = null;
    }
    if (this.boundSettingsHandler) {
      window.removeEventListener(
        "tagify:keyboardSettingsChanged",
        this.boundSettingsHandler
      );
      this.boundSettingsHandler = null;
    }
    this.isInitialized = false;
  }

  private getCurrentlyPlayingTrackUri(): string | null {
    try {
      const trackData = Spicetify?.Player?.data?.item;
      return trackData?.uri || null;
    } catch {
      return null;
    }
  }

  private getTargetTrackMetadata(): { name: string; artists: string } | null {
    try {
      const isAppMounted = localStorage.getItem(APP_MOUNTED_KEY) === "true";
      const isLocked = localStorage.getItem(LOCK_STATE_KEY) === "true";

      // If app is mounted and locked, get metadata from locked track (this has everything: title, artists, album, uri, duration)
      if (isAppMounted && isLocked) {
        const lockedTrackJson = localStorage.getItem(LOCKED_TRACK_KEY);
        if (lockedTrackJson) {
          const lockedTrack = JSON.parse(lockedTrackJson);
          if (lockedTrack?.uri) {
            return {
              name: lockedTrack.name || "Unknown Track",
              artists:
                lockedTrack.artists?.map((a: any) => a.name).join(", ") ||
                "Unknown Artist",
            };
          }
        }
      }
    } catch (error) {
      console.error("Tagify: Error reading locked track metadata", error);
    }

    // Fall back to currently playing track
    try {
      const playerData = Spicetify?.Player?.data;
      if (!playerData?.item) return null;

      const item = playerData.item;
      return {
        name: item.name || "Unknown Track",
        artists:
          item.artists?.map((a: any) => a.name).join(", ") || "Unknown Artist",
      };
    } catch (error) {
      console.error("Error getting current track metadata:", error);
      return null;
    }
  }

  /** Changes the star rating or energy of a song from its saved record. */
  private async editTrack(trackUri: string, edit: AnnotationEdit): Promise<void> {
    let created = false;
    let saved: Record<string, TrackData | null>;
    try {
      saved = await saveTrackEdits([trackUri], edit, {
        details: () => {
          created = true;
          const metadata = this.getTargetTrackMetadata();
          return { name: metadata?.name, artists: metadata?.artists };
        },
      });
    } catch (error) {
      console.error("Tagify: Could not save the keyboard shortcut change", error);
      Spicetify.showNotification(getEditErrorMessage(error), true);
      return;
    }

    announceSavedTracks(saved);
    // New songs are saved right away; their tempo and key are looked up after.
    if (created && saved[trackUri]) void this.backfillAudioFeatures(trackUri);
  }

  /**
   * Fills in a song's tempo and key when they are still missing. Ratings,
   * tags, values changed in the meantime, and Last Updated stay as saved.
   */
  private async backfillAudioFeatures(trackUri: string): Promise<void> {
    if (trackUri.startsWith("spotify:local:") || this.audioFeaturesBackfillInFlight.has(trackUri)) {
      return;
    }
    this.audioFeaturesBackfillInFlight.add(trackUri);

    try {
      const expectedDatabaseName = getTagifyDatabaseName();
      const features = await audioFeaturesService.getAudioFeaturesFromUri(trackUri);
      const bpm = features?.bpm ?? null;
      const camelotKey = features?.camelotKey ?? null;
      if (bpm === null && camelotKey === null) return;

      const saved = await indexedDBStorage.patchTracks({
        [trackUri]: (current) => {
          if (!current) return undefined;
          const fillBpm = bpm !== null && (current.bpm === null || current.bpm === undefined);
          const fillKey = camelotKey !== null && !current.camelotKey;
          if (!fillBpm && !fillKey) return undefined;
          return {
            ...current,
            ...(fillBpm ? { bpm } : {}),
            ...(fillKey ? { camelotKey } : {}),
          };
        },
      }, { expectedDatabaseName });
      announceSavedTracks(saved);
    } catch (error) {
      console.error("Tagify: Could not fill in the song's tempo and key", error);
    } finally {
      this.audioFeaturesBackfillInFlight.delete(trackUri);
    }
  }

  /** Changes the star rating or energy of a playlist, album, or artist from its saved record. */
  private async editEntity(
    target: Extract<ShortcutTarget, { type: "playlist" | "artist" }>,
    edit: AnnotationEdit,
  ): Promise<void> {
    let saved: Record<string, PlaylistData | ArtistData | null>;
    try {
      saved = target.type === "playlist"
        ? await saveEntityEdit<PlaylistData>("playlist", target.uri, edit, {
            name: target.metadata?.name,
            ownerName: target.metadata?.ownerName ?? null,
            imageUrl: target.metadata?.imageUrl ?? null,
            description: target.metadata?.description ?? null,
            trackCount: target.metadata?.trackCount ?? null,
            snapshotId: target.metadata?.snapshotId ?? null,
          })
        : await saveEntityEdit<ArtistData>("artist", target.uri, edit, {
            name: target.metadata?.name,
            imageUrl: target.metadata?.imageUrl ?? null,
            followerCount: target.metadata?.followerCount ?? null,
            genres: target.metadata?.genres || [],
          });
    } catch (error) {
      console.error("Tagify: Could not save the keyboard shortcut change", error);
      Spicetify.showNotification(getEditErrorMessage(error), true);
      return;
    }
    if (!(target.uri in saved)) return;

    dispatchTagDataUpdatedEvent("save", { recordsAnnounced: true });
    window.dispatchEvent(
      target.type === "playlist"
        ? new CustomEvent(PLAYLIST_CHANGED_EVENT, {
            detail: { playlistUri: target.uri, playlistData: saved[target.uri], timestamp: Date.now() },
          })
        : new CustomEvent(ARTIST_CHANGED_EVENT, {
            detail: { artistUri: target.uri, artistData: saved[target.uri], timestamp: Date.now() },
          })
    );
  }

  private get isTemporarilyDisabled(): boolean {
    return (
      localStorage.getItem("tagify:shortcutsTemporarilyDisabled") === "true"
    );
  }

  temporarilyDisable(): void {
    localStorage.setItem("tagify:shortcutsTemporarilyDisabled", "true");
  }

  temporarilyEnable(): void {
    localStorage.removeItem("tagify:shortcutsTemporarilyDisabled");
  }

  private handleKeyPress(event: KeyboardEvent): void {
    // gets disabled with MultiTrackDetails is rendered
    if (this.isTemporarilyDisabled) {
      return;
    }
    // Ignore if typing in an input field
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      (event.target instanceof HTMLElement && event.target.isContentEditable)
    ) {
      return;
    }

    // event.code: "1" returns "Digit1" - regardless of Shift key pressed or not
    const code = event.code;
    const isShiftPressed = event.shiftKey;

    // Only handle Digit0-Digit9 keys
    const digitMatch = code.match(/^Digit(\d)$/);
    if (!digitMatch) return;

    const digit = digitMatch[1]; // [0] is full match ("Digit5"), [1] is first capturing group - "0" through "9"

    const shortcutTarget = this.getShortcutTarget();
    if (shortcutTarget.type === "none") {
      return;
    }

    // Only allow track ratings for Spotify music tracks. Album/playlist and artist
    // targets are selected explicitly inside Tagify and can be handled below.
    if (
      shortcutTarget.type === "track" &&
      !this.isTrackMusic(shortcutTarget.uri)
    ) {
      return;
    }

    const digitToStarRating: { [key: string]: number } = {
      "1": 0.5,
      "2": 1,
      "3": 1.5,
      "4": 2,
      "5": 2.5,
      "6": 3,
      "7": 3.5,
      "8": 4,
      "9": 4.5,
      "0": 5,
    };

    const digitToEnergyRating: { [key: string]: number } = {
      "1": 1,
      "2": 2,
      "3": 3,
      "4": 4,
      "5": 5,
      "6": 6,
      "7": 7,
      "8": 8,
      "9": 9,
      "0": 10,
    };

    event.preventDefault();
    event.stopPropagation();

    // Pressing the saved value again clears it. That is decided from the
    // saved record when the change is written, not from an earlier copy.
    const edit: AnnotationEdit = isShiftPressed
      ? { toggleEnergy: digitToEnergyRating[digit] }
      : { toggleRating: digitToStarRating[digit] };

    if (shortcutTarget.type === "track") {
      void this.editTrack(shortcutTarget.uri, edit);
    } else {
      void this.editEntity(shortcutTarget, edit);
    }
  }
}

// Export singleton instance
export const keyboardShortcutService = new KeyboardShortcutService();
