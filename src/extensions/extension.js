/* global Spicetify */
(async () => {
  while (!Spicetify?.Platform && !Spicetify?.CosmosAsync) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const APP_NAME = "tagify";
  const VERSION = "1.0.0";

  const STORAGE_KEY = "tagify:tagData";
  const PLAYLIST_CACHE_KEY = "tagify:playlistCache";
  const PLAYLIST_SETTINGS_KEY = "tagify:playlistSettings";
  const EXTENSION_SETTINGS_KEY = "tagify:extensionSettings";
  const SETTINGS_CHANGED_EVENT = "tagify:settingsChanged";

  // Shared state
  const state = {
    taggedTracks: {},
    observer: null,
    nowPlayingWidgetTagInfo: null,
    lastTrackUri: null,
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
        const savedExtensionSettings = localStorage.getItem(EXTENSION_SETTINGS_KEY);
        if (savedExtensionSettings) {
          const data = JSON.parse(savedExtensionSettings);
          state.activeExtensions.tracklistEnhancer = data.enableTracklistEnhancer ?? true;
          state.activeExtensions.playbarEnhancer = data.enablePlaybarEnhancer ?? true;
          return true;
        } else {
          // create initial localStorage item
          this.saveExtensionSettings(DEFAULT_EXTENSION_SETTINGS);
          state.activeExtensions.tracklistEnhancer =
            DEFAULT_EXTENSION_SETTINGS.enableTracklistEnhancer;
          state.activeExtensions.playbarEnhancer = DEFAULT_EXTENSION_SETTINGS.enablePlaybarEnhancer;
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

      state.activeExtensions.tracklistEnhancer = newSettings.enableTracklistEnhancer;
      state.activeExtensions.playbarEnhancer = newSettings.enablePlaybarEnhancer;

      if (oldSettings.tracklistEnhancer !== state.activeExtensions.tracklistEnhancer) {
        if (state.activeExtensions.tracklistEnhancer) {
          tracklistEnhancer.initialize();
        } else {
          tracklistEnhancer.disable();
        }
      }

      if (oldSettings.playbarEnhancer !== state.activeExtensions.playbarEnhancer) {
        if (state.activeExtensions.playbarEnhancer) {
          playbarEnhancer.initialize();
        } else {
          playbarEnhancer.disable();
        }
      }
    },

    dispatchSettingsChange(settings) {
      window.dispatchEvent(
        new CustomEvent(SETTINGS_CHANGED_EVENT, {
          detail: settings,
        })
      );
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
        const savedData = localStorage.getItem(STORAGE_KEY);
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
        excludedPlaylistKeywords: ["Daylist", "Discover Weekly", "Release Radar"],
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
          console.log(`Tagify: No relevant playlists for local file`);
        }
        return "No regular playlists";
      }

      const playlistNames = relevantPlaylists.map((playlist) => playlist.name).sort();

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
        console.log("Error: Could not get tracklist element");
        return null;
      }

      try {
        // First try standard approach
        const uri =
          values[0]?.pendingProps?.children[0]?.props?.children?.props?.uri ||
          values[0]?.pendingProps?.children[0]?.props?.children?.props?.children?.props?.uri ||
          values[0]?.pendingProps?.children[0]?.props?.children?.props?.children?.props?.children
            ?.props?.uri ||
          values[0]?.pendingProps?.children[0]?.props?.children[0]?.props?.uri;

        // If we have a URI at this point, return it
        if (uri) return uri;

        // Special handling for local files - they might have a different structure
        const localUri = this.extractLocalFileUri(values[0]);
        if (localUri) return localUri;

        // If we couldn't find a URI, log a warning and return null
        console.log("Warning: Could not extract URI from element");
        return null;
      } catch (e) {
        console.log("Error getting URI from element:", e);
        return null;
      }
    },

    extractLocalFileUri(element) {
      try {
        // Try to find local file URI in various locations of the React component tree
        if (!element || !element.pendingProps) return null;

        // First direct check for uri property
        if (element.pendingProps.uri && element.pendingProps.uri.startsWith("spotify:local:")) {
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
        if (element.pendingProps.children && Array.isArray(element.pendingProps.children)) {
          for (const child of element.pendingProps.children) {
            if (child && child.props) {
              // Check if this child has the URI
              if (child.props.uri && child.props.uri.startsWith("spotify:local:")) {
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
        console.error("Error extracting local file URI:", error);
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
              parts.length > 5 ? decodeURIComponent(parts[5].replace(/\+/g, " ")) : "";

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
        console.warn("Tagify: Spicetify.ContextMenu not available, menu feature disabled");
        return;
      }

      try {
        // Create menu item
        new Spicetify.ContextMenu.Item(
          "Tag with Tagify",
          this.handleMenuClick,
          this.shouldShowMenu,
          `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21.41,11.58L12.41,2.58C12.04,2.21 11.53,2 11,2H4C2.9,2 2,2.9 2,4V11C2,11.53 2.21,12.04 2.59,12.42L11.59,21.42C11.96,21.79 12.47,22 13,22C13.53,22 14.04,21.79 14.41,21.42L21.41,14.42C21.79,14.04 22,13.53 22,13C22,12.47 21.79,11.96 21.41,11.58M5.5,7C4.67,7 4,6.33 4,5.5C4,4.67 4.67,4 5.5,4C6.33,4 7,4.67 7,5.5C7,6.33 6.33,7 5.5,7Z"/>
          </svg>`
        ).register();

        state.initialized.menu = true;
      } catch (error) {
        console.error("Tagify: Error initializing menu feature:", error);
      }
    },

    /**
     * Determine whether to show the menu item
     * @param {string[]} uris - The URIs of the selected items
     * @returns {boolean} Whether to show the menu
     */
    shouldShowMenu(uris) {
      return uris.some(
        (uri) => uri.startsWith("spotify:track:") || uri.startsWith("spotify:local:")
      );
    },

    /**
     * Handle the menu item click
     * @param {string[]} uris - The URIs of the selected items
     */
    handleMenuClick(uris) {
      if (uris.length === 0) return;

      if (uris.length === 1) {
        // Single track selection - use standard navigation
        const trackUri = uris[0];

        Spicetify.Platform.History.push({
          pathname: `/${APP_NAME}`,
          search: `?uri=${encodeURIComponent(trackUri)}`,
          state: { trackUri },
        });
      } else {
        // We'll encode the array of URIs for the URL (you could also use state)
        const encodedUris = encodeURIComponent(JSON.stringify(uris));

        Spicetify.Platform.History.push({
          pathname: `/${APP_NAME}`,
          search: `?uris=${encodedUris}`,
          state: { trackUris: uris },
        });
      }
    },
  };

  // Tracklist indicator feature - adds 'Tagify' column to tracklists
  const tracklistEnhancer = {
    tracklistObservers: new Set(),
    updateInterval: null,
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
        setTimeout(this.updateTracklists, 500);

        // Store the interval reference for cleanup
        this.updateInterval = setInterval(this.updateTracklists, 3000);

        // Setup debug utility
        window.tagifyDebug = {
          reprocess: this.updateTracklists,
          getData: () => state.taggedTracks,
          checkTrack: (uri) => console.log(`Track ${uri} is tagged: ${utils.isTrackTagged(uri)}`),
        };

        state.initialized.tracklistEnhancer = true;
      } catch (error) {
        console.error("Tagify: Error initializing tracklist indicator feature:", error);
      }
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
        tracklistEnhancer.updateTracklists();
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
              tracklistEnhancer.updateTracklists();

              // Observe each tracklist for changes
              const tracklists = document.getElementsByClassName("main-trackList-indexable");
              for (const tracklist of tracklists) {
                const newObserver = new MutationObserver(() => {
                  if (!state.activeExtensions.tracklistEnhancer) return;
                  tracklistEnhancer.updateTracklists();
                });

                newObserver.observe(tracklist, {
                  childList: true,
                  subtree: true,
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
      const tracklists = document.getElementsByClassName("main-trackList-indexable");
      for (const tracklist of tracklists) {
        const newObserver = new MutationObserver(() => {
          if (!state.activeExtensions.tracklistEnhancer) return;
          tracklistEnhancer.updateTracklists();
        });

        newObserver.observe(tracklist, {
          childList: true,
          subtree: true,
        });

        this.tracklistObservers.add(newObserver);
      }
    },

    /**
     * Update all tracklists on the page
     */
    updateTracklists() {
      // CHECK IF STILL ACTIVE BEFORE PROCESSING
      if (!state.activeExtensions.tracklistEnhancer) return;

      const tracklists = document.getElementsByClassName("main-trackList-indexable");
      for (const tracklist of tracklists) {
        tracklistEnhancer.processTracklist(tracklist);
      }
    },

    /**
     * Process all tracks in a tracklist
     * @param {HTMLElement} tracklist - The tracklist to process
     */
    processTracklist(tracklist) {
      if (!tracklist) return;

      // Add column to header first
      const header = tracklist.querySelector(".main-trackList-trackListHeaderRow");
      if (header) {
        tracklistEnhancer.addColumnToHeader(header);
      }

      // Process all track rows
      const trackRows = tracklist.querySelectorAll(".main-trackList-trackListRow");

      trackRows.forEach((row) => {
        tracklistEnhancer.addTagInfoToTrack(row);
      });
    },

    /**
     * Add column to tracklist header
     * @param {HTMLElement} header - The header element
     */
    addColumnToHeader(header) {
      if (!header || header.querySelector(".tagify-header")) return;

      // Find the last column to insert before
      const lastColumn = header.querySelector(".main-trackList-rowSectionEnd");
      if (!lastColumn) return;

      // Get column index and increment it for the last column
      const colIndex = parseInt(lastColumn.getAttribute("aria-colindex"));
      lastColumn.setAttribute("aria-colindex", (colIndex + 1).toString());

      // Create our new column
      const tagColumn = document.createElement("div");
      tagColumn.classList.add("main-trackList-rowSectionVariable");
      tagColumn.classList.add("tagify-header");
      tagColumn.setAttribute("role", "columnheader");
      tagColumn.setAttribute("aria-colindex", colIndex.toString());
      tagColumn.style.display = "flex";

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

      // Update grid template columns based on column count
      const fiveColumnGridCss =
        "grid-template-columns: [index] 16px [first] 3fr [var1] 2fr [var2] 2fr [var3] 1fr [last] minmax(120px,1fr) !important";
      const sixColumnGridCss =
        "grid-template-columns: [index] 16px [first] 5fr [var1] 3fr [var2] 2fr [var3] 2fr [last] minmax(120px,1fr) !important";

      switch (colIndex) {
        case 4:
          header.setAttribute("style", fiveColumnGridCss);
          break;
        case 5:
          header.setAttribute("style", sixColumnGridCss);
          break;
        default:
          break;
      }
    },

    /**
     * Add Tagify info to track row
     * @param {HTMLElement} row - The track row element
     */
    addTagInfoToTrack(row) {
      // Skip if already processed
      if (row.querySelector(".tagify-info")) return;

      // Get track URI
      const trackUri = utils.getTracklistTrackUri(row);

      // Skip if no URI found
      if (!trackUri) return;

      // Ensure we're dealing with a track URI (either Spotify track or local file)
      if (!trackUri.includes("track") && !trackUri.startsWith("spotify:local:")) return;

      // Find the last column to insert before
      const lastColumn = row.querySelector(".main-trackList-rowSectionEnd");
      if (!lastColumn) return;

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
      tagColumn.style.justifyContent = "space-between";

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
      container.style.justifyContent = "space-between";

      // Create the tag info element (left side)
      const tagInfo = document.createElement("div");
      tagInfo.style.display = "flex";
      tagInfo.style.alignItems = "center";

      // Check if track is tagged
      const isTagged = utils.isTrackTagged(trackUri);

      if (isTagged) {
        const summary = utils.getTrackTagSummary(trackUri);
        const tagText = document.createElement("div");

        // Check if track has incomplete tags
        const incomplete = utils.hasIncompleteTags(trackUri);

        // Use orange bullet for incomplete tags, green for complete tags
        const bulletColor = incomplete ? "#FFA500" : "#1DB954";

        tagText.innerHTML = `<span style="color:${bulletColor}; margin-right:4px;">●</span> <span class="tag-summary">${summary}</span>`;
        tagText.style.fontSize = "12px";

        // Add tooltip with detailed tag list
        if (
          trackUri in state.taggedTracks &&
          state.taggedTracks[trackUri].tags &&
          state.taggedTracks[trackUri].tags.length > 0
        ) {
          const tagList = tracklistEnhancer.createTagListTooltip(trackUri);
          tagText.title = tagList;
        }
        tagInfo.appendChild(tagText);
      }

      container.appendChild(tagInfo);

      // Add warning at the right side
      const statusContainer = document.createElement("div");
      statusContainer.style.marginLeft = "auto"; // Push to the right

      container.appendChild(statusContainer);
      tagColumn.appendChild(container);

      // Insert our column before the last column
      row.insertBefore(tagColumn, lastColumn);

      // Update grid template columns based on column count
      const fiveColumnGridCss =
        "grid-template-columns: [index] 16px [first] 3fr [var1] 2fr [var2] 2fr [var3] 1fr [last] minmax(120px,1fr) !important";
      const sixColumnGridCss =
        "grid-template-columns: [index] 16px [first] 5fr [var1] 3fr [var2] 2fr [var3] 2fr [last] minmax(120px,1fr) !important";

      switch (colIndex) {
        case 4:
          row.setAttribute("style", fiveColumnGridCss);
          break;
        case 5:
          row.setAttribute("style", sixColumnGridCss);
          break;
        default:
          break;
      }
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
          const tagDataString = localStorage.getItem("tagify:tagData");
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
              const subcategory = category.subcategories.find((s) => s.id === tag.subcategoryId);
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
          Object.entries(tagsByCategory).forEach(([_category, subcategories]) => {
            Object.entries(subcategories).forEach(([_subcategory, tags]) => {
              if (tags.length > 0) {
                tagLines.push(tags.join(", "));
              }
            });
          });

          if (tagLines.length > 0) {
            return tagLines.join("\n");
          }
        }
      }

      // Handle older format tags as fallback
      const simpleTags = track.tags.filter((tag) => tag.tag).map((tag) => tag.tag);
      if (simpleTags.length > 0) {
        return simpleTags.join(", ");
      }

      return "";
    },

    disable() {
      // Clear the interval
      if (this.updateInterval) {
        clearInterval(this.updateInterval);
        this.updateInterval = null;
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
      document.querySelectorAll(".tagify-header, .tagify-info").forEach((el) => {
        el.remove();
      });

      // Reset grid styles that were modified
      document.querySelectorAll('[style*="grid-template-columns"]').forEach((el) => {
        el.removeAttribute("style");
      });

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
        Spicetify.Player.addEventListener("songchange", this.updateNowPlayingWidget);

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
          (!trackUri.startsWith("spotify:track:") && !trackUri.startsWith("spotify:local:"))
        ) {
          if (state.nowPlayingWidgetTagInfo) {
            state.nowPlayingWidgetTagInfo.style.display = "none";
          }
          return;
        }

        // Skip if URI hasn't changed and element exists
        if (trackUri === state.lastTrackUri && state.nowPlayingWidgetTagInfo) return;
        state.lastTrackUri = trackUri;

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
            const tagListTooltip = tracklistEnhancer.createTagListTooltip(trackUri);
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

      state.lastTrackUri = null;
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

    window.addEventListener("tagify:dataUpdated", dataUpdateListener);
  };

  // Start initialization
  initialize();
})();
