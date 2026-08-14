/**
 * GLOBAL KEYBOARD SHORTCUT SERVICE
 *
 * Manages keyboard shortcuts for rating tracks OUTSIDE of React lifecycle.
 * This allows shortcuts to work even when the Tagify app is not mounted.
 * Does this by reading/writing through storageService (IndexedDB-backed state).
 * And emits global events - listened by useGlobalKeyboardShortcuts (which runs INSIDE of React).
 *
 * This is a service (and not a hook) because shortcuts must:
 *  - work when app is not mounted, and survive React unmounts
 *  - intercept events globally
 *
 * KeyboardShortcutService exists to make things happen.
 * useGlobalKeyboardShortcuts exists to tell React that something happened.
 */
import {
  ArtistData,
  PlaylistData,
  TagDataStructure,
  TrackData,
} from "@/types/tagData";
import { storageService } from "@/services/storage";
import { defaultTagData } from "@/constants/defaultTagData";
import { audioFeaturesService } from "@/services/AudioFeaturesService";

const DATA_UPDATED_EVENT = "tagify:dataUpdated";
const SMART_PLAYLIST_SYNC_EVENT = "tagify:trackChanged";
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
  private tagDataCache: TagDataStructure | null = null;
  private cacheLoadPromise: Promise<void> | null = null;
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

    // Load initial cache from IndexedDB
    await this.loadCache();
    this.listenForDataUpdates();

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

  private async loadCache(): Promise<void> {
    if (this.cacheLoadPromise) {
      return this.cacheLoadPromise;
    }

    this.cacheLoadPromise = (async () => {
      try {
        if (!storageService.isReady()) {
          await storageService.initialize();
        }
        this.tagDataCache = await storageService.loadAll();
      } catch (error) {
        console.error("KeyboardShortcutService: Failed to load cache", error);
        this.tagDataCache = defaultTagData;
      }
    })();

    await this.cacheLoadPromise;
    this.cacheLoadPromise = null;
  }

  private listenForDataUpdates(): void {
    window.addEventListener(DATA_UPDATED_EVENT, async () => {
      await this.loadCache();
    });
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
    this.tagDataCache = null;
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

  // read tag data from in-memory cache hydrated from storageService
  private getTagData(): TagDataStructure | null {
    return this.tagDataCache;
  }

  private async persistTrackChange(
    trackUri: string,
    trackData: TrackData | null
  ): Promise<boolean> {
    try {
      if (trackData === null) {
        return await storageService.deleteTrack(trackUri);
      }
      return await storageService.saveTrack(trackUri, trackData);
    } catch (error) {
      console.error("Tagify: Error saving track to IndexedDB", error);
      return false;
    }
  }

  private async persistPlaylistChange(
    playlistUri: string,
    playlistData: PlaylistData | null
  ): Promise<boolean> {
    try {
      if (playlistData === null) {
        return await storageService.deletePlaylist(playlistUri);
      }
      return await storageService.savePlaylist(playlistUri, playlistData);
    } catch (error) {
      console.error("Tagify: Error saving playlist to IndexedDB", error);
      return false;
    }
  }

  private async persistArtistChange(
    artistUri: string,
    artistData: ArtistData | null
  ): Promise<boolean> {
    try {
      if (artistData === null) {
        return await storageService.deleteArtist(artistUri);
      }
      return await storageService.saveArtist(artistUri, artistData);
    } catch (error) {
      console.error("Tagify: Error saving artist to IndexedDB", error);
      return false;
    }
  }

  private createTrackShell(trackUri: string): TrackData {
    const metadata = this.getTargetTrackMetadata();
    const now = Date.now();

    // Save immediately with bpm:null; BPM is fetched in background.
    const trackData: TrackData = {
      rating: 0,
      energy: 0,
      bpm: null,
      camelotKey: null,
      tagIds: [],
      dateCreated: now,
      dateModified: now,
      name: metadata?.name,
      artists: metadata?.artists,
    };

    const tagData = this.getTagData();
    if (tagData) {
      tagData.tracks[trackUri] = trackData;
    }

    void this.backfillAudioFeatures(trackUri);

    return trackData;
  }

  private createPlaylistShell(
    playlistUri: string,
    metadata?: ShortcutPlaylistMetadata | null
  ): PlaylistData {
    const now = Date.now();
    const playlistData: PlaylistData = {
      rating: 0,
      energy: 0,
      tagIds: [],
      dateCreated: now,
      dateModified: now,
      name: metadata?.name,
      ownerName: metadata?.ownerName ?? null,
      imageUrl: metadata?.imageUrl ?? null,
      description: metadata?.description ?? null,
      trackCount: metadata?.trackCount ?? null,
      snapshotId: metadata?.snapshotId ?? null,
    };

    const tagData = this.getTagData();
    if (tagData) {
      tagData.playlists[playlistUri] = playlistData;
    }

    return playlistData;
  }

  private createArtistShell(
    artistUri: string,
    metadata?: ShortcutArtistMetadata | null
  ): ArtistData {
    const now = Date.now();
    const artistData: ArtistData = {
      rating: 0,
      energy: 0,
      tagIds: [],
      dateCreated: now,
      dateModified: now,
      name: metadata?.name,
      imageUrl: metadata?.imageUrl ?? null,
      followerCount: metadata?.followerCount ?? null,
      genres: metadata?.genres || [],
    };

    const tagData = this.getTagData();
    if (tagData) {
      tagData.artists[artistUri] = artistData;
    }

    return artistData;
  }

  private async backfillAudioFeatures(trackUri: string): Promise<void> {
    if (trackUri.startsWith("spotify:local:")) {
      return;
    }

    if (this.audioFeaturesBackfillInFlight.has(trackUri)) {
      return;
    }
    this.audioFeaturesBackfillInFlight.add(trackUri);

    try {
      const tagData = this.getTagData();
      const track = tagData?.tracks[trackUri];
      if (!track) {
        return;
      }

      const features = await audioFeaturesService.getAudioFeaturesFromUri(
        trackUri
      );
      const bpm = features?.bpm ?? null;
      const camelotKey = features?.camelotKey ?? null;

      if (bpm === null && camelotKey === null) {
        return;
      }

      const latestTagData = this.getTagData();
      const latestTrack = latestTagData?.tracks[trackUri];
      if (!latestTrack) {
        return;
      }

      if (latestTrack.bpm === null && bpm !== null) {
        latestTrack.bpm = bpm;
      }
      if (!latestTrack.camelotKey && camelotKey !== null) {
        latestTrack.camelotKey = camelotKey;
      }
      latestTrack.dateModified = Date.now();

      const finalTrackData = { ...latestTrack };
      const saved = await this.persistTrackChange(trackUri, finalTrackData);
      if (saved) {
        this.notifyDataUpdated(trackUri, finalTrackData);
      }
    } catch (error) {
      console.error("Error backfilling audio features:", error);
    } finally {
      this.audioFeaturesBackfillInFlight.delete(trackUri);
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

  // dispatch event AFTER LOCALSTORAGE HAS BEEN WRITTEN. notify React components that data has changed
  private notifyDataUpdated(
    trackUri: string = "",
    trackData: TrackData | null = null
  ): void {
    //
    window.dispatchEvent(
      new CustomEvent(DATA_UPDATED_EVENT, {
        detail: { type: "keyboardShortcut", timestamp: Date.now() },
      })
    );
    window.dispatchEvent(
      new CustomEvent(SMART_PLAYLIST_SYNC_EVENT, {
        detail: { trackUri, trackData, timestamp: Date.now() },
      })
    );
  }

  private notifyPlaylistUpdated(
    playlistUri: string,
    playlistData: PlaylistData | null
  ): void {
    window.dispatchEvent(
      new CustomEvent(DATA_UPDATED_EVENT, {
        detail: { type: "keyboardShortcut", timestamp: Date.now() },
      })
    );
    window.dispatchEvent(
      new CustomEvent(PLAYLIST_CHANGED_EVENT, {
        detail: { playlistUri, playlistData, timestamp: Date.now() },
      })
    );
  }

  private notifyArtistUpdated(
    artistUri: string,
    artistData: ArtistData | null
  ): void {
    window.dispatchEvent(
      new CustomEvent(DATA_UPDATED_EVENT, {
        detail: { type: "keyboardShortcut", timestamp: Date.now() },
      })
    );
    window.dispatchEvent(
      new CustomEvent(ARTIST_CHANGED_EVENT, {
        detail: { artistUri, artistData, timestamp: Date.now() },
      })
    );
  }

  private async setRating(trackUri: string, rating: number): Promise<void> {
    const tagData = this.getTagData();
    if (!tagData) {
      return;
    }

    const now = Date.now();

    // Ensure track exists
    if (!tagData.tracks[trackUri]) {
      this.createTrackShell(trackUri);
    }

    const trackData = tagData.tracks[trackUri];
    let finalTrackData: TrackData | null = null;

    // Check if clearing the rating would make the track empty
    if (rating === 0 && trackData.energy === 0 && trackData.tagIds.length === 0) {
      // Remove track entirely
      delete tagData.tracks[trackUri];
    } else {
      trackData.rating = rating;
      trackData.dateModified = now;
      if (!trackData.dateCreated) {
        trackData.dateCreated = now;
      }
      finalTrackData = { ...trackData };
    }

    const saved = await this.persistTrackChange(trackUri, finalTrackData);
    if (saved) {
      this.notifyDataUpdated(trackUri, finalTrackData);
    }
  }

  private async setEnergy(trackUri: string, energy: number): Promise<void> {
    const tagData = this.getTagData();
    if (!tagData) {
      return;
    }

    const now = Date.now();

    // Ensure track exists
    if (!tagData.tracks[trackUri]) {
      this.createTrackShell(trackUri);
    }

    const trackData = tagData.tracks[trackUri];
    let finalTrackData: TrackData | null = null;

    // Check if clearing the energy would make the track empty
    if (energy === 0 && trackData.rating === 0 && trackData.tagIds.length === 0) {
      // Remove track entirely
      delete tagData.tracks[trackUri];
    } else {
      trackData.energy = energy;
      trackData.dateModified = now;
      if (!trackData.dateCreated) {
        trackData.dateCreated = now;
      }
      finalTrackData = { ...trackData };
    }

    const saved = await this.persistTrackChange(trackUri, finalTrackData);
    if (saved) {
      this.notifyDataUpdated(trackUri, finalTrackData);
    }
  }

  private async setPlaylistRating(
    playlistUri: string,
    rating: number,
    metadata?: ShortcutPlaylistMetadata | null
  ): Promise<void> {
    const tagData = this.getTagData();
    if (!tagData) {
      return;
    }

    const now = Date.now();
    if (!tagData.playlists[playlistUri]) {
      this.createPlaylistShell(playlistUri, metadata);
    }

    const playlistData = tagData.playlists[playlistUri];
    let finalPlaylistData: PlaylistData | null = null;

    if (rating === 0 && playlistData.energy === 0 && playlistData.tagIds.length === 0) {
      delete tagData.playlists[playlistUri];
    } else {
      playlistData.rating = rating;
      playlistData.dateModified = now;
      if (!playlistData.dateCreated) {
        playlistData.dateCreated = now;
      }
      finalPlaylistData = { ...playlistData };
    }

    const saved = await this.persistPlaylistChange(playlistUri, finalPlaylistData);
    if (saved) {
      this.notifyPlaylistUpdated(playlistUri, finalPlaylistData);
    }
  }

  private async setPlaylistEnergy(
    playlistUri: string,
    energy: number,
    metadata?: ShortcutPlaylistMetadata | null
  ): Promise<void> {
    const tagData = this.getTagData();
    if (!tagData) {
      return;
    }

    const now = Date.now();
    if (!tagData.playlists[playlistUri]) {
      this.createPlaylistShell(playlistUri, metadata);
    }

    const playlistData = tagData.playlists[playlistUri];
    let finalPlaylistData: PlaylistData | null = null;

    if (energy === 0 && playlistData.rating === 0 && playlistData.tagIds.length === 0) {
      delete tagData.playlists[playlistUri];
    } else {
      playlistData.energy = energy;
      playlistData.dateModified = now;
      if (!playlistData.dateCreated) {
        playlistData.dateCreated = now;
      }
      finalPlaylistData = { ...playlistData };
    }

    const saved = await this.persistPlaylistChange(playlistUri, finalPlaylistData);
    if (saved) {
      this.notifyPlaylistUpdated(playlistUri, finalPlaylistData);
    }
  }

  private async setArtistRating(
    artistUri: string,
    rating: number,
    metadata?: ShortcutArtistMetadata | null
  ): Promise<void> {
    const tagData = this.getTagData();
    if (!tagData) {
      return;
    }

    const now = Date.now();
    if (!tagData.artists[artistUri]) {
      this.createArtistShell(artistUri, metadata);
    }

    const artistData = tagData.artists[artistUri];
    let finalArtistData: ArtistData | null = null;

    if (rating === 0 && artistData.energy === 0 && artistData.tagIds.length === 0) {
      delete tagData.artists[artistUri];
    } else {
      artistData.rating = rating;
      artistData.dateModified = now;
      if (!artistData.dateCreated) {
        artistData.dateCreated = now;
      }
      finalArtistData = { ...artistData };
    }

    const saved = await this.persistArtistChange(artistUri, finalArtistData);
    if (saved) {
      this.notifyArtistUpdated(artistUri, finalArtistData);
    }
  }

  private async setArtistEnergy(
    artistUri: string,
    energy: number,
    metadata?: ShortcutArtistMetadata | null
  ): Promise<void> {
    const tagData = this.getTagData();
    if (!tagData) {
      return;
    }

    const now = Date.now();
    if (!tagData.artists[artistUri]) {
      this.createArtistShell(artistUri, metadata);
    }

    const artistData = tagData.artists[artistUri];
    let finalArtistData: ArtistData | null = null;

    if (energy === 0 && artistData.rating === 0 && artistData.tagIds.length === 0) {
      delete tagData.artists[artistUri];
    } else {
      artistData.energy = energy;
      artistData.dateModified = now;
      if (!artistData.dateCreated) {
        artistData.dateCreated = now;
      }
      finalArtistData = { ...artistData };
    }

    const saved = await this.persistArtistChange(artistUri, finalArtistData);
    if (saved) {
      this.notifyArtistUpdated(artistUri, finalArtistData);
    }
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

    const tagData = this.getTagData();
    if (!tagData) {
      return;
    }

    const currentData =
      shortcutTarget.type === "track"
        ? tagData.tracks[shortcutTarget.uri]
        : shortcutTarget.type === "playlist"
          ? tagData.playlists[shortcutTarget.uri]
          : tagData.artists[shortcutTarget.uri];

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

    // Handle energy ratings (with Shift)
    if (isShiftPressed) {
      event.preventDefault();
      event.stopPropagation();

      const newEnergy = digitToEnergyRating[digit];
      const currentEnergy = currentData?.energy || 0;

      // Toggle: if same energy, clear it
      const nextEnergy = currentEnergy === newEnergy ? 0 : newEnergy;

      if (shortcutTarget.type === "track") {
        void this.setEnergy(shortcutTarget.uri, nextEnergy);
      } else if (shortcutTarget.type === "playlist") {
        void this.setPlaylistEnergy(
          shortcutTarget.uri,
          nextEnergy,
          shortcutTarget.metadata
        );
      } else {
        void this.setArtistEnergy(
          shortcutTarget.uri,
          nextEnergy,
          shortcutTarget.metadata
        );
      }
      return;
    }

    // Handle star ratings (no Shift)
    event.preventDefault();
    event.stopPropagation();

    const newRating = digitToStarRating[digit];
    const currentRating = currentData?.rating || 0;

    // Toggle: if same rating, clear it
    const nextRating = currentRating === newRating ? 0 : newRating;

    if (shortcutTarget.type === "track") {
      void this.setRating(shortcutTarget.uri, nextRating);
    } else if (shortcutTarget.type === "playlist") {
      void this.setPlaylistRating(
        shortcutTarget.uri,
        nextRating,
        shortcutTarget.metadata
      );
    } else {
      void this.setArtistRating(
        shortcutTarget.uri,
        nextRating,
        shortcutTarget.metadata
      );
    }
  }
}

// Export singleton instance
export const keyboardShortcutService = new KeyboardShortcutService();
