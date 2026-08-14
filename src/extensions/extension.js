/* global Spicetify */
import { keyboardShortcutService } from "../services/KeyboardShortcutService";
import { smartPlaylistSyncService } from "../services/SmartPlaylistSyncService";
import { welcomeModal } from "./WelcomeModal";
import {
  addRecentTag,
  createUpdatedTrack,
  getRatingUpdateForSelection,
  getTagIndicatorStatus,
  toggleTagIdForSelection,
} from "./inlineEditor.logic";
import {
  createEnergyRatingRow,
  getSortedMenuTagCategories,
  positionInlineMenu,
  updateEnergyRatingRowSelection,
} from "./inlineEditor.menu";
import { renderInlineEditorPresentation } from "./inlineEditor.presentation";
import { getInlineEditScope } from "./inlineEditor.selection";

(async () => {
  while (!Spicetify?.Platform) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Initialize global services
  keyboardShortcutService.initialize();
  welcomeModal.initialize();

  const APP_NAME = "tagify";

  const TAG_DATA_KEY = "tagify:tagData";
  const PLAYLIST_CACHE_KEY = "tagify:playlistCache";
  const PLAYLIST_SETTINGS_KEY = "tagify:playlistSettings";
  const SMART_PLAYLIST_STORAGE_KEY = "tagify:smartPlaylists";
  const EXTENSION_SETTINGS_KEY = "tagify:extensionSettings";
  const SETTINGS_CHANGED_EVENT = "tagify:settingsChanged";
  const DATA_UPDATED_EVENT = "tagify:dataUpdated";
  const SMART_PLAYLIST_SYNC_EVENT = "tagify:trackChanged";
  const SMART_PLAYLISTS_UPDATED_EVENT = "tagify:smartPlaylistsUpdated";

  window.addEventListener(SMART_PLAYLIST_SYNC_EVENT, async (event) => {
    const { trackUri, trackData } = event.detail;
    try {
      await smartPlaylistSyncService.syncTrack(trackUri, trackData);
    } catch (error) {
      console.error("Tagify: Error syncing track with smart playlists", error);
    }
  });

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

  };

  // Shared state
  const state = {
    taggedTracks: {},
    taggedPlaylists: {},
    taggedArtists: {},
    tagCategories: [],
    tagLookup: new Map(),
    recentTagIds: [],
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
      smartPlaylistIndicator: false,
      artistProfileIndicator: false,
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
          EXTENSION_SETTINGS_KEY,
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
    buildCategoryTreeFromTaxonomy(taxonomy) {
      if (!taxonomy || typeof taxonomy !== "object") {
        return [];
      }

      const categoryOrder = Array.isArray(taxonomy.categoryOrder)
        ? taxonomy.categoryOrder
        : [];
      const categoriesById =
        taxonomy.categoriesById && typeof taxonomy.categoriesById === "object"
          ? taxonomy.categoriesById
          : {};
      const subcategoriesById =
        taxonomy.subcategoriesById &&
        typeof taxonomy.subcategoriesById === "object"
          ? taxonomy.subcategoriesById
          : {};
      const tagsById =
        taxonomy.tagsById && typeof taxonomy.tagsById === "object"
          ? taxonomy.tagsById
          : {};

      return categoryOrder
        .map((categoryId) => categoriesById[categoryId])
        .filter(Boolean)
        .map((category) => ({
          id: category.id,
          name: category.name,
          subcategories: (Array.isArray(category.subcategoryIds)
            ? category.subcategoryIds
            : []
          )
            .map((subcategoryId) => subcategoriesById[subcategoryId])
            .filter(Boolean)
            .map((subcategory) => ({
              id: subcategory.id,
              name: subcategory.name,
              tags: (Array.isArray(subcategory.tagIds) ? subcategory.tagIds : [])
                .map((tagId) => tagsById[tagId])
                .filter(Boolean)
                .map((tag) => ({
                  id: tag.id,
                  name: tag.name,
                })),
            })),
        }));
    },

    buildTagLookup(categories) {
      const lookup = new Map();

      (Array.isArray(categories) ? categories : []).forEach((category) => {
        (Array.isArray(category.subcategories) ? category.subcategories : []).forEach(
          (subcategory) => {
            (Array.isArray(subcategory.tags) ? subcategory.tags : []).forEach((tag) => {
              lookup.set(tag.id, {
                categoryId: category.id,
                categoryName: category.name,
                subcategoryId: subcategory.id,
                subcategoryName: subcategory.name,
                tagId: tag.id,
                name: tag.name,
                tag: tag.name,
              });
            });
          },
        );
      });

      return lookup;
    },

    normalizeTrackForExtension(trackData, tagLookup) {
      const tagIds = Array.isArray(trackData?.tagIds)
        ? trackData.tagIds.filter((tagId) => typeof tagId === "string")
        : [];

      const legacyTags = Array.isArray(trackData?.tags)
        ? trackData.tags
            .filter((tag) => tag && typeof tag === "object")
            .map((tag) => {
              if (
                typeof tag.categoryId === "string" &&
                typeof tag.subcategoryId === "string" &&
                typeof tag.tagId === "string"
              ) {
                const resolvedTag = tagLookup.get(tag.tagId);
                const tagName =
                  tag.name || tag.tag || resolvedTag?.name || tag.tagId;

                return {
                  ...tag,
                  name: tagName,
                  tag: tagName,
                };
              }

              if (typeof tag.tag === "string") {
                return tag;
              }

              return null;
            })
            .filter(Boolean)
        : [];

      const tags =
        tagIds.length > 0
          ? tagIds.map((tagId) => {
              const resolvedTag = tagLookup.get(tagId);

              if (resolvedTag) {
                return { ...resolvedTag };
              }

              return {
                tagId,
                name: tagId,
                tag: tagId,
              };
            })
          : legacyTags;

      return {
        ...trackData,
        tags,
      };
    },

    normalizePlaylistForExtension(playlistData, tagLookup) {
      const tagIds = Array.isArray(playlistData?.tagIds)
        ? playlistData.tagIds.filter((tagId) => typeof tagId === "string")
        : [];

      return {
        ...playlistData,
        tags: tagIds.map((tagId) => {
          const resolvedTag = tagLookup.get(tagId);

          if (resolvedTag) {
            return { ...resolvedTag };
          }

          return {
            tagId,
            name: tagId,
            tag: tagId,
          };
        }),
      };
    },

    normalizeArtistForExtension(artistData, tagLookup) {
      const tagIds = Array.isArray(artistData?.tagIds)
        ? artistData.tagIds.filter((tagId) => typeof tagId === "string")
        : [];

      return {
        ...artistData,
        tags: tagIds.map((tagId) => {
          const resolvedTag = tagLookup.get(tagId);

          if (resolvedTag) {
            return { ...resolvedTag };
          }

          return {
            tagId,
            name: tagId,
            tag: tagId,
          };
        }),
      };
    },

    normalizeLoadedTagData(data) {
      if (!data || typeof data !== "object") {
        return null;
      }

      const taxonomyCategories = this.buildCategoryTreeFromTaxonomy(data.taxonomy);
      const categories =
        Array.isArray(data.categories) && data.categories.length > 0
          ? data.categories
          : taxonomyCategories;
      const tagLookup = this.buildTagLookup(categories);
      const rawTracks =
        data.tracks && typeof data.tracks === "object" ? data.tracks : {};
      const rawPlaylists =
        data.playlists && typeof data.playlists === "object" ? data.playlists : {};
      const rawArtists =
        data.artists && typeof data.artists === "object" ? data.artists : {};
      const tracks = Object.fromEntries(
        Object.entries(rawTracks).map(([trackUri, trackData]) => [
          trackUri,
          this.normalizeTrackForExtension(trackData, tagLookup),
        ]),
      );
      const playlists = Object.fromEntries(
        Object.entries(rawPlaylists).map(([playlistUri, playlistData]) => [
          playlistUri,
          this.normalizePlaylistForExtension(playlistData, tagLookup),
        ]),
      );
      const artists = Object.fromEntries(
        Object.entries(rawArtists).map(([artistUri, artistData]) => [
          artistUri,
          this.normalizeArtistForExtension(artistData, tagLookup),
        ]),
      );

      if (
        Object.keys(tracks).length === 0 &&
        Object.keys(playlists).length === 0 &&
        Object.keys(artists).length === 0 &&
        categories.length === 0
      ) {
        return null;
      }

      return {
        tracks,
        playlists,
        artists,
        categories,
        tagLookup,
      };
    },

    getTrackTags(track) {
      if (!track || typeof track !== "object") {
        return [];
      }

      if (Array.isArray(track.tags)) {
        return track.tags;
      }

      if (Array.isArray(track.tagIds)) {
        return track.tagIds
          .filter((tagId) => typeof tagId === "string")
          .map((tagId) => {
            const resolvedTag = state.tagLookup.get(tagId);

            if (resolvedTag) {
              return { ...resolvedTag };
            }

            return {
              tagId,
              name: tagId,
              tag: tagId,
            };
          });
      }

      return [];
    },

    getPlaylistTags(playlist) {
      if (!playlist || typeof playlist !== "object") {
        return [];
      }

      if (Array.isArray(playlist.tags)) {
        return playlist.tags;
      }

      if (Array.isArray(playlist.tagIds)) {
        return playlist.tagIds
          .filter((tagId) => typeof tagId === "string")
          .map((tagId) => {
            const resolvedTag = state.tagLookup.get(tagId);

            if (resolvedTag) {
              return { ...resolvedTag };
            }

            return {
              tagId,
              name: tagId,
              tag: tagId,
            };
          });
      }

      return [];
    },

    getArtistTags(artist) {
      if (!artist || typeof artist !== "object") {
        return [];
      }

      if (Array.isArray(artist.tags)) {
        return artist.tags;
      }

      if (Array.isArray(artist.tagIds)) {
        return artist.tagIds
          .filter((tagId) => typeof tagId === "string")
          .map((tagId) => {
            const resolvedTag = state.tagLookup.get(tagId);

            if (resolvedTag) {
              return { ...resolvedTag };
            }

            return {
              tagId,
              name: tagId,
              tag: tagId,
            };
          });
      }

      return [];
    },

    resolveTagById(tagId) {
      if (typeof tagId !== "string") {
        return null;
      }

      return state.tagLookup.get(tagId) || null;
    },

    serializeTagFilter(filter) {
      if (typeof filter === "string") {
        return filter;
      }

      if (
        filter &&
        typeof filter === "object" &&
        typeof filter.categoryId === "string" &&
        typeof filter.subcategoryId === "string" &&
        typeof filter.tagId === "string"
      ) {
        return `${filter.categoryId}:${filter.subcategoryId}:${filter.tagId}`;
      }

      return "";
    },

    /**
     * Load tagged tracks from storage (IndexedDB or localStorage fallback)
     * @returns {boolean} whether data was successfully loaded
     */
    async loadTaggedTracks() {
      try {
        // Try IndexedDB first (new storage)
        const idbData = await this.loadFromIndexedDB();
        const normalizedIdbData = this.normalizeLoadedTagData(idbData);
        if (normalizedIdbData) {
          state.taggedTracks = normalizedIdbData.tracks;
          state.taggedPlaylists = normalizedIdbData.playlists;
          state.taggedArtists = normalizedIdbData.artists;
          state.tagCategories = normalizedIdbData.categories;
          state.tagLookup = normalizedIdbData.tagLookup;
          return true;
        }

        // Fallback to localStorage (legacy or during migration)
        const savedData = localStorage.getItem(TAG_DATA_KEY);
        if (savedData) {
          const normalizedLocalData = this.normalizeLoadedTagData(
            JSON.parse(savedData),
          );
          if (normalizedLocalData) {
            state.taggedTracks = normalizedLocalData.tracks;
            state.taggedPlaylists = normalizedLocalData.playlists;
            state.taggedArtists = normalizedLocalData.artists;
            state.tagCategories = normalizedLocalData.categories;
            state.tagLookup = normalizedLocalData.tagLookup;
            return true;
          }
        }
      } catch (error) {
        console.error("Tagify: Error loading data", error);
      }
      return false;
    },

    /**
     * Load data from IndexedDB
     * @returns {Promise<Object|null>} The tag data or null
     */
    async loadFromIndexedDB() {
      return new Promise((resolve) => {
        try {
          // Do not pin a lower DB version here.
          // The app currently uses versioned schema upgrades (e.g. v2), and
          // opening with a lower version throws VersionError and breaks reads.
          const request = indexedDB.open("tagify-db");

          request.onerror = () => resolve(null);

          request.onsuccess = (event) => {
            const db = event.target.result;

            try {
              const storeNames = ["tracks", "categories"];
              if (db.objectStoreNames.contains("playlists")) {
                storeNames.push("playlists");
              }
              if (db.objectStoreNames.contains("artists")) {
                storeNames.push("artists");
              }
              const transaction = db.transaction(storeNames, "readonly");
              const trackStore = transaction.objectStore("tracks");
              const playlistStore = db.objectStoreNames.contains("playlists")
                ? transaction.objectStore("playlists")
                : null;
              const artistStore = db.objectStoreNames.contains("artists")
                ? transaction.objectStore("artists")
                : null;
              const categoryStore = transaction.objectStore("categories");

              const tracks = {};
              const playlists = {};
              const artists = {};
              let categories = [];
              let taxonomy = null;

              const trackRequest = trackStore.getAll();
              const playlistRequest = playlistStore?.getAll();
              const artistRequest = artistStore?.getAll();
              const categoryRequest = categoryStore.get("categories");
              const taxonomyRequest = categoryStore.get("taxonomy");

              trackRequest.onsuccess = () => {
                for (const record of trackRequest.result || []) {
                  const { uri, ...trackData } = record;
                  tracks[uri] = trackData;
                }
              };

              if (playlistRequest) {
                playlistRequest.onsuccess = () => {
                  for (const record of playlistRequest.result || []) {
                    const { uri, ...playlistData } = record;
                    playlists[uri] = playlistData;
                  }
                };
              }

              if (artistRequest) {
                artistRequest.onsuccess = () => {
                  for (const record of artistRequest.result || []) {
                    const { uri, ...artistData } = record;
                    artists[uri] = artistData;
                  }
                };
              }

              categoryRequest.onsuccess = () => {
                categories = categoryRequest.result?.data || [];
              };

              taxonomyRequest.onsuccess = () => {
                taxonomy = taxonomyRequest.result?.data || null;
              };

              transaction.oncomplete = () => {
                db.close();
                if (
                  Object.keys(tracks).length > 0 ||
                  Object.keys(playlists).length > 0 ||
                  Object.keys(artists).length > 0 ||
                  categories.length > 0 ||
                  taxonomy
                ) {
                  resolve({ tracks, playlists, artists, categories, taxonomy });
                } else {
                  resolve(null);
                }
              };

              transaction.onerror = () => {
                db.close();
                resolve(null);
              };
            } catch {
              db.close();
              resolve(null);
            }
          };

          request.onupgradeneeded = () => {
            // DB doesn't exist yet, will be created by main app
            resolve(null);
          };
        } catch {
          resolve(null);
        }
      });
    },

    getTrackTagIds(track) {
      if (Array.isArray(track?.tagIds)) {
        return track.tagIds.filter((tagId) => typeof tagId === "string");
      }

      return this.getTrackTags(track)
        .map((tag) => tag.tagId)
        .filter((tagId) => typeof tagId === "string");
    },

    async saveInlineTrackUpdates(trackUris, changesOrFactory) {
      const uniqueTrackUris = [...new Set(trackUris)].filter(Boolean);
      if (uniqueTrackUris.length === 0) {
        return {};
      }

      const now = Date.now();
      const nextTracks = Object.fromEntries(
        uniqueTrackUris.map((trackUri) => {
          const currentTrack = state.taggedTracks[trackUri];
          const normalizedCurrentTrack = {
            ...currentTrack,
            tagIds: this.getTrackTagIds(currentTrack),
          };
          const changes =
            typeof changesOrFactory === "function"
              ? changesOrFactory(normalizedCurrentTrack, trackUri)
              : changesOrFactory;

          return [
            trackUri,
            createUpdatedTrack(normalizedCurrentTrack, changes, now),
          ];
        }),
      );

      await new Promise((resolve, reject) => {
        const request = indexedDB.open("tagify-db");
        request.onerror = () => reject(new Error("Unable to open Tagify storage"));
        request.onsuccess = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains("tracks")) {
            db.close();
            reject(new Error("Tagify track storage is unavailable"));
            return;
          }

          const transaction = db.transaction("tracks", "readwrite");
          const trackStore = transaction.objectStore("tracks");
          Object.entries(nextTracks).forEach(([trackUri, trackData]) => {
            trackStore.put({ uri: trackUri, ...trackData });
          });
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => {
            db.close();
            reject(new Error("Unable to save Tagify track data"));
          };
          transaction.onabort = () => {
            db.close();
            reject(new Error("Tagify track update was cancelled"));
          };
        };
      });

      Object.entries(nextTracks).forEach(([trackUri, trackData]) => {
        state.taggedTracks[trackUri] = this.normalizeTrackForExtension(
          trackData,
          state.tagLookup,
        );
      });
      window.dispatchEvent(
        new CustomEvent(DATA_UPDATED_EVENT, {
          detail: { type: "save", trackUris: uniqueTrackUris },
        }),
      );
      Object.entries(nextTracks).forEach(([trackUri, trackData]) => {
        window.dispatchEvent(
          new CustomEvent(SMART_PLAYLIST_SYNC_EVENT, {
            detail: { trackUri, trackData },
          }),
        );
      });

      return nextTracks;
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
      const hasTags = this.getTrackTags(track).length > 0;

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
          const parsed = JSON.parse(settingsString);
          return {
            excludeNonOwnedPlaylists:
              typeof parsed.excludeNonOwnedPlaylists === "boolean"
                ? parsed.excludeNonOwnedPlaylists
                : true,
            includedPlaylistKeywords: Array.isArray(
              parsed.includedPlaylistKeywords,
            )
              ? parsed.includedPlaylistKeywords
              : [],
            includedPlaylistFolderPaths: Array.isArray(
              parsed.includedPlaylistFolderPaths,
            )
              ? parsed.includedPlaylistFolderPaths
              : [],
            includedPlaylistFolderPlaylistIds: Array.isArray(
              parsed.includedPlaylistFolderPlaylistIds,
            )
              ? parsed.includedPlaylistFolderPlaylistIds
              : [],
            excludedPlaylistKeywords: Array.isArray(
              parsed.excludedPlaylistKeywords,
            )
              ? parsed.excludedPlaylistKeywords
              : ["Daylist", "Discover Weekly", "Release Radar"],
            excludedPlaylistIds: Array.isArray(parsed.excludedPlaylistIds)
              ? parsed.excludedPlaylistIds
              : [],
            excludeByDescription: Array.isArray(parsed.excludeByDescription)
              ? parsed.excludeByDescription
              : ["ignore"],
            playlistOverrides:
              parsed.playlistOverrides &&
              typeof parsed.playlistOverrides === "object"
                ? parsed.playlistOverrides
                : {},
          };
        }
      } catch (error) {
        console.error("Tagify: Error reading playlist settings:", error);
      }

      // Return default settings if not found or error
      return {
        excludeNonOwnedPlaylists: true,
        includedPlaylistKeywords: [],
        includedPlaylistFolderPaths: [],
        includedPlaylistFolderPlaylistIds: [],
        excludedPlaylistKeywords: [
          "Daylist",
          "Discover Weekly",
          "Release Radar",
        ],
        excludedPlaylistIds: [],
        excludeByDescription: ["ignore"],
        playlistOverrides: {},
      };
    },

    /**
     * Get current playlist ID from history pathname
     * @returns {string|null} Playlist ID from route
     */
    getCurrentPlaylistId() {
      const pathname =
        Spicetify?.Platform?.History?.location?.pathname ||
        window.location.pathname ||
        "";

      const match = pathname.match(/\/playlist\/([^/?]+)/);
      if (!match || !match[1]) {
        return null;
      }

      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    },

    /**
     * Get current album ID from history pathname
     * @returns {string|null} Album ID from route
     */
    getCurrentAlbumId() {
      const pathname =
        Spicetify?.Platform?.History?.location?.pathname ||
        window.location.pathname ||
        "";

      const match = pathname.match(/\/album\/([^/?]+)/);
      if (!match || !match[1]) {
        return null;
      }

      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    },

    getCurrentArtistId() {
      const pathname =
        Spicetify?.Platform?.History?.location?.pathname ||
        window.location.pathname ||
        "";

      const match = pathname.match(/\/artist\/([^/?]+)/);
      if (!match || !match[1]) {
        return null;
      }

      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    },

    /**
     * Get smart playlists from localStorage
     * @returns {Array<Object>} Smart playlist entries
     */
    getSmartPlaylists() {
      try {
        const smartPlaylistString = localStorage.getItem(
          SMART_PLAYLIST_STORAGE_KEY,
        );
        if (!smartPlaylistString) {
          return [];
        }

        const parsed = JSON.parse(smartPlaylistString);
        if (!Array.isArray(parsed)) {
          return [];
        }

        return parsed.filter(
          (playlist) =>
            playlist &&
            typeof playlist === "object" &&
            typeof playlist.playlistId === "string",
        );
      } catch (error) {
        Logger.warn("Error reading smart playlists:", error);
        return [];
      }
    },

    /**
     * Find smart playlist by playlist ID
     * @param {string} playlistId - The playlist ID
     * @returns {Object|null} Smart playlist entry
     */
    getSmartPlaylistByPlaylistId(playlistId) {
      if (!playlistId) {
        return null;
      }

      const smartPlaylists = this.getSmartPlaylists();
      return (
        smartPlaylists.find((playlist) => playlist.playlistId === playlistId) ||
        null
      );
    },

    /**
     * Check if a playlist is excluded based on settings
     * @param {string} playlistId - The playlist ID
     * @param {string} playlistName - The playlist name
     * @returns {boolean} Whether the playlist is excluded
     */
    isPlaylistExcluded(playlistId, playlistName, playlistDescription = "") {
      const settings = this.getPlaylistSettings();
      const overrideMode = settings.playlistOverrides?.[playlistId] || "inherit";

      if (overrideMode === "include") {
        return false;
      }

      if (overrideMode === "exclude") {
        return true;
      }

      const includedPlaylistKeywords = Array.isArray(
        settings.includedPlaylistKeywords,
      )
        ? settings.includedPlaylistKeywords
        : [];
      const includedPlaylistFolderPlaylistIds = Array.isArray(
        settings.includedPlaylistFolderPlaylistIds,
      )
        ? settings.includedPlaylistFolderPlaylistIds
        : [];

      if (
        includedPlaylistKeywords.some((keyword) =>
          playlistName.toLowerCase().includes(keyword.toLowerCase()),
        )
      ) {
        return false;
      }

      if (includedPlaylistFolderPlaylistIds.includes(playlistId)) {
        return false;
      }

      if (
        includedPlaylistKeywords.length > 0 ||
        includedPlaylistFolderPlaylistIds.length > 0
      ) {
        return true;
      }

      // Check specific excluded playlists
      if (settings.excludedPlaylistIds.includes(playlistId)) {
        return true;
      }

      // Check for excluded keywords in name
      if (
        settings.excludedPlaylistKeywords.some((keyword) =>
          playlistName.toLowerCase().includes(keyword.toLowerCase()),
        )
      ) {
        return true;
      }

      // Check for description exclusions - important for "ignore" flag
      if (
        playlistDescription &&
        settings.excludeByDescription &&
        settings.excludeByDescription.some((term) =>
          playlistDescription.toLowerCase().includes(term.toLowerCase()),
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
          "Tagify: Spicetify.ContextMenu not available, menu feature disabled",
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
        </svg>`,
        ).register();

        new Spicetify.ContextMenu.Item(
          "Tag playlist with Tagify",
          this.handleMenuClick,
          this.shouldShowPlaylistMenu,
          `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V8C22 6.9 21.1 6 20 6H12L10 4M20 18H4V6H9.17L11.17 8H20V18Z"/>
        </svg>`,
        ).register();

        new Spicetify.ContextMenu.Item(
          "Tag album with Tagify",
          this.handleMenuClick,
          this.shouldShowAlbumMenu,
          `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3C7.03 3 3 7.03 3 12S7.03 21 12 21 21 16.97 21 12 16.97 3 12 3M12 15.5C10.07 15.5 8.5 13.93 8.5 12S10.07 8.5 12 8.5 15.5 10.07 15.5 12 13.93 15.5 12 15.5M12 13.5C12.83 13.5 13.5 12.83 13.5 12S12.83 10.5 12 10.5 10.5 11.17 10.5 12 11.17 13.5 12 13.5Z"/>
        </svg>`,
        ).register();

        new Spicetify.ContextMenu.Item(
          "Tag artist with Tagify",
          this.handleMenuClick,
          this.shouldShowArtistMenu,
          `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 12C14.21 12 16 10.21 16 8S14.21 4 12 4 8 5.79 8 8 9.79 12 12 12M12 14C9.33 14 4 15.34 4 18V20H20V18C20 15.34 14.67 14 12 14Z"/>
        </svg>`,
        ).register();

        // Multiple tracks menu item
        new Spicetify.ContextMenu.Item(
          "Bulk Tag",
          this.handleMenuClick,
          this.shouldShowBulkMenu,
          `<svg width="16" height="16" viewBox="0 0 24 24" fill="#FF6B35">
          <path d="M21.41,11.58L12.41,2.58C12.04,2.21 11.53,2 11,2H4C2.9,2 2,2.9 2,4V11C2,11.53 2.21,12.04 2.59,12.42L11.59,21.42C11.96,21.79 12.47,22 13,22C13.53,22 14.04,21.79 14.41,21.42L21.41,14.42C21.79,14.04 22,13.53 22,13C22,12.47 21.79,11.96 21.41,11.58M5.5,7C4.67,7 4,6.33 4,5.5C4,4.67 4.67,4 5.5,4C6.33,4 7,4.67 7,5.5C7,6.33 6.33,7 5.5,7Z"/>
          </svg>`,
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
          uri.startsWith("spotify:track:") || uri.startsWith("spotify:local:"),
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
          uri.startsWith("spotify:track:") || uri.startsWith("spotify:local:"),
      );
      return trackUris.length > 1;
    },

    /**
     * Show playlist tagging for a single Spotify playlist.
     * @param {string[]} uris - The URIs of the selected items
     * @returns {boolean} Whether to show playlist tagging menu
     */
    shouldShowPlaylistMenu(uris) {
      const playlistUris = uris.filter((uri) =>
        uri.startsWith("spotify:playlist:"),
      );
      return playlistUris.length === 1;
    },

    shouldShowAlbumMenu(uris) {
      const albumUris = uris.filter((uri) =>
        uri.startsWith("spotify:album:"),
      );
      return albumUris.length === 1;
    },

    shouldShowArtistMenu(uris) {
      const artistUris = uris.filter((uri) =>
        uri.startsWith("spotify:artist:"),
      );
      return artistUris.length === 1;
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
          uri.startsWith("spotify:track:") || uri.startsWith("spotify:local:"),
      );
      const playlistUris = uris.filter((uri) =>
        uri.startsWith("spotify:playlist:"),
      );
      const albumUris = uris.filter((uri) =>
        uri.startsWith("spotify:album:"),
      );
      const artistUris = uris.filter((uri) =>
        uri.startsWith("spotify:artist:"),
      );

      if (
        artistUris.length === 1 &&
        trackUris.length === 0 &&
        playlistUris.length === 0 &&
        albumUris.length === 0
      ) {
        const artistUri = artistUris[0];

        Spicetify.Platform.History.push({
          pathname: `/${APP_NAME}`,
          search: `?artistUri=${encodeURIComponent(artistUri)}`,
          state: { artistUri },
        });
      } else if (
        albumUris.length === 1 &&
        trackUris.length === 0 &&
        playlistUris.length === 0
      ) {
        const playlistUri = albumUris[0];

        Spicetify.Platform.History.push({
          pathname: `/${APP_NAME}`,
          search: `?playlistUri=${encodeURIComponent(playlistUri)}`,
          state: { playlistUri },
        });
      } else if (playlistUris.length === 1 && trackUris.length === 0) {
        const playlistUri = playlistUris[0];

        Spicetify.Platform.History.push({
          pathname: `/${APP_NAME}`,
          search: `?playlistUri=${encodeURIComponent(playlistUri)}`,
          state: { playlistUri },
        });
      } else if (trackUris.length === 1) {
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

  const inlineEditor = {
    openMenu: null,

    getEditScope(trackUri) {
      return getInlineEditScope(trackUri);
    },

    getRatingActionLabel(trackUri, value, defaultLabel) {
      const scope = this.getEditScope(trackUri);
      if (!scope.isBulk) {
        return defaultLabel;
      }

      const formattedValue = Number.isInteger(value)
        ? String(value)
        : value.toFixed(1);
      const allHaveRating = scope.trackUris.every(
        (uri) => Number(state.taggedTracks[uri]?.rating) === value,
      );

      return allHaveRating
        ? `Clear ${formattedValue} star rating from ${scope.trackCount} selected tracks`
        : `Set ${scope.trackCount} selected tracks to ${formattedValue} stars`;
    },

    notifyBulkUpdate(scope, message) {
      if (scope.isBulk) {
        Spicetify.showNotification(
          `${message} ${scope.trackCount} selected tracks`,
        );
      }
    },

    createControl(trackUri, compact = false) {
      const control = document.createElement("div");
      control.className = "tagify-inline-editor";
      control.dataset.tagifyTrackUri = trackUri;
      control.dataset.tagifyCompact = String(compact);
      control.style.whiteSpace = "nowrap";
      control.style.cursor = "pointer";
      control.setAttribute("role", "group");
      control.setAttribute("aria-label", "Tagify star rating");

      control.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.showMenu(trackUri, event.clientX, event.clientY);
      });

      this.renderControl(control, trackUri, compact);
      return control;
    },

    renderControl(control, trackUri, compact = false) {
      const track = state.taggedTracks[trackUri];
      const rating = Number(track?.rating) || 0;
      const energy = Number(track?.energy) || 0;
      const tagCount = utils.getTrackTags(track).length;
      const tagStatus = getTagIndicatorStatus(track, tagCount);
      const tagListTooltip =
        tagStatus === "none"
          ? ""
          : tracklistEnhancer.createTagListTooltip(trackUri);

      renderInlineEditorPresentation(control, {
        rating,
        energy,
        tagStatus,
        tagListTooltip,
        compact,
        getRateActionLabel: (value, defaultLabel) =>
          this.getRatingActionLabel(trackUri, value, defaultLabel),
        onRate: async (nextRating) => {
          try {
            const scope = this.getEditScope(trackUri);
            let ratingToSave = nextRating;

            if (scope.isBulk) {
              const selectedRating = nextRating === 0 ? rating : nextRating;
              ratingToSave = getRatingUpdateForSelection(
                scope.trackUris.map(
                  (uri) => Number(state.taggedTracks[uri]?.rating) || 0,
                ),
                selectedRating,
              );
            }

            await utils.saveInlineTrackUpdates(scope.trackUris, {
              rating: ratingToSave,
            });
            this.refreshTracks(scope.trackUris);
            this.notifyBulkUpdate(
              scope,
              ratingToSave > 0
                ? `Set the rating to ${ratingToSave} stars for`
                : "Cleared the star rating from",
            );
          } catch (error) {
            console.error("Tagify: Unable to save inline rating", error);
            Spicetify.showNotification("Tagify couldn't save that rating", true);
          }
        },
      });
    },

    refreshTracks(trackUris) {
      const trackUriSet = new Set(trackUris);
      document
        .querySelectorAll(".tagify-inline-editor")
        .forEach((control) => {
          if (trackUriSet.has(control.dataset.tagifyTrackUri)) {
            this.renderControl(
              control,
              control.dataset.tagifyTrackUri,
              control.dataset.tagifyCompact === "true",
            );
          }
        });
    },

    refreshAll() {
      document.querySelectorAll(".tagify-inline-editor").forEach((control) => {
        this.renderControl(
          control,
          control.dataset.tagifyTrackUri,
          control.dataset.tagifyCompact === "true",
        );
      });
    },

    closeMenu() {
      this.openMenu?.remove();
      this.openMenu = null;
    },

    showMenu(trackUri, x, y) {
      this.closeMenu();
      const scope = this.getEditScope(trackUri);
      const menu = document.createElement("div");
      menu.className = "tagify-inline-menu";
      menu.style.position = "fixed";
      menu.style.left = "0";
      menu.style.top = "0";
      menu.style.visibility = "hidden";
      menu.style.zIndex = "10000";
      menu.style.boxSizing = "border-box";
      menu.style.width = "280px";
      menu.style.maxWidth = "calc(100vw - 16px)";
      menu.style.overflowY = "auto";
      menu.style.padding = "8px";
      menu.style.border = "1px solid var(--spice-button, #555)";
      menu.style.borderRadius = "8px";
      menu.style.background = "var(--spice-sidebar, #282828)";
      menu.style.boxShadow = "0 8px 24px rgba(0,0,0,.4)";
      menu.setAttribute("role", "menu");

      const section = (label) => {
        const heading = document.createElement("div");
        heading.textContent = label;
        heading.style.color = "var(--spice-subtext)";
        heading.style.fontSize = "11px";
        heading.style.fontWeight = "700";
        heading.style.margin = "6px 4px";
        menu.appendChild(heading);
      };
      const action = (label, handler) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.style.display = "block";
        button.style.width = "100%";
        button.style.padding = "6px 8px";
        button.style.border = "0";
        button.style.borderRadius = "4px";
        button.style.background = "transparent";
        button.style.color = "var(--spice-text)";
        button.style.cursor = "pointer";
        button.style.textAlign = "left";
        button.onclick = async () => {
          try {
            await handler();
            this.refreshTracks(scope.trackUris);
          } catch (error) {
            console.error("Tagify: Unable to save inline edit", error);
            Spicetify.showNotification("Tagify couldn't save that change", true);
          }
        };
        menu.appendChild(button);
        return button;
      };

      if (scope.isBulk) {
        const scopeNotice = document.createElement("div");
        scopeNotice.className = "tagify-inline-menu-scope";
        scopeNotice.textContent = `Changes apply to ${scope.trackCount} selected tracks`;
        scopeNotice.style.margin = "0 0 8px";
        scopeNotice.style.padding = "7px 8px";
        scopeNotice.style.borderRadius = "5px";
        scopeNotice.style.background =
          "var(--spice-tab-active, rgba(255,255,255,.08))";
        scopeNotice.style.color = "var(--spice-text)";
        scopeNotice.style.fontSize = "12px";
        scopeNotice.style.fontWeight = "600";
        scopeNotice.setAttribute("role", "status");
        menu.appendChild(scopeNotice);
        menu.setAttribute(
          "aria-label",
          `Tagify editor for ${scope.trackCount} selected tracks`,
        );
      } else {
        menu.setAttribute("aria-label", "Tagify track editor");
      }

      section("Energy");
      const selectedEnergyRatings = scope.trackUris.map(
        (uri) => Number(state.taggedTracks[uri]?.energy) || 0,
      );
      const commonEnergy = selectedEnergyRatings.every(
        (energy) => energy === selectedEnergyRatings[0],
      )
        ? selectedEnergyRatings[0]
        : 0;
      const energyRow = createEnergyRatingRow({
        currentEnergy: commonEnergy,
        onSelect: async (energy) => {
          try {
            await utils.saveInlineTrackUpdates(scope.trackUris, { energy });
            this.refreshTracks(scope.trackUris);
            updateEnergyRatingRowSelection(energyRow, energy);
            this.notifyBulkUpdate(scope, `Set energy ${energy} for`);
          } catch (error) {
            console.error("Tagify: Unable to save inline edit", error);
            Spicetify.showNotification("Tagify couldn't save that change", true);
          }
        },
      });
      menu.appendChild(energyRow);

      const tagButtonsById = new Map();
      const getTagSelectionState = (tagId) => {
        const appliedCount = scope.trackUris.filter((uri) =>
          utils.getTrackTagIds(state.taggedTracks[uri]).includes(tagId),
        ).length;

        return appliedCount === 0
          ? "none"
          : appliedCount === scope.trackCount
            ? "all"
            : "mixed";
      };
      const configureTagButton = (button, tagId, tagName) => {
        const selectionState = getTagSelectionState(tagId);
        const prefix =
          selectionState === "all"
            ? "✓ "
            : selectionState === "mixed"
              ? "– "
              : "";
        const actionLabel = selectionState === "all" ? "Remove" : "Add";
        const targetLabel = scope.isBulk
          ? `${scope.trackCount} selected tracks`
          : "this track";

        button.textContent = `${prefix}${tagName}`;
        const preposition = selectionState === "all" ? "from" : "to";
        button.title = `${actionLabel} ${tagName} ${preposition} ${targetLabel}`;
        button.setAttribute(
          "aria-pressed",
          selectionState === "mixed"
            ? "mixed"
            : String(selectionState === "all"),
        );
      };
      const registerTagButton = (button, tagId, tagName) => {
        const tagButtons = tagButtonsById.get(tagId) || [];
        tagButtons.push({ button, tagName });
        tagButtonsById.set(tagId, tagButtons);
        configureTagButton(button, tagId, tagName);
      };
      const refreshTagButtons = (tagId) => {
        (tagButtonsById.get(tagId) || []).forEach(({ button, tagName }) => {
          configureTagButton(button, tagId, tagName);
        });
      };
      const tagAction = async (tagId, tagName) => {
        const currentTagIdsByTrack = scope.trackUris.map((uri) =>
          utils.getTrackTagIds(state.taggedTracks[uri]),
        );
        const nextTagIdsByTrack = toggleTagIdForSelection(
          currentTagIdsByTrack,
          tagId,
        );
        const shouldRemove = currentTagIdsByTrack.every((tagIds) =>
          tagIds.includes(tagId),
        );
        const nextTagIdsByUri = new Map(
          scope.trackUris.map((uri, index) => [
            uri,
            nextTagIdsByTrack[index],
          ]),
        );

        state.recentTagIds = addRecentTag(state.recentTagIds, tagId);
        await utils.saveInlineTrackUpdates(scope.trackUris, (_, uri) => ({
          tagIds: nextTagIdsByUri.get(uri),
        }));
        refreshTagButtons(tagId);
        const actionVerb = shouldRemove ? "Removed" : "Added";
        const preposition = shouldRemove ? "from" : "to";
        this.notifyBulkUpdate(
          scope,
          `${actionVerb} ${tagName} ${preposition}`,
        );
      };
      const recentTags = state.recentTagIds
        .map((tagId) => state.tagLookup.get(tagId))
        .filter(Boolean);
      if (recentTags.length > 0) {
        section("Recent tags");
        recentTags.forEach((tag) => {
          const button = action(tag.name, () => tagAction(tag.tagId, tag.name));
          registerTagButton(button, tag.tagId, tag.name);
        });
      }

      if (state.tagCategories.length > 0) {
        section("Tags");
        const sortedCategories = getSortedMenuTagCategories(
          state.tagCategories,
          localStorage,
        );
        sortedCategories.forEach((category) => {
          const categoryDetails = document.createElement("details");
          const categorySummary = document.createElement("summary");
          categorySummary.textContent = category.name;
          categorySummary.style.cursor = "pointer";
          categorySummary.style.padding = "5px 4px";
          categoryDetails.appendChild(categorySummary);
          category.subcategories.forEach((subcategory) => {
            const subcategoryDetails = document.createElement("details");
            subcategoryDetails.style.marginLeft = "12px";
            const subcategorySummary = document.createElement("summary");
            subcategorySummary.textContent = subcategory.name;
            subcategorySummary.style.cursor = "pointer";
            subcategorySummary.style.padding = "4px";
            subcategoryDetails.appendChild(subcategorySummary);
            subcategory.tags.forEach((tag) => {
              const tagButton = document.createElement("button");
              tagButton.type = "button";
              tagButton.textContent = tag.name;
              tagButton.style.display = "block";
              tagButton.style.margin = "3px 4px 3px 12px";
              tagButton.style.border = "0";
              tagButton.style.background = "transparent";
              tagButton.style.color = "var(--spice-text)";
              tagButton.style.cursor = "pointer";
              registerTagButton(tagButton, tag.id, tag.name);
              tagButton.onclick = async () => {
                try {
                  await tagAction(tag.id, tag.name);
                  this.refreshTracks(scope.trackUris);
                } catch (error) {
                  console.error("Tagify: Unable to save inline tag", error);
                  Spicetify.showNotification("Tagify couldn't save that tag", true);
                }
              };
              subcategoryDetails.appendChild(tagButton);
            });
            categoryDetails.appendChild(subcategoryDetails);
          });
          menu.appendChild(categoryDetails);
        });
      }

      document.body.appendChild(menu);
      positionInlineMenu(menu, x, y);
      menu.style.visibility = "visible";
      this.openMenu = menu;
      const closeOnOutsideClick = (event) => {
        if (!menu.contains(event.target)) {
          this.closeMenu();
          document.removeEventListener("mousedown", closeOnOutsideClick, true);
        }
      };
      setTimeout(
        () => document.addEventListener("mousedown", closeOnOutsideClick, true),
        0,
      );
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
          error,
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
                  node.querySelector?.(".main-trackList-indexable")),
            );

            if (addedTracklists.length > 0) {
              this.updateTracklists();

              // Observe each tracklist for changes
              const tracklists = document.getElementsByClassName(
                "main-trackList-indexable",
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
        "main-trackList-indexable",
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
        "main-trackList-indexable",
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
          ".main-trackList-trackListRow",
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
          (row) => !row.querySelector(".tagify-info"),
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
        ".main-trackList-trackListRow",
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
        ".main-trackList-trackListHeaderRow",
      );
      if (header && !header.querySelector(".tagify-header")) {
        this.addColumnToHeader(header);
      }

      // Only process unprocessed track rows
      const trackRows = tracklist.querySelectorAll(
        ".main-trackList-trackListRow",
      );
      const unprocessedRows = Array.from(trackRows).filter(
        (row) => !row.querySelector(".tagify-info"),
      );

      Logger.log(
        `Processing ${unprocessedRows.length} new rows out of ${trackRows.length} total`,
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
          template += ` [var${i}] 150px`;
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
        '[class*="main-trackList-rowSection"]',
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
        '[class*="main-trackList-rowSection"]',
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

      container.appendChild(inlineEditor.createControl(trackUri));
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
      if (!state.taggedTracks[trackUri]) {
        return "";
      }

      const track = state.taggedTracks[trackUri];
      const trackTags = utils.getTrackTags(track);
      if (trackTags.length === 0) {
        return "";
      }

      // Process tags that have category structure (newer format)
      const structuredTags = trackTags.filter(
        (tag) => tag.categoryId && tag.subcategoryId && tag.tagId,
      );

      if (structuredTags.length > 0) {
        // Use cached categories from state instead of localStorage
        const categories = state.tagCategories;

        // Process structured tags with categories
        if (categories.length > 0) {
          const tagsByCategory = {};

          structuredTags.forEach((tag) => {
            const category = categories.find((c) => c.id === tag.categoryId);
            if (category) {
              const categoryName = category.name;
              const subcategory = category.subcategories.find(
                (s) => s.id === tag.subcategoryId,
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
          Object.values(tagsByCategory).forEach((subcategories) => {
            Object.values(subcategories).forEach((tags) => {
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
      const simpleTags = trackTags
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
          this.updateNowPlayingWidget,
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
            ".main-nowPlayingWidget-nowPlaying .main-trackInfo-container",
          );
          trackInfo.after(state.nowPlayingWidgetTagInfo);
        }

        // Make sure our element is visible
        state.nowPlayingWidgetTagInfo.style.display = "flex";

        state.nowPlayingWidgetTagInfo.title = "";
        state.nowPlayingWidgetTagInfo.replaceChildren();
        state.nowPlayingWidgetTagInfo.appendChild(
          inlineEditor.createControl(trackUri, true),
        );

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

  // Playlist page smart playlist indicator feature
  const smartPlaylistIndicatorEnhancer = {
    observer: null,
    historyUnlisten: null,
    resizeHandler: null,
    updateScheduled: false,
    needsLayoutRecalc: true,
    indicatorClassName: "tagify-smart-playlist-indicator",
    indicatorPulseStyleId: "tagify-smart-playlist-pulse-style",
    floatingPopover: null,

    initialize() {
      if (state.initialized.smartPlaylistIndicator) return;

      // Keep the indicator synced across route changes, DOM rerenders, and viewport resize.
      this.setupHistoryListener();
      this.setupObserver();
      this.setupResizeListener();
      this.scheduleUpdate();

      state.initialized.smartPlaylistIndicator = true;
    },

    setupHistoryListener() {
      if (
        !Spicetify?.Platform?.History ||
        typeof Spicetify.Platform.History.listen !== "function"
      ) {
        return;
      }

      try {
        const unlisten = Spicetify.Platform.History.listen(() => {
          this.scheduleUpdate();
        });

        if (typeof unlisten === "function") {
          this.historyUnlisten = unlisten;
        }
      } catch (error) {
        Logger.warn("Error setting smart playlist history listener:", error);
      }
    },

    setupObserver() {
      if (this.observer) {
        this.observer.disconnect();
      }

      this.observer = new MutationObserver(() => {
        this.scheduleUpdate();
      });

      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    },

    setupResizeListener() {
      if (this.resizeHandler) {
        return;
      }

      this.resizeHandler = () => {
        this.needsLayoutRecalc = true;
        this.scheduleUpdate();
      };

      window.addEventListener("resize", this.resizeHandler);
    },

    ensureIndicatorPulseStyles() {
      if (document.getElementById(this.indicatorPulseStyleId)) {
        return;
      }

      const styleElement = document.createElement("style");
      styleElement.id = this.indicatorPulseStyleId;
      styleElement.textContent = `
        @keyframes tagify-smart-status-pulse {
          0% {
            opacity: 0.70;
            transform: scale(0.9);
            filter: drop-shadow(0 0 0 rgba(29, 185, 84, 0));
          }
          50% {
            opacity: 1;
            transform: scale(1.08);
            filter: drop-shadow(0 0 4px rgba(29, 185, 84, 0.55));
          }
          100% {
            opacity: 0.70;
            transform: scale(0.9);
            filter: drop-shadow(0 0 0 rgba(29, 185, 84, 0));
          }
        }
      `;

      document.head.appendChild(styleElement);
    },

    scheduleUpdate() {
      if (this.updateScheduled) return;
      this.updateScheduled = true;

      requestAnimationFrame(() => {
        this.updateScheduled = false;
        this.renderIndicator();
      });
    },

    renderIndicator() {
      const playlistId = utils.getCurrentPlaylistId();
      const albumId = utils.getCurrentAlbumId();
      const entityId = playlistId || albumId;

      if (!entityId) {
        this.removeIndicator();
        return;
      }

      const entityType = playlistId ? "playlist" : "album";
      const playlistUri = `spotify:${entityType}:${entityId}`;
      const playlistData = state.taggedPlaylists[playlistUri];
      const smartPlaylist = playlistId
        ? utils.getSmartPlaylistByPlaylistId(playlistId)
        : null;
      const playlistTags = utils.getPlaylistTags(playlistData);
      const rating = Number(playlistData?.rating) || 0;
      const energy = Number(playlistData?.energy) || 0;

      if (!smartPlaylist && playlistTags.length === 0 && rating === 0 && energy === 0) {
        this.removeIndicator();
        return;
      }

      const insertionPoint = this.findIndicatorInsertionPoint();
      if (!insertionPoint) {
        return;
      }

      // Place the indicator next to playlist search controls when possible.
      const indicator = this.getOrCreateIndicator();
      let movedIndicator = false;

      const { parent, anchor, alignToEnd } = insertionPoint;
      indicator.dataset.tagifyAlignEnd = alignToEnd ? "true" : "false";

      if (anchor) {
        if (
          indicator.parentElement !== parent ||
          indicator.nextSibling !== anchor
        ) {
          parent.insertBefore(indicator, anchor);
          movedIndicator = true;
        }
      } else {
        const shouldMoveToEnd =
          indicator.parentElement !== parent || indicator.nextSibling !== null;

        if (shouldMoveToEnd) {
          parent.appendChild(indicator);
          movedIndicator = true;
        }
      }

      if (movedIndicator) {
        this.needsLayoutRecalc = true;
      }

      this.updateIndicatorContent(indicator, {
        smartPlaylist,
        playlistUri,
        playlistTags,
        rating,
        energy,
        entityType,
      });
    },

    findIndicatorInsertionPoint() {
      const searchInputContainer = document.querySelector(
        ".main-actionBar-ActionBarRow .x-filterBox-filterInputContainer",
      );

      if (
        searchInputContainer instanceof HTMLElement &&
        searchInputContainer.parentElement instanceof HTMLElement
      ) {
        return {
          parent: searchInputContainer.parentElement,
          anchor: searchInputContainer,
          alignToEnd: false,
        };
      }

      const sortDropdown = document.querySelector(
        ".main-actionBar-ActionBarRow .x-sortBox-sortDropdown",
      );

      if (
        sortDropdown instanceof HTMLElement &&
        sortDropdown.parentElement instanceof HTMLElement
      ) {
        return {
          parent: sortDropdown.parentElement,
          anchor: sortDropdown,
          alignToEnd: false,
        };
      }

      const actionBarContainer = document.querySelector(
        'main [data-testid="action-bar-row"], main .main-actionBar-ActionBarRow, .main-actionBar-ActionBarRow',
      );

      if (
        actionBarContainer instanceof HTMLElement &&
        actionBarContainer.querySelector("button, a")
      ) {
        return {
          parent: actionBarContainer,
          anchor: null,
          alignToEnd: true,
        };
      }

      const headerContainer = document.querySelector(
        'main [data-testid="entityHeader"], main .main-entityHeader-container',
      );

      if (headerContainer instanceof HTMLElement) {
        return {
          parent: headerContainer,
          anchor: null,
          alignToEnd: true,
        };
      }

      return null;
    },

    getOrCreateIndicator() {
      const existingIndicator = document.querySelector(
        `.${this.indicatorClassName}`,
      );

      if (existingIndicator instanceof HTMLElement) {
        return existingIndicator;
      }

      this.ensureIndicatorPulseStyles();

      const indicator = document.createElement("div");
      indicator.className = this.indicatorClassName;
      this.applyIndicatorContainerBaseStyles(indicator);

      return indicator;
    },

    applyIndicatorContainerBaseStyles(indicator) {
      indicator.style.display = "inline-flex";
      indicator.style.alignItems = "center";
      indicator.style.gap = "6px";
      indicator.style.padding = "4px 10px";
      indicator.style.borderRadius = "999px";
      indicator.style.fontSize = "12px";
      indicator.style.fontWeight = "600";
      indicator.style.lineHeight = "1";
      indicator.style.marginLeft = "8px";
      indicator.style.marginRight = "8px";
      indicator.style.whiteSpace = "nowrap";
      indicator.style.pointerEvents = "auto";
      indicator.style.position = "relative";
      indicator.style.flex = "0 1 auto";
      indicator.style.cursor = "default";
      indicator.tabIndex = 0;
    },

    applyIndicatorContentStyles(content, mode) {
      content.style.display = "inline-flex";
      content.style.alignItems = "center";
      content.style.gap = mode === "mini" ? "0" : "6px";
    },

    applyIndicatorDotStyles(dot, isActive, dotColor) {
      dot.style.color = dotColor;
      dot.style.fontSize = "10px";
      dot.style.lineHeight = "1";

      if (isActive) {
        dot.style.animation = "tagify-smart-status-pulse 1.7s ease-in-out infinite";
      } else {
        dot.style.animation = "none";
      }
    },

    applyIndicatorLabelStyles(label) {
      label.textContent = "Smart Playlist";
      label.style.fontSize = "12px";
      label.style.fontWeight = "600";
      label.style.letterSpacing = "normal";
    },

    buildIndicatorContent({ dotColor, isActive, mode }) {
      const content = document.createElement("div");
      this.applyIndicatorContentStyles(content, mode);

      const marker = document.createElement("span");
      marker.textContent = "●";
      this.applyIndicatorDotStyles(marker, isActive, dotColor);
      content.appendChild(marker);

      if (mode === "mini") {
        return content;
      }

      const label = document.createElement("span");
      this.applyIndicatorLabelStyles(label);
      content.appendChild(label);

      return content;
    },

    buildPlaylistTagChip({ playlistTags, playlistUri, mode, entityType }) {
      if (!Array.isArray(playlistTags) || playlistTags.length === 0) {
        return null;
      }

      const entityLabel = entityType === "album" ? "Album" : "Playlist";
      const labels = Array.from(
        new Set(
          playlistTags
            .map((tag) => tag?.name || tag?.tag || tag?.tagId)
            .filter(Boolean),
        ),
      );
      const visibleLabels = labels.slice(0, 3);
      const hiddenCount = Math.max(0, labels.length - visibleLabels.length);

      const chip = document.createElement("button");
      chip.type = "button";
      chip.style.display = "inline-flex";
      chip.style.alignItems = "center";
      chip.style.gap = "6px";
      chip.style.maxWidth = mode === "mini" ? "96px" : "260px";
      chip.style.border = "1px solid rgba(255, 255, 255, 0.30)";
      chip.style.borderRadius = "999px";
      chip.style.background = "rgba(255, 255, 255, 0.08)";
      chip.style.color = "var(--spice-text)";
      chip.style.cursor = "pointer";
      chip.style.fontSize = "12px";
      chip.style.fontWeight = "600";
      chip.style.lineHeight = "1";
      chip.style.padding = mode === "mini" ? "6px 8px" : "9px 10px";
      chip.style.whiteSpace = "nowrap";
      chip.title = `${entityLabel} tags: ${labels.join(", ")}`;
      chip.setAttribute("aria-label", `${entityLabel} tags: ${labels.join(", ")}`);

      const prefix = document.createElement("span");
      prefix.textContent = mode === "mini" ? "Tags" : "Tagify";
      prefix.style.color = "#1DB954";
      prefix.style.fontWeight = "700";
      chip.appendChild(prefix);

      if (mode !== "mini") {
        const label = document.createElement("span");
        label.textContent = `${visibleLabels.join(", ")}${
          hiddenCount > 0 ? ` +${hiddenCount}` : ""
        }`;
        label.style.overflow = "hidden";
        label.style.textOverflow = "ellipsis";
        chip.appendChild(label);
      }

      chip.onclick = (event) => {
        event.stopPropagation();
        Spicetify.Platform.History.push({
          pathname: `/${APP_NAME}`,
          search: `?playlistUri=${encodeURIComponent(playlistUri)}`,
          state: { playlistUri },
        });
      };

      return chip;
    },

    buildPlaylistValueChip({ label, title, playlistUri, mode }) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.style.display = "inline-flex";
      chip.style.alignItems = "center";
      chip.style.border = "1px solid rgba(255, 255, 255, 0.30)";
      chip.style.borderRadius = "999px";
      chip.style.background = "rgba(255, 255, 255, 0.08)";
      chip.style.color = "var(--spice-text)";
      chip.style.cursor = "pointer";
      chip.style.fontSize = "12px";
      chip.style.fontWeight = "700";
      chip.style.lineHeight = "1";
      chip.style.padding = mode === "mini" ? "6px 8px" : "9px 10px";
      chip.style.whiteSpace = "nowrap";
      chip.title = title;
      chip.setAttribute("aria-label", title);
      chip.textContent = label;

      chip.onclick = (event) => {
        event.stopPropagation();
        Spicetify.Platform.History.push({
          pathname: `/${APP_NAME}`,
          search: `?playlistUri=${encodeURIComponent(playlistUri)}`,
          state: { playlistUri },
        });
      };

      return chip;
    },

    buildCombinedIndicatorContent(
      renderContext,
      playlistTags,
      playlistUri,
      mode,
      { rating, energy, entityType },
    ) {
      const content = document.createElement("div");
      content.style.display = "inline-flex";
      content.style.alignItems = "center";
      content.style.gap = mode === "mini" ? "4px" : "6px";
      content.style.minWidth = "0";

      if (renderContext.smartPlaylist) {
        content.appendChild(this.buildIndicatorContent({ ...renderContext, mode }));
      }

      const playlistTagChip = this.buildPlaylistTagChip({
        playlistTags,
        playlistUri,
        mode,
        entityType,
      });
      if (playlistTagChip) {
        content.appendChild(playlistTagChip);
      }

      const entityLabel = entityType === "album" ? "Album" : "Playlist";
      if (rating > 0) {
        content.appendChild(
          this.buildPlaylistValueChip({
            label: `${rating}★`,
            title: `${entityLabel} star rating: ${rating}`,
            playlistUri,
            mode,
          }),
        );
      }

      if (energy > 0) {
        content.appendChild(
          this.buildPlaylistValueChip({
            label: `E${energy}`,
            title: `${entityLabel} energy rating: ${energy}`,
            playlistUri,
            mode,
          }),
        );
      }

      return content;
    },

    applyContainerModeStyles(indicator, mode) {
      const alignToEnd = indicator.dataset.tagifyAlignEnd === "true";

      if (mode === "mini") {
        indicator.style.padding = "4px 6px";
        indicator.style.marginLeft = alignToEnd ? "auto" : "4px";
        indicator.style.marginRight = "4px";
      } else {
        indicator.style.padding = "9px";
        indicator.style.marginLeft = alignToEnd ? "auto" : "8px";
        indicator.style.marginRight = "8px";
      }
    },

    getActionBarOverflow(indicator) {
      const actionBar = indicator.closest(".main-actionBar-ActionBarRow");
      if (!(actionBar instanceof HTMLElement)) {
        return 0;
      }

      return Math.max(0, actionBar.scrollWidth - actionBar.clientWidth);
    },

    fitIndicatorDisplayMode(
      indicator,
      renderContext,
      playlistTags,
      playlistUri,
      playlistValues,
    ) {
      // Two-stage responsive rendering: prefer full label, then fall back to mini dot.
      const displayModes = ["full", "mini"];
      let selectedMode = "mini";

      for (const mode of displayModes) {
        this.applyContainerModeStyles(indicator, mode);
        indicator.replaceChildren(
          this.buildCombinedIndicatorContent(
            renderContext,
            playlistTags,
            playlistUri,
            mode,
            playlistValues,
          ),
        );

        const overflow = this.getActionBarOverflow(indicator);
        if (overflow <= 1 || mode === "mini") {
          selectedMode = mode;
          break;
        }
      }

      indicator.dataset.tagifyDisplayMode = selectedMode;
    },

    resolveTagFilterLabel(filter) {
      if (typeof filter === "string") {
        return utils.resolveTagById(filter)?.name || filter;
      }

      if (!filter || typeof filter !== "object") {
        return "Unknown tag";
      }

      const resolvedTag = utils.resolveTagById(filter.tagId);
      if (resolvedTag) {
        return resolvedTag.name;
      }

      const categories = Array.isArray(state.tagCategories)
        ? state.tagCategories
        : [];

      const category = categories.find(
        (candidate) => candidate.id === filter.categoryId,
      );
      if (!category) {
        return filter.tagId || "Unknown tag";
      }

      const subcategory = Array.isArray(category.subcategories)
        ? category.subcategories.find(
            (candidate) => candidate.id === filter.subcategoryId,
          )
        : null;
      if (!subcategory) {
        return filter.tagId || "Unknown tag";
      }

      const tag = Array.isArray(subcategory.tags)
        ? subcategory.tags.find((candidate) => candidate.id === filter.tagId)
        : null;

      return tag?.name || filter.tagId || "Unknown tag";
    },

    formatTagFilterList(filters) {
      if (!Array.isArray(filters) || filters.length === 0) {
        return "None";
      }

      const uniqueLabels = Array.from(
        new Set(filters.map((filter) => this.resolveTagFilterLabel(filter))),
      );
      return uniqueLabels.join(", ");
    },

    normalizeIncludeTagFormula(criteria) {
      const legacyGroups = Array.isArray(criteria.includeTagGroups)
        ? criteria.includeTagGroups
        : [];
      const rawClauses = Array.isArray(criteria.includeTagClauses)
        ? criteria.includeTagClauses
        : legacyGroups.map((group) => ({
            tagIds: Array.isArray(group) ? group : [],
            excludedTagIds: [],
            operator: "OR",
          }));
      const rawConnectors = Array.isArray(criteria.clauseConnectors)
        ? criteria.clauseConnectors
        : Array(Math.max(0, legacyGroups.length - 1)).fill("AND");
      const normalizedClauses = [];
      const normalizedConnectors = [];
      const seenTagIds = new Set();
      const normalizeLaneTagIds = (filters) =>
        Array.from(
          new Set(
            (Array.isArray(filters) ? filters : [])
              .map((filter) => utils.serializeTagFilter(filter))
              .filter((tagId) => {
                if (!tagId || seenTagIds.has(tagId)) {
                  return false;
                }

                seenTagIds.add(tagId);
                return true;
              }),
          ),
        );

      rawClauses.forEach((clause, clauseIndex) => {
        const nextTagIds = normalizeLaneTagIds(clause?.tagIds);
        const nextExcludedTagIds = normalizeLaneTagIds(clause?.excludedTagIds);

        if (nextTagIds.length === 0 && nextExcludedTagIds.length === 0) {
          return;
        }

        if (normalizedClauses.length > 0) {
          normalizedConnectors.push(
            rawConnectors[clauseIndex - 1] === "OR" ? "OR" : "AND",
          );
        }

        normalizedClauses.push({
          tagIds: nextTagIds,
          excludedTagIds: nextExcludedTagIds,
          operator: clause?.operator === "AND" ? "AND" : "OR",
        });
      });

      const legacyExcludedTagIds = normalizeLaneTagIds(criteria.excludedTagFilters);
      if (legacyExcludedTagIds.length > 0) {
        if (normalizedClauses.length > 0) {
          normalizedConnectors.push("AND");
        }

        normalizedClauses.push({
          tagIds: [],
          excludedTagIds: legacyExcludedTagIds,
          operator: "OR",
        });
      }

      return {
        clauses: normalizedClauses,
        connectors: normalizedConnectors.slice(
          0,
          Math.max(0, normalizedClauses.length - 1),
        ),
      };
    },

    formatIncludeTagFormula(criteria) {
      const normalizedFormula = this.normalizeIncludeTagFormula(criteria);

      if (normalizedFormula.clauses.length === 0) {
        return null;
      }

      const formatClause = (clause) => {
        const positiveText =
          clause.tagIds.length === 0
            ? ""
            : clause.tagIds.length > 1
              ? `(${clause.tagIds
                  .map((tagId) => this.resolveTagFilterLabel(tagId))
                  .filter(Boolean)
                  .join(` ${clause.operator} `)})`
              : this.resolveTagFilterLabel(clause.tagIds[0]);
        const negativeTerms = Array.isArray(clause.excludedTagIds)
          ? clause.excludedTagIds
              .map((tagId) => this.resolveTagFilterLabel(tagId))
              .filter(Boolean)
              .map((label) => `NOT ${label}`)
          : [];
        const terms = positiveText ? [positiveText, ...negativeTerms] : negativeTerms;

        return {
          text: terms.join(" AND "),
          hasInternalAnd: terms.length > 1,
        };
      };

      const orSeparatedSegments = [];
      const firstClause = formatClause(normalizedFormula.clauses[0]);
      let currentSegment = firstClause.text;
      let currentSegmentClauseCount = 1;
      let currentSegmentHasInternalAnd = firstClause.hasInternalAnd;

      normalizedFormula.connectors.forEach((connector, connectorIndex) => {
        const nextClause = formatClause(
          normalizedFormula.clauses[connectorIndex + 1],
        );

        if (connector === "AND") {
          currentSegment = `${currentSegment} AND ${nextClause.text}`;
          currentSegmentClauseCount += 1;
          currentSegmentHasInternalAnd = true;
          return;
        }

        orSeparatedSegments.push({
          clauseCount: currentSegmentClauseCount,
          hasInternalAnd: currentSegmentHasInternalAnd,
          text: currentSegment,
        });
        currentSegment = nextClause.text;
        currentSegmentClauseCount = 1;
        currentSegmentHasInternalAnd = nextClause.hasInternalAnd;
      });

      orSeparatedSegments.push({
        clauseCount: currentSegmentClauseCount,
        hasInternalAnd: currentSegmentHasInternalAnd,
        text: currentSegment,
      });

      const shouldWrapAndSegments = orSeparatedSegments.length > 1;

      return orSeparatedSegments
        .map((segment) =>
          shouldWrapAndSegments &&
          (segment.clauseCount > 1 || segment.hasInternalAnd)
            ? `(${segment.text})`
            : segment.text,
        )
        .join(" OR ");
    },

    formatRange(minValue, maxValue) {
      const hasMin = typeof minValue === "number";
      const hasMax = typeof maxValue === "number";

      if (!hasMin && !hasMax) {
        return null;
      }

      if (hasMin && hasMax) {
        return `${minValue}-${maxValue}`;
      }

      if (hasMin) {
        return `>= ${minValue}`;
      }

      return `<= ${maxValue}`;
    },

    getCamelotKeyDisplay(criteria) {
      if (
        Array.isArray(criteria.camelotKeyFilters) &&
        criteria.camelotKeyFilters.length > 0
      ) {
        const uniqueKeys = Array.from(new Set(criteria.camelotKeyFilters));
        if (uniqueKeys.length <= 6) {
          return uniqueKeys.join(", ");
        }
        return `${uniqueKeys.slice(0, 6).join(", ")} +${
          uniqueKeys.length - 6
        } more`;
      }

      const hasMin = typeof criteria.camelotMinFilter === "string";
      const hasMax = typeof criteria.camelotMaxFilter === "string";
      if (!hasMin && !hasMax) {
        return null;
      }

      if (hasMin && hasMax) {
        return `${criteria.camelotMinFilter}-${criteria.camelotMaxFilter}`;
      }

      if (hasMin) {
        return `>= ${criteria.camelotMinFilter}`;
      }

      return `<= ${criteria.camelotMaxFilter}`;
    },

    getCriteriaRows(criteria) {
      const rows = [];

      const includeTagFormula = this.formatIncludeTagFormula(criteria);

      if (includeTagFormula) {
        rows.push({
          label: "Match",
          value: includeTagFormula,
        });
      }

      if (
        Array.isArray(criteria.ratingFilters) &&
        criteria.ratingFilters.length > 0
      ) {
        const sortedRatings = [...criteria.ratingFilters].sort((a, b) => a - b);
        rows.push({
          label: "Ratings",
          value: sortedRatings.map((rating) => `${rating}★`).join(", "),
        });
      }

      const energyRange = this.formatRange(
        criteria.energyMinFilter,
        criteria.energyMaxFilter,
      );
      if (energyRange) {
        rows.push({
          label: "Energy",
          value: energyRange,
        });
      }

      const bpmRange = this.formatRange(
        criteria.bpmMinFilter,
        criteria.bpmMaxFilter,
      );
      if (bpmRange) {
        rows.push({
          label: "BPM",
          value: bpmRange,
        });
      }

      const camelotDisplay = this.getCamelotKeyDisplay(criteria);
      if (camelotDisplay) {
        rows.push({
          label: "Camelot",
          value: camelotDisplay,
        });
      }

      if (rows.length === 0) {
        rows.push({
          label: "Rules",
          value: "No criteria configured",
        });
      }

      return rows;
    },

    hashString(value) {
      let hash = 0;
      for (let i = 0; i < value.length; i++) {
        hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
      }
      return hash.toString(36);
    },

    buildCriteriaStateKey(criteria) {
      const stablePayload = {
        includeFormula: this.normalizeIncludeTagFormula(criteria),
        ratings: Array.isArray(criteria.ratingFilters)
          ? [...criteria.ratingFilters].sort((a, b) => a - b)
          : [],
        energyMin: criteria.energyMinFilter ?? null,
        energyMax: criteria.energyMaxFilter ?? null,
        bpmMin: criteria.bpmMinFilter ?? null,
        bpmMax: criteria.bpmMaxFilter ?? null,
        camelotKeys: Array.isArray(criteria.camelotKeyFilters)
          ? [...criteria.camelotKeyFilters].sort()
          : [],
        camelotMin: criteria.camelotMinFilter ?? null,
        camelotMax: criteria.camelotMaxFilter ?? null,
      };

      return this.hashString(JSON.stringify(stablePayload));
    },

    createCriteriaPopover(criteriaRows) {
      const popover = document.createElement("div");
      popover.style.minWidth = "260px";
      popover.style.maxWidth = "360px";
      popover.style.padding = "10px";
      popover.style.borderRadius = "10px";
      popover.style.border = "1px solid var(--spice-button-disabled)";
      popover.style.backgroundColor = "var(--spice-sidebar)";
      popover.style.color = "var(--spice-text)";
      popover.style.boxShadow = "0 8px 22px rgba(0, 0, 0, 0.35)";
      popover.style.whiteSpace = "normal";

      const heading = document.createElement("div");
      heading.textContent = "Smart Criteria";
      heading.style.fontSize = "11px";
      heading.style.fontWeight = "700";
      heading.style.letterSpacing = "0.3px";
      heading.style.textTransform = "uppercase";
      heading.style.color = "var(--spice-subtext)";
      heading.style.marginBottom = "8px";
      popover.appendChild(heading);

      criteriaRows.forEach(({ label, value }) => {
        const row = document.createElement("div");
        row.style.display = "grid";
        row.style.gridTemplateColumns = "68px 1fr";
        row.style.columnGap = "8px";
        row.style.rowGap = "4px";
        row.style.alignItems = "start";
        row.style.marginBottom = "6px";

        const labelElement = document.createElement("div");
        labelElement.textContent = label;
        labelElement.style.fontSize = "11px";
        labelElement.style.fontWeight = "600";
        labelElement.style.color = "var(--spice-subtext)";

        const valueElement = document.createElement("div");
        valueElement.textContent = value;
        valueElement.style.fontSize = "11px";
        valueElement.style.lineHeight = "1.35";
        valueElement.style.wordBreak = "break-word";

        row.append(labelElement, valueElement);
        popover.appendChild(row);
      });

      return popover;
    },

    ensureFloatingPopover() {
      if (
        this.floatingPopover &&
        document.body.contains(this.floatingPopover)
      ) {
        return this.floatingPopover;
      }

      // Render popover at document root to avoid action-bar overflow clipping.
      const popover = document.createElement("div");
      popover.className = "tagify-smart-playlist-popover";
      popover.style.display = "none";
      popover.style.position = "fixed";
      popover.style.zIndex = "2147483647";
      popover.style.pointerEvents = "none";
      popover.style.whiteSpace = "normal";

      document.body.appendChild(popover);
      this.floatingPopover = popover;

      return popover;
    },

    showFloatingPopover(indicator, criteriaRows) {
      const popover = this.ensureFloatingPopover();
      popover.replaceChildren(this.createCriteriaPopover(criteriaRows));

      popover.style.display = "block";

      const indicatorRect = indicator.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();

      const viewportPadding = 8;
      let left = indicatorRect.right - popoverRect.width;
      let top = indicatorRect.bottom + 8;

      if (left < viewportPadding) {
        left = viewportPadding;
      }

      const maxLeft = window.innerWidth - popoverRect.width - viewportPadding;
      if (left > maxLeft) {
        left = maxLeft;
      }

      if (top + popoverRect.height > window.innerHeight - viewportPadding) {
        top = indicatorRect.top - popoverRect.height - 8;
      }

      if (top < viewportPadding) {
        top = viewportPadding;
      }

      popover.style.left = `${Math.round(left)}px`;
      popover.style.top = `${Math.round(top)}px`;
    },

    hideFloatingPopover() {
      if (this.floatingPopover) {
        this.floatingPopover.style.display = "none";
      }
    },

    updateIndicatorContent(
      indicator,
      { smartPlaylist, playlistUri, playlistTags, rating, energy, entityType },
    ) {
      const isActive = smartPlaylist?.isActive !== false;
      const dotColor = isActive ? "#1DB954" : "#F59E0B";
      const borderColor = isActive
        ? "rgba(255, 255, 255, 0.30)"
        : "rgba(245, 158, 11, 0.45)";
      const criteria = smartPlaylist?.criteria || {};
      const criteriaRows = this.getCriteriaRows(criteria);
      const criteriaKey = this.buildCriteriaStateKey(criteria);
      const playlistTagKey = (playlistTags || [])
        .map((tag) => tag?.tagId || tag?.id || tag?.name)
        .filter(Boolean)
        .join("|");
      const stateKey = `${playlistUri}:${smartPlaylist ? isActive ? "active" : "paused" : "not-smart"}:${criteriaKey}:${playlistTagKey}:${rating}:${energy}:${entityType}`;
      // Skip expensive style/content rewrites unless the smart-playlist state changed.
      const stateChanged = indicator.dataset.tagifyState !== stateKey;
      const renderContext = {
        dotColor,
        isActive,
        smartPlaylist,
      };

      if (stateChanged) {
        indicator.style.color = "var(--spice-text)";
        indicator.style.backgroundColor = "transparent";
        indicator.style.border = smartPlaylist ? `1px solid ${borderColor}` : "0";

        const showPopover = () => {
          if (smartPlaylist) {
            this.showFloatingPopover(indicator, criteriaRows);
            indicator.style.zIndex = "20";
          }
        };
        const hidePopover = () => {
          this.hideFloatingPopover();
          indicator.style.zIndex = "";
        };

        indicator.onmouseenter = showPopover;
        indicator.onmouseleave = hidePopover;
        indicator.onfocus = showPopover;
        indicator.onblur = hidePopover;

        indicator.title = smartPlaylist
          ? isActive
            ? "Smart playlist. Hover for criteria details."
            : "Smart playlist is paused. Hover for criteria details."
          : "";
        indicator.setAttribute(
          "aria-label",
          smartPlaylist
            ? isActive
              ? "Smart playlist indicator. Focus for criteria details."
              : "Smart playlist paused indicator. Focus for criteria details."
            : `Tagged ${entityType} indicator.`,
        );
        indicator.dataset.tagifyState = stateKey;
        this.needsLayoutRecalc = true;
      }

      if (
        stateChanged ||
        this.needsLayoutRecalc ||
        !indicator.dataset.tagifyDisplayMode
      ) {
        this.fitIndicatorDisplayMode(
          indicator,
          renderContext,
          playlistTags,
          playlistUri,
          { rating, energy, entityType },
        );
        this.needsLayoutRecalc = false;
      }
    },

    removeIndicator() {
      this.hideFloatingPopover();
      document
        .querySelectorAll(`.${this.indicatorClassName}`)
        .forEach((indicator) => indicator.remove());
    },

    disable() {
      this.removeIndicator();

      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }

      if (typeof this.historyUnlisten === "function") {
        this.historyUnlisten();
      }
      this.historyUnlisten = null;

      if (this.resizeHandler) {
        window.removeEventListener("resize", this.resizeHandler);
      }
      this.resizeHandler = null;

      if (this.floatingPopover) {
        this.floatingPopover.remove();
        this.floatingPopover = null;
      }

      const pulseStyles = document.getElementById(this.indicatorPulseStyleId);
      if (pulseStyles) {
        pulseStyles.remove();
      }

      this.needsLayoutRecalc = true;
      state.initialized.smartPlaylistIndicator = false;
    },
  };

  const artistProfileIndicatorEnhancer = {
    observer: null,
    historyUnlisten: null,
    updateScheduled: false,
    indicatorClassName: "tagify-artist-profile-indicator",

    initialize() {
      if (state.initialized.artistProfileIndicator) return;

      this.setupHistoryListener();
      this.setupObserver();
      this.scheduleUpdate();

      state.initialized.artistProfileIndicator = true;
    },

    setupHistoryListener() {
      if (
        !Spicetify?.Platform?.History ||
        typeof Spicetify.Platform.History.listen !== "function"
      ) {
        return;
      }

      try {
        const unlisten = Spicetify.Platform.History.listen(() => {
          this.scheduleUpdate();
        });

        if (typeof unlisten === "function") {
          this.historyUnlisten = unlisten;
        }
      } catch (error) {
        Logger.warn("Error setting artist profile indicator history listener:", error);
      }
    },

    setupObserver() {
      if (this.observer) {
        this.observer.disconnect();
      }

      this.observer = new MutationObserver(() => {
        this.scheduleUpdate();
      });

      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    },

    scheduleUpdate() {
      if (this.updateScheduled) return;
      this.updateScheduled = true;

      requestAnimationFrame(() => {
        this.updateScheduled = false;
        this.renderIndicator();
      });
    },

    renderIndicator() {
      const artistId = utils.getCurrentArtistId();
      if (!artistId) {
        this.removeIndicator();
        return;
      }

      const artistUri = `spotify:artist:${artistId}`;
      const artistData = state.taggedArtists[artistUri];
      const artistTags = utils.getArtistTags(artistData);
      const rating = Number(artistData?.rating) || 0;
      const energy = Number(artistData?.energy) || 0;

      if (!artistData || (artistTags.length === 0 && rating === 0 && energy === 0)) {
        this.removeIndicator();
        return;
      }

      const insertionPoint = this.findIndicatorInsertionPoint();
      if (!insertionPoint) {
        return;
      }

      const indicator = this.getOrCreateIndicator();
      const { parent, anchor } = insertionPoint;

      if (anchor) {
        if (
          indicator.parentElement !== parent ||
          indicator.nextSibling !== anchor
        ) {
          parent.insertBefore(indicator, anchor);
        }
      } else if (indicator.parentElement !== parent) {
        parent.prepend(indicator);
      }

      this.updateIndicatorContent(indicator, {
        artistUri,
        artistTags,
        rating,
        energy,
      });
    },

    findIndicatorInsertionPoint() {
      const actionBarContainer = document.querySelector(
        'main [data-testid="action-bar-row"], main .main-actionBar-ActionBarRow, .main-actionBar-ActionBarRow',
      );

      if (
        actionBarContainer instanceof HTMLElement &&
        actionBarContainer.querySelector("button, a")
      ) {
        return {
          parent: actionBarContainer,
          anchor: null,
        };
      }

      const headerContainer = document.querySelector(
        'main [data-testid="entityHeader"], main .main-entityHeader-container',
      );

      if (headerContainer instanceof HTMLElement) {
        return {
          parent: headerContainer,
          anchor: null,
        };
      }

      return null;
    },

    getOrCreateIndicator() {
      const existingIndicator = document.querySelector(
        `.${this.indicatorClassName}`,
      );

      if (existingIndicator instanceof HTMLElement) {
        return existingIndicator;
      }

      const indicator = document.createElement("button");
      indicator.type = "button";
      indicator.className = this.indicatorClassName;
      indicator.style.alignItems = "center";
      indicator.style.background = "rgba(255, 255, 255, 0.08)";
      indicator.style.border = "1px solid rgba(255, 255, 255, 0.22)";
      indicator.style.borderRadius = "999px";
      indicator.style.color = "var(--spice-text)";
      indicator.style.cursor = "pointer";
      indicator.style.display = "inline-flex";
      indicator.style.fontSize = "12px";
      indicator.style.fontWeight = "700";
      indicator.style.gap = "6px";
      indicator.style.lineHeight = "1";
      indicator.style.marginLeft = "8px";
      indicator.style.padding = "8px 10px";
      indicator.style.whiteSpace = "nowrap";

      return indicator;
    },

    buildText(label, color) {
      const element = document.createElement("span");
      element.textContent = label;
      element.style.color = color || "inherit";
      return element;
    },

    updateIndicatorContent(indicator, { artistUri, artistTags, rating, energy }) {
      const labels = Array.from(
        new Set(
          artistTags
            .map((tag) => tag?.name || tag?.tag || tag?.tagId)
            .filter(Boolean),
        ),
      );
      const visibleLabels = labels.slice(0, 2);
      const hiddenCount = Math.max(0, labels.length - visibleLabels.length);
      const parts = [
        visibleLabels.length > 0
          ? `${visibleLabels.join(", ")}${hiddenCount > 0 ? ` +${hiddenCount}` : ""}`
          : null,
        rating > 0 ? `${rating}★` : null,
        energy > 0 ? `E${energy}` : null,
      ].filter(Boolean);
      const label = parts.length > 0 ? parts.join(" · ") : "Tagged artist";
      const stateKey = `${artistUri}:${label}`;

      if (indicator.dataset.tagifyState === stateKey) {
        return;
      }

      indicator.replaceChildren(
        this.buildText("Tagify", "#1DB954"),
        this.buildText(label),
      );
      indicator.title = `Artist Tagify values: ${label}`;
      indicator.setAttribute("aria-label", `Artist Tagify values: ${label}`);
      indicator.onclick = (event) => {
        event.stopPropagation();
        Spicetify.Platform.History.push({
          pathname: `/${APP_NAME}`,
          search: `?artistUri=${encodeURIComponent(artistUri)}`,
          state: { artistUri },
        });
      };
      indicator.dataset.tagifyState = stateKey;
    },

    removeIndicator() {
      document
        .querySelectorAll(`.${this.indicatorClassName}`)
        .forEach((indicator) => indicator.remove());
    },

    disable() {
      this.removeIndicator();

      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }

      if (this.historyUnlisten) {
        this.historyUnlisten();
        this.historyUnlisten = null;
      }

      state.initialized.artistProfileIndicator = false;
    },
  };

  // Main initialization
  const initialize = async () => {
    await utils.loadTaggedTracks(); // todo: await does nothing? why ?
    settingsUtils.loadExtensionSettings();
    settingsUtils.subscribe();

    // Initialize features
    contextMenuItem.initialize();
    tracklistEnhancer.initialize();
    playbarEnhancer.initialize();
    smartPlaylistIndicatorEnhancer.initialize();
    artistProfileIndicatorEnhancer.initialize();

    const dataUpdateListener = async () => {
      await utils.loadTaggedTracks(); // todo ?
      // Refresh any UI that depends on tagged tracks
      if (state.activeExtensions.tracklistEnhancer) {
        tracklistEnhancer.updateTracklists();
      }
      inlineEditor.refreshAll();
      if (state.activeExtensions.playbarEnhancer) {
        playbarEnhancer.updateNowPlayingWidget();
      }
      smartPlaylistIndicatorEnhancer.scheduleUpdate();
      artistProfileIndicatorEnhancer.scheduleUpdate();
    };

    window.addEventListener(DATA_UPDATED_EVENT, dataUpdateListener);
    window.addEventListener(SMART_PLAYLISTS_UPDATED_EVENT, () => {
      smartPlaylistIndicatorEnhancer.scheduleUpdate();
    });
  };

  // Start initialization
  initialize();
})();
