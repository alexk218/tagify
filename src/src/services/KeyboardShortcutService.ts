/**
 * GLOBAL KEYBOARD SHORTCUT SERVICE
 *
 * Manages keyboard shortcuts for rating tracks outside of React lifecycle.
 * This allows shortcuts to work even when the Tagify app is not mounted.
 * Does this by reading/writing directly to localStorage
 */

const DATA_UPDATED_EVENT = "tagify:dataUpdated";
const TAG_DATA_KEY = "tagify:tagData";
const LOCK_STATE_KEY = "tagify:lockState";
const LOCKED_TRACK_KEY = "tagify:lockedTrack";
const APP_MOUNTED_KEY = "tagify:appMounted";
const SETTINGS_KEY = "tagify:keyboardShortcutSettings";

interface TrackData {
  rating: number;
  energy: number;
  bpm: number | null;
  tags: Array<{ categoryId: string; subcategoryId: string; tagId: string }>;
  dateCreated?: number;
  dateModified?: number;
}

interface TagDataStructure {
  categories: Array<unknown>;
  tracks: { [trackUri: string]: TrackData };
}

class KeyboardShortcutService {
  private isInitialized = false;
  private boundHandler: ((event: KeyboardEvent) => void) | null = null;
  private boundSettingsHandler: ((event: Event) => void) | null = null;

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

  // initialize keyboard shortcut listener. call once when Spotify starts (called from extension.js)
  initialize(): void {
    if (this.isInitialized) {
      return;
    }

    // Check if shortcuts are disabled in settings
    const settings = this.getSettings();
    if (!settings.enabled) {
      this.listenForSettingsChanges();
      return;
    }

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

  // read tag data from localStorage
  private getTagData(): TagDataStructure | null {
    try {
      const raw = localStorage.getItem(TAG_DATA_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (error) {
      console.error("Tagify: Error reading tag data from localStorage", error);
      return null;
    }
  }

  // write tag data to localStorage
  private saveTagData(tagData: TagDataStructure): boolean {
    try {
      localStorage.setItem(TAG_DATA_KEY, JSON.stringify(tagData));
      return true;
    } catch (error) {
      console.error("Tagify: Error saving tag data to localStorage", error);
      return false;
    }
  }

  // dispatch event. notify React components that data has changed
  private notifyDataUpdated(): void {
    window.dispatchEvent(
      new CustomEvent(DATA_UPDATED_EVENT, {
        detail: { type: "keyboardShortcut", timestamp: Date.now() },
      })
    );
  }

  private setRating(trackUri: string, rating: number): void {
    const tagData = this.getTagData();
    if (!tagData) {
      return;
    }

    const now = Date.now();

    // Ensure track exists
    if (!tagData.tracks[trackUri]) {
      tagData.tracks[trackUri] = {
        rating: 0,
        energy: 0,
        bpm: null,
        tags: [],
        dateCreated: now,
        dateModified: now,
      };
    }

    const trackData = tagData.tracks[trackUri];

    // Check if clearing the rating would make the track empty
    if (rating === 0 && trackData.energy === 0 && trackData.tags.length === 0) {
      // Remove track entirely
      delete tagData.tracks[trackUri];
    } else {
      trackData.rating = rating;
      trackData.dateModified = now;
      if (!trackData.dateCreated) {
        trackData.dateCreated = now;
      }
    }

    if (this.saveTagData(tagData)) {
      this.notifyDataUpdated();
    }
  }

  private setEnergy(trackUri: string, energy: number): void {
    const tagData = this.getTagData();
    if (!tagData) {
      return;
    }

    const now = Date.now();

    // Ensure track exists
    if (!tagData.tracks[trackUri]) {
      tagData.tracks[trackUri] = {
        rating: 0,
        energy: 0,
        bpm: null,
        tags: [],
        dateCreated: now,
        dateModified: now,
      };
    }

    const trackData = tagData.tracks[trackUri];

    // Check if clearing the energy would make the track empty
    if (energy === 0 && trackData.rating === 0 && trackData.tags.length === 0) {
      // Remove track entirely
      delete tagData.tracks[trackUri];
    } else {
      trackData.energy = energy;
      trackData.dateModified = now;
      if (!trackData.dateCreated) {
        trackData.dateCreated = now;
      }
    }

    if (this.saveTagData(tagData)) {
      this.notifyDataUpdated();
    }
  }

  private handleKeyPress(event: KeyboardEvent): void {
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

    // Get currently playing track
    const targetTrackUri = this.getTargetTrackUri();
    if (!targetTrackUri) return;

    // Get current track data for toggle behavior
    const tagData = this.getTagData();
    const trackData = tagData?.tracks[targetTrackUri];

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
      const currentEnergy = trackData?.energy || 0;

      // Toggle: if same energy, clear it
      if (currentEnergy === newEnergy) {
        this.setEnergy(targetTrackUri, 0);
      } else {
        this.setEnergy(targetTrackUri, newEnergy);
      }
      return;
    }

    // Handle star ratings (no Shift)
    event.preventDefault();
    event.stopPropagation();

    const newRating = digitToStarRating[digit];
    const currentRating = trackData?.rating || 0;

    // Toggle: if same rating, clear it
    if (currentRating === newRating) {
      this.setRating(targetTrackUri, 0);
    } else {
      this.setRating(targetTrackUri, newRating);
    }
  }
}

// Export singleton instance
export const keyboardShortcutService = new KeyboardShortcutService();
