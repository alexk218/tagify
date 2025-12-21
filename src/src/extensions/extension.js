/* global Spicetify */
import { keyboardShortcutService } from "../services/KeyboardShortcutService";

(async () => {
  while (!Spicetify?.Platform && !Spicetify?.CosmosAsync) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Initialize keyboard shortcuts immediately
  keyboardShortcutService.initialize();

  const APP_NAME = "tagify";

  const TAG_DATA_KEY = "tagify:tagData";
  const PLAYLIST_CACHE_KEY = "tagify:playlistCache";
  const PLAYLIST_SETTINGS_KEY = "tagify:playlistSettings";
  const EXTENSION_SETTINGS_KEY = "tagify:extensionSettings";
  const SETTINGS_CHANGED_EVENT = "tagify:settingsChanged";
  const DATA_UPDATED_EVENT = "tagify:dataUpdated";

  // ! SET TO TRUE TO DEBUG
  const DEBUG_MODE = false;

  const Logger = {
    log(...args) {
      if (DEBUG_MODE) {
        console.log("🏷️ Tagify:", ...args);
      }
    },

    warn(...args) {
      if (DEBUG_MODE) {
        console.warn("⚠️ Tagify:", ...args);
      }
    },

    error(...args) {
      // Always log errors, even in production
      console.error("❌ Tagify:", ...args);
    },

    debug(...args) {
      if (DEBUG_MODE) {
        console.log("🔍 Debug:", ...args);
      }
    },

    performance(label, duration) {
      if (DEBUG_MODE) {
        console.log(`⏱️ ${label}: ${duration.toFixed(2)}ms`);
      }
    },
  };

  const PerformanceMonitor = {
    timers: new Map(),

    start(label) {
      if (DEBUG_MODE) {
        this.timers.set(label, performance.now());
      }
    },

    end(label) {
      if (!DEBUG_MODE) return;

      const start = this.timers.get(label);
      if (start) {
        const duration = performance.now() - start;
        Logger.performance(label, duration);
        this.timers.delete(label);
        return duration;
      }
    },

    measure(label, fn) {
      if (!DEBUG_MODE) {
        return fn(); // Just execute without measuring
      }

      this.start(label);
      const result = fn();
      this.end(label);
      return result;
    },

    measureAsync(label, asyncFn) {
      if (!DEBUG_MODE) {
        return asyncFn(); // Just execute without measuring
      }

      this.start(label);
      return asyncFn().finally(() => this.end(label));
    },
  };

  // Shared state
  const state = {
    taggedTracks: {},
    observer: null,
    nowPlayingWidgetTagInfo: null,
    playlistCacheMemory: null,
    activeExtensions: {
      tracklistEnhancer: true,
      playbarEnhancer: true,
    },
    initialized: {
      menu: false,
      tracklistEnhancer: false,
      playbarEnhancer: false,
    },
  };

  const DEFAULT_EXTENSION_SETTINGS = {
    enableTracklistEnhancer: true,
    enablePlaybarEnhancer: true,
  };

  const settingsUtils = {
    /**
     * Load extension settings from localStorage
     * @returns {boolean} whether data was successfully loaded
     */
    loadExtensionSettings() {
      try {
        const savedExtensionSettings = localStorage.getItem(
          EXTENSION_SETTINGS_KEY
        );
        if (savedExtensionSettings) {
          const data = JSON.parse(savedExtensionSettings);
          state.activeExtensions.tracklistEnhancer =
            data.enableTracklistEnhancer ?? true;
          state.activeExtensions.playbarEnhancer =
            data.enablePlaybarEnhancer ?? true;
          return true;
        } else {
          // create initial localStorage item
          this.saveExtensionSettings(DEFAULT_EXTENSION_SETTINGS);
          state.activeExtensions.tracklistEnhancer =
            DEFAULT_EXTENSION_SETTINGS.enableTracklistEnhancer;
          state.activeExtensions.playbarEnhancer =
            DEFAULT_EXTENSION_SETTINGS.enablePlaybarEnhancer;
          return false; // Indicates we created defaults
        }
      } catch (error) {
        console.error("Tagify: Error loading extension settings", error);
        this.saveExtensionSettings(DEFAULT_EXTENSION_SETTINGS);
        return false;
      }
    },
    saveExtensionSettings(settings) {
      localStorage.setItem(EXTENSION_SETTINGS_KEY, JSON.stringify(settings));
    },
    subscribe() {
      window.addEventListener(SETTINGS_CHANGED_EVENT, (event) => {
        this.handleSettingsChange(event.detail);
      });
    },

    handleSettingsChange(newSettings) {
      const oldSettings = { ...state.activeExtensions };

      state.activeExtensions.tracklistEnhancer =
        newSettings.enableTracklistEnhancer;
      state.activeExtensions.playbarEnhancer =
        newSettings.enablePlaybarEnhancer;

      if (
        oldSettings.tracklistEnhancer !==
        state.activeExtensions.tracklistEnhancer
      ) {
        if (state.activeExtensions.tracklistEnhancer) {
          tracklistEnhancer.initialize();
        } else {
          tracklistEnhancer.disable();
        }
      }

      if (
        oldSettings.playbarEnhancer !== state.activeExtensions.playbarEnhancer
      ) {
        if (state.activeExtensions.playbarEnhancer) {
          playbarEnhancer.initialize();
        } else {
          playbarEnhancer.disable();
        }
      }
    },
  };

  // Shared utilities
  const utils = {
    /**
     * Load tagged tracks from localStorage
     * @returns {boolean} whether data was successfully loaded
     */
    loadTaggedTracks() {
      try {
        const savedData = localStorage.getItem(TAG_DATA_KEY);
        if (savedData) {
          const data = JSON.parse(savedData);
          if (data && data.tracks) {
            state.taggedTracks = data.tracks;
            return true;
          }
        }
      } catch (error) {
        console.error("Tagify: Error loading data", error);
      }
      return false;
    },

    /**
     * Check if a track is tagged
     * @param {string} trackUri - The track URI to check
     * @returns {boolean} Whether the track is tagged
     */
    isTrackTagged(trackUri) {
      if (!(trackUri in state.taggedTracks)) return false;

      const track = state.taggedTracks[trackUri];

      // Check if track has any meaningful data
      const hasRating = track.rating > 0;
      const hasEnergy = track.energy > 0;
      const hasBpm = track.bpm !== null && track.bpm > 0;
      const hasTags = track.tags && track.tags.length > 0;

      return hasRating || hasEnergy || hasBpm || hasTags;
    },

    /**
     * Get playlist cache from localStorage
     * @returns {Object} The playlist cache
     */
    getPlaylistCache() {
      if (state.playlistCacheMemory) {
        return state.playlistCacheMemory;
      }

      try {
        const cacheString = localStorage.getItem(PLAYLIST_CACHE_KEY);
        if (cacheString) {
          state.playlistCacheMemory = JSON.parse(cacheString);
          return state.playlistCacheMemory;
        }
      } catch (error) {
        console.error("Tagify: Error reading playlist cache:", error);
      }

      // Return empty cache if not found or error
      const emptyCache = { tracks: {}, lastUpdated: 0 };
      state.playlistCacheMemory = emptyCache;
      return emptyCache;
    },

    /**
     * Get playlist settings from localStorage
     * @returns {Object} The playlist settings
     */
    getPlaylistSettings() {
      try {
        const settingsString = localStorage.getItem(PLAYLIST_SETTINGS_KEY);
        if (settingsString) {
          return JSON.parse(settingsString);
        }
      } catch (error) {
        console.error("Tagify: Error reading playlist settings:", error);
      }

      // Return default settings if not found or error
      return {
        excludeNonOwnedPlaylists: true,
        excludedPlaylistKeywords: [
          "Daylist",
          "Discover Weekly",
          "Release Radar",
        ],
        excludedPlaylistIds: [],
        excludeByDescription: ["ignore"],
      };
    },

    /**
     * Check if a playlist is excluded based on settings
     * @param {string} playlistId - The playlist ID
     * @param {string} playlistName - The playlist name
     * @returns {boolean} Whether the playlist is excluded
     */
    isPlaylistExcluded(playlistId, playlistName, playlistDescription = "") {
      const settings = this.getPlaylistSettings();

      // Check specific excluded playlists
      if (settings.excludedPlaylistIds.includes(playlistId)) {
        return true;
      }

      // Check for excluded keywords in name
      if (
        settings.excludedPlaylistKeywords.some((keyword) =>
          playlistName.toLowerCase().includes(keyword.toLowerCase())
        )
      ) {
        return true;
      }

      // Check for description exclusions - important for "ignore" flag
      if (
        playlistDescription &&
        settings.excludeByDescription &&
        settings.excludeByDescription.some((term) =>
          playlistDescription.toLowerCase().includes(term.toLowerCase())
        )
      ) {
        return true;
      }

      // Explicitly exclude "Local Files" playlist
      if (playlistName === "MASTER" || playlistName === "Local Files") {
        return true;
      }

      return false;
    },

    /**
     * Check if a track should show a warning for being only in Liked Songs
     * @param {string} trackUri - The track URI to check
     * @returns {boolean} Whether to show the warning
     */
    shouldShowLikedOnlyWarning(trackUri) {
      const cache = this.getPlaylistCache();
      const containingPlaylists = cache.tracks[trackUri] || [];

      // CRITICAL CHANGE: If track is not in any playlists, we SHOULD show a warning
      if (containingPlaylists.length === 0) return true;

      const hasNonExcludedPlaylists = containingPlaylists.some((playlist) => {
        // Check if this is a non-excluded, non-Liked Songs, non-Local Files playlist
        const result =
          playlist.id !== "liked" &&
          playlist.name !== "Local Files" &&
          !this.isPlaylistExcluded(playlist.id, playlist.name);

        return result;
      });
      return !hasNonExcludedPlaylists;
    },

    /**
     * Get playlist list for a track as a string
     * @param {string} trackUri - The track URI
     * @returns {string} Comma-separated list of playlists
     */
    getPlaylistListForTrack(trackUri) {
      const cache = this.getPlaylistCache();
      const containingPlaylists = cache.tracks[trackUri] || [];

      const relevantPlaylists = containingPlaylists.filter((playlist) => {
        // Exclude "Local Files" playlist and other excluded playlists
        const result =
          !this.isPlaylistExcluded(playlist.id, playlist.name) &&
          playlist.id !== "liked" &&
          playlist.name !== "Local Files";

        return result;
      });

      if (relevantPlaylists.length === 0) {
        if (trackUri.startsWith("spotify:local:")) {
          Logger.debug(`Tagify: No relevant playlists for local file`);
        }
        return "No regular playlists";
      }

      const playlistNames = relevantPlaylists
        .map((playlist) => playlist.name)
        .sort();

      return playlistNames.join(", ");
    },

    /**
     * Check if a track has incomplete tags
     * @param {string} trackUri - The track URI to check
     * @returns {boolean} Whether the track has incomplete tags
     */
    hasIncompleteTags(trackUri) {
      if (!state.taggedTracks[trackUri]) return true;

      const track = state.taggedTracks[trackUri];

      const missingRating = track.rating === 0 || track.rating === undefined;
      const missingEnergy = track.energy === 0 || track.energy === undefined;
      const missingTags = !track.tags || track.tags.length === 0;

      return missingRating || missingEnergy || missingTags;
    },

    /**
     * Get summary of track tags
     * @param {string} trackUri - The track URI
     * @returns {string} Summary of track tags
     */
    getTrackTagSummary(trackUri) {
      if (!this.isTrackTagged(trackUri)) return "";

      const track = state.taggedTracks[trackUri];
      let summary = [];

      if (track.rating > 0) {
        summary.push(`★ ${track.rating}`);
      }

      if (track.energy > 0) {
        summary.push(`E ${track.energy}`);
      }

      if (track.tags && track.tags.length > 0) {
        // Get tag names and deduplicate them
        const tagNames = new Set();
        track.tags.forEach((tag) => {
          // Support both tag formats
          const name = tag.tag || tag.name;
          if (name) tagNames.add(name);
        });

        if (tagNames.size > 0) {
          summary.push(`Tags: ${tagNames.size}`);
        }
      }

      return summary.join(" | ");
    },

    /**
     * Extract track URI from playlist row element
     * @param {HTMLElement} tracklistElement - The playlist row element
     * @returns {string|null} The track URI
     */
    getTracklistTrackUri(tracklistElement) {
      let values = Object.values(tracklistElement);
      if (!values) {
        Logger.error("Error: Could not get tracklist element");
        return null;
      }

      try {
        const findUri = (obj, depth = 0, path = "values[0]") => {
          if (depth > 10) return null;

          if (obj && typeof obj === "object") {
            if (
              obj.uri &&
              typeof obj.uri === "string" &&
              obj.uri.startsWith("spotify:")
            ) {
              Logger.debug("🔍 FOUND URI at path:", path + ".uri");
              Logger.debug("🔍 URI value:", obj.uri);
              return { uri: obj.uri, path: path + ".uri" };
            }

            // Check arrays
            if (Array.isArray(obj)) {
              for (let i = 0; i < obj.length; i++) {
                const result = findUri(obj[i], depth + 1, `${path}[${i}]`);
                if (result) return result;
              }
            } else {
              // Check object properties
              for (let key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                  const result = findUri(obj[key], depth + 1, `${path}.${key}`);
                  if (result) return result;
                }
              }
            }
          }
          return null;
        };

        const result = findUri(values[0]);
        if (result) {
          Logger.debug("✅ Use this path:", result.path);
          return result.uri;
        }
      } catch (error) {
        Logger.error("Error in getTracklistTrackUri:", error);
        return null;
      }

      Logger.warn("Warning: Could not extract URI from element");
      return null;
    },

    extractLocalFileUri(element) {
      try {
        // Try to find local file URI in various locations of the React component tree
        if (!element || !element.pendingProps) return null;

        // First direct check for uri property
        if (
          element.pendingProps.uri &&
          element.pendingProps.uri.startsWith("spotify:local:")
        ) {
          return element.pendingProps.uri;
        }

        // Check the track object if it exists
        if (
          element.pendingProps.track &&
          element.pendingProps.track.uri &&
          element.pendingProps.track.uri.startsWith("spotify:local:")
        ) {
          return element.pendingProps.track.uri;
        }

        // Deep search in children
        if (
          element.pendingProps.children &&
          Array.isArray(element.pendingProps.children)
        ) {
          for (const child of element.pendingProps.children) {
            if (child && child.props) {
              // Check if this child has the URI
              if (
                child.props.uri &&
                child.props.uri.startsWith("spotify:local:")
              ) {
                return child.props.uri;
              }

              // Check if it has a track object with URI
              if (
                child.props.track &&
                child.props.track.uri &&
                child.props.track.uri.startsWith("spotify:local:")
              ) {
                return child.props.track.uri;
              }
            }
          }
        }

        return null;
      } catch (error) {
        Logger.error("Error extracting local file URI:", error);
        return null;
      }
    },

    parseLocalFileUri(uri) {
      if (!uri.startsWith("spotify:local:")) {
        return { title: "Unknown Track", artist: "Unknown Artist" };
      }

      try {
        // Split the URI
        const parts = uri.split(":");

        // Handle different formats
        if (parts.length >= 5) {
          let title = "Local Track";
          let artist = "Local Artist";

          // Format with empty artist/album slots but has artist:title at the end
          if (parts[2] === "" && parts[3] === "") {
            artist = decodeURIComponent(parts[4].replace(/\+/g, " "));
            let potentialTitle =
              parts.length > 5
                ? decodeURIComponent(parts[5].replace(/\+/g, " "))
                : "";

            // Check if the title part is just a number (likely duration)
            if (potentialTitle && !isNaN(Number(potentialTitle))) {
              title = artist; // Use the artist field as title
              artist = "Local Artist";
            } else {
              title = potentialTitle;
            }
          }
          // Format with artist, album, title fields
          else if (parts[2] && parts[3] && parts[4]) {
            artist = decodeURIComponent(parts[2].replace(/\+/g, " "));
            title = decodeURIComponent(parts[4].replace(/\+/g, " "));
          }

          // Clean up the title (remove file extension)
          title = title.replace(/\.[^/.]+$/, "").trim();
          artist = artist.trim();

          // Set defaults if empty
          if (!title) title = "Local Track";
          if (!artist) artist = "Local Artist";

          return { title, artist };
        }
      } catch (error) {
        console.error("Error parsing local file URI:", error);
      }

      return { title: "Local Track", artist: "Unknown Artist" };
    },

    /**
     * Wait for an element to exist in the DOM
     * @param {string} selector - CSS selector to wait for
     * @returns {Promise<HTMLElement>} The found element
     */
    async waitForElement(selector) {
      while (!document.querySelector(selector)) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return document.querySelector(selector);
    },
  };

  // Context menu feature - adds "Tag with Tagify" to context menu
  const contextMenuItem = {
    /**
     * Initialize the context menu feature
     */
    initialize() {
      if (state.initialized.menu) return;

      if (!Spicetify.ContextMenu) {
        console.warn(
          "Tagify: Spicetify.ContextMenu not available, menu feature disabled"
        );
        return;
      }

      try {
        // Single track menu item
        new Spicetify.ContextMenu.Item(
          "Tag with Tagify",
          this.handleMenuClick,
          this.shouldShowSingleMenu,
          `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M21.41,11.58L12.41,2.58C12.04,2.21 11.53,2 11,2H4C2.9,2 2,2.9 2,4V11C2,11.53 2.21,12.04 2.59,12.42L11.59,21.42C11.96,21.79 12.47,22 13,22C13.53,22 14.04,21.79 14.41,21.42L21.41,14.42C21.79,14.04 22,13.53 22,13C22,12.47 21.79,11.96 21.41,11.58M5.5,7C4.67,7 4,6.33 4,5.5C4,4.67 4.67,4 5.5,4C6.33,4 7,4.67 7,5.5C7,6.33 6.33,7 5.5,7Z"/>
        </svg>`
        ).register();

        // Multiple tracks menu item
        new Spicetify.ContextMenu.Item(
          "Bulk Tag",
          this.handleMenuClick,
          this.shouldShowBulkMenu,
          `<svg width="16" height="16" viewBox="0 0 24 24" fill="#FF6B35">
          <path d="M21.41,11.58L12.41,2.58C12.04,2.21 11.53,2 11,2H4C2.9,2 2,2.9 2,4V11C2,11.53 2.21,12.04 2.59,12.42L11.59,21.42C11.96,21.79 12.47,22 13,22C13.53,22 14.04,21.79 14.41,21.42L21.41,14.42C21.79,14.04 22,13.53 22,13C22,12.47 21.79,11.96 21.41,11.58M5.5,7C4.67,7 4,6.33 4,5.5C4,4.67 4.67,4 5.5,4C6.33,4 7,4.67 7,5.5C7,6.33 6.33,7 5.5,7Z"/>
          </svg>`
        ).register();

        state.initialized.menu = true;
      } catch (error) {
        console.error("Tagify: Error initializing menu feature:", error);
      }
    },

    /**
     * Show single track menu for 1 track or mixed selection
     * @param {string[]} uris - The URIs of the selected items
     * @returns {boolean} Whether to show single track menu
     */
    shouldShowSingleMenu(uris) {
      const trackUris = uris.filter(
        (uri) =>
          uri.startsWith("spotify:track:") || uri.startsWith("spotify:local:")
      );
      return trackUris.length === 1;
    },

    /**
     * Show bulk menu for multiple tracks
     * @param {string[]} uris - The URIs of the selected items
     * @returns {boolean} Whether to show bulk menu
     */
    shouldShowBulkMenu(uris) {
      const trackUris = uris.filter(
        (uri) =>
          uri.startsWith("spotify:track:") || uri.startsWith("spotify:local:")
      );
      return trackUris.length > 1;
    },

    /**
     * Handle the menu item click
     * @param {string[]} uris - The URIs of the selected items
     */
    handleMenuClick(uris) {
      if (uris.length === 0) return;

      // Filter to only track URIs
      const trackUris = uris.filter(
        (uri) =>
          uri.startsWith("spotify:track:") || uri.startsWith("spotify:local:")
      );

      if (trackUris.length === 1) {
        // Single track selection - use standard navigation
        const trackUri = trackUris[0];

        Spicetify.Platform.History.push({
          pathname: `/${APP_NAME}`,
          search: `?uri=${encodeURIComponent(trackUri)}`,
          state: { trackUri },
        });
      } else if (trackUris.length > 1) {
        // Multiple track selection - use bulk tagging
        const encodedUris = encodeURIComponent(JSON.stringify(trackUris));

        Spicetify.Platform.History.push({
          pathname: `/${APP_NAME}`,
          search: `?uris=${encodedUris}`,
          state: { trackUris },
        });
      }
    },
  };

  // Tracklist indicator feature - adds 'Tagify' column to tracklists
  const tracklistEnhancer = {
    tracklistObservers: new Set(),
    updateInterval: null,
    processedElements: new WeakSet(),
    lastProcessedCount: 0,
    smartUpdateInterval: null,
    isIdle: false,
    lastActivityTime: Date.now(),

    /**
     * Initialize the tracklist indicator feature
     */
    initialize() {
      if (state.initialized.tracklistEnhancer) return;
      if (!state.activeExtensions.tracklistEnhancer) return;

      try {
        // Set up mutation observer
        this.setupObserver();

        // Initial processing
        setTimeout(this.updateTracklists.bind(this), 500);

        // Start smart interval management instead of fixed interval
        this.startSmartUpdates();

        // Setup debug utility
        window.tagifyDebug = {
          reprocess: this.updateTracklists.bind(this),
          getData: () => state.taggedTracks,
          checkTrack: (uri) =>
            Logger.debug(`Track ${uri} is tagged: ${utils.isTrackTagged(uri)}`),
        };

        state.initialized.tracklistEnhancer = true;
      } catch (error) {
        console.error(
          "Tagify: Error initializing tracklist indicator feature:",
          error
        );
      }
    },

    /**
     * Smart interval management with idle detection
     */
    startSmartUpdates() {
      // Clear any existing interval
      if (this.smartUpdateInterval) {
        clearTimeout(this.smartUpdateInterval);
      }

      // Start with shorter intervals, extend when idle
      this.scheduleNextUpdate();

      // Track user activity to detect idle state
      this.trackUserActivity();
    },

    scheduleNextUpdate() {
      const timeSinceActivity = Date.now() - this.lastActivityTime;
      let interval;

      if (timeSinceActivity < 5000) {
        // Active in last 5 seconds
        interval = 1000; // Check every second
        this.isIdle = false;
      } else if (timeSinceActivity < 30000) {
        // Active in last 30 seconds
        interval = 3000; // Check every 3 seconds
        this.isIdle = false;
      } else {
        interval = 10000; // Check every 10 seconds when idle
        this.isIdle = true;
      }

      this.smartUpdateInterval = setTimeout(() => {
        if (this.isIdle) {
          Logger.log("Idle update check");
        }
        this.updateTracklists();
        this.scheduleNextUpdate(); // Schedule next update
      }, interval);
    },

    trackUserActivity() {
      const activityEvents = ["click", "scroll", "keydown", "mousemove"];

      const resetActivity = () => {
        this.lastActivityTime = Date.now();
        if (this.isIdle) {
          Logger.log("👆 User activity detected, exiting idle mode");
          this.isIdle = false;
        }
      };

      // Throttle mousemove to avoid excessive calls
      const throttledMouseMove = this.throttle(resetActivity, 1000);

      activityEvents.forEach((event) => {
        if (event === "mousemove") {
          document.addEventListener(event, throttledMouseMove, {
            passive: true,
          });
        } else {
          document.addEventListener(event, resetActivity, { passive: true });
        }
      });
    },

    /**
     * Set up mutation observer for tracking DOM changes
     */
    setupObserver() {
      if (state.observer) {
        state.observer.disconnect();
      }

      // Clear any existing tracklist observers
      this.tracklistObservers.forEach((observer) => observer.disconnect());
      this.tracklistObservers.clear();

      // Observer watches for tracklist changes
      const tracklistObserver = new MutationObserver(() => {
        // CHECK IF STILL ACTIVE BEFORE PROCESSING
        if (!state.activeExtensions.tracklistEnhancer) return;
        this.updateTracklists();
      });

      // Store reference for cleanup
      this.tracklistObservers.add(tracklistObserver);

      // Main observer - detects when tracklists are added to the DOM (when you change playlists)
      state.observer = new MutationObserver(async (mutations) => {
        // CHECK IF STILL ACTIVE BEFORE PROCESSING
        if (!state.activeExtensions.tracklistEnhancer) return;

        for (const mutation of mutations) {
          if (mutation.type === "childList") {
            const addedTracklists = Array.from(mutation.addedNodes).filter(
              (node) =>
                node.nodeType === Node.ELEMENT_NODE &&
                (node.classList?.contains("main-trackList-indexable") ||
                  node.querySelector?.(".main-trackList-indexable"))
            );

            if (addedTracklists.length > 0) {
              this.updateTracklists();

              // Observe each tracklist for changes
              const tracklists = document.getElementsByClassName(
                "main-trackList-indexable"
              );
              for (const tracklist of tracklists) {
                const newObserver = new MutationObserver(() => {
                  if (!state.activeExtensions.tracklistEnhancer) return;
                  this.updateTracklists();
                });

                newObserver.observe(tracklist, {
                  childList: true, // Watch for added/removed children
                  subtree: true, // Watch all descendants
                });

                // Store reference for cleanup
                this.tracklistObservers.add(newObserver);
              }
            }
          }
        }
      });

      // Start observing the whole document
      state.observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      // Get all tracklists and observe them for changes
      const tracklists = document.getElementsByClassName(
        "main-trackList-indexable"
      );
      for (const tracklist of tracklists) {
        const newObserver = new MutationObserver(() => {
          if (!state.activeExtensions.tracklistEnhancer) return;
          this.updateTracklists();
        });

        newObserver.observe(tracklist, {
          childList: true,
          subtree: true,
        });

        this.tracklistObservers.add(newObserver);
      }
    },

    /**
     * Update all tracklists on the page with change detection
     */
    updateTracklists() {
      // CHECK IF STILL ACTIVE BEFORE PROCESSING
      if (!state.activeExtensions.tracklistEnhancer) return;

      const tracklists = document.getElementsByClassName(
        "main-trackList-indexable"
      );

      if (tracklists.length === 0) {
        Logger.debug("No tracklists found, skipping update");
        return;
      }

      let hasChanges = false;

      for (const tracklist of tracklists) {
        if (this.hasTracklistChanged(tracklist)) {
          hasChanges = true;
          this.processTracklist(tracklist);
          this.markTracklistAsProcessed(tracklist);
        }
      }

      if (!hasChanges) {
        Logger.debug("No changes detected, skipping processing");
      }
    },

    /**
     * Check if a tracklist has changed since last processing
     */
    hasTracklistChanged(tracklist) {
      // Check if we've already processed this exact tracklist
      if (this.processedElements.has(tracklist)) {
        const trackRows = tracklist.querySelectorAll(
          ".main-trackList-trackListRow"
        );
        const currentCount = trackRows.length;

        // Check if track count changed
        const lastCount = tracklist.dataset.tagifyLastCount || 0;
        if (parseInt(lastCount) !== currentCount) {
          Logger.log(`Track count changed: ${lastCount} -> ${currentCount}`);
          return true;
        }

        // Check if any new rows were added
        const unprocessedRows = Array.from(trackRows).filter(
          (row) => !row.querySelector(".tagify-info")
        );

        if (unprocessedRows.length > 0) {
          Logger.log(`Found ${unprocessedRows.length} unprocessed rows`);
          return true;
        }

        return false; // No changes detected
      }

      return true; // Never processed before
    },

    /**
     * Mark a tracklist as processed
     */
    markTracklistAsProcessed(tracklist) {
      this.processedElements.add(tracklist);
      const trackRows = tracklist.querySelectorAll(
        ".main-trackList-trackListRow"
      );
      tracklist.dataset.tagifyLastCount = trackRows.length.toString();
    },

    /**
     * Process all tracks in a tracklist
     * @param {HTMLElement} tracklist - The tracklist to process
     */
    processTracklist(tracklist) {
      if (!tracklist) return;

      Logger.log("Actually processing tracklist (changes detected)");

      // Add column to header first (with duplicate check)
      const header = tracklist.querySelector(
        ".main-trackList-trackListHeaderRow"
      );
      if (header && !header.querySelector(".tagify-header")) {
        this.addColumnToHeader(header);
      }

      // Only process unprocessed track rows
      const trackRows = tracklist.querySelectorAll(
        ".main-trackList-trackListRow"
      );
      const unprocessedRows = Array.from(trackRows).filter(
        (row) => !row.querySelector(".tagify-info")
      );

      Logger.log(
        `Processing ${unprocessedRows.length} new rows out of ${trackRows.length} total`
      );

      unprocessedRows.forEach((row) => {
        this.addTagInfoToTrack(row);
      });
    },

    /**
     * Build dynamic grid template based on column count
     * @param {number} totalColumns - Total number of columns including ours
     * @param {number} tagifyColumnIndex - The index where our Tagify column is positioned
     * @returns {string} CSS grid template string
     */
    buildDynamicGrid(totalColumns, tagifyColumnIndex) {
      let template = "[index] 16px [first] 3fr";

      // Build variable columns
      for (let i = 1; i < totalColumns - 2; i++) {
        const columnIndex = i + 2; // Start from 3 since we have index(1) and first(2)

        if (columnIndex === tagifyColumnIndex) {
          // This is our Tagify column - make it narrow
          template += ` [var${i}] 80px`;
        } else {
          // Other extension columns or standard columns
          template += ` [var${i}] 2fr`;
        }
      }

      // Add the last column (usually duration/menu)
      template += " [last] minmax(120px,1fr)";

      return `grid-template-columns: ${template} !important`;
    },

    /**
     * Add column to tracklist header with dynamic grid management
     * @param {HTMLElement} header - The header element
     */
    addColumnToHeader(header) {
      if (!header || header.querySelector(".tagify-header")) return;

      // Find the last column to insert before
      const lastColumn = header.querySelector(".main-trackList-rowSectionEnd");
      if (!lastColumn) return;

      // Count existing columns before adding ours
      const existingColumns = header.querySelectorAll(
        '[class*="main-trackList-rowSection"]'
      );
      const currentColumnCount = existingColumns.length;

      // Get current column index and increment it for the last column
      const colIndex = parseInt(lastColumn.getAttribute("aria-colindex"));
      lastColumn.setAttribute("aria-colindex", (colIndex + 1).toString());

      // Create our new column
      const tagColumn = document.createElement("div");
      tagColumn.classList.add("main-trackList-rowSectionVariable");
      tagColumn.classList.add("tagify-header");
      tagColumn.setAttribute("role", "columnheader");
      tagColumn.setAttribute("aria-colindex", colIndex.toString());
      tagColumn.style.display = "flex";
      tagColumn.style.justifyContent = "center";

      // Add a button with header text
      const headerButton = document.createElement("button");
      headerButton.classList.add("main-trackList-column");
      headerButton.classList.add("main-trackList-sortable");

      const headerText = document.createElement("span");
      headerText.classList.add("TypeElement-mesto-type");
      headerText.classList.add("standalone-ellipsis-one-line");
      headerText.textContent = "Tagify";

      headerButton.appendChild(headerText);
      tagColumn.appendChild(headerButton);

      // Insert our column before the last column
      header.insertBefore(tagColumn, lastColumn);

      // Build and apply dynamic grid template based on new column count
      const newColumnCount = currentColumnCount + 1;
      const gridTemplate = this.buildDynamicGrid(newColumnCount, colIndex);
      header.setAttribute("style", gridTemplate);
    },

    /**
     * Add Tagify info to track row with observer isolation
     * @param {HTMLElement} row - The track row element
     */
    addTagInfoToTrack(row) {
      // Skip if already processed
      if (row.querySelector(".tagify-info")) return;

      // Temporarily disconnect observers to prevent feedback
      this.temporarilyDisconnectObservers(() => {
        this.addTagInfoToTrackInternal(row);
      });
    },

    /**
     * Internal method for adding tag info without observer management
     */
    addTagInfoToTrackInternal(row) {
      // Get track URI
      const trackUri = utils.getTracklistTrackUri(row);

      // Skip if no URI found
      if (!trackUri) return;

      // Ensure we're dealing with a track URI (either Spotify track or local file)
      if (!trackUri.includes("track") && !trackUri.startsWith("spotify:local:"))
        return;

      // Find the last column to insert before
      const lastColumn = row.querySelector(".main-trackList-rowSectionEnd");
      if (!lastColumn) return;

      // Count existing columns before adding ours
      const existingColumns = row.querySelectorAll(
        '[class*="main-trackList-rowSection"]'
      );
      const currentColumnCount = existingColumns.length;

      // Get column index and increment it for the last column
      const colIndex = parseInt(lastColumn.getAttribute("aria-colindex"));
      lastColumn.setAttribute("aria-colindex", (colIndex + 1).toString());

      // Create our tag info column
      const tagColumn = document.createElement("div");
      tagColumn.classList.add("main-trackList-rowSectionVariable");
      tagColumn.classList.add("tagify-info");
      tagColumn.setAttribute("aria-colindex", colIndex.toString());
      tagColumn.style.display = "flex";
      tagColumn.style.alignItems = "center";

      // Make the entire column clickable
      tagColumn.style.cursor = "pointer";
      tagColumn.onclick = (e) => {
        // Prevent default row click behavior
        e.stopPropagation();

        // Navigate to Tagify with this track
        Spicetify.Platform.History.push({
          pathname: `/${APP_NAME}`,
          search: `?uri=${encodeURIComponent(trackUri)}`,
          state: { trackUri },
        });
      };

      // Create a structured layout for consistent positioning
      const container = document.createElement("div");
      container.style.display = "flex";
      container.style.width = "100%";
      container.style.alignItems = "center";
      container.style.justifyContent = "center";

      // Create the tag info element (left side)
      const tagInfo = document.createElement("div");
      tagInfo.style.display = "flex";
      tagInfo.style.alignItems = "center";
      tagInfo.style.justifyContent = "center";

      // Check if track is tagged
      const isTagged = utils.isTrackTagged(trackUri);

      if (isTagged) {
        const summary = utils.getTrackTagSummary(trackUri);
        const tagText = document.createElement("div");

        // Check if track has incomplete tags (missing rating or energy)
        const incomplete = utils.hasIncompleteTags(trackUri);

        // Use orange bullet for incomplete tags, green for complete tags
        const bulletColor = incomplete ? "#FFA500" : "#1DB954";

        // Truncate long summaries for narrow column
        const truncatedSummary =
          summary.length > 12 ? summary.substring(0, 12) + "..." : summary;

        tagText.innerHTML = `<span style="color:${bulletColor}; margin-right:4px;">●</span>${truncatedSummary}`;
        tagText.style.fontSize = "12px";
        tagText.style.overflow = "hidden";
        tagText.style.whiteSpace = "nowrap";
        tagText.style.textOverflow = "ellipsis";
        tagText.style.display = "flex";
        tagText.style.alignItems = "center";
        tagText.style.width = "100%";

        // Add tooltip with detailed tag list
        if (
          trackUri in state.taggedTracks &&
          state.taggedTracks[trackUri].tags &&
          state.taggedTracks[trackUri].tags.length > 0
        ) {
          const tagList = this.createTagListTooltip(trackUri);
          tagText.title = tagList;
        }

        tagInfo.appendChild(tagText);
      } else {
        // Show untagged indicator with 3 dots
        const untaggedText = document.createElement("div");
        untaggedText.style.display = "flex";
        untaggedText.style.alignItems = "center";
        untaggedText.style.justifyContent = "center";
        untaggedText.style.width = "100%";
        untaggedText.style.height = "100%";
        untaggedText.style.minHeight = "40px";
        untaggedText.style.cursor = "pointer";

        // Create the dots element
        const dotsSpan = document.createElement("span");
        dotsSpan.innerHTML = "⋯";
        dotsSpan.style.color = "#999";
        dotsSpan.style.fontSize = "20px";
        dotsSpan.style.lineHeight = "1";
        dotsSpan.style.transition = "color 0.2s ease";
        dotsSpan.style.textAlign = "center";

        untaggedText.appendChild(dotsSpan);

        // Add hover tooltip
        untaggedText.title = "Tag with Tagify";

        // Add hover effect - only change the dots color
        untaggedText.addEventListener("mouseenter", () => {
          dotsSpan.style.color = "#fff";
        });

        untaggedText.addEventListener("mouseleave", () => {
          dotsSpan.style.color = "#999";
        });

        tagInfo.appendChild(untaggedText);
      }

      container.appendChild(tagInfo);
      tagColumn.appendChild(container);

      // Insert our column before the last column
      row.insertBefore(tagColumn, lastColumn);

      // Apply the same dynamic grid template to maintain consistency
      const newColumnCount = currentColumnCount + 1;
      const gridTemplate = this.buildDynamicGrid(newColumnCount, colIndex);
      row.setAttribute("style", gridTemplate);
    },

    /**
     * Create a formatted tooltip with all tags from a track
     * @param {string} trackUri - The track URI
     * @returns {string} Formatted tooltip text
     */
    createTagListTooltip(trackUri) {
      if (
        !state.taggedTracks[trackUri] ||
        !state.taggedTracks[trackUri].tags ||
        state.taggedTracks[trackUri].tags.length === 0
      ) {
        return "";
      }

      const track = state.taggedTracks[trackUri];

      // Process tags that have category structure (newer format)
      const structuredTags = track.tags.filter(
        (tag) => tag.categoryId && tag.subcategoryId && tag.tagId
      );

      if (structuredTags.length > 0) {
        // Get category data from localStorage if available
        let categories = [];
        try {
          const tagDataString = localStorage.getItem(TAG_DATA_KEY);
          if (tagDataString) {
            const tagData = JSON.parse(tagDataString);
            if (tagData && tagData.categories) {
              categories = tagData.categories;
            }
          }
        } catch (error) {
          console.error("Error loading categories:", error);
        }

        // Process structured tags with categories
        if (categories.length > 0) {
          const tagsByCategory = {};

          structuredTags.forEach((tag) => {
            const category = categories.find((c) => c.id === tag.categoryId);
            if (category) {
              const categoryName = category.name;
              const subcategory = category.subcategories.find(
                (s) => s.id === tag.subcategoryId
              );
              if (subcategory) {
                const subcategoryName = subcategory.name;
                const tagObj = subcategory.tags.find((t) => t.id === tag.tagId);
                if (tagObj) {
                  const tagName = tagObj.name;

                  if (!tagsByCategory[categoryName]) {
                    tagsByCategory[categoryName] = {};
                  }
                  if (!tagsByCategory[categoryName][subcategoryName]) {
                    tagsByCategory[categoryName][subcategoryName] = [];
                  }
                  tagsByCategory[categoryName][subcategoryName].push(tagName);
                }
              }
            }
          });

          const tagLines = [];
          Object.entries(tagsByCategory).forEach(
            ([_category, subcategories]) => {
              Object.entries(subcategories).forEach(([_subcategory, tags]) => {
                if (tags.length > 0) {
                  tagLines.push(tags.join(", "));
                }
              });
            }
          );

          if (tagLines.length > 0) {
            return tagLines.join("\n");
          }
        }
      }

      // Handle older format tags as fallback
      const simpleTags = track.tags
        .filter((tag) => tag.tag)
        .map((tag) => tag.tag);
      if (simpleTags.length > 0) {
        return simpleTags.join(", ");
      }

      return "";
    },

    /**
     * Temporarily disconnect observers during DOM modifications
     */
    temporarilyDisconnectObservers(callback) {
      // Disconnect all observers
      const observers = Array.from(this.tracklistObservers);
      observers.forEach((observer) => observer.disconnect());

      // Execute the callback
      callback();

      // Reconnect observers after a brief delay
      setTimeout(() => {
        this.reconnectObservers();
      }, 100);
    },

    /**
     * Reconnect all observers
     */
    reconnectObservers() {
      // Clear existing observers
      this.tracklistObservers.forEach((observer) => observer.disconnect());
      this.tracklistObservers.clear();

      // Re-setup observers
      this.setupObserver();
    },

    /**
     * Utility: Throttle function calls
     */
    throttle(func, limit) {
      let inThrottle;
      return (...args) => {
        if (!inThrottle) {
          func.apply(this, args);
          inThrottle = true;
          setTimeout(() => (inThrottle = false), limit);
        }
      };
    },

    /**
     * Disable the tracklist enhancer
     */
    disable() {
      // Clear the smart update interval
      if (this.smartUpdateInterval) {
        clearTimeout(this.smartUpdateInterval);
        this.smartUpdateInterval = null;
      }

      // Disconnect main observer
      if (state.observer) {
        state.observer.disconnect();
        state.observer = null;
      }

      // Disconnect all tracklist observers
      this.tracklistObservers.forEach((observer) => observer.disconnect());
      this.tracklistObservers.clear();

      // Remove ALL existing tag columns immediately
      document
        .querySelectorAll(".tagify-header, .tagify-info")
        .forEach((el) => {
          el.remove();
        });

      // Reset grid styles that were modified
      document
        .querySelectorAll('[style*="grid-template-columns"]')
        .forEach((el) => {
          el.removeAttribute("style");
        });

      // Clear processed elements cache
      this.processedElements = new WeakSet();

      state.initialized.tracklistEnhancer = false;
    },
  };

  // Playbar feature
  const playbarEnhancer = {
    /**
     * Initialize the playbar feature
     */
    async initialize() {
      if (state.initialized.playbarEnhancer) return;
      if (!state.activeExtensions.playbarEnhancer) return;

      try {
        // Wait for Player to be ready
        while (!Spicetify.Player || !Spicetify.Player.data) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Add listener for song changes
        Spicetify.Player.addEventListener(
          "songchange",
          this.updateNowPlayingWidget
        );

        // Initial update
        setTimeout(this.updateNowPlayingWidget, 1000);

        // Create a MutationObserver to watch for DOM changes
        const observer = new MutationObserver(() => {
          // Check if Now Playing widget might have been recreated
          if (!document.contains(state.nowPlayingWidgetTagInfo)) {
            state.nowPlayingWidgetTagInfo = null;
            this.updateNowPlayingWidget();
          }
        });

        // Start observing the body
        observer.observe(document.body, {
          childList: true,
          subtree: true,
        });

        state.initialized.playbarEnhancer = true;
      } catch (error) {
        console.error("Tagify: Error initializing playbar feature:", error);
      }
    },

    /**
     * Update the Now Playing widget
     */
    async updateNowPlayingWidget() {
      try {
        if (!state.activeExtensions.playbarEnhancer) {
          // If feature is disabled, hide existing element and return
          if (state.nowPlayingWidgetTagInfo) {
            state.nowPlayingWidgetTagInfo.style.display = "none";
          }
          return;
        }

        // Get the current track URI
        const trackUri = Spicetify.Player.data?.item?.uri;
        if (
          !trackUri ||
          (!trackUri.startsWith("spotify:track:") &&
            !trackUri.startsWith("spotify:local:"))
        ) {
          if (state.nowPlayingWidgetTagInfo) {
            state.nowPlayingWidgetTagInfo.style.display = "none";
          }
          return;
        }

        // Get or create our tag info element
        if (!state.nowPlayingWidgetTagInfo) {
          state.nowPlayingWidgetTagInfo = document.createElement("div");
          state.nowPlayingWidgetTagInfo.className = "tagify-playbar-info";
          state.nowPlayingWidgetTagInfo.style.marginLeft = "8px";
          state.nowPlayingWidgetTagInfo.style.fontSize = "11px";
          state.nowPlayingWidgetTagInfo.style.display = "flex";
          state.nowPlayingWidgetTagInfo.style.alignItems = "center";
          state.nowPlayingWidgetTagInfo.style.whiteSpace = "nowrap";

          // Find the track info container and add our element after it
          const trackInfo = await utils.waitForElement(
            ".main-nowPlayingWidget-nowPlaying .main-trackInfo-container"
          );
          trackInfo.after(state.nowPlayingWidgetTagInfo);
        }

        // Make sure our element is visible
        state.nowPlayingWidgetTagInfo.style.display = "flex";

        const isTagged = utils.isTrackTagged(trackUri);

        const incomplete = utils.hasIncompleteTags(trackUri);

        // Build the HTML content
        let htmlContent = "";

        if (isTagged) {
          const summary = utils.getTrackTagSummary(trackUri);

          if (
            trackUri in state.taggedTracks &&
            state.taggedTracks[trackUri].tags &&
            state.taggedTracks[trackUri].tags.length > 0
          ) {
            const tagListTooltip =
              tracklistEnhancer.createTagListTooltip(trackUri);
            state.nowPlayingWidgetTagInfo.title = tagListTooltip;
          }

          const bulletColor = incomplete ? "#FFA500" : "#1DB954";

          htmlContent += `<span style="color:${bulletColor}; margin-right:4px;">●</span> ${summary} `;
        }

        if (!isTagged || !state.taggedTracks[trackUri]?.tags?.length) {
          state.nowPlayingWidgetTagInfo.title = "";
        }

        // Update the content
        state.nowPlayingWidgetTagInfo.innerHTML = htmlContent;

        // Add a click handler to navigate to Tagify
        state.nowPlayingWidgetTagInfo.style.cursor = "pointer";
        state.nowPlayingWidgetTagInfo.onclick = () => {
          Spicetify.Platform.History.push({
            pathname: `/${APP_NAME}`,
            search: `?uri=${encodeURIComponent(trackUri)}`,
            state: { trackUri },
          });
        };
      } catch (error) {
        console.error("Tagify: Error updating Now Playing widget", error);
      }
    },

    disable() {
      if (state.nowPlayingWidgetTagInfo) {
        // Hide instead of removing (in case Spotify tries to reference it)
        state.nowPlayingWidgetTagInfo.style.display = "none";
        // Remove from DOM
        state.nowPlayingWidgetTagInfo.remove();
        state.nowPlayingWidgetTagInfo = null;
      }

      state.initialized.playbarEnhancer = false;
    },
  };

  // Main initialization
  const initialize = async () => {
    utils.loadTaggedTracks();
    settingsUtils.loadExtensionSettings();
    settingsUtils.subscribe();

    // Initialize features
    contextMenuItem.initialize();
    tracklistEnhancer.initialize();
    playbarEnhancer.initialize();

    const dataUpdateListener = () => {
      utils.loadTaggedTracks();
      // Refresh any UI that depends on tagged tracks
      if (state.activeExtensions.tracklistEnhancer) {
        tracklistEnhancer.updateTracklists();
      }
      if (state.activeExtensions.playbarEnhancer) {
        playbarEnhancer.updateNowPlayingWidget();
      }
    };

    window.addEventListener(DATA_UPDATED_EVENT, dataUpdateListener);
  };

  // Start initialization
  initialize();
})();
